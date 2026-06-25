import { beforeEach, describe, expect, it, vi } from "vitest";

const previewNativeCycle = vi.hoisted(() => vi.fn());
const beginQueuedFeeds = vi.hoisted(() => vi.fn(() => vi.fn()));

vi.mock("@/lib/tauriClient", () => ({
  tauriClient: {
    scheduler: {
      previewNativeCycle,
    },
  },
}));

vi.mock("@/services/feeds/feedRefreshActivity", () => ({
  feedRefreshActivity: {
    beginQueuedFeeds,
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, handler) => {
    if (_event === "scheduler:native-cycle-start") {
      handler({ payload: { feedIds: ["feed-1"], queuedCount: 1 } });
    }
    if (_event === "scheduler:native-cycle-feed") {
      handler({
        payload: {
          feedId: "feed-1",
          insertedCount: 2,
        },
      });
    }
    return vi.fn();
  }),
}));

import { runNativeFeedRefresh } from "@/services/scheduler/nativeFeedRefresh";

describe("nativeFeedRefresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    previewNativeCycle.mockResolvedValue({
      plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
      queuedCount: 1,
      executedFeedCount: 1,
      changedFeeds: 1,
      notModifiedFeeds: 0,
      failedFeeds: 0,
      insertedArticles: 2,
      feedResults: [
        { feedId: "feed-1", status: "changed", insertedCount: 2 },
      ],
    });
  });

  it("invokes previewNativeCycle with scoped force refresh ids", async () => {
    const result = await runNativeFeedRefresh({
      feedIds: ["feed-1"],
      forceRefreshFeedIds: new Set(["feed-1"]),
    });

    expect(previewNativeCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: true,
        options: expect.objectContaining({
          onlyFeedIds: ["feed-1"],
          forceRefreshFeedIds: ["feed-1"],
        }),
      }),
    );
    expect(result.insertedArticles).toBe(2);
    expect(result.insertedByFeedId.get("feed-1")).toBe(2);
    expect(beginQueuedFeeds).toHaveBeenCalledWith(["feed-1"], "foreground");
  });

  it("skips activity queue when the caller already reserved foreground slots", async () => {
    await runNativeFeedRefresh({
      feedIds: ["feed-1"],
      forceRefreshFeedIds: new Set(["feed-1"]),
      skipActivityQueue: true,
    });

    expect(beginQueuedFeeds).not.toHaveBeenCalled();
  });
});
