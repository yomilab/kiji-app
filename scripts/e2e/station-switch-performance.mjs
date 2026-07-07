#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import {
  buildAtomFeedEntryRoutes,
  buildLargeStationPerformanceOpml,
  E2E_LARGE_STATION_FEED_COUNT,
  E2E_STATION_COMPACT,
  E2E_STATION_DAILY,
} from "./e2eFixtures.mjs";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import {
  createE2eSessionDirs,
  formatE2eFailure,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
  waitForSwitchPerfEvent,
} from "./e2eRunner.mjs";
import { STATION_SWITCH_E2E_BUDGETS_MS } from "./switchPerformanceBudgets.mjs";

const CI_E2E_PERF_TIMEOUT_MS = process.env.KIJI_RUN_E2E_IN_CI === "1" ? 180_000 : 90_000;
  const failures = [];

  if (sample.harnessInteractiveMs > budgets.harnessInteractive) {
    failures.push(
      `${label}: harness ${sample.harnessInteractiveMs}ms > ${budgets.harnessInteractive}ms`,
    );
  }

  const interactiveMs = sample.traceInteractiveMs;
  if (typeof interactiveMs === "number") {
    const interactiveBudget = sample.isWarmSwitch ? budgets.warmInteractive : budgets.coldInteractive;
    if (interactiveMs > interactiveBudget) {
      failures.push(
        `${label}: interactive ${interactiveMs}ms > ${interactiveBudget}ms`,
      );
    }
  }

  const renderCommitMs = sample.renderCommitMs;
  if (typeof renderCommitMs === "number" && renderCommitMs > budgets.renderCommit) {
    failures.push(
      `${label}: render commit ${renderCommitMs}ms > ${budgets.renderCommit}ms`,
    );
  }

  const blockingSqliteMs = sample.stageDurationsMs?.["sqlite-query"];
  if (typeof blockingSqliteMs === "number" && blockingSqliteMs > budgets.sqliteQuery) {
    failures.push(
      `${label}: blocking sqlite-query ${blockingSqliteMs}ms > ${budgets.sqliteQuery}ms`,
    );
  }

  if (sample.expectLargeStationFastPath) {
    const hasBlockingSqlite = typeof sample.stageDurationsMs?.["sqlite-query"] === "number";
    if (hasBlockingSqlite) {
      failures.push(`${label}: large station cold switch blocked on sqlite-query`);
    }
    if (!sample.usedLargeStationFastPath) {
      failures.push(`${label}: expected large-station-fast-path stage`);
    }
  }

  const paintGateMs = sample.stageDurationsMs?.["paint-gate"];
  if (typeof paintGateMs === "number" && paintGateMs > budgets.paintGate) {
    failures.push(
      `${label}: paint-gate ${paintGateMs}ms > ${budgets.paintGate}ms`,
    );
  }

  if (failures.length > 0) {
    throw new Error(`${failures.join("; ")}\nSample: ${JSON.stringify(sample, null, 2)}`);
  }
}

async function measureStationSwitch(e2eDir, stationName, options = {}) {
  const {
    isWarmSwitch = false,
    expectLargeStationFastPath = false,
  } = options;
  const startedAt = Date.now();
  writeE2eCommand(e2eDir, "select-station", { stationName });

  await waitForEvent(
    e2eDir,
    "navigation-changed",
    (event) => event.payload?.selectedTag === stationName,
    90_000,
  );

  await waitForEvent(
    e2eDir,
    "article-list-snapshot",
    (event) => event.payload?.selectedTag === stationName,
    90_000,
  );

  if (expectLargeStationFastPath) {
    await waitForEvent(
      e2eDir,
      "large-station-fast-path",
      (event) => event.payload?.tagName === stationName
        && (event.payload?.taggedFeedCount ?? 0) >= STATION_SWITCH_E2E_BUDGETS_MS.largeStationMinFeeds,
      CI_E2E_PERF_TIMEOUT_MS,
    );
  }

  const harnessInteractiveMs = Date.now() - startedAt;
  const perfEvent = await waitForSwitchPerfEvent(
    e2eDir,
    startedAt - 50,
    (event) => event.payload?.sourceKey === `tag:${stationName}`
      && event.payload?.phase === "interactive",
    CI_E2E_PERF_TIMEOUT_MS,
  );

  const payload = perfEvent.payload ?? {};
  const stageTimeline = Array.isArray(payload.stageTimeline) ? payload.stageTimeline : [];

  return {
    stationName,
    isWarmSwitch,
    expectLargeStationFastPath,
    harnessInteractiveMs,
    traceInteractiveMs: payload.interactiveDurationMs ?? null,
    renderCommitMs: payload.renderCommit?.actualDurationMs ?? null,
    stageDurationsMs: payload.stageDurationsMs ?? {},
    budgetViolations: payload.budgetViolations ?? [],
    fromSnapshot: stageTimeline.some((stage) => stage.name === "snapshot-restored"),
    usedLargeStationFastPath: stageTimeline.some((stage) => stage.name === "large-station-fast-path")
      || expectLargeStationFastPath,
    taggedFeedCount: payload.context?.taggedFeedCount ?? payload.context?.feedCount ?? null,
  };
}

