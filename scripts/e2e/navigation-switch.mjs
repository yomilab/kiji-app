#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import {
  buildAtomFeed,
  buildMultiStationOpml,
  E2E_STATION_ALPHA,
  E2E_STATION_BETA,
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
} from "./e2eRunner.mjs";

export async function runNavigationSwitchE2e() {
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
    "/alpha.xml": {
      contentType: "application/atom+xml; charset=utf-8",
      body: buildAtomFeed({
        feedId: "e2e-alpha",
        title: "E2E Alpha Feed",
        entries: [
          {
            id: "e2e-alpha-1",
            title: "Alpha article one",
            link: `${baseUrl}/alpha/1`,
            summary: "Alpha station article",
          },
        ],
      }),
    },
    "/beta.xml": {
      contentType: "application/atom+xml; charset=utf-8",
      body: buildAtomFeed({
        feedId: "e2e-beta",
        title: "E2E Beta Feed",
        entries: [
          {
            id: "e2e-beta-1",
            title: "Beta article one",
            link: `${baseUrl}/beta/1`,
            summary: "Beta station article",
          },
        ],
      }),
    },
  });

  const opmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-opml-")), "navigation.opml");
  fs.writeFileSync(opmlPath, buildMultiStationOpml(baseUrl));

  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: "",
    extraEnv: {
      KIJI_E2E_BOOTSTRAP: "opml",
      KIJI_E2E_OPML_PATH: opmlPath,
    },
  });

  try {
    await waitForEvent(e2eDir, "main-shell-ready");
    const imported = await waitForEvent(
      e2eDir,
      "opml-import-complete",
      (event) => (event.payload?.feedCount ?? 0) >= 2,
    );

    const alphaFeed = imported.payload?.feeds?.find((feed) => feed.title === "E2E Alpha Feed");
    const betaFeed = imported.payload?.feeds?.find((feed) => feed.title === "E2E Beta Feed");
    if (!alphaFeed?.id || !betaFeed?.id) {
      throw new Error("Expected alpha and beta feeds in OPML import payload");
    }

    writeE2eCommand(e2eDir, "select-station", { stationName: E2E_STATION_BETA });
    await waitForEvent(
      e2eDir,
      "navigation-changed",
      (event) => event.payload?.selectedTag === E2E_STATION_BETA,
    );

    writeE2eCommand(e2eDir, "select-feed", { feedId: betaFeed.id });
    const betaList = await waitForEvent(
      e2eDir,
      "article-list-snapshot",
      (event) => event.payload?.selectedFeedId === betaFeed.id && (event.payload?.articleCount ?? 0) >= 1,
      90_000,
    );

    writeE2eCommand(e2eDir, "select-station", { stationName: E2E_STATION_ALPHA });
    await waitForEvent(
      e2eDir,
      "navigation-changed",
      (event) => event.payload?.selectedTag === E2E_STATION_ALPHA,
    );

    writeE2eCommand(e2eDir, "select-feed", { feedId: alphaFeed.id });
    const alphaList = await waitForEvent(
      e2eDir,
      "article-list-snapshot",
      (event) => event.payload?.selectedFeedId === alphaFeed.id && (event.payload?.articleCount ?? 0) >= 1,
      90_000,
    );

    return {
      skipped: false,
      alphaArticleCount: alphaList.payload?.articleCount ?? 0,
      betaArticleCount: betaList.payload?.articleCount ?? 0,
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
  runNavigationSwitchE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:navigation-switch] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(
        `[e2e:navigation-switch] Passed: alpha=${result.alphaArticleCount} beta=${result.betaArticleCount}`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:navigation-switch] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
