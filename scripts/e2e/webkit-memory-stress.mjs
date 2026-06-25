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
import { writeE2eCommand } from "./e2eCommands.mjs";
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
  getEventAtMs,
  readEvent,
  readEventIfAfter,
  readEventIfBefore,
  sleep,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
  waitForPostImportEvent,
} from "./e2eRunner.mjs";

const execFileAsync = promisify(execFile);

const STRESS_STATION_NAME = "E2E WebKit Stress";
const DEFAULT_PROFILE_NAME = "amplified";
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
const DEFAULT_VERIFY_MAX_WEBKIT_MB = 1536;
const DEFAULT_VERIFY_MAX_NATIVE_MB = 4096;
const STRESS_PROFILE_DEFAULTS = {
  amplified: {
    feedCount: DEFAULT_FEED_COUNT,
    entriesPerFeed: DEFAULT_ENTRIES_PER_FEED,
    contentKbPerEntry: DEFAULT_CONTENT_KB_PER_ENTRY,
    verificationMode: true,
    minWebKitMemoryMb: 0,
    maxWebKitMemoryMb: DEFAULT_VERIFY_MAX_WEBKIT_MB,
    maxNativeMemoryMb: DEFAULT_VERIFY_MAX_NATIVE_MB,
    targetCycles: DEFAULT_TARGET_CYCLES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    schedulerIntervalMs: Number(E2E_SCHEDULER_INTERVAL_MS),
    pressureWindowMs: DEFAULT_PRESSURE_WINDOW_MS,
    idlePlateauMs: DEFAULT_IDLE_PLATEAU_MS,
    idleDeltaMb: DEFAULT_IDLE_DELTA_MB,
    settleMs: 30_000,
    captureHeap: true,
    hideUi: "1",
    runUiInteractions: false,
    readerMode: false,
    minPostImportArticleCount: 1,
    acceptance: {
      maxWebKitMemoryMb: DEFAULT_VERIFY_MAX_WEBKIT_MB,
      maxNativeMemoryMb: DEFAULT_VERIFY_MAX_NATIVE_MB,
      purpose: "verify native ingestion keeps WebKit bounded under large changed-feed refresh",
    },
  },
  "amplified-repro": {
    feedCount: DEFAULT_FEED_COUNT,
    entriesPerFeed: DEFAULT_ENTRIES_PER_FEED,
    contentKbPerEntry: DEFAULT_CONTENT_KB_PER_ENTRY,
    verificationMode: false,
    minWebKitMemoryMb: DEFAULT_MIN_WEBKIT_MB,
    maxWebKitMemoryMb: null,
    maxNativeMemoryMb: null,
    targetCycles: DEFAULT_TARGET_CYCLES,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    schedulerIntervalMs: Number(E2E_SCHEDULER_INTERVAL_MS),
    pressureWindowMs: DEFAULT_PRESSURE_WINDOW_MS,
    idlePlateauMs: DEFAULT_IDLE_PLATEAU_MS,
    idleDeltaMb: DEFAULT_IDLE_DELTA_MB,
    settleMs: 0,
    captureHeap: true,
    hideUi: "1",
    runUiInteractions: false,
    readerMode: false,
    minPostImportArticleCount: 1,
    acceptance: {
      minWebKitMemoryMb: DEFAULT_MIN_WEBKIT_MB,
      purpose: "legacy repro: multi-GB WebContent pressure from renderer feed fetch/parse (VITE_KIJI_NATIVE_FEED_INGESTION=0)",
    },
  },
  realistic: {
    feedCount: 80,
    entriesPerFeed: 30,
    contentKbPerEntry: 16,
    verificationMode: true,
    minWebKitMemoryMb: 0,
    maxWebKitMemoryMb: 1536,
    maxNativeMemoryMb: 2048,
    targetCycles: 1,
    timeoutMs: 10 * 60 * 1000,
    schedulerIntervalMs: Number(E2E_SCHEDULER_INTERVAL_MS),
    pressureWindowMs: 120_000,
    idlePlateauMs: 45_000,
    idleDeltaMb: 32,
    settleMs: 15_000,
    captureHeap: false,
    hideUi: "0",
    runUiInteractions: true,
    readerMode: false,
    minPostImportArticleCount: 1,
    acceptance: {
      maxWebKitMemoryMb: 1536,
      maxNativeMemoryMb: 2048,
      purpose: "verify bounded WebKit during visible station/list/article navigation",
    },
  },
};
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
      KIJI_E2E_HIDE_UI: profile.hideUi,
    },
  });

  const sampler = startMemorySampler({
    appPid: child.pid,
    initialWebKitPids,
    outputPath: path.join(artifactsDir, "webkit-memory-samples.jsonl"),
  });

  let postImportAtMs = null;

  try {
    const imported = await waitForEvent(
      e2eDir,
      "opml-import-complete",
      (event) => (event.payload?.feedCount ?? 0) >= profile.feedCount,
      profile.timeoutMs,
    );
    postImportAtMs = getEventAtMs(imported) ?? Date.now();
    const preImportCycle = readEventIfBefore(e2eDir, "cycle-complete", postImportAtMs);
    const postImportCycleTimeoutMs = Math.min(profile.timeoutMs, 120_000);
    const postImportScheduler = await waitForPostImportEvent(
      e2eDir,
      "cycle-complete",
      postImportAtMs,
      (event) => (event.payload?.articleCount ?? 0) >= profile.minPostImportArticleCount,
      postImportCycleTimeoutMs,
    ).catch(() => null);

    const uiSummary = profile.runUiInteractions
      ? await runRealisticUiSteps({ e2eDir, profile })
      : null;

    const pressureSummary = await waitForMemoryPressure({ sampler, profile });

    // Give the resource monitor one more interval when requested; the default
    // keeps this bounded for manual repro loops.
    if (profile.settleMs > 0) {
      await sleep(profile.settleMs);
    }

    await sampler.stop();
    const summary = summarizeSamples(sampler.samples);
    const logSummary = copyStressLogs(homeDir, artifactsDir);
    const attributionSummary = summarizeAttributionLogs(logSummary);
    const eventSequence = copyEventSequence(e2eDir, artifactsDir);
    const heapSummary = await captureHeapSummaryIfNeeded(summary, artifactsDir, profile);
    const postImportCycle = readEventIfAfter(e2eDir, "cycle-complete", postImportAtMs);

    const result = {
      skipped: false,
      binaryPath,
      e2eDir,
      artifactsDir,
      profileName: profile.name,
      uiSummary,
      postImportAtMs,
      postImportSummary: {
        postImportAtMs,
        preImportCycle: summarizeHarnessEvent(preImportCycle),
        firstPostImportCycle: summarizeHarnessEvent(postImportScheduler),
        finalPostImportCycle: summarizeHarnessEvent(postImportCycle),
        waitedForFirstPostImportCycle: postImportScheduler !== null,
      },
      feedCount: imported.payload?.feedCount ?? 0,
      articleCount: postImportCycle?.payload?.articleCount
        ?? postImportScheduler?.payload?.articleCount
        ?? 0,
      expectedStressArticleCount: profile.feedCount * profile.entriesPerFeed,
      cycleCount: postImportCycle?.payload?.cycleCount
        ?? postImportScheduler?.payload?.cycleCount
        ?? 0,
      totalFetchCount: sumFetchCounts(fetchCounts()),
      maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
      maxNativeMemoryMb: summary.maxNativeMemoryMb,
      maxTotalMemoryMb: summary.maxTotalMemoryMb,
      webKitPidCount: summary.webKitPidCount,
      pressureSummary,
      attributionSummary,
      heapSummaryPath: heapSummary.path,
      logSummary,
      eventSequence,
      acceptance: profile.acceptance,
      profile,
    };

    fs.writeFileSync(
      path.join(artifactsDir, "summary.json"),
      JSON.stringify(result, null, 2),
    );

    assertStressResult({ summary, profile, attributionSummary, artifactsDir });

    return result;
  } catch (error) {
    await sampler.stop();
    const summary = summarizeSamples(sampler.samples);
    const logSummary = copyStressLogs(homeDir, artifactsDir);
    const attributionSummary = summarizeAttributionLogs(logSummary);
    const eventSequence = copyEventSequence(e2eDir, artifactsDir);
    const heapSummary = await captureHeapSummaryIfNeeded(summary, artifactsDir, profile);
    fs.writeFileSync(
      path.join(artifactsDir, "failure-summary.json"),
      JSON.stringify(
        {
          error: error instanceof Error ? error.message : String(error),
          profileName: profile.name,
          postImportAtMs,
          maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
          maxTotalMemoryMb: summary.maxTotalMemoryMb,
          webKitPidCount: summary.webKitPidCount,
          expectedStressArticleCount: profile.feedCount * profile.entriesPerFeed,
          heapSummaryPath: heapSummary.path,
          logSummary,
          eventSequence,
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
  const requestedProfile = process.env.KIJI_E2E_WEBKIT_STRESS_PROFILE ?? DEFAULT_PROFILE_NAME;
  const defaults = STRESS_PROFILE_DEFAULTS[requestedProfile] ?? STRESS_PROFILE_DEFAULTS[DEFAULT_PROFILE_NAME];
  const name = STRESS_PROFILE_DEFAULTS[requestedProfile] ? requestedProfile : DEFAULT_PROFILE_NAME;

  return {
    name,
    feedCount: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_FEEDS", defaults.feedCount),
    entriesPerFeed: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_ENTRIES", defaults.entriesPerFeed),
    contentKbPerEntry: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_CONTENT_KB", defaults.contentKbPerEntry),
    minWebKitMemoryMb: readNonNegativeInt("KIJI_E2E_WEBKIT_STRESS_MIN_MB", defaults.minWebKitMemoryMb),
    maxWebKitMemoryMb: readOptionalPositiveInt("KIJI_E2E_WEBKIT_STRESS_MAX_MB", defaults.maxWebKitMemoryMb),
    maxNativeMemoryMb: readOptionalPositiveInt("KIJI_E2E_WEBKIT_STRESS_MAX_NATIVE_MB", defaults.maxNativeMemoryMb),
    verificationMode: readBoolean("KIJI_E2E_WEBKIT_STRESS_VERIFY", defaults.verificationMode),
    targetCycles: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_CYCLES", defaults.targetCycles),
    timeoutMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_TIMEOUT_MS", defaults.timeoutMs),
    schedulerIntervalMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_INTERVAL_MS", defaults.schedulerIntervalMs),
    pressureWindowMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_PRESSURE_MS", defaults.pressureWindowMs),
    idlePlateauMs: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_IDLE_MS", defaults.idlePlateauMs),
    idleDeltaMb: readPositiveInt("KIJI_E2E_WEBKIT_STRESS_IDLE_DELTA_MB", defaults.idleDeltaMb),
    settleMs: readNonNegativeInt("KIJI_E2E_WEBKIT_STRESS_SETTLE_MS", defaults.settleMs),
    captureHeap: readBoolean("KIJI_E2E_WEBKIT_STRESS_HEAP", defaults.captureHeap),
    hideUi: process.env.KIJI_E2E_HIDE_UI ?? defaults.hideUi,
    runUiInteractions: readBoolean("KIJI_E2E_WEBKIT_STRESS_UI_STEPS", defaults.runUiInteractions),
    readerMode: readBoolean("KIJI_E2E_WEBKIT_STRESS_READER_MODE", defaults.readerMode),
    minPostImportArticleCount: readPositiveInt(
      "KIJI_E2E_WEBKIT_STRESS_MIN_POST_IMPORT_ARTICLES",
      defaults.minPostImportArticleCount,
    ),
    acceptance: defaults.acceptance,
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

  if (profile.verificationMode) {
    while (Date.now() - startedAt < profile.pressureWindowMs) {
      const summary = summarizeSamples(sampler.samples);
      const latest = sampler.samples.at(-1);
      const latestWebKitMb = latest?.webKitMemoryMb ?? 0;

      if (profile.maxWebKitMemoryMb && summary.maxWebKitMemoryMb > profile.maxWebKitMemoryMb) {
        return {
          reason: "verification-bound-exceeded",
          durationMs: Date.now() - startedAt,
          maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
        };
      }

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
      reason: "verification-window-complete",
      durationMs: Date.now() - startedAt,
      maxWebKitMemoryMb: summary.maxWebKitMemoryMb,
    };
  }

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

async function runRealisticUiSteps({ e2eDir, profile }) {
  writeE2eCommand(e2eDir, "select-station", { stationName: STRESS_STATION_NAME });
  await waitForEvent(
    e2eDir,
    "navigation-changed",
    (event) => event.payload?.selectedTag === STRESS_STATION_NAME,
    profile.timeoutMs,
  );

  const listSnapshot = await waitForEvent(
    e2eDir,
    "article-list-snapshot",
    (event) => (
      event.payload?.selectedTag === STRESS_STATION_NAME
      && (event.payload?.articleCount ?? 0) >= 1
    ),
    profile.timeoutMs,
  );

  writeE2eCommand(e2eDir, "scroll-list", { toEnd: true });
  const scrollState = await waitForEvent(
    e2eDir,
    "scroll-state",
    (event) => event.payload?.toEnd === true,
    profile.timeoutMs,
  );
  const loadMore = await waitForEvent(e2eDir, "load-more-complete", () => true, profile.timeoutMs);

  writeE2eCommand(e2eDir, "open-article", { index: 0 });
  await waitForEvent(e2eDir, "article-deck-phase", (event) => event.payload?.phase === "open", profile.timeoutMs);
  const content = await waitForEvent(e2eDir, "article-content-ready", () => true, profile.timeoutMs);

  let readerReady = null;
  if (profile.readerMode) {
    writeE2eCommand(e2eDir, "toggle-reader-mode");
    await waitForEvent(e2eDir, "reader-mode-changed", (event) => event.payload?.mode === "reader", profile.timeoutMs);
    readerReady = await waitForEvent(
      e2eDir,
      "reader-content-ready",
      (event) => (event.payload?.wordCount ?? 0) > 0,
      profile.timeoutMs,
    );
  }

  writeE2eCommand(e2eDir, "close-article");
  await waitForEvent(e2eDir, "article-deck-phase", (event) => event.payload?.phase === "closed", profile.timeoutMs);

  return {
    selectedStation: STRESS_STATION_NAME,
    initialArticleCount: listSnapshot.payload?.articleCount ?? 0,
    initialTotalCount: listSnapshot.payload?.articlesTotalCount ?? 0,
    loadedAfterScroll: loadMore.payload?.loadedCount ?? scrollState.payload?.loadedCount ?? 0,
    openedArticleTitle: content.payload?.title ?? null,
    readerModeWordCount: readerReady?.payload?.wordCount ?? null,
  };
}

function summarizeHarnessEvent(event) {
  if (!event) {
    return null;
  }
  return {
    name: event.name ?? null,
    at: getEventAtMs(event),
    payload: event.payload ?? null,
  };
}

function copyEventSequence(e2eDir, artifactsDir) {
  const eventsDir = path.join(e2eDir, "events");
  const sequence = [];
  if (!fs.existsSync(eventsDir)) {
    return { path: null, events: sequence };
  }

  for (const fileName of fs.readdirSync(eventsDir).sort()) {
    if (!fileName.endsWith(".json")) {
      continue;
    }
    const event = JSON.parse(fs.readFileSync(path.join(eventsDir, fileName), "utf8"));
    sequence.push({
      fileName,
      name: event.name ?? fileName.replace(/\.json$/, ""),
      at: getEventAtMs(event),
      payload: event.payload ?? null,
    });
  }

  const outputPath = path.join(artifactsDir, "event-sequence.json");
  fs.writeFileSync(outputPath, JSON.stringify(sequence, null, 2));
  return { path: outputPath, events: sequence };
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

function readOptionalPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback ?? null;
}

function readPositiveInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readNonNegativeInt(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  return raw !== "0" && raw.toLowerCase() !== "false";
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

    const articleMatch = pathname.match(/^\/articles\/stress-(\d+)-(\d+)-(\d+)\.html$/);
    if (articleMatch) {
      const feedIndex = Number(articleMatch[1]);
      const requestCount = Number(articleMatch[2]);
      const entryIndex = Number(articleMatch[3]);
      response.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      });
      response.end(buildStressReaderHtml(feedIndex, requestCount, entryIndex, profile.contentKbPerEntry));
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
  <link href="${escapeXml(`${baseUrl}/articles/${articleId}.html`)}" />
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

function buildStressReaderHtml(feedIndex, requestCount, entryIndex, contentKb) {
  return `<!doctype html>
<html>
  <head>
    <title>Stress ${feedIndex}-${requestCount}-${entryIndex}</title>
  </head>
  <body>
    ${buildStressArticleHtml(feedIndex, requestCount, entryIndex, contentKb)}
  </body>
</html>`;
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
  let maxNativeMemoryMb = 0;
  let maxTotalMemoryMb = 0;
  let maxSample = null;
  for (const sample of samples) {
    if ((sample.webKitMemoryMb ?? 0) > maxWebKitMemoryMb) {
      maxWebKitMemoryMb = sample.webKitMemoryMb;
      maxSample = sample;
    }
    maxNativeMemoryMb = Math.max(maxNativeMemoryMb, sample.appRssMb ?? 0);
    maxTotalMemoryMb = Math.max(maxTotalMemoryMb, sample.totalMemoryMb ?? 0);
  }
  return {
    maxWebKitMemoryMb: roundOne(maxWebKitMemoryMb),
    maxNativeMemoryMb: roundOne(maxNativeMemoryMb),
    maxTotalMemoryMb: roundOne(maxTotalMemoryMb),
    webKitPidCount: maxSample?.webKitProcesses?.length ?? 0,
    maxSample,
  };
}

function assertStressResult({ summary, profile, attributionSummary, artifactsDir }) {
  if (profile.verificationMode) {
    if (profile.maxWebKitMemoryMb && summary.maxWebKitMemoryMb > profile.maxWebKitMemoryMb) {
      throw new Error(
        `WebKit verification failed: max=${summary.maxWebKitMemoryMb.toFixed(1)}MB limit=${profile.maxWebKitMemoryMb}MB artifacts=${artifactsDir}`,
      );
    }
    if (profile.maxNativeMemoryMb && summary.maxNativeMemoryMb > profile.maxNativeMemoryMb) {
      throw new Error(
        `Native verification failed: max=${summary.maxNativeMemoryMb.toFixed(1)}MB limit=${profile.maxNativeMemoryMb}MB artifacts=${artifactsDir}`,
      );
    }
    if ((attributionSummary?.nativeFeedRefreshCount ?? 0) < 1
      && (attributionSummary?.postImportFeedParseAttributionCount ?? 0) > 0) {
      throw new Error(
        `Renderer parse attribution still active after import: postImportFeedParseAttributionCount=${attributionSummary.postImportFeedParseAttributionCount} artifacts=${artifactsDir}`,
      );
    }
    if ((attributionSummary?.nativeFeedRefreshCount ?? 0) < 1
      && (attributionSummary?.feedParseAttributionCount ?? 0) > 0) {
      throw new Error(
        `Native attribution missing and renderer parse attribution present — rebuild KiJi.app with native ingestion enabled artifacts=${artifactsDir}`,
      );
    }
    if ((attributionSummary?.postImportLargeRendererFeedNetworkCount ?? 0) > 0) {
      throw new Error(
        `Renderer feed bodies still attributed after import: postImportLargeRendererFeedNetworkCount=${attributionSummary.postImportLargeRendererFeedNetworkCount} artifacts=${artifactsDir}`,
      );
    }
    return;
  }

  if (summary.maxWebKitMemoryMb < profile.minWebKitMemoryMb) {
    throw new Error(
      `WebKit stress did not reach threshold: max=${summary.maxWebKitMemoryMb.toFixed(1)}MB threshold=${profile.minWebKitMemoryMb}MB artifacts=${artifactsDir}`,
    );
  }
}

function summarizeAttributionLogs(logSummary) {
  const counts = {
    nativeFeedRefreshCount: 0,
    feedNetworkResponseCount: 0,
    largeRendererFeedNetworkCount: 0,
    postImportLargeRendererFeedNetworkCount: 0,
    feedParseAttributionCount: 0,
    postImportFeedParseAttributionCount: 0,
    readerDomAttributionCount: 0,
    articleRenderAttributionCount: 0,
  };

  for (const copiedPath of logSummary.copied ?? []) {
    const fileName = path.basename(copiedPath);
    if (!fileName.startsWith("debug-") && !fileName.startsWith("app-")) {
      continue;
    }

    let postImportStarted = false;
    const lines = fs.readFileSync(copiedPath, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (
        line.includes("Boosted feed priorities after import")
        || line.includes("Native background refresh cycle stats")
        || line.includes("opml-import-complete")
      ) {
        postImportStarted = true;
      }

      if (!line.includes("[WebKitAttribution]")) {
        continue;
      }

      const contextLine = lines[index + 1];
      if (!contextLine?.startsWith("context=")) {
        continue;
      }

      let context;
      try {
        context = JSON.parse(contextLine.slice("context=".length));
      } catch {
        continue;
      }

      switch (context.event) {
        case "native-feed-refresh-attribution":
          counts.nativeFeedRefreshCount += 1;
          break;
        case "feed-network-response":
          counts.feedNetworkResponseCount += 1;
          if (context.largePayload === true || (context.responseBytes ?? 0) >= 512 * 1024) {
            counts.largeRendererFeedNetworkCount += 1;
            if (postImportStarted) {
              counts.postImportLargeRendererFeedNetworkCount += 1;
            }
          }
          break;
        case "feed-parse-attribution":
          counts.feedParseAttributionCount += 1;
          if (postImportStarted) {
            counts.postImportFeedParseAttributionCount += 1;
          }
          break;
        case "reader-dom-attribution":
          counts.readerDomAttributionCount += 1;
          break;
        case "article-render-attribution":
          counts.articleRenderAttributionCount += 1;
          break;
        default:
          break;
      }
    }
  }

  return counts;
}

async function captureHeapSummaryIfNeeded(summary, artifactsDir, profile) {
  const pid = summary.maxSample?.webKitProcesses
    ?.filter((process) => process.type === "webkit-webcontent")
    ?.sort((a, b) => b.rssMb - a.rssMb)[0]?.pid;
  if (!pid || !profile.captureHeap) {
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
