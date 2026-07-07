#!/usr/bin/env node
/**
 * E2E: app bootstrap — real KiJi.app starts, imports mock feed, mounts shell, shows articles.
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
  formatE2eFailure,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
} from "./e2eRunner.mjs";

export async function runAppBootstrapE2e() {
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
    await waitForEvent(e2eDir, "main-shell-ready");
    await waitForEvent(e2eDir, "scheduler-bootstrap");
    await waitForEvent(
      e2eDir,
      "scheduler-ready",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    const listSnapshot = await waitForEvent(
      e2eDir,
      "article-list-snapshot",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    return {
      skipped: false,
      binaryPath,
      feedUrl,
      articleCount: listSnapshot.payload?.articleCount ?? 0,
      selectedFeedId: listSnapshot.payload?.selectedFeedId ?? null,
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
  runAppBootstrapE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:app-bootstrap] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:app-bootstrap] Passed: articles=${result.articleCount} feed=${result.selectedFeedId}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:app-bootstrap] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
