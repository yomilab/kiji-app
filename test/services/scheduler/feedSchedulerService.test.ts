import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schedulerStart = vi.hoisted(() => vi.fn().mockResolvedValue("started"));
const schedulerStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const schedulerReconfigure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const previewNativeCycle = vi.hoisted(() => vi.fn().mockResolvedValue({
  plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
  queuedCount: 0,
  executedFeedCount: 0,
  changedFeeds: 0,
  notModifiedFeeds: 0,
  failedFeeds: 0,
  insertedArticles: 0,
  feedResults: [],
}));
const isNativeFeedIngestionEnabled = vi.hoisted(() => vi.fn(() => false));
const listen = vi.hoisted(() => vi.fn());
const eventHandlers = vi.hoisted(() => new Map<string, () => void>());

const getSchedulerEventHandler = (event: string): (() => void) | undefined => {
  return eventHandlers.get(event);
};
const getAll = vi.hoisted(() => vi.fn().mockResolvedValue([
  {
    id: "feed-1",
    title: "Feed 1",
    url: "https://feed-1.example.com/rss",
    tags: [],
    sortOrder: 0,
    updateFrequencyScore: 0.5,
    consecutiveFailures: 0,
  },
]));
const getById = vi.hoisted(() => vi.fn().mockResolvedValue({
  id: "feed-1",
  title: "Feed 1",
  url: "https://feed-1.example.com/rss",
  tags: [],
}));
const fetchFeedNetworkWithCache = vi.hoisted(() => vi.fn().mockResolvedValue({
  notModified: true,
  etag: "etag-1",
  lastModified: "date-1",
}));
const getSettings = vi.hoisted(() => vi.fn().mockResolvedValue({ backgroundUpdate: "every-5m" }));
const storeParsedFeedContent = vi.hoisted(() => vi.fn());
const syncFeedCountsBatch = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const publishFeedsCountsUpdated = vi.hoisted(() => vi.fn());

const getE2eConfig = vi.hoisted(() => vi.fn(() => ({ schedulerIntervalMs: 1 })));

vi.mock("@/services/e2e/e2eHarness", () => ({
  getE2eConfig,
}));

vi.mock("@/lib/tauriClient", () => ({
  tauriClient: {
    scheduler: {
      start: schedulerStart,
      stop: schedulerStop,
      reconfigure: schedulerReconfigure,
      previewNativeCycle,
    },
  },
}));

vi.mock("@/services/scheduler/nativeSchedulerCycle", async () => {
  const actual = await vi.importActual<typeof import("@/services/scheduler/nativeSchedulerCycle")>(
    "@/services/scheduler/nativeSchedulerCycle",
  );
  return {
    ...actual,
    isNativeFeedIngestionEnabled,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen,
}));

vi.mock("@/services/settings", () => ({
  settingsManager: {
    getSettings,
  },
}));

vi.mock("@/stores/feedStore", () => ({
  getAll,
  getById,
  update: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/stores/articleStore", () => ({
  store: vi.fn(),
  query: vi.fn(),
  getUnreadCount: vi.fn(),
  getArticleCount: vi.fn(),
  syncFeedCountsBatch,
}));

vi.mock("@/services/feeds/feedRefreshPipeline", () => ({
  storeParsedFeedContent,
}));

vi.mock("@/services/ui/feedLibraryMutationBus", () => ({
  feedLibraryMutationBus: {
    publishFeedsCountsUpdated,
  },
}));

vi.mock("@/services/feeds/feedsFetcher", () => ({
  feedsFetcher: {
    fetchFeedNetworkWithCache,
  },
}));

vi.mock("@/services/feeds/feedRefreshActivity", () => ({
  feedRefreshActivity: {
    track: vi.fn((_feedId: string, operation: () => Promise<unknown>) => operation()),
    beginQueuedFeeds: vi.fn(() => vi.fn()),
    clearInteractiveRefreshDeferredTail: vi.fn(),
    noteInteractiveRefreshBackgroundBatch: vi.fn(),
    recordInteractiveRefreshFeedSettled: vi.fn(),
    getSnapshot: vi.fn(() => ({ interactiveRefreshScopeTotal: 0 })),
  },
}));

