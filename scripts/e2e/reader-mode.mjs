#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import path from "node:path";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import { buildReaderAtomFeed, READER_HTML } from "./e2eFixtures.mjs";
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

export async function runReaderModeE2e() {
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
      body: buildReaderAtomFeed(baseUrl),
    },
    "/article.html": {
      contentType: "text/html; charset=utf-8",
      body: READER_HTML,
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
    await waitForEvent(e2eDir, "scheduler-ready", (event) => (event.payload?.articleCount ?? 0) >= 1);
    writeE2eCommand(e2eDir, "open-article", { index: 0 });
    await waitForEvent(e2eDir, "article-deck-phase", (event) => event.payload?.phase === "open");
    await waitForEvent(e2eDir, "article-content-ready");

    writeE2eCommand(e2eDir, "toggle-reader-mode");
    await waitForEvent(
      e2eDir,
      "reader-mode-changed",
      (event) => event.payload?.mode === "reader",
    );
    const readerReady = await waitForEvent(
      e2eDir,
      "reader-content-ready",
      (event) => (event.payload?.wordCount ?? 0) > 0,
    );

    return {
      skipped: false,
      wordCount: readerReady.payload?.wordCount ?? 0,
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
  runReaderModeE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:reader-mode] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(`[e2e:reader-mode] Passed: wordCount=${result.wordCount}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:reader-mode] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
