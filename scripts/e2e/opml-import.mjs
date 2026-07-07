#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import { buildImportOpml } from "./e2eFixtures.mjs";
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

export async function runOpmlImportE2e() {
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
    "/alpha.xml": { contentType: "application/atom+xml; charset=utf-8", body: minimalFeed("alpha") },
    "/beta.xml": { contentType: "application/atom+xml; charset=utf-8", body: minimalFeed("beta") },
  });

  const opmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-opml-")), "import.opml");
  fs.writeFileSync(opmlPath, buildImportOpml(baseUrl));

  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, {
    homeDir,
    e2eDir,
    feedUrl: "",
    extraEnv: { KIJI_E2E_BOOTSTRAP: "none" },
  });

  try {
    await waitForEvent(e2eDir, "main-shell-ready");
    writeE2eCommand(e2eDir, "import-opml", { path: opmlPath });
    const imported = await waitForEvent(
      e2eDir,
      "opml-import-complete",
      (event) => (event.payload?.feedCount ?? 0) >= 2,
    );
    const refreshed = await waitForEvent(
      e2eDir,
      "cycle-complete",
      (event) => (event.payload?.articleCount ?? 0) >= 1,
    );

    return {
      skipped: false,
      feedCount: imported.payload?.feedCount ?? 0,
      stationCount: imported.payload?.stationCount ?? 0,
      articleCount: refreshed.payload?.articleCount ?? 0,
    };
  } catch (error) {
    throw new Error(formatE2eFailure(error, e2eDir, stderr));
  } finally {
    await stopE2eApp({ child, homeDir, e2eDir, mockFeed: server });
    fs.rmSync(path.dirname(opmlPath), { recursive: true, force: true });
  }
}

function minimalFeed(name) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>E2E ${name}</title>
  <id>e2e-${name}</id>
  <updated>2026-06-18T00:00:00Z</updated>
  <entry>
    <title>${name} article</title>
    <id>e2e-${name}-1</id>
    <updated>2026-06-18T00:00:00Z</updated>
    <link href="https://example.com/${name}" />
    <summary>${name}</summary>
  </entry>
</feed>`;
}

const isMainModule =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainModule) {
  runOpmlImportE2e()
    .then((result) => {
      assertE2eNotSkipped(result);
      if (result.skipped) {
        console.log(`[e2e:opml-import] Skipped: ${result.reason}`);
        process.exit(0);
      }
      console.log(`[e2e:opml-import] Passed: feeds=${result.feedCount} stations=${result.stationCount}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(`[e2e:opml-import] Failed: ${error instanceof Error ? error.message : error}`);
      process.exit(1);
    });
}
