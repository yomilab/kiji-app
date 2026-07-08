#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import { buildManageStationOpml, E2E_STATION_MANAGE } from "./e2eFixtures.mjs";
import {
  assertE2eNotSkipped,
  ensureE2eBundledBinary,
  getE2eSkipReason,
  isE2eRequired,
} from "./e2eSupport.mjs";
import {
  createE2eSessionDirs,
  formatE2eFailure,
  issueE2eCommandAndWaitForEvent,
  startE2eApp,
  stopE2eApp,
  waitForEvent,
  waitForHarnessBootstrapSettled,
} from "./e2eRunner.mjs";

export async function runFeedDeleteE2e() {
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
    "/manage.xml": {
      contentType: "application/atom+xml; charset=utf-8",
      body: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E Manage Feed</title>
  <id>e2e-manage</id>
  <updated>2026-06-18T00:00:00Z</updated>
  <entry>
    <title>Manage article</title>
    <id>e2e-manage-1</id>
    <updated>2026-06-18T00:00:00Z</updated>
    <link href="https://example.com/manage" />
    <summary>manage</summary>
  </entry>
</feed>`,
    },
  });

  const opmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-opml-")), "delete.opml");
  fs.writeFileSync(opmlPath, buildManageStationOpml(baseUrl));

  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: "",
    extraEnv: {
      KIJI_E2E_BOOTSTRAP: "opml",
      KIJI_E2E_OPML_PATH: opmlPath,
      KIJI_E2E_AUTO_CONFIRM: "1",
    },
  });

  try {
    await waitForEvent(e2eDir, "opml-import-complete");
    await waitForHarnessBootstrapSettled(e2eDir);
    await issueE2eCommandAndWaitForEvent(
      e2eDir,
      "delete-station",
      { stationName: E2E_STATION_MANAGE },
      "feed-delete-confirmed",
    );
    const snapshot = await waitForEvent(
      e2eDir,
      "station-library-snapshot",
      (event) => !event.payload?.stationNames?.includes(E2E_STATION_MANAGE),
    );

    return {
      skipped: false,
      stationNames: snapshot.payload?.stationNames ?? [],
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
  runFeedDeleteE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:feed-delete] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(`[e2e:feed-delete] Passed: stations=${result.stationNames.length}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:feed-delete] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
