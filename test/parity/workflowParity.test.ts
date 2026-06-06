import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { parseFeed } from "@/services/feeds/feedsFetcher";
import { normalizeFeedUrl, parseOpmlEntries } from "@/services/feeds/opmlImportService";
import { opmlExportService } from "@/services/feeds/opmlExportService";
import { feedsManager } from "@/services/feeds/feedsManager";
import { tagsManager } from "@/services/tags/tagsManager";
import { electronFixturesAreAvailable, FEEDS_OPML_ENTRY_COUNT, FEEDS_OPML_UNIQUE_URL_COUNT, readElectronFixture } from "./electronFixtures";

const describeWithFixtures = electronFixturesAreAvailable() ? describe : describe.skip;

describeWithFixtures("Electron workflow parity (21c)", () => {
  it("imports Feeds.opml with a stable feed entry count", () => {
    const entries = parseOpmlEntries(readElectronFixture("Feeds.opml"));
    expect(entries.length).toBe(FEEDS_OPML_ENTRY_COUNT);
    expect(new Set(entries.map((entry) => normalizeFeedUrl(entry.url))).size).toBe(
      FEEDS_OPML_UNIQUE_URL_COUNT,
    );
  });

  it("round-trips OPML export structure for fixture-derived feeds", async () => {
    const entries = parseOpmlEntries(readElectronFixture("Feeds.opml")).slice(0, 12);
    const feeds = entries.map((entry, index) => ({
      id: `feed-${index}`,
      title: entry.title,
      url: entry.url,
      tags: entry.station ? [entry.station] : [],
      emoji: undefined,
    }));
    const stationNames = [...new Set(entries.map((entry) => entry.station).filter(Boolean))] as string[];

    vi.spyOn(feedsManager, "getAllFeeds").mockResolvedValue(feeds as never);
    vi.spyOn(tagsManager, "getAllTags").mockResolvedValue(
      stationNames.map((name, index) => ({
        name,
        emoji: undefined,
        feedIds: feeds.filter((feed) => feed.tags.includes(name)).map((feed) => feed.id),
        createdAt: "2026-01-01T00:00:00.000Z",
      })) as never,
    );

    const exported = await opmlExportService.buildOpmlText();
    const reimported = parseOpmlEntries(exported);

    expect(reimported.length).toBeGreaterThanOrEqual(feeds.length);
    for (const feed of feeds) {
      expect(reimported.some((entry) => entry.url === feed.url)).toBe(true);
    }
  });

  it("parses androidFeed.xml and longbridge.xml with readable items", () => {
    for (const fixture of ["androidFeed.xml", "longbridge.xml"] as const) {
      const items = parseFeed(readElectronFixture(fixture), `https://example.com/${fixture}`);
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].title.length).toBeGreaterThan(0);
    }
  });
});

describe("Database migration parity (21d)", () => {
  it("passes Rust synthetic Electron v13/v15 migration tests", () => {
    const manifestPath = path.join(process.cwd(), "src-tauri/Cargo.toml");
    expect(fs.existsSync(manifestPath)).toBe(true);

    const result = spawnSync(
      "cargo",
      ["test", "--manifest-path", manifestPath, "synthetic_v13", "--", "--nocapture"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status).toBe(0);

    const resultV15 = spawnSync(
      "cargo",
      ["test", "--manifest-path", manifestPath, "synthetic_v15", "--", "--nocapture"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    if (resultV15.status !== 0) {
      throw new Error(
        `Rust migration parity tests failed:\n${resultV15.stdout}\n${resultV15.stderr}`,
      );
    }
  });
});

describe("Performance diagnostics parity (21e)", () => {
  it("documents diagnostics and freeze-watchdog command coverage", () => {
    const libRs = fs.readFileSync(path.join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    expect(libRs).toContain("diagnostics_export_bundle");
    expect(libRs).toContain("diagnostics_performance_snapshot");
    expect(fs.existsSync(path.join(process.cwd(), "src/services/performance/interactionFreezeWatchdog.ts"))).toBe(
      true,
    );
  });
});
