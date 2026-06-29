#!/usr/bin/env node
/**
 * Phase 0: correlate KiJi resource-usage samples with app-log scheduler and
 * WebKitAttribution events.
 *
 * Usage:
 *   npm run analyze:memory-logs
 *   node scripts/analyze-memory-logs.mjs --days 3 --export /tmp/memory-correlation.json
 *   node scripts/analyze-memory-logs.mjs --date 2026-06-29
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_LOGS_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "com.yomilab.kiji",
  "logs",
);

const RESOURCE_LINE = /\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\].*totalMemoryMb=([\d.]+) nativeMemoryMb=([\d.]+) webkitMemoryMb=([\d.]+)/;
const APP_TS = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:([+-]\d{2}:\d{2})|Z)\]/;

function expandHome(input) {
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

function parseArgs(argv) {
  const options = {
    logsDir: DEFAULT_LOGS_DIR,
    date: null,
    days: null,
    exportPath: null,
    windowMinutes: 5,
    highWebKitMb: 1500,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--logs-dir" && argv[index + 1]) {
      options.logsDir = expandHome(argv[++index]);
    } else if (arg === "--date" && argv[index + 1]) {
      options.date = argv[++index];
    } else if (arg === "--days" && argv[index + 1]) {
      options.days = Number(argv[++index]);
    } else if (arg === "--export" && argv[index + 1]) {
      options.exportPath = expandHome(argv[++index]);
    } else if (arg === "--window-minutes" && argv[index + 1]) {
      options.windowMinutes = Number(argv[++index]);
    } else if (arg === "--high-webkit-mb" && argv[index + 1]) {
      options.highWebKitMb = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: node scripts/analyze-memory-logs.mjs [options]

Options:
  --logs-dir <path>       KiJi logs directory (default: Application Support)
  --date YYYY-MM-DD       Analyze one calendar day
  --days <n>              Analyze resource logs modified in the last N days
  --window-minutes <n>    Event correlation window (default: 5)
  --high-webkit-mb <n>    High-WebKit sample threshold (default: 1500)
  --export <path>         Write JSON summary
`);
      process.exit(0);
    }
  }

  return options;
}

function parseAppTimestamp(rawTs, offset) {
  if (offset === "Z" || offset === undefined) {
    return new Date(`${rawTs}Z`);
  }
  return new Date(`${rawTs}${offset}`);
}

function listResourceFiles(logsDir, date, days) {
  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }

  let files = fs.readdirSync(logsDir)
    .filter((name) => name.startsWith("resource-usage-") && name.endsWith(".log"))
    .map((name) => ({
      name,
      fullPath: path.join(logsDir, name),
      mtimeMs: fs.statSync(path.join(logsDir, name)).mtimeMs,
    }));

  if (date) {
    const dated = files.find((file) => file.name === `resource-usage-${date}.log`);
    if (!dated) {
      throw new Error(`No resource log for date ${date}`);
    }
    return [dated.fullPath];
  }

  if (days !== null && Number.isFinite(days)) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    files = files.filter((file) => file.mtimeMs >= cutoff);
  }

  return files
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) => file.fullPath);
}

function listAppFiles(logsDir, date, days) {
  if (!fs.existsSync(logsDir)) {
    return [];
  }

  let files = fs.readdirSync(logsDir)
    .filter((name) => name.startsWith("app-") && name.endsWith(".log"))
    .map((name) => ({
      name,
      fullPath: path.join(logsDir, name),
      mtimeMs: fs.statSync(path.join(logsDir, name)).mtimeMs,
    }));

  if (date) {
    const dated = files.find((file) => file.name === `app-${date}.log`);
    return dated ? [dated.fullPath] : [];
  }

  if (days !== null && Number.isFinite(days)) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    files = files.filter((file) => file.mtimeMs >= cutoff);
  }

  return files
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((file) => file.fullPath);
}

function parseResourceSamples(filePaths) {
  const samples = [];
  for (const filePath of filePaths) {
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
      const match = RESOURCE_LINE.exec(line);
      if (!match) {
        continue;
      }
      samples.push({
        at: new Date(`${match[1].replace("Z", "")}Z`),
        totalMb: Number(match[2]),
        nativeMb: Number(match[3]),
        webkitMb: Number(match[4]),
        sourceFile: path.basename(filePath),
      });
    }
  }
  samples.sort((left, right) => left.at.getTime() - right.at.getTime());
  return samples;
}

function classifyAppEvent(line, context) {
  if (line.includes("Background refresh cycle completed")) {
    return "cycle-complete";
  }
  if (line.includes("Background refresh cycle started")) {
    return "cycle-start";
  }
  if (line.includes("Native background refresh cycle stats")) {
    return "native-cycle-stats";
  }
  if (line.includes("Deferred native scheduler tick until current refresh cycle completes")) {
    return "deferred-tick";
  }
  if (line.includes("Deferred native scheduler tick coalesced until interval overdue")) {
    return "deferred-tick-coalesced";
  }
  if (line.includes("[resource-threshold-breach]")) {
    return "resource-threshold-breach";
  }

  const event = context?.event;
  if (event === "renderer-session-memory-attribution") return "session-memory";
  if (event === "list-refresh-attribution") return "list-refresh";
  if (event === "native-feed-refresh-cycle-attribution") return "native-cycle-attribution";
  if (event === "native-feed-refresh-attribution") return "native-feed-attribution";
  if (event === "article-open-attribution") return "article-open";
  if (event === "article-render-attribution") return "article-render";
  if (event === "feed-network-response") return "feed-network";
  if (event === "feed-parse-attribution") return "feed-parse";
  if (event === "reader-dom-attribution") return "reader-dom";
  return null;
}

function parseAppEvents(filePaths) {
  const events = [];
  for (const filePath of filePaths) {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const tsMatch = APP_TS.exec(line);
      if (!tsMatch) {
        continue;
      }

      const at = parseAppTimestamp(tsMatch[1], tsMatch[2]);
      const contextLine = lines[index + 1]?.startsWith("context=") ? lines[index + 1] : null;
      let context = null;
      if (contextLine) {
        try {
          context = JSON.parse(contextLine.slice("context=".length));
        } catch {
          context = null;
        }
      }

      const type = classifyAppEvent(line, context);
      if (!type) {
        continue;
      }

      events.push({
        type,
        at,
        context: context ?? (type === "resource-threshold-breach" ? { message: line.trim() } : null),
        file: path.basename(filePath),
      });
    }
  }

  events.sort((left, right) => left.at.getTime() - right.at.getTime());
  return events;
}

function percentile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function summarizeSamples(samples) {
  if (samples.length === 0) {
    return null;
  }

  const totals = samples.map((sample) => sample.totalMb);
  const webkits = samples.map((sample) => sample.webkitMb);
  const natives = samples.map((sample) => sample.nativeMb);
  const peak = samples.reduce((best, sample) => (
    sample.totalMb > best.totalMb ? sample : best
  ), samples[0]);

  return {
    sampleCount: samples.length,
    totalMb: {
      max: Math.max(...totals),
      median: percentile(totals, 0.5),
      p90: percentile(totals, 0.9),
    },
    webkitMb: {
      max: Math.max(...webkits),
      median: percentile(webkits, 0.5),
      p90: percentile(webkits, 0.9),
    },
    nativeMb: {
      max: Math.max(...natives),
      median: percentile(natives, 0.5),
      p90: percentile(natives, 0.9),
    },
    peakSample: {
      at: peak.at.toISOString(),
      totalMb: peak.totalMb,
      webkitMb: peak.webkitMb,
      nativeMb: peak.nativeMb,
      webkitSharePct: Number(((peak.webkitMb / peak.totalMb) * 100).toFixed(1)),
      sourceFile: peak.sourceFile,
    },
    highWebKitSampleCount: samples.filter((sample) => sample.webkitMb >= 1500).length,
    idleWebKitSampleCount: samples.filter((sample) => sample.webkitMb < 500).length,
  };
}

function correlateCycles(samples, events, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const cycleCompletes = events.filter((event) => event.type === "cycle-complete");
  const correlations = [];

  for (const event of cycleCompletes) {
    const nearby = samples.filter((sample) => {
      const delta = sample.at.getTime() - event.at.getTime();
      return delta >= -2 * 60 * 1000 && delta <= windowMs;
    });
    if (nearby.length === 0) {
      continue;
    }
    correlations.push({
      cycleCompletedAt: event.at.toISOString(),
      durationMs: event.context?.durationMs ?? null,
      maxWebkitMbNearby: Math.max(...nearby.map((sample) => sample.webkitMb)),
      maxTotalMbNearby: Math.max(...nearby.map((sample) => sample.totalMb)),
      sampleCount: nearby.length,
    });
  }

  const nearCycleMax = correlations.map((row) => row.maxWebkitMbNearby);
  return {
    cycleCompleteCount: cycleCompletes.length,
    correlatedCycleCount: correlations.length,
    nearCycleWebkitMaxMedian: percentile(nearCycleMax, 0.5),
    nearCycleWebkitMaxP90: percentile(nearCycleMax, 0.9),
    examples: correlations
      .sort((left, right) => right.maxWebkitMbNearby - left.maxWebkitMbNearby)
      .slice(0, 10),
  };
}

function correlateHighWebKit(samples, events, highWebKitMb, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const highSamples = samples.filter((sample) => sample.webkitMb >= highWebKitMb);
  const attributionNearHigh = {};

  for (const sample of highSamples) {
    const nearbyEvents = events.filter((event) => (
      Math.abs(event.at.getTime() - sample.at.getTime()) <= windowMs
    ));
    for (const event of nearbyEvents) {
      attributionNearHigh[event.type] = (attributionNearHigh[event.type] ?? 0) + 1;
    }
  }

  const sessionNearHigh = highSamples.map((sample) => {
    const sessionEvents = events.filter((event) => (
      event.type === "session-memory"
      && Math.abs(event.at.getTime() - sample.at.getTime()) <= windowMs
    ));
    if (sessionEvents.length === 0) {
      return null;
    }
    const nearest = sessionEvents.reduce((best, event) => {
      const delta = Math.abs(event.at.getTime() - sample.at.getTime());
      return delta < best.delta ? { event, delta } : best;
    }, { event: sessionEvents[0], delta: Number.POSITIVE_INFINITY });
    return {
      at: sample.at.toISOString(),
      webkitMb: sample.webkitMb,
      loadedArticleCount: nearest.event.context?.loadedArticleCount ?? null,
      estimatedSerializedListKb: nearest.event.context?.estimatedSerializedListKb ?? null,
      internFeedCount: nearest.event.context?.internFeedCount ?? null,
    };
  }).filter(Boolean);

  return {
    highWebKitSampleCount: highSamples.length,
    attributionNearHighWebKit: attributionNearHigh,
    sessionMemoryNearHighExamples: sessionNearHigh
      .sort((left, right) => right.webkitMb - left.webkitMb)
      .slice(0, 10),
  };
}

function countEvents(events) {
  const counts = {};
  for (const event of events) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const resourceFiles = listResourceFiles(options.logsDir, options.date, options.days);
  const appFiles = listAppFiles(options.logsDir, options.date, options.days ?? (options.date ? null : 7));
  const samples = parseResourceSamples(resourceFiles);
  const events = parseAppEvents(appFiles);

  const summary = {
    generatedAt: new Date().toISOString(),
    logsDir: options.logsDir,
    date: options.date,
    days: options.days,
    resourceFiles: resourceFiles.map((filePath) => path.basename(filePath)),
    appFiles: appFiles.map((filePath) => path.basename(filePath)),
    samples: summarizeSamples(samples),
    eventCounts: countEvents(events),
    cycleCorrelation: correlateCycles(samples, events, options.windowMinutes),
    highWebKitCorrelation: correlateHighWebKit(
      samples,
      events,
      options.highWebKitMb,
      options.windowMinutes,
    ),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (options.exportPath) {
    fs.mkdirSync(path.dirname(options.exportPath), { recursive: true });
    fs.writeFileSync(options.exportPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.error(`Wrote ${options.exportPath}`);
  }
}

main();
