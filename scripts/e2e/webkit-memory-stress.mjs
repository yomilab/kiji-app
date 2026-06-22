#!/usr/bin/env node
/**
 * Manual E2E: WebKit memory stress reproduction.
 *
 * This intentionally creates a large local feed library and repeated changed
 * refreshes. It is gated by KIJI_E2E_WEBKIT_STRESS=1 and should not run in
 * normal CI.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import {
  createE2eSessionDirs,
  E2E_SCHEDULER_INTERVAL_MS,
  formatE2eFailure,
  sleep,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
} from "./e2eRunner.mjs";

const execFileAsync = promisify(execFile);

const STRESS_STATION_NAME = "E2E WebKit Stress";
const DEFAULT_FEED_COUNT = 560;
const DEFAULT_ENTRIES_PER_FEED = 20;
const DEFAULT_CONTENT_KB_PER_ENTRY = 1024;
const DEFAULT_MIN_WEBKIT_MB = 2048;
const DEFAULT_TARGET_CYCLES = 2;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_PRESSURE_WINDOW_MS = 180_000;
const DEFAULT_IDLE_PLATEAU_MS = 60_000;
const DEFAULT_IDLE_DELTA_MB = 64;
const SAMPLE_INTERVAL_MS = 1000;
const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax8gL8AAAAASUVORK5CYII=",
  "base64",
);

export async function runWebKitMemoryStressE2e() {
  if (process.env.KIJI_E2E_WEBKIT_STRESS !== "1") {
    return {
      skipped: true,
      reason: "Set KIJI_E2E_WEBKIT_STRESS=1 to run the WebKit memory stress repro",
    };
  }

  const skipReason = getE2eSkipReason();
  if (skipReason) {
    return { skipped: true, reason: skipReason };
  }

  const binaryPath = await ensureE2eBundledBinary();
  if (!binaryPath) {
    const reason = isE2eRequired()
      ? "KiJi.app debug bundle missing — run npm run build:debug"
      : "No KiJi debug bundle available";
    return { skipped: true, reason };
  }

  const profile = readStressProfile();
  const server = createStressFeedServer(profile);
  const { baseUrl, fetchCounts } = await server.start();
  const opmlRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-webkit-opml-"));
  const opmlPath = path.join(opmlRoot, "webkit-memory-stress.opml");
  fs.writeFileSync(opmlPath, buildStressOpml(baseUrl, profile.feedCount));

  const initialWebKitPids = await readWebKitPidSet();
  const { homeDir, e2eDir } = createE2eSessionDirs();
  const artifactsDir = resolveArtifactsDir();
  fs.mkdirSync(artifactsDir, { recursive: true });

  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: "",
    extraEnv: {
      KIJI_E2E_BOOTSTRAP: "opml",
      KIJI_E2E_OPML_PATH: opmlPath,
      KIJI_E2E_SCHEDULER_INTERVAL_MS: String(profile.schedulerIntervalMs),
      KIJI_E2E_HIDE_UI: process.env.KIJI_E2E_HIDE_UI ?? "1",
    },
  });

  const sampler = startMemorySampler({
    appPid: child.pid,
    initialWebKitPids,
    outputPath: path.join(artifactsDir, "webkit-memory-samples.jsonl"),
  });

  try {
    const imported = await waitForEvent(
      e2eDir,
      "opml-import-complete",
      (event) => (event.payload?.feedCount ?? 0) >= profile.feedCount,
      profile.timeoutMs,
    );

    const pressureSummary = await waitForMemoryPressure({ sampler, profile });

    // Give the resource monitor one more interval when requested; the default
    // keeps this bounded for manual repro loops.
    if (profile.settleMs > 0) {
      await sleep(profile.settleMs);
    }

    await sampler.stop();
    const summary = summarizeSamples(sampler.samples);
    const logSummary = copyStressLogs(homeDir, artifactsDir);
    const heapSummary = await captureHeapSummaryIfNeeded(summary, artifactsDir);

    const result = {
      skipped: false,
      binaryPath,
      e2eDir,
      artifactsDir,
      feedCount: imported.payload?.feedCount ?? 0,
      articleCount: readEventPayload(e2eDir, "cycle-complete")?.articleCount ?? 0,
      expectedStressArticleCount: profile.feedCount * profile.entriesPerFeed,
      cycleCount: readEventPayload(e2eDir, "cycle-complete")?.cycleCount ?? 0,
      totalFetchCount: sumFetchCounts(fetchCounts()),
      maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
      maxTotalMemoryMb: summary.maxTotalMemoryMb,
      webKitPidCount: summary.webKitPidCount,
      pressureSummary,
      heapSummaryPath: heapSummary.path,
      logSummary,
      profile,
    };

    fs.writeFileSync(
      path.join(artifactsDir, "summary.json"),
      JSON.stringify(result, null, 2),
    );

    if (summary.maxWebKitMemoryMb < profile.minWebKitMemoryMb) {
      throw new Error(
        `WebKit stress did not reach threshold: max=${summary.maxWebKitMemoryMb.toFixed(1)}MB threshold=${profile.minWebKitMemoryMb}MB artifacts=${artifactsDir}`,
      );
    }

    return result;
  } catch (error) {
    await sampler.stop();
    const summary = summarizeSamples(sampler.samples);
    const logSummary = copyStressLogs(homeDir, artifactsDir);
    const heapSummary = await captureHeapSummaryIfNeeded(summary, artifactsDir);
    fs.writeFileSync(
      path.join(artifactsDir, "failure-summary.json"),
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : String(error),
          maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
          maxTotalMemoryMb: summary.maxTotalMemoryMb,
          webKitPidCount: summary.webKitPidCount,
          expectedStressArticleCount: profile.feedCount * profile.entriesPerFeed,
          heapSummaryPath: heapSummary.path,
          logSummary,
          profile,
        },
        null,
        2,
      ),
    );
    throw new Error(`${formatE2eFailure(error, e2eDir, stderr)}\nartifacts=${artifactsDir}`);
  } finally {
    await stopE2eApp({ child, homeDir, e2eDir, mockFeed: server });
    fs.rmSync(opmlRoot, { recursive: true, force: true });
  }
}

function readStressProfile() {
  return {
    feedCount: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_FEEDS", DEFAULT_FEED_COUNT),
    entriesPerFeed: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_ENTRIES", DEFAULT_ENTRIES_PER_FEED),
    contentKbPerEntry: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_CONTENT_KB", DEFAULT_CONTENT_KB_PER_ENTRY),
    minWebKitMemoryMb: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_MIN_MB", DEFAULT_MIN_WEBKIT_MB),
    targetCycles: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_CYCLES", DEFAULT_TARGET_CYCLES),
    timeoutMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    schedulerIntervalMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_INTERVAL_MS", Number(E2E_SCHEDULER_INTERVAL_MS)),
    pressureWindowMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_PRESSURE_MS", DEFAULT_PRESSURE_WINDOW_MS),
    idlePlateauMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_IDLE_MS", DEFAULT_IDLE_PLATEAU_MS),
    idleDeltaMb: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_IDLE_DELTA_MB", DEFAULT_IDLE_DELTA_MB),
    settleMs: readNonNegativeInt("KIJI_E2E_WEBKIT_STRESS_SETTLE_MS", 0),
    captureHeap: process.env.KIJI_E2E_WEBKIT_STRESS_HEAP !== "0",
  };
}

function resolveArtifactsDir() {
  if (process.env.KIJI_E2E_WEBKIT_STRESS_ARTIFACTS_DIR) {
    return path.resolve(process.env.KIJI_E2E_WEBKIT_STRESS_ARTIFACTS_DIR);
  }
  return fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-webkit-artifacts-"));
}

async function waitForMemoryPressure({ sampler, profile }) {
  const startedAt = Date.now();
  let plateauStartedAt = null;
  let plateauBaselineMb = 0;

  while (Date.now() - startedAt < profile.pressureWindowMs) {
    const summary = summarizeSamples(sampler.samples);
    if (summary.maxWebKitMemoryMb >= profile.minWebKitMemoryMb) {
      return {
        reason: "threshold-reached",
        durationMs: Date.now() - startedAt,
        maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
      };
    }

    const latest = sampler.samples.at(-1);
    const latestWebKitMb = latest?.webKitMemoryMb ?? 0;
    if (latestWebKitMb > plateauBaselineMb + profile.idleDeltaMb) {
      plateauBaselineMb = latestWebKitMb;
      plateauStartedAt = Date.now();
    } else if (plateauStartedAt === null) {
      plateauBaselineMb = latestWebKitMb;
      plateauStartedAt = Date.now();
    } else if (Date.now() - plateauStartedAt >= profile.idlePlateauMs) {
      return {
        reason: "idle-plateau",
        durationMs: Date.now() - startedAt,
        latestWebKitMemoryMb: latestWebKitMb,
        maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
      };
    }

    await sleep(SAMPLE_INTERVAL_MS);
  }

  const summary = summarizeSamples(sampler.samples);
  return {
    reason: "pressure-window-expired",
    durationMs: Date.now() - startedAt,
    maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
  };
}

function readEventPayload(e2eDir, name) {
  const eventPath = path.join(e2eDir, "events", `${name}.json`);
  if (!fs.existsSync(eventPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(eventPath, "utf8")).payload ?? null;
  } catch {
    return null;
  }
}

function readPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function createStressFeedServer(profile) {
  const requestCounts = new Map();
  let baseUrl = "";
  const server = http.createServer((request, response) => {
    const pathname = request.url?.split("?")[0] ?? "/";
    if (pathname === "/favicon.ico" || pathname === "/favicon.png") {
      response.writeHead(200, {
        "content-type": "image/png",
        "cache-control": "public, max-age=3600",
      });
      response.end(ONE_BY_ONE_PNG);
      return;
    }

    const match = pathname.match(/^\/feeds\/stress-(\d+)\.xml$/);
    if (!match) {
      response.writeHead(404);
      response.end("not found");
      return;
    }

    const feedIndex = Number(match[1]);
    const requestCount = (requestCounts.get(feedIndex) ?? 0) + 1;
    requestCounts.set(feedIndex, requestCount);
    const body = buildStressAtomFeed({ feedIndex, requestCount, profile, baseUrl });
    response.writeHead(200, {
      "content-type": "application/atom+xml; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  });

  return {
    server,
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolve());
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to resolve stress feed server port");
      }
      baseUrl = `http://127.0.0.1:${address.port}`;
      return {
        baseUrl,
        fetchCounts: () => new Map(requestCounts),
      };
    },
    async stop() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function buildStressOpml(baseUrl, feedCount) {
  const outlines = Array.from({ length: feedCount }, (_, index) => {
    const title = `E2E Stress Feed ${index}`;
    const feedUrl = `${baseUrl}/feeds/stress-${index}.xml`;
    return `    <outline type="rss" title="${escapeXml(title)}" text="${escapeXml(title)}" xmlUrl="${escapeXml(feedUrl)}" htmlUrl="${escapeXml(feedUrl)}" kijiEmoji="stress" />`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
<head><title>${escapeXml(STRESS_STATION_NAME)}</title></head>
<body>
  <outline text="${escapeXml(STRESS_STATION_NAME)}" title="${escapeXml(STRESS_STATION_NAME)}">
${outlines}
  </outline>
</body>
</opml>`;
}

function buildStressAtomFeed({ feedIndex, requestCount, profile, baseUrl }) {
  const updated = `2026-06-22T${String(requestCount % 24).padStart(2, "0")}:00:00Z`;
  const entries = Array.from({ length: profile.entriesPerFeed }, (_, entryIndex) => {
    const articleId = `stress-${feedIndex}-${requestCount}-${entryIndex}`;
    const html = buildStressArticleHtml(feedIndex, requestCount, entryIndex, profile.contentKbPerEntry);
    return `<entry>
  <title>E2E stress article ${feedIndex}-${requestCount}-${entryIndex}</title>
  <id>${articleId}</id>
  <updated>${updated}</updated>
  <link href="https://example.com/stress/${feedIndex}/${requestCount}/${entryIndex}" />
  <content type="html"><![CDATA[${html}]]></content>
</entry>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E Stress Feed ${feedIndex}</title>
  <id>e2e-stress-feed-${feedIndex}</id>
  <icon>${escapeXml(`${baseUrl}/favicon.png`)}</icon>
  <logo>${escapeXml(`${baseUrl}/favicon.png`)}</logo>
  <updated>${updated}</updated>
  ${entries}
</feed>`;
}

function buildStressArticleHtml(feedIndex, requestCount, entryIndex, contentKb) {
  const paragraph = `Feed ${feedIndex} request ${requestCount} entry ${entryIndex} WebKit stress content `;
  const targetChars = Math.max(1024, contentKb * 1024);
  let body = "";
  let blockIndex = 0;
  while (body.length < targetChars) {
    body += `<div class="stress-block stress-block-${blockIndex}">
  <p>${escapeXml(paragraph.repeat(6))}</p>
  <span>${escapeXml(`nested text ${blockIndex} `.repeat(12))}</span>
  <img src="https://example.com/stress/${feedIndex}/${requestCount}/${entryIndex}/image-${blockIndex}.jpg" alt="stress image ${blockIndex}" />
</div>`;
    blockIndex += 1;
  }
  return `<article><h1>Stress ${feedIndex}-${requestCount}-${entryIndex}</h1>${body}</article>`;
}

function startMemorySampler({ appPid, initialWebKitPids, outputPath }) {
  let stopped = false;
  const samples = [];
  let timer = null;

  const sample = async () => {
    if (stopped) {
      return;
    }
    try {
      const processes = await readProcessTable();
      const appProcess = processes.find((process) => process.pid === appPid) ?? null;
      const webKitProcesses = processes.filter((process) => (
        process.command.includes("com.apple.WebKit.")
        && !initialWebKitPids.has(process.pid)
      ));
      const sampleBody = {
        at: new Date().toISOString(),
        appPid,
        appRssMb: appProcess ? kbToMb(appProcess.rssKb) : 0,
        appCpu: appProcess?.cpu ?? 0,
        webKitProcesses: webKitProcesses.map((process) => ({
          pid: process.pid,
          rssMb: kbToMb(process.rssKb),
          cpu: process.cpu,
          type: classifyWebKitCommand(process.command),
          command: process.command,
        })),
      };
      sampleBody.webKitMemoryMb = roundOne(
        sampleBody.webKitProcesses.reduce((sum, process) => sum + process.rssMb, 0),
      );
      sampleBody.totalMemoryMb = roundOne(sampleBody.appRssMb + sampleBody.webKitMemoryMb);
      samples.push(sampleBody);
      fs.appendFileSync(outputPath, `${JSON.stringify(sampleBody)}\n`);
    } catch (error) {
      fs.appendFileSync(outputPath, `${JSON.stringify({
        at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })}\n`);
    }
  };

  timer = setInterval(() => {
    void sample();
  }, SAMPLE_INTERVAL_MS);
  void sample();

  return {
    samples,
    async stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      await sample();
      stopped = true;
    },
  };
}

async function readWebKitPidSet() {
  const processes = await readProcessTable();
  return new Set(
    processes
      .filter((process) => process.command.includes("com.apple.WebKit."))
      .map((process) => process.pid),
  );
}

async function readProcessTable() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,rss=,pcpu=,command="], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number(match[1]),
        rssKb: Number(match[2]),
        cpu: Number(match[3]),
        command: match[4],
      };
    })
    .filter(Boolean);
}

function summarizeSamples(samples) {
  let maxWebKitMemoryMb = 0;
  let maxTotalMemoryMb = 0;
  let maxSample = null;
  for (const sample of samples) {
    if ((sample.webKitMemoryMb ?? 0) > maxWebKitMemoryMb) {
      maxWebKitMemoryMb = sample.webKitMemoryMb;
      maxSample = sample;
    }
    maxTotalMemoryMb = Math.max(maxTotalMemoryMb, sample.totalMemoryMb ?? 0);
  }
  return {
    maxWebKitMemoryMb: roundOne(maxWebKitMemoryMb),
    maxTotalMemoryMb: roundOne(maxTotalMemoryMb),
    webKitPidCount: maxSample?.webKitProcesses?.length ?? 0,
    maxSample,
  };
}

async function captureHeapSummaryIfNeeded(summary, artifactsDir) {
  const pid = summary.maxSample?.webKitProcesses
    ?.filter((process) => process.type === "webkit-webcontent")
    ?.sort((a, b) => b.rssMb - a.rssMb)[0]?.pid;
  if (!pid || process.env.KIJI_E2E_WEBKIT_STRESS_HEAP === "0") {
    return { path: null };
  }

  const outputPath = path.join(artifactsDir, `heap-summary-${pid}.txt`);
  try {
    const { stdout, stderr } = await execFileAsync("heap", ["-s", String(pid)], {
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    fs.writeFileSync(outputPath, `${stdout}${stderr ? `\n${stderr}` : ""}`);
    return { path: outputPath };
  } catch (error) {
    fs.writeFileSync(
      outputPath,
      error instanceof Error ? error.message : String(error),
    );
    return { path: outputPath };
  }
}

function copyStressLogs(homeDir, artifactsDir) {
  const logsDir = path.join(
    homeDir,
    "Library",
    "Application Support",
    "com.yomilab.kiji",
    "logs",
  );
  const copied = [];
  if (!fs.existsSync(logsDir)) {
    return { logsDir, copied };
  }

  const outDir = path.join(artifactsDir, "logs");
  fs.mkdirSync(outDir, { recursive: true });
  for (const fileName of fs.readdirSync(logsDir)) {
    if (!fileName.endsWith(".log")) {
      continue;
    }
    const source = path.join(logsDir, fileName);
    const target = path.join(outDir, fileName);
    fs.copyFileSync(source, target);
    copied.push(target);

    if (fileName.startsWith("debug-") || fileName.startsWith("app-")) {
      const filtered = fs
        .readFileSync(source, "utf8")
        .split("\n")
        .filter((line) => line.includes("WebKitAttribution") || line.includes("ResourceMonitor"))
        .join("\n");
      fs.writeFileSync(path.join(outDir, `filtered-${fileName}`), filtered);
    }
  }
  return { logsDir, copied };
}

function sumFetchCounts(fetchCounts) {
  let total = 0;
  for (const count of fetchCounts.values()) {
    total += count;
  }
  return total;
}

function classifyWebKitCommand(command) {
  if (command.includes("com.apple.WebKit.WebContent")) {
    return "webkit-webcontent";
  }
  if (command.includes("com.apple.WebKit.Networking")) {
    return "webkit-networking";
  }
  if (command.includes("com.apple.WebKit.GPU")) {
    return "webkit-gpu";
  }
  return "webkit";
}

function kbToMb(kb) {
  return roundOne(kb / 1024);
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runWebKitMemoryStressE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:webkit-memory-stress] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:webkit-memory-stress] Passed: webkitMax=${result.maxWebKitMemoryMb}MB feeds=${result.feedCount} cycles=${result.cycleCount} artifacts=${result.artifactsDir}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:webkit-memory-stress] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
