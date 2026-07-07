#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import { buildScrollAtomFeed } from "./e2eFixtures.mjs";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import {
  createE2eSessionDirs,
  E2E_FEED_ID,
  formatE2eFailure,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
} from "./e2eRunner.mjs";

export async function runArticleListScrollE2e() {
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
  Object.assign(routes, {
    "/feed.xml": {
      contentType: "application/atom+xml; charset=utf-8",
      body: buildScrollAtomFeed(baseUrl, 120),
    },
  });

  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: `${baseUrl}/feed.xml`,
    extraEnv: { KIJI_E2E_FEED_ID: E2E_FEED_ID },
  });

  try {
    await waitForEvent(
      e2eDir,
      "scheduler-ready",
      (event) => (event.payload?.articleCount ?? 0) >= 120,
      90_000,
    );
    const listSnapshot = await waitForEvent(
      e2eDir,
      "article-list-snapshot",
      (event) => (event.payload?.articlesTotalCount ?? 0) >= 120,
      90_000,
    );
    const initialLoaded = listSnapshot.payload?.articleCount ?? 0;

    writeE2eCommand(e2eDir, "scroll-list", { toEnd: true });
    const scrollState = await waitForEvent(
      e2eDir,
      "scroll-state",
      (event) => event.payload?.toEnd === true,
    );
    const loadMore = await waitForEvent(e2eDir, "load-more-complete");

    const loadedAfterScroll = loadMore.payload?.loadedCount ?? scrollState.payload?.loadedCount ?? 0;
    if (loadedAfterScroll <= initialLoaded) {
      throw new Error(
        `Expected more articles after scroll-to-end (before=${initialLoaded} after=${loadedAfterScroll})`,
      );
    }

    return {
      skipped: false,
      initialLoaded,
      loadedAfterScroll,
    };
  } catch (error) {
    throw new Error(formatE2eFailure(error, e2eDir, stderr));
  } finally {
    await stopE2eApp({ child, homeDir, e2eDir, mockFeed: server });
  }
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runArticleListScrollE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:article-list-scroll] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:article-list-scroll] Passed: ${result.initialLoaded} -> ${result.loadedAfterScroll}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:article-list-scroll] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
