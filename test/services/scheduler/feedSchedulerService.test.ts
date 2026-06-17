import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schedulerStart = vi.hoisted(() => vi.fn().mockResolvedValue("started"));
const schedulerStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const schedulerReconfigure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
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

vi.mock("@/lib/tauriClient", () => ({
  tauriClient: {
    scheduler: {
      start: schedulerStart,
      stop: schedulerStop,
      reconfigure: schedulerReconfigure,
    },
  },
}));

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
    });
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
    });
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
    });
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
    });
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

  it("registers a global wake handler for native eval ticks", async () => {
    await feedScheduler.start();

    expect((globalThis as Record<string, unknown>).__kijiSchedulerTick).toEqual(expect.any(Function));
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
});
