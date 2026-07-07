#!/usr/bin/env node
/**
 * E2E: scheduled feed refresh — second cycle fetches phase-2 mock feed articles.
 */
import { pathToFileURL } from "node:url";
import path from "node:path";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import { createMockFeedServer } from "./mockFeedServer.mjs";
import {
  createE2eSessionDirs,
  E2E_SCHEDULER_INTERVAL_MS,
  formatE2eFailure,
  sleep,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
} from "./e2eRunner.mjs";

export async function runFeedRefreshE2e() {
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

  const mockFeed = createMockFeedServer();
  const { feedUrl, fetchCount } = await mockFeed.start();
  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, { homeDir, e2eDir, feedUrl });

  try {
    await waitForEvent(
      e2eDir,
      "scheduler-ready",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    await sleep(Number(E2E_SCHEDULER_INTERVAL_MS) + 300);

    const refreshEvent = await waitForEvent(
      e2eDir,
      "cycle-complete",
      (event) => (event.payload?.cycleCount ?? 0) >= 2,
    );

    const articleCount = refreshEvent.payload?.articleCount ?? 0;
    const serverFetchCount = fetchCount();
    if (serverFetchCount < 2) {
      throw new Error(`Expected mock feed fetch count >= 2, got ${serverFetchCount}`);
    }
    if (articleCount < 2) {
      throw new Error(`Expected >= 2 articles after refresh cycle, got ${articleCount}`);
    }

    return {
      skipped: false,
      binaryPath,
      feedUrl,
      articleCount,
      fetchCount: serverFetchCount,
      cycleCount: refreshEvent.payload?.cycleCount ?? 0,
    };
  } catch (error) {
    throw new Error(formatE2eFailure(error, e2eDir, stderr));
  } finally {
    await stopE2eApp({ child, homeDir, e2eDir, mockFeed });
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runFeedRefreshE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:feed-refresh] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:feed-refresh] Passed: fetches=${result.fetchCount} articles=${result.articleCount}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:feed-refresh] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