export async function runStationSwitchPerformanceE2e() {
  const skipReason = getE2eSkipReason();
  if (skipReason) {
    return { skipped: true, reason: skipReason };
  }

  const binaryPath = await ensureE2eBundledBinary();
  if (!binaryPath) {
    return {
      skipped: true,
      reason: isE2eRequired()
        ? "KiJi.app debug bundle missing — run npm run build:debug"
        : "No KiJi debug bundle available",
    };
  }

  const routes = {};
  const server = createE2eContentServer(routes);
  const { baseUrl } = await server.start();

  for (let index = 0; index < E2E_LARGE_STATION_FEED_COUNT; index += 1) {
    const slug = `daily-${index}`;
    routes[`/${slug}.xml`] = buildAtomFeedEntryRoutes(
      baseUrl,
      slug,
      `e2e-daily-${index}`,
      `E2E Daily ${index}`,
    );
  }

  Object.assign(routes, {
    "/compact.xml": buildAtomFeedEntryRoutes(baseUrl, "compact", "e2e-compact", "E2E Compact"),
  });

  const opmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-opml-")), "performance-large.opml");
  fs.writeFileSync(opmlPath, buildLargeStationPerformanceOpml(baseUrl));

  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: "",
    extraEnv: {
      KIJI_E2E_BOOTSTRAP: "opml",
      KIJI_E2E_OPML_PATH: opmlPath,
      KIJI_E2E_SCHEDULER_INTERVAL_MS: "5000",
    },
  });

  try {
    await waitForEvent(e2eDir, "main-shell-ready");
    const importEvent = await waitForEvent(
      e2eDir,
      "opml-import-complete",
      (event) => (event.payload?.feedCount ?? 0) >= E2E_LARGE_STATION_FEED_COUNT,
    );

    const importedFeedCount = importEvent.payload?.feedCount ?? 0;
    if (importedFeedCount < STATION_SWITCH_E2E_BUDGETS_MS.largeStationMinFeeds) {
      throw new Error(
        `Expected at least ${STATION_SWITCH_E2E_BUDGETS_MS.largeStationMinFeeds} imported feeds for real-scale perf E2E, got ${importedFeedCount}`,
      );
    }

    const dailyCold = await measureStationSwitch(e2eDir, E2E_STATION_DAILY, {
      isWarmSwitch: false,
      expectLargeStationFastPath: true,
    });
    await waitForEvent(
      e2eDir,
      "article-list-snapshot",
      (event) => event.payload?.selectedTag === E2E_STATION_DAILY
        && (event.payload?.articleCount ?? 0) >= 1,
      90_000,
    );
    const compactWarm = await measureStationSwitch(e2eDir, E2E_STATION_COMPACT, {
      isWarmSwitch: true,
    });
    const dailyWarm = await measureStationSwitch(e2eDir, E2E_STATION_DAILY, {
      isWarmSwitch: true,
    });

    assertSwitchWithinBudget("daily-cold", dailyCold, STATION_SWITCH_E2E_BUDGETS_MS);
    assertSwitchWithinBudget("compact-warm", compactWarm, STATION_SWITCH_E2E_BUDGETS_MS);
    assertSwitchWithinBudget("daily-warm", dailyWarm, STATION_SWITCH_E2E_BUDGETS_MS);

    if (!dailyWarm.fromSnapshot) {
      throw new Error("Expected warm Daily switch to restore a source snapshot");
    }

    return {
      skipped: false,
      importedFeedCount,
      dailyCold,
      compactWarm,
      dailyWarm,
    };
  } catch (error) {
    throw new Error(formatE2eFailure(error, e2eDir, stderr));
  } finally {
    await stopE2eApp({ child, homeDir, e2eDir, mockFeed: server });
    fs.rmSync(path.dirname(opmlPath), { recursive: true, force: true });
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runStationSwitchPerformanceE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:station-switch-performance] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:station-switch-performance] Passed: daily-cold=${result.dailyCold.harnessInteractiveMs}ms daily-warm=${result.dailyWarm.harnessInteractiveMs}ms feeds=${result.importedFeedCount}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(
        `[e2e:station-switch-performance] Failed: ${error instanceof Error ? error.message : error}`,
      );
      process.exit(1);
    });
}