vi.mock("@/services/feeds/feedRefreshCoordinator", () => ({
  feedRefreshCoordinator: {
    run: vi.fn((_feedId: string, operation: () => Promise<unknown>) => operation()),
  },
}));

vi.mock("@/services/favicons/faviconRefreshService", () => ({
  maybeRefreshFavicon: vi.fn(),
}));

vi.mock("@/services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { feedScheduler } from "@/services/scheduler/feedSchedulerService";

describe("feedSchedulerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getE2eConfig.mockReturnValue({ schedulerIntervalMs: 1 });
    getSettings.mockResolvedValue({ backgroundUpdate: "every-5m" });
    getAll.mockResolvedValue([
      {
        id: "feed-1",
        title: "Feed 1",
        url: "https://feed-1.example.com/rss",
        tags: [],
        sortOrder: 0,
        updateFrequencyScore: 0.5,
        consecutiveFailures: 0,
      },
    ]);
    getById.mockResolvedValue({
      id: "feed-1",
      title: "Feed 1",
      url: "https://feed-1.example.com/rss",
      tags: [],
    });
    fetchFeedNetworkWithCache.mockResolvedValue({
      notModified: true,
      etag: "etag-1",
      lastModified: "date-1",
    });
    listen.mockImplementation(async (event: string, handler: () => void) => {
      eventHandlers.set(event, handler);
      return vi.fn();
    });
    eventHandlers.clear();
    schedulerStart.mockResolvedValue("started");
  });

  afterEach(async () => {
    await feedScheduler.stop();
  });

  it("starts the native scheduler driver once and skips duplicate starts", async () => {
    await feedScheduler.start();
    await feedScheduler.start();

    expect(schedulerStart).toHaveBeenCalledTimes(1);
    expect(schedulerReconfigure).toHaveBeenCalledTimes(1);
    expect(listen).toHaveBeenCalledWith("scheduler:cycle-tick", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scheduler:system-sleep", expect.any(Function));
    expect(listen).toHaveBeenCalledWith("scheduler:system-resume", expect.any(Function));
  });

  it("stops native driver when lifecycle becomes stale during start", async () => {
    schedulerStart.mockImplementation(async () => {
      await feedScheduler.stop();
      return "started";
    });

    await feedScheduler.start();

    expect(schedulerStop).toHaveBeenCalled();
    expect(schedulerStart).toHaveBeenCalledTimes(1);
  });

  it("runs a refresh cycle when the native tick event fires", async () => {
    await feedScheduler.start();

    expect(listen).toHaveBeenCalledWith("scheduler:cycle-tick", expect.any(Function));
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
    expect(tickHandler).toBeTypeOf("function");

    await tickHandler?.();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    });

    expect(fetchFeedNetworkWithCache).toHaveBeenCalledWith(
      "https://feed-1.example.com/rss",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("defers overlapping native ticks and runs one follow-up cycle", async () => {
    let releaseRefresh!: () => void;
    fetchFeedNetworkWithCache.mockImplementation(() => new Promise((resolve) => {
      releaseRefresh = () => resolve({
        notModified: true,
        etag: "etag-1",
        lastModified: "date-1",
      });
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    const firstTick = tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    await tickHandler?.();
    await tickHandler?.();
    expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);

    releaseRefresh();
    await firstTick;
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000 });
  });

  it("defers boostMany during an active cycle and runs one follow-up cycle", async () => {
    let releaseRefresh!: () => void;
    fetchFeedNetworkWithCache.mockImplementation(() => new Promise((resolve) => {
      releaseRefresh = () => resolve({
        notModified: true,
        etag: "etag-1",
        lastModified: "date-1",
      });
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    const firstTick = tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    feedScheduler.boostMany(["feed-1"]);
    expect(getAll).toHaveBeenCalledTimes(1);

    releaseRefresh();
    await firstTick;
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(2);
    });
  });

  it("defers native ticks while station selection pauses the scheduler", async () => {
    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    feedScheduler.pauseForStationSelection();
    await tickHandler?.();

    expect(getAll).not.toHaveBeenCalled();

    feedScheduler.resumeAfterStationSelection();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    }, { timeout: 5_000 });
  });

  it("front-loads active station feeds when a native tick runs during station dwell", async () => {
    getAll.mockResolvedValue([
      {
        id: "feed-rest",
        title: "Rest",
        url: "https://feed-rest.example.com/rss",
        tags: [],
        sortOrder: 0,
        updateFrequencyScore: 1,
        consecutiveFailures: 0,
      },
      {
        id: "feed-station",
        title: "Station",
        url: "https://feed-station.example.com/rss",
        tags: ["Station"],
        sortOrder: 2,
        updateFrequencyScore: 0.1,
        consecutiveFailures: 0,
      },
    ]);
    getById.mockImplementation((feedId: string) => Promise.resolve({
      id: feedId,
      title: feedId,
      url: `https://${feedId}.example.com/rss`,
      tags: feedId === "feed-station" ? ["Station"] : [],
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    feedScheduler.setActiveStationFocus("tag:Station", ["feed-station"]);
    await tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
    });

    expect(fetchFeedNetworkWithCache.mock.calls[0]?.[0]).toBe("https://feed-station.example.com/rss");
  });

  it("suppresses foreground-refreshed station feeds for only the next cycle", async () => {
    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    feedScheduler.suppressFeedsForNextCycle(["feed-1"]);
    await tickHandler?.();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    });
    expect(fetchFeedNetworkWithCache).not.toHaveBeenCalled();

    await tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });
  });

  it("aborts an in-flight cycle when station selection pauses the scheduler", async () => {
    let releaseRefresh!: () => void;
    fetchFeedNetworkWithCache.mockImplementation(() => new Promise((resolve) => {
      releaseRefresh = () => resolve({
        notModified: true,
        etag: "etag-1",
        lastModified: "date-1",
      });
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    const firstTick = tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    feedScheduler.pauseForStationSelection();
    releaseRefresh();
    await firstTick;

    feedScheduler.resumeAfterStationSelection();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(2);
    }, { timeout: 5_000 });
  });

  it("keeps the scheduler paused until nested station selections finish", async () => {
    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    feedScheduler.pauseForStationSelection();
    feedScheduler.pauseForStationSelection();
    feedScheduler.resumeAfterStationSelection();

    await tickHandler?.();
    expect(getAll).not.toHaveBeenCalled();

    feedScheduler.resumeAfterStationSelection();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    }, { timeout: 5_000 });
  });

  it("defers boostMany during station pause and runs one cycle after resume", async () => {
    await feedScheduler.start();

    feedScheduler.pauseForStationSelection();
    feedScheduler.boostMany(["feed-1"]);

    expect(getAll).not.toHaveBeenCalled();

    feedScheduler.resumeAfterStationSelection();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    });
  });

  it("defers catchUpAfterResume during station pause and runs after resume", async () => {
    vi.useFakeTimers();

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

      await tickHandler?.();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      vi.advanceTimersByTime(6 * 60_000);

      feedScheduler.pauseForStationSelection();
      await feedScheduler.catchUpAfterResume();
      expect(getAll).toHaveBeenCalledTimes(1);

      feedScheduler.resumeAfterStationSelection();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases station pause on background and runs deferred scheduler tick", async () => {
    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    feedScheduler.pauseForStationSelection();
    await tickHandler?.();
    expect(getAll).not.toHaveBeenCalled();

    feedScheduler.releaseStationSelectionPause("background");
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(1);
    });

    feedScheduler.resumeAfterStationSelection();
  });

  it("auto-releases station pause after the max pause window", async () => {
    vi.useFakeTimers();

    try {
      await feedScheduler.start();

      feedScheduler.pauseForStationSelection();
      expect(getAll).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(10 * 60_000 + 1);

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      feedScheduler.resumeAfterStationSelection();
    } finally {
      vi.useRealTimers();
    }
  });

  it("registers global wake handlers for native eval ticks and power events", async () => {
    await feedScheduler.start();

    const globalScope = globalThis as Record<string, unknown>;
    expect(globalScope.__kijiSchedulerTick).toEqual(expect.any(Function));
    expect(globalScope.__kijiSchedulerSleep).toEqual(expect.any(Function));
    expect(globalScope.__kijiSchedulerResume).toEqual(expect.any(Function));
  });

  it("reconfigures the native driver during catch-up after resume", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      await tickHandler?.();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      schedulerReconfigure.mockClear();
      await vi.advanceTimersByTimeAsync(6 * 60_000);

      await feedScheduler.catchUpAfterResume();

      expect(schedulerReconfigure).toHaveBeenCalledWith({ mode: "every-5m" });
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts a stuck cycle after repeated deferred native ticks", async () => {
    getE2eConfig.mockReturnValue(null);
    let releaseRefresh!: () => void;
    fetchFeedNetworkWithCache.mockImplementation((_url, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      const onAbort = (): void => {
        reject(new DOMException("Aborted", "AbortError"));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      releaseRefresh = () => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve({
          notModified: true,
          etag: "etag-1",
          lastModified: "date-1",
        });
      };
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

    void tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    await tickHandler?.();
    await tickHandler?.();
    await tickHandler?.();
    expect(getAll).toHaveBeenCalledTimes(1);

    await tickHandler?.();
    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(2);
    });
  });

  it("detects a system sleep gap via wall-clock heartbeat and aborts the stalled cycle", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      fetchFeedNetworkWithCache.mockImplementation((_url: string, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
        const onAbort = (): void => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        void resolve;
      }));

      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");

      void tickHandler?.();
      await vi.waitFor(() => {
        expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
      });
      expect(getAll).toHaveBeenCalledTimes(1);

      // Simulate system sleep: wall clock jumps 40 minutes while timers were
      // frozen, then the next heartbeat fires and sees the gap.
      vi.setSystemTime(Date.now() + 40 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);

      // Heartbeat → catch-up path → stale cycle aborted → catch-up cycle runs.
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs station-first catch-up after resume when a station is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    getAll.mockResolvedValue([
      {
        id: "feed-rest",
        title: "Rest",
        url: "https://feed-rest.example.com/rss",
        tags: [],
        sortOrder: 0,
        updateFrequencyScore: 1,
        consecutiveFailures: 0,
      },
      {
        id: "feed-station",
        title: "Station",
        url: "https://feed-station.example.com/rss",
        tags: ["Station"],
        sortOrder: 2,
        updateFrequencyScore: 0.1,
        consecutiveFailures: 0,
      },
    ]);
    getById.mockImplementation((feedId: string) => Promise.resolve({
      id: feedId,
      title: feedId,
      url: `https://${feedId}.example.com/rss`,
      tags: feedId === "feed-station" ? ["Station"] : [],
    }));

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      await tickHandler?.();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      feedScheduler.setActiveStationFocus("tag:Station", ["feed-station"]);
      fetchFeedNetworkWithCache.mockClear();
      getAll.mockClear();

      await vi.advanceTimersByTimeAsync(6 * 60_000);
      await feedScheduler.catchUpAfterResume();

      await vi.waitFor(() => {
        expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
      });
      expect(fetchFeedNetworkWithCache.mock.calls[0]?.[0]).toBe("https://feed-station.example.com/rss");
      expect(fetchFeedNetworkWithCache.mock.calls[1]?.[0]).toBe("https://feed-rest.example.com/rss");
      expect(getAll).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries catch-up within the interval after an all-failed cycle (overnight dark wake)", async () => {
    // Use wall-clock interval (not 1ms E2E) so a just-finished failed cycle is
    // not treated as overdue solely by the interval gate.
    getE2eConfig.mockReturnValue(null);
    getSettings.mockResolvedValue({ backgroundUpdate: "every-15m" });
    fetchFeedNetworkWithCache.mockRejectedValue(new Error("network down"));

    const cycleEvents: string[] = [];
    const unsubscribe = feedScheduler.on((event) => {
      cycleEvents.push(event.type);
    });

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      await tickHandler?.();
      await vi.waitFor(() => {
        expect(cycleEvents).toContain("cycle-complete");
      });

      fetchFeedNetworkWithCache.mockClear();
      getAll.mockClear();
      fetchFeedNetworkWithCache.mockResolvedValue({
        notModified: true,
        etag: "etag-1",
        lastModified: "date-1",
      });

      // No timer advance: interval is not overdue, but needsResumeCatchUp is set.
      await feedScheduler.catchUpAfterResume();

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });
      expect(fetchFeedNetworkWithCache).toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("marks needsResumeCatchUp on sleep-gap heartbeat so short gaps after failures still catch up", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getE2eConfig.mockReturnValue(null);
    getSettings.mockResolvedValue({ backgroundUpdate: "every-15m" });

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      await tickHandler?.();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      getAll.mockClear();
      fetchFeedNetworkWithCache.mockClear();

      // Wall clock jumps 5 minutes (less than 15m interval) — sleep gap ≥ 120s.
      vi.setSystemTime(Date.now() + 5 * 60_000);
      await vi.advanceTimersByTimeAsync(30_000);

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });
      expect(fetchFeedNetworkWithCache).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts in-flight refresh on system sleep", async () => {
    let releaseRefresh!: () => void;
    fetchFeedNetworkWithCache.mockImplementation((_url, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
      const onAbort = (): void => {
        reject(new DOMException("Aborted", "AbortError"));
      };
      options?.signal?.addEventListener("abort", onAbort, { once: true });
      releaseRefresh = () => {
        options?.signal?.removeEventListener("abort", onAbort);
        resolve({
          notModified: true,
          etag: "etag-1",
          lastModified: "date-1",
        });
      };
    }));

    await feedScheduler.start();
    const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
    const sleepHandler = getSchedulerEventHandler("scheduler:system-sleep");

    void tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
    });

    await sleepHandler?.();
    await tickHandler?.();

    await vi.waitFor(() => {
      expect(getAll).toHaveBeenCalledTimes(2);
    });
  });

  it("runs catch-up when the system resume event fires after an overdue interval", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      const resumeHandler = getSchedulerEventHandler("scheduler:system-resume");

      await tickHandler?.();
      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });

      getAll.mockClear();
      await vi.advanceTimersByTimeAsync(6 * 60_000);

      await resumeHandler?.();

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  describe("native eval wake delivery (simulates throttled webview)", () => {
    const getGlobalWakeHandler = (name: string): (() => void) => {
      const handler = (globalThis as Record<string, unknown>)[name];
      expect(handler).toEqual(expect.any(Function));
      return handler as () => void;
    };

    beforeEach(() => {
      listen.mockImplementation(async () => vi.fn());
      eventHandlers.clear();
    });

    it("runs a refresh cycle via __kijiSchedulerTick when Tauri listen never registers", async () => {
      await feedScheduler.start();

      expect(eventHandlers.has("scheduler:cycle-tick")).toBe(false);

      getGlobalWakeHandler("__kijiSchedulerTick")();

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(1);
      });
    });

    it("runs overdue catch-up via __kijiSchedulerResume when listen is unavailable", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      try {
        await feedScheduler.start();

        getGlobalWakeHandler("__kijiSchedulerTick")();
        await vi.waitFor(() => {
          expect(getAll).toHaveBeenCalledTimes(1);
        });

        getAll.mockClear();
        await vi.advanceTimersByTimeAsync(6 * 60_000);

        getGlobalWakeHandler("__kijiSchedulerResume")();

        await vi.waitFor(() => {
          expect(getAll).toHaveBeenCalledTimes(1);
        });
        expect(eventHandlers.has("scheduler:system-resume")).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it("aborts in-flight refresh via __kijiSchedulerSleep when listen is unavailable", async () => {
      let releaseRefresh!: () => void;
      fetchFeedNetworkWithCache.mockImplementation((_url, options?: { signal?: AbortSignal }) => new Promise((resolve, reject) => {
        const onAbort = (): void => {
          reject(new DOMException("Aborted", "AbortError"));
        };
        options?.signal?.addEventListener("abort", onAbort, { once: true });
        releaseRefresh = () => {
          options?.signal?.removeEventListener("abort", onAbort);
          resolve({
            notModified: true,
            etag: "etag-1",
            lastModified: "date-1",
          });
        };
      }));

      await feedScheduler.start();

      void getGlobalWakeHandler("__kijiSchedulerTick")();
      await vi.waitFor(() => {
        expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(1);
      });

      await getGlobalWakeHandler("__kijiSchedulerSleep")();
      getGlobalWakeHandler("__kijiSchedulerTick")();

      await vi.waitFor(() => {
        expect(getAll).toHaveBeenCalledTimes(2);
      });
      expect(eventHandlers.has("scheduler:system-sleep")).toBe(false);

      releaseRefresh();
    });

    it("removes eval wake globals when the scheduler lifecycle stops", async () => {
      await feedScheduler.start();
      expect((globalThis as Record<string, unknown>).__kijiSchedulerResume).toEqual(expect.any(Function));

      await feedScheduler.stop();

      const globalScope = globalThis as Record<string, unknown>;
      expect(globalScope.__kijiSchedulerTick).toBeUndefined();
      expect(globalScope.__kijiSchedulerSleep).toBeUndefined();
      expect(globalScope.__kijiSchedulerResume).toBeUndefined();
    });
  });

  describe("native feed ingestion cycle", () => {
    beforeEach(() => {
      getE2eConfig.mockReturnValue(null);
      isNativeFeedIngestionEnabled.mockReturnValue(true);
      previewNativeCycle.mockResolvedValue({
        plan: {
          prioritized: [{ feedId: "feed-1", score: 1 }],
          skippedBackoffCount: 0,
          skippedSuppressedCount: 0,
        },
        queuedCount: 1,
        executedFeedCount: 1,
        changedFeeds: 1,
        notModifiedFeeds: 0,
        failedFeeds: 0,
        insertedArticles: 2,
        feedResults: [{ feedId: "feed-1", status: "changed", insertedCount: 2 }],
      });
    });

    it("runs previewNativeCycle instead of renderer fetch/store on scheduler tick", async () => {
      await feedScheduler.start();

      getSchedulerEventHandler("scheduler:cycle-tick")?.();
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });

      expect(fetchFeedNetworkWithCache).not.toHaveBeenCalled();
      expect(storeParsedFeedContent).not.toHaveBeenCalled();
      expect(previewNativeCycle).toHaveBeenCalledWith(
        expect.objectContaining({
          execute: true,
          concurrency: expect.any(Number),
        }),
      );
    });

    it("scopes post-import refresh to boosted feed ids", async () => {
      await feedScheduler.start();

      feedScheduler.boostMany(["feed-1", "feed-2"]);
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });

      expect(previewNativeCycle).toHaveBeenCalledWith(
        expect.objectContaining({
          execute: true,
          options: expect.objectContaining({
            onlyFeedIds: ["feed-1", "feed-2"],
          }),
        }),
      );
    });

    it("passes bypassFailureBackoff on resume catch-up after an all-failed native cycle", async () => {
      getSettings.mockResolvedValue({ backgroundUpdate: "every-15m" });
      previewNativeCycle.mockResolvedValue({
        plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
        queuedCount: 1,
        executedFeedCount: 1,
        changedFeeds: 0,
        notModifiedFeeds: 0,
        failedFeeds: 1,
        insertedArticles: 0,
        feedResults: [{ feedId: "feed-1", status: "failed", error: "network down" }],
      });

      await feedScheduler.start();
      getSchedulerEventHandler("scheduler:cycle-tick")?.();
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });

      previewNativeCycle.mockClear();
      previewNativeCycle.mockResolvedValue({
        plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
        queuedCount: 1,
        executedFeedCount: 1,
        changedFeeds: 0,
        notModifiedFeeds: 1,
        failedFeeds: 0,
        insertedArticles: 0,
        feedResults: [{ feedId: "feed-1", status: "not-modified", insertedCount: 0 }],
      });

      await feedScheduler.catchUpAfterResume();

      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });
      expect(previewNativeCycle).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            bypassFailureBackoff: true,
          }),
        }),
      );
    });

    it("emits feeds-batch-updated with per-feed insert counts after a native cycle", async () => {
      const events: Array<{ type: string; updates?: ReadonlyArray<{ feedId: string; newArticleCount: number }> }> = [];
      const unsubscribe = feedScheduler.on((event) => {
        events.push(event as (typeof events)[number]);
      });

      try {
        await feedScheduler.start();
        getSchedulerEventHandler("scheduler:cycle-tick")?.();

        await vi.waitFor(() => {
          expect(events.some((event) => event.type === "cycle-complete")).toBe(true);
        });

        const batchEvent = events.find((event) => event.type === "feeds-batch-updated");
        expect(batchEvent?.updates).toEqual([{ feedId: "feed-1", newArticleCount: 2 }]);

        const batchIndex = events.findIndex((event) => event.type === "feeds-batch-updated");
        const completeIndex = events.findIndex((event) => event.type === "cycle-complete");
        expect(batchIndex).toBeGreaterThanOrEqual(0);
        expect(batchIndex).toBeLessThan(completeIndex);
      } finally {
        unsubscribe();
      }
    });

    it("does not emit feeds-batch-updated when the native cycle inserts nothing", async () => {
      previewNativeCycle.mockResolvedValue({
        plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
        queuedCount: 1,
        executedFeedCount: 1,
        changedFeeds: 0,
        notModifiedFeeds: 1,
        failedFeeds: 0,
        insertedArticles: 0,
        feedResults: [{ feedId: "feed-1", status: "not-modified", insertedCount: 0 }],
      });

      const events: Array<{ type: string }> = [];
      const unsubscribe = feedScheduler.on((event) => {
        events.push(event);
      });

      try {
        await feedScheduler.start();
        getSchedulerEventHandler("scheduler:cycle-tick")?.();

        await vi.waitFor(() => {
          expect(events.some((event) => event.type === "cycle-complete")).toBe(true);
        });

        expect(events.some((event) => event.type === "feeds-batch-updated")).toBe(false);
      } finally {
        unsubscribe();
      }
    });

    it("preempts a stale native cycle when boostMany arrives (deferred-tick threshold)", async () => {
      let resolveCycle!: () => void;
      previewNativeCycle.mockImplementationOnce(() => new Promise((resolve) => {
        resolveCycle = () => {
          resolve({
            plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
            queuedCount: 0,
            executedFeedCount: 0,
            changedFeeds: 0,
            notModifiedFeeds: 0,
            failedFeeds: 0,
            insertedArticles: 0,
            feedResults: [],
          });
        };
      }));

      await feedScheduler.start();
      const tickHandler = getSchedulerEventHandler("scheduler:cycle-tick");
      tickHandler?.();
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });

      // Three deferred ticks mark the cycle stale (MAX_DEFERRED_TICKS_BEFORE_FORCE_ABORT).
      await tickHandler?.();
      await tickHandler?.();
      await tickHandler?.();
      expect(previewNativeCycle).toHaveBeenCalledTimes(1);

      // A boost against the stale cycle preempts it instead of deferring.
      feedScheduler.boostMany(["feed-2"]);
      resolveCycle();

      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(2);
      });
      expect(previewNativeCycle).toHaveBeenLastCalledWith(
        expect.objectContaining({
          execute: true,
          options: expect.objectContaining({
            onlyFeedIds: ["feed-2"],
          }),
        }),
      );
    });

    it("defers boosted import refresh until the native cycle completes", async () => {
      let resolveCycle!: () => void;
      previewNativeCycle.mockImplementation(() => new Promise((resolve) => {
        resolveCycle = () => {
          resolve({
            plan: { prioritized: [], skippedBackoffCount: 0, skippedSuppressedCount: 0 },
            queuedCount: 0,
            executedFeedCount: 0,
            changedFeeds: 0,
            notModifiedFeeds: 0,
            failedFeeds: 0,
            insertedArticles: 0,
            feedResults: [],
          });
        };
      }));

      await feedScheduler.start();
      getSchedulerEventHandler("scheduler:cycle-tick")?.();
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(1);
      });

      feedScheduler.boostMany(["feed-2"]);
      getSchedulerEventHandler("scheduler:cycle-tick")?.();
      expect(previewNativeCycle).toHaveBeenCalledTimes(1);

      resolveCycle();
      await vi.waitFor(() => {
        expect(previewNativeCycle).toHaveBeenCalledTimes(2);
      });

      expect(previewNativeCycle).toHaveBeenLastCalledWith(
        expect.objectContaining({
          execute: true,
          options: expect.objectContaining({
            onlyFeedIds: ["feed-2"],
          }),
        }),
      );
    });
  });
});
