import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseFeed } from "@/services/feeds/feedsFetcher";
import { feedsManager } from "@/services/feeds/feedsManager";
import * as articleStore from "@/stores/articleStore";
import * as feedStore from "@/stores/feedStore";
import { feedsFetcher } from "@/services/feeds/feedsFetcher";
import { feedNetworkDataResult } from "../helpers/feedNetworkFetchMock";
import {
  electronFixturesAreAvailable,
  readElectronFixture,
} from "../parity/electronFixtures";

const manifestPath = path.join(process.cwd(), "src-tauri/Cargo.toml");
const describeWithFixtures = electronFixturesAreAvailable() ? describe : describe.skip;

describe("Desktop smoke (todo 22)", () => {
  it(
    "passes Rust desktop workflow smoke for feed refresh, save, export, and relaunch persistence",
    () => {
      expect(fs.existsSync(manifestPath)).toBe(true);

      const result = spawnSync(
        "cargo",
        [
          "test",
          "--manifest-path",
          manifestPath,
          "desktop_smoke_workflow",
          "--",
          "--nocapture",
        ],
        { cwd: process.cwd(), encoding: "utf8" },
      );

      if (result.status !== 0) {
        throw new Error(
          `Rust desktop smoke failed:\n${result.stdout}\n${result.stderr}`,
        );
      }
    },
    120_000,
  );
});

describeWithFixtures("Desktop smoke (todo 22)", () => {
  it("refreshes a feed from fixture XML through the service layer", async () => {
    const fixtureXml = readElectronFixture("simon.xml");
    const parsedItems = parseFeed(fixtureXml, "https://example.com/simon.xml");
    expect(parsedItems.length).toBeGreaterThan(0);

    const feed = {
      id: "smoke-feed-service",
      url: "https://example.com/simon.xml",
      title: "Simon Smoke Feed",
      createdAt: new Date("2026-06-06T00:00:00.000Z"),
      unreadCount: 0,
      articleCount: 0,
      tags: [],
      sortOrder: 0,
      consecutiveFailures: 0,
    };

    vi.spyOn(feedStore, "getById").mockResolvedValue(feed as never);
    vi.spyOn(feedStore, "update").mockResolvedValue(undefined as never);
    vi.spyOn(feedsFetcher, "fetchFeedNetworkWithCache").mockResolvedValue(
      feedNetworkDataResult(fixtureXml),
    );
    vi.spyOn(articleStore, "store").mockResolvedValue(parsedItems.length);
    vi.spyOn(articleStore, "getArticleCount").mockResolvedValue(parsedItems.length);
    vi.spyOn(articleStore, "getUnreadCount").mockResolvedValue(parsedItems.length);

    const result = await feedsManager.refreshFeed("smoke-feed-service");

    expect(result.notModified).toBe(false);
    expect(result.insertedCount).toBe(parsedItems.length);
    expect(feedStore.update).toHaveBeenCalledWith(
      "smoke-feed-service",
      expect.objectContaining({
        articleCount: parsedItems.length,
        unreadCount: parsedItems.length,
        consecutiveFailures: 0,
      }),
    );
  });
});

describe("Desktop launch smoke (todo 22)", () => {
  it("launches KiJi briefly on macOS when a built binary exists", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const { runLaunchSmoke } = await import("../../scripts/smoke-launch.mjs");
    const result = await runLaunchSmoke();

    if (result.skipped) {
      expect(result.reason).toBeTruthy();
      return;
    }

    expect(result.pid).toBeGreaterThan(0);
    expect(result.binaryPath).toContain("kiji-app");
  }, 20_000);
});
