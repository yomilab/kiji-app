import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schedulerStart = vi.hoisted(() => vi.fn().mockResolvedValue("started"));
const schedulerStop = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const schedulerReconfigure = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const listen = vi.hoisted(() => vi.fn());
const refreshFeed = vi.hoisted(() => vi.fn().mockResolvedValue({ insertedCount: 1 }));
const getAllFeeds = vi.hoisted(() => vi.fn().mockResolvedValue([
  { id: "feed-1", title: "Feed 1" },
]));
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

vi.mock("@/services/feeds/feedsManager", () => ({
  feedsManager: {
    getAllFeeds,
    refreshFeed,
  },
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
    getAllFeeds.mockResolvedValue([{ id: "feed-1", title: "Feed 1" }]);
    refreshFeed.mockResolvedValue({ insertedCount: 1 });
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
      expect(getAllFeeds).toHaveBeenCalledTimes(1);
    });

    expect(refreshFeed).toHaveBeenCalledWith("feed-1", { signal: expect.any(AbortSignal) });
  });
});
