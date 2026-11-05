#!/usr/bin/env node
/**
 * Robustness check-in report: reads Yomi Reader app logs and verifies the invariants
 * from the FeedContext/scheduler/import robustness work (kiji-doc
 * `docs/core/robustness-metrics.md`). Prints PASS / WARN / FAIL per check.
 *
 * Usage:
 *   npm run analyze:robustness-logs
 *   node scripts/analyze-robustness-logs.mjs --days 3
 *   node scripts/analyze-robustness-logs.mjs --date 2026-10-19 --json /tmp/robustness.json
 *   node scripts/analyze-robustness-logs.mjs --logs-dir /path/to/logs
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

const HEADER = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}|Z))\] \[(\w+)\] \[(\w+)\] \[([^\]]+)\] (.*)$/;

/** Messages whose presence means a contained failure path ran (expected rare). */
const CONTAINED_FAILURE_MESSAGES = [
  "Station network refresh phase failed",
  "Smart view query failed",
  "Background list refresh failed",
  "Scheduler UI flush failed",
  "Switch header COUNT reconcile failed",
  "Search-exit list re-query failed",
  "Failed to sync feed counts after refresh cycle",
  "Station favicon catch-up failed",
  "Favicon task result handling failed",
  "Initial article storage failed after adding feed",
  "Favicon update failed after adding feed",
];

function parseArgs(argv) {
  const options = { logsDir: DEFAULT_LOGS_DIR, days: 3, date: null, json: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--logs-dir") options.logsDir = next().replace(/^~\//, `${os.homedir()}/`);
    else if (arg === "--days") options.days = Number(next());
    else if (arg === "--date") options.date = next();
    else if (arg === "--json") options.json = next();
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: analyze-robustness-logs.mjs [--days N | --date YYYY-MM-DD] [--logs-dir DIR] [--json FILE]");
      process.exit(0);
    }
  }
  return options;
}

function selectLogFiles({ logsDir, days, date }) {
  if (!fs.existsSync(logsDir)) {
    throw new Error(`Logs directory not found: ${logsDir}`);
  }
  const files = fs.readdirSync(logsDir)
    .filter((name) => /^app-\d{4}-\d{2}-\d{2}\.log$/.test(name))
    .sort();
  if (date) {
    return files.filter((name) => name === `app-${date}.log`).map((name) => path.join(logsDir, name));
  }
  return files.slice(-Math.max(1, days)).map((name) => path.join(logsDir, name));
}

/** Yields { ts, level, process, category, message, context, error } entries. */
function* readEntries(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let current = null;
  for (const line of lines) {
    const header = HEADER.exec(line);
    if (header) {
      if (current) yield current;
      current = {
        ts: Date.parse(header[1]),
        level: header[2],
        process: header[3],
        category: header[4],
        message: header[5],
        context: null,
        error: null,
      };
      continue;
    }
    if (!current) continue;
    if (line.startsWith("context=")) {
      try {
        current.context = JSON.parse(line.slice("context=".length));
      } catch {
        current.context = null;
      }
    } else if (line.startsWith("error=")) {
      current.error = line.slice("error=".length);
    }
  }
  if (current) yield current;
}

function newSession(startTs) {
  return {
    startTs,
    endTs: startTs,
    cycles: 0,
    cycleCompletedTs: [],
    cancelledFeeds: 0,
    failedFeeds: 0,
    executedFeeds: 0,
    lastRobustness: null,
    mode: null,
  };
}

const INTERVAL_MS_BY_MODE = {
  "every-5m": 5 * 60_000,
  "every-10m": 10 * 60_000,
  "every-15m": 15 * 60_000,
  "every-30m": 30 * 60_000,
  "every-1h": 60 * 60_000,
};

function analyze(files) {
  const sessions = [];
  let session = null;
  const containedFailures = new Map();
  let unhandledRejections = 0;
  let nativeCycleFailedNonAbort = 0;
  let pauseSafetyWarnings = 0;
  const nativeRecordedFailures = new Map();

  for (const file of files) {
    for (const entry of readEntries(file)) {
      if (entry.message === "Renderer bootstrap starting" && entry.context?.windowType !== "settings") {
        session = newSession(entry.ts);
        sessions.push(session);
      }
      if (!session) {
        session = newSession(entry.ts);
        sessions.push(session);
      }
      session.endTs = entry.ts;

      if (entry.message === "Unhandled promise rejection") unhandledRejections += 1;
      for (const message of CONTAINED_FAILURE_MESSAGES) {
        if (entry.message === message) {
          containedFailures.set(message, (containedFailures.get(message) ?? 0) + 1);
        }
      }
      if (entry.message === "Feed fetch failed from UI refresh (native recorded)") {
        const feedId = entry.context?.feedId ?? "?";
        nativeRecordedFailures.set(feedId, (nativeRecordedFailures.get(feedId) ?? 0) + 1);
      }
      if (entry.message === "Native background refresh cycle failed"
        && entry.context?.error?.name !== "AbortError") {
        nativeCycleFailedNonAbort += 1;
      }
      if (entry.category === "Scheduler" && /safety/i.test(entry.message)) pauseSafetyWarnings += 1;
      if (entry.message === "Background refresh cycle completed") {
        session.cycles += 1;
        session.cycleCompletedTs.push(entry.ts);
        if (entry.context?.mode) session.mode = entry.context.mode;
      }
      if (entry.message === "Native background refresh cycle stats" && entry.context) {
        session.cancelledFeeds += entry.context.cancelledFeeds ?? 0;
        session.failedFeeds += entry.context.failedFeeds ?? 0;
        session.executedFeeds += entry.context.executedFeedCount ?? 0;
      }
      if (entry.message === "Robustness counters" && entry.context) {
        session.lastRobustness = entry.context;
      }
    }
  }

  return {
    sessions,
    containedFailures,
    unhandledRejections,
    nativeCycleFailedNonAbort,
    pauseSafetyWarnings,
    nativeRecordedFailures,
  };
}

