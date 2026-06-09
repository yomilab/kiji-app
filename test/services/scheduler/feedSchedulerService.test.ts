import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schedulerStart = vi.hoisted(() => vi.fn().mockResolvedValue("started"));
const schedulerStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const schedulerReconfigure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const listen = vi.hoisted(() => vi.fn());
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
}));

vi.mock("@/services/feeds/feedsFetcher", () => ({
  feedsFetcher: {
    fetchFeedNetworkWithCache,
  },
  parseFeed: vi.fn(),
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
    listen.mockResolvedValue(vi.fn());
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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;
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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

    feedScheduler.setActiveStationFocus("tag:Station", ["feed-station"]);
    await tickHandler?.();
    await vi.waitFor(() => {
      expect(fetchFeedNetworkWithCache).toHaveBeenCalledTimes(2);
    });

    expect(fetchFeedNetworkWithCache.mock.calls[0]?.[0]).toBe("https://feed-station.example.com/rss");
  });

  it("suppresses foreground-refreshed station feeds for only the next cycle", async () => {
    await feedScheduler.start();
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
    const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
      const tickHandler = listen.mock.calls.at(-1)?.[1] as (() => void) | undefined;

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
});
