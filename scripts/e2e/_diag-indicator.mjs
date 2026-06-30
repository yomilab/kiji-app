#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeE2eCommand } from "./e2eCommands.mjs";
import { createE2eContentServer } from "./e2eContentServer.mjs";
import {
  buildAtomFeed,
  buildMultiStationOpml,
  E2E_STATION_ALPHA,
  E2E_STATION_BETA,
} from "./e2eFixtures.mjs";
import { resolveE2eBundledBinary } from "./e2eSupport.mjs";
import {
  createE2eSessionDirs,
  startE2eApp,
  waitForEvent,
} from "./e2eRunner.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const readIndicator = (e2eDir) => {
  const p = path.join(e2eDir, "events", "refresh-indicator-snapshot.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
};

async function main() {
  const routes = {};
  const server = createE2eContentServer(routes);
  const { baseUrl } = await server.start();
  Object.assign(routes, {
    "/alpha.xml": { contentType: "application/atom+xml; charset=utf-8", body: buildAtomFeed({ feedId: "e2e-alpha", title: "E2E Alpha Feed", entries: [{ id: "e2e-alpha-1", title: "Alpha article one", link: `${baseUrl}/alpha/1`, summary: "Alpha station article" }] }) },
    "/beta.xml": { contentType: "application/atom+xml; charset=utf-8", body: buildAtomFeed({ feedId: "e2e-beta", title: "E2E Beta Feed", entries: [{ id: "e2e-beta-1", title: "Beta article one", link: `${baseUrl}/beta/1`, summary: "Beta station article" }] }) },
  });
  const opmlPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "kiji-e2e-opml-")), "indicator.opml");
  fs.writeFileSync(opmlPath, buildMultiStationOpml(baseUrl));
  const binaryPath = resolveE2eBundledBinary();
  const { homeDir, e2eDir } = createE2eSessionDirs();
  const { child, stderr } = startE2eApp(binaryPath, { homeDir, e2eDir, feedUrl: "", extraEnv: { KIJI_E2E_BOOTSTRAP: "opml", KIJI_E2E_OPML_PATH: opmlPath, KIJI_E2E_SCHEDULER_INTERVAL_MS: "5000" } });

  try {
    await waitForEvent(e2eDir, "main-shell-ready");
    await waitForEvent(e2eDir, "opml-import-complete", (e) => (e.payload?.feedCount ?? 0) >= 2);
    // Select ALPHA first (warm), then BETA — mirror the real harness.
    writeE2eCommand(e2eDir, "select-station", { stationName: E2E_STATION_ALPHA });
    await waitForEvent(e2eDir, "navigation-changed", (e) => e.payload?.selectedTag === E2E_STATION_ALPHA);
    await waitForEvent(e2eDir, "article-list-snapshot", (e) => e.payload?.selectedTag === E2E_STATION_ALPHA && (e.payload?.articleCount ?? 0) >= 1, 30_000);
    await sleep(1000);

    writeE2eCommand(e2eDir, "select-station", { stationName: E2E_STATION_BETA });
    await waitForEvent(e2eDir, "navigation-changed", (e) => e.payload?.selectedTag === E2E_STATION_BETA);
    console.log("[diag] BETA selected; sampling indicator for 8s...");
    let last = null;
    const samples = [];
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const ev = readIndicator(e2eDir);
      if (ev && (last === null || ev.payload?.indicatorText !== last?.payload?.indicatorText || ev.payload?.selectedTag !== last?.payload?.selectedTag)) {
        samples.push({ t: Date.now() - start, tag: ev.payload?.selectedTag, text: ev.payload?.indicatorText, fg: ev.payload?.foregroundQueuedFeedCount, bg: ev.payload?.backgroundQueuedFeedCount, scope: ev.payload?.interactiveRefreshScopeTotal, completed: ev.payload?.interactiveRefreshCompleted });
        last = ev;
      }
      await sleep(30);
    }
    console.log("[diag] BETA indicator samples:");
    for (const s of samples) console.log(`  t=${s.t}ms tag=${s.tag} text=${JSON.stringify(s.text)} fg=${s.fg} bg=${s.bg} scope=${s.scope} completed=${s.completed}`);
  } catch (error) {
    console.log(`[diag] failed: ${error.message}`);
  }
  console.log(`\n[diag] stderr (last 1500):\n${stderr().slice(-1500)}`);
  try { child.kill("SIGKILL"); } catch {}
  fs.rmSync(e2eDir, { recursive: true, force: true });
  fs.rmSync(path.dirname(opmlPath), { recursive: true, force: true });
}

main();
