import { describe, expect, it } from "vitest";
import {
  buildNativeCycleBoosts,
  buildNativeCycleOptions,
  buildNativeCycleRequest,
  collectFeedIdsNeedingCountSync,
  isNativeFeedIngestionEnabled,
} from "@/services/scheduler/nativeSchedulerCycle";

describe("nativeSchedulerCycle", () => {
  it("builds run-plan options from scheduler scope and station focus", () => {
    const options = buildNativeCycleOptions(
      { onlyFeedIds: new Set(["feed-a"]) },
      new Set(["feed-a", "feed-b"]),
      new Set(["feed-b"]),
    );

    expect(options).toEqual({
      frontloadFeedIds: ["feed-a", "feed-b"],
      skipFeedIdsForThisCycle: ["feed-b"],
      onlyFeedIds: ["feed-a"],
      excludeFeedIds: undefined,
      forceRefreshFeedIds: undefined,
    });
  });

  it("builds boost payloads from the scheduler boost map", () => {
    const boosts = buildNativeCycleBoosts(
      new Map([
        ["feed-1", 1_700_000_000_000],
        ["feed-2", 1_700_000_060_000],
      ]),
    );

    expect(boosts).toEqual([
      { feedId: "feed-1", boostUntilMs: 1_700_000_000_000 },
      { feedId: "feed-2", boostUntilMs: 1_700_000_060_000 },
    ]);
  });

  it("builds native execute request with concurrency", () => {
    const request = buildNativeCycleRequest({
      boosts: new Map([["feed-1", 1_700_000_000_000]]),
      scope: { excludeFeedIds: new Set(["feed-skip"]) },
      frontloadFeedIds: new Set(["feed-1"]),
      skipFeedIdsForThisCycle: undefined,
      concurrency: 4,
      now: 1_700_000_000_000,
    });

    expect(request.execute).toBe(true);
    expect(request.concurrency).toBe(4);
    expect(request.nowMs).toBe(1_700_000_000_000);
    expect(request.options?.excludeFeedIds).toEqual(["feed-skip"]);
  });

  it("collects changed feeds for count sync", () => {
    expect(
      collectFeedIdsNeedingCountSync([
        { feedId: "feed-1", status: "changed", insertedCount: 2 },
        { feedId: "feed-2", status: "not-modified", insertedCount: 0 },
        { feedId: "feed-3", status: "failed" },
      ]),
    ).toEqual(["feed-1"]);
  });

  it("defaults native ingestion to enabled unless explicitly disabled", () => {
    expect(isNativeFeedIngestionEnabled()).toBe(
      import.meta.env.VITE_KIJI_NATIVE_FEED_INGESTION !== "0",
    );
  });
});
