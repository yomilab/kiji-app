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
    recordInteractiveRefreshFeedSettled: vi.fn(),
    getSnapshot: vi.fn(() => ({ interactiveRefreshScopeTotal: 0 })),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event, handler) => {
    if (_event === "scheduler:native-cycle-start") {
      handler({ payload: { feedIds: ["feed-1"], queuedCount: 1, cycleId: "native-7" } });
    }
    if (_event === "scheduler:native-cycle-feed") {
      handler({
        payload: {
          feedId: "feed-1",
          insertedCount: 2,
          cycleId: "native-7",
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
      cycleId: "native-7",
    });

    expect(previewNativeCycle).toHaveBeenCalledWith(
      expect.objectContaining({
        execute: true,
        cycleId: "native-7",
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

  it("flags scheduler cycles as background and switches/manual refreshes as not", async () => {
    await runNativeFeedRefresh({ scope: {}, activityKind: "background", cycleId: "native-8" });
    expect(previewNativeCycle).toHaveBeenLastCalledWith(expect.objectContaining({ background: true }));

    await runNativeFeedRefresh({ feedIds: ["feed-1"], forceRefreshFeedIds: new Set(["feed-1"]) });
    expect(previewNativeCycle).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ background: true }),
    );
  });

  it("ignores START/FEED events for a different cycleId", async () => {
    const { listen } = await import("@tauri-apps/api/event");
    const handlers: Array<(event: { payload: unknown }) => void> = [];
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      handlers.push(handler as (event: { payload: unknown }) => void);
      return vi.fn();
    });

    const onFeedComplete = vi.fn();
    const pending = runNativeFeedRefresh({
      feedIds: ["feed-1"],
      cycleId: "native-a",
      onFeedComplete,
    });

    for (let i = 0; i < 20 && handlers.length < 2; i++) {
      await Promise.resolve();
    }

    handlers[0]?.({ payload: { feedIds: ["feed-1"], queuedCount: 1, cycleId: "native-b" } });
    handlers[1]?.({ payload: { feedId: "feed-1", insertedCount: 9, cycleId: "native-b" } });
    expect(beginQueuedFeeds).not.toHaveBeenCalled();
    expect(onFeedComplete).not.toHaveBeenCalled();

    handlers[0]?.({ payload: { feedIds: ["feed-1"], queuedCount: 1, cycleId: "native-a" } });
    handlers[1]?.({ payload: { feedId: "feed-1", insertedCount: 2, cycleId: "native-a" } });
    expect(beginQueuedFeeds).toHaveBeenCalledWith(["feed-1"], "foreground");
    expect(onFeedComplete).toHaveBeenCalledWith(
      expect.objectContaining({ feedId: "feed-1", insertedCount: 2, cycleId: "native-a" }),
    );

    await pending;
  });

  it("skips activity queue when the caller already reserved foreground slots", async () => {
    await runNativeFeedRefresh({
      feedIds: ["feed-1"],
      forceRefreshFeedIds: new Set(["feed-1"]),
      skipActivityQueue: true,
      cycleId: "native-7",
    });

    expect(beginQueuedFeeds).not.toHaveBeenCalled();
  });

  describe("activity-kind lock — foreground must not block on a running background cycle", () => {
    const okResult = () => ({
      plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
      queuedCount: 1,
      executedFeedCount: 1,
      changedFeeds: 0,
      notModifiedFeeds: 1,
      failedFeeds: 0,
      insertedArticles: 0,
      feedResults: [{ feedId: "x", status: "not-modified", insertedCount: 0 }],
    });

    it("runs a foreground refresh concurrently with an in-flight background cycle", async () => {
      let releaseBackground: () => void = () => {};
      const backgroundGate = new Promise<void>((resolve) => {
        releaseBackground = resolve;
      });
      let callCount = 0;
      let foregroundResolved = false;

      previewNativeCycle.mockImplementation(() => {
        callCount += 1;
        // First call is the background cycle — gate it so it stays in flight.
        if (callCount === 1) {
          return backgroundGate.then(() => okResult());
        }
        // Foreground call resolves immediately.
        return Promise.resolve(okResult());
      });

      let backgroundResolved = false;
      const backgroundPromise = runNativeFeedRefresh({
        feedIds: ["bg-1"],
        activityKind: "background",
      }).then(() => {
        backgroundResolved = true;
      });

      // Let the background turn enter its lock and reach previewNativeCycle.
      for (let i = 0; i < 100 && callCount === 0; i++) {
        await Promise.resolve();
      }
      expect(callCount).toBe(1); // background's IPC is in flight (gated)
      expect(backgroundResolved).toBe(false);

      // Foreground must NOT wait for the background gate.
      const foregroundResult = await runNativeFeedRefresh({
        feedIds: ["fg-1"],
        activityKind: "foreground",
        skipActivityQueue: true,
      });
      foregroundResolved = true;

      expect(foregroundResolved).toBe(true);
      expect(callCount).toBe(2); // foreground's IPC ran despite background still gated
      expect(foregroundResult.insertedArticles).toBe(0);
      expect(backgroundResolved).toBe(false); // background still blocked

      releaseBackground();
      await backgroundPromise;
      expect(backgroundResolved).toBe(true);
    });

    it("defers a background turn behind a running foreground turn", async () => {
      let releaseForeground: () => void = () => {};
      const foregroundGate = new Promise<void>((resolve) => {
        releaseForeground = resolve;
      });
      let callCount = 0;
      let backgroundCallCount = 0;

      previewNativeCycle.mockImplementation(() => {
        callCount += 1;
        if (callCount === 1) {
          return foregroundGate.then(() => okResult());
        }
        backgroundCallCount += 1;
        return Promise.resolve(okResult());
      });

      let foregroundResolved = false;
      const foregroundPromise = runNativeFeedRefresh({
        feedIds: ["fg-1"],
        activityKind: "foreground",
        skipActivityQueue: true,
      }).then(() => {
        foregroundResolved = true;
      });

      for (let i = 0; i < 100 && callCount === 0; i++) {
        await Promise.resolve();
      }
      expect(callCount).toBe(1);
      expect(foregroundResolved).toBe(false);

      // Background started while foreground is gated must NOT call previewNativeCycle yet.
      let backgroundResolved = false;
      const backgroundPromise = runNativeFeedRefresh({
        feedIds: ["bg-1"],
        activityKind: "background",
      }).then(() => {
        backgroundResolved = true;
      });

      for (let i = 0; i < 100 && callCount < 2; i++) {
        await Promise.resolve();
      }
      expect(backgroundCallCount).toBe(0); // background deferred behind foreground
      expect(backgroundResolved).toBe(false);

      releaseForeground();
      await foregroundPromise;
      await backgroundPromise;
      expect(foregroundResolved).toBe(true);
      expect(backgroundResolved).toBe(true);
      expect(backgroundCallCount).toBe(1);
    });
  });
});
