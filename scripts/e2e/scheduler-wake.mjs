#!/usr/bin/env node
/**
 * End-to-end scheduler wake harness.
 *
 * Spawns a real KiJi debug bundle with an isolated HOME, serves a mock Atom feed,
 * waits for the first scheduler cycle, triggers the Rust system-resume emit path,
 * and asserts a second catch-up cycle inserts the post-wake article.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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

export async function runSchedulerWakeE2e() {
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
  const { feedUrl } = await mockFeed.start();
  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, { homeDir, e2eDir, feedUrl });

  try {
    const readyEvent = await waitForEvent(
      e2eDir,
      "scheduler-ready",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    const initialArticleCount = readyEvent.payload?.articleCount ?? 0;
    if (initialArticleCount < 1) {
      throw new Error(`Expected at least one article after first cycle, got ${initialArticleCount}`);
    }

    await sleep(Number(E2E_SCHEDULER_INTERVAL_MS) + 200);

    fs.writeFileSync(path.join(e2eDir, "commands", "emit-system-resume"), "");
    await waitForEvent(e2eDir, "resume-emitted");

    const catchUpEvent = await waitForEvent(
      e2eDir,
      "cycle-complete",
      (event) => (event.payload?.cycleCount ?? 0) >= 2,
    );

    const articleCountAfterWake = catchUpEvent.payload?.articleCount ?? 0;
    if (articleCountAfterWake < 2) {
      throw new Error(
        `Expected post-wake article import (>=2 articles), got ${articleCountAfterWake}`,
      );
    }

    return {
      skipped: false,
      binaryPath,
      feedUrl,
      initialArticleCount,
      articleCountAfterWake,
      cycleCount: catchUpEvent.payload?.cycleCount ?? 0,
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
  runSchedulerWakeE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:scheduler-wake] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:scheduler-wake] Passed: cycles=${result.cycleCount} articles=${result.articleCountAfterWake}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:scheduler-wake] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