function maxCycleGapMs(session) {
  let maxGap = 0;
  for (let index = 1; index < session.cycleCompletedTs.length; index += 1) {
    maxGap = Math.max(maxGap, session.cycleCompletedTs[index] - session.cycleCompletedTs[index - 1]);
  }
  return maxGap;
}

function buildChecks(result) {
  const checks = [];
  const add = (status, name, detail) => checks.push({ status, name, detail });

  add(result.unhandledRejections === 0 ? "PASS" : "FAIL", "No unhandled promise rejections",
    `${result.unhandledRejections} found`);

  const contained = [...result.containedFailures.entries()];
  add(contained.length === 0 ? "PASS" : "WARN", "Contained async failures (logged, not thrown)",
    contained.length === 0 ? "none" : contained.map(([message, count]) => `${message}: ${count}`).join("; "));

  add(result.pauseSafetyWarnings === 0 ? "PASS" : "FAIL", "Station pause never hit the 10-minute safety release",
    `${result.pauseSafetyWarnings} safety releases logged`);

  add(result.nativeCycleFailedNonAbort === 0 ? "PASS" : "WARN", "Native cycles did not fail (non-abort)",
    `${result.nativeCycleFailedNonAbort} non-abort cycle failures`);

  const repeatedNative = [...result.nativeRecordedFailures.entries()].filter(([, count]) => count >= 5);
  add(repeatedNative.length === 0 ? "PASS" : "WARN", "No feed failing repeatedly from UI refresh",
    repeatedNative.length === 0 ? "none ≥5" : repeatedNative.map(([id, count]) => `${id}×${count}`).join(", "));

  for (const [index, session] of result.sessions.entries()) {
    const label = `session ${index + 1} (${new Date(session.startTs).toISOString()})`;
    const durationMin = Math.round((session.endTs - session.startTs) / 60_000);
    const intervalMs = INTERVAL_MS_BY_MODE[session.mode] ?? null;
    if (intervalMs && durationMin * 60_000 > intervalMs * 3) {
      const gap = maxCycleGapMs(session);
      // Sleep/hidden periods legitimately stretch gaps; flag only large ones.
      add(gap <= intervalMs * 3 ? "PASS" : "WARN", `${label}: cycle cadence`,
        `${session.cycles} cycles in ${durationMin} min, max gap ${Math.round(gap / 60_000)} min (mode ${session.mode})`);
    }
    if (session.cancelledFeeds > 0 || session.failedFeeds > 0) {
      const failureRate = session.executedFeeds > 0
        ? Math.round((session.failedFeeds / session.executedFeeds) * 1000) / 10
        : 0;
      // Cancelled fetches are reported as failed results but must not raise
      // backoff; a high rate with cancelled ≈ failed points at station clicks
      // during cycles, not broken feeds.
      add("INFO", `${label}: feed outcomes`,
        `executed ${session.executedFeeds}, failed ${session.failedFeeds} (${failureRate}%), cancelled ${session.cancelledFeeds}`);
    }
    const robustness = session.lastRobustness;
    if (robustness) {
      const counters = robustness.counters ?? {};
      const durations = robustness.durations ?? {};
      const pause = durations["scheduler.stationPauseHeldMs"];
      if (pause) {
        add(pause.maxMs <= 30_000 ? "PASS" : "WARN", `${label}: station pause duration`,
          `count ${pause.count}, avg ${pause.avgMs} ms, max ${pause.maxMs} ms`);
      }
      if ((counters["scheduler.stationPauseSafetyRelease"] ?? 0) > 0) {
        add("FAIL", `${label}: station pause safety release counter`, String(counters["scheduler.stationPauseSafetyRelease"]));
      }
      const native = robustness.native ?? {};
      add("INFO", `${label}: robustness counters`, JSON.stringify({ ...counters, native }));
    }
  }

  if (!result.sessions.some((session) => session.lastRobustness)) {
    add("WARN", "Robustness counters present", "no `Robustness counters` line yet (logged every 10 min when something changed)");
  }
  return checks;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const files = selectLogFiles(options);
  if (files.length === 0) {
    console.error("No app-*.log files matched.");
    process.exit(1);
  }
  const result = analyze(files);
  const checks = buildChecks(result);

  console.log(`Yomi Reader robustness report — ${files.map((file) => path.basename(file)).join(", ")}`);
  console.log(`${result.sessions.length} renderer session(s)\n`);
  for (const check of checks) {
    console.log(`[${check.status}] ${check.name}: ${check.detail}`);
  }

  if (options.json) {
    fs.writeFileSync(options.json, JSON.stringify({ files, checks }, null, 2));
    console.log(`\nWrote ${options.json}`);
  }
  process.exit(checks.some((check) => check.status === "FAIL") ? 2 : 0);
}

main();
