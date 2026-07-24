import type { SchedulerNativeCycleFeedResult } from "@/lib/tauriClient/contracts";
import { tauriClient } from "@/lib/tauriClient";
import { logNativeFeedRefreshCycleAttribution } from "@/services/diagnostics/webKitAttribution";
import { feedRefreshActivity } from "@/services/feeds/feedRefreshActivity";
import { getSchedulerConcurrency } from "@/services/scheduler/schedulerConcurrency";
import type { SchedulerCycleScope } from "./feedSchedulerServiceTypes";
import {
  SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
  SCHEDULER_NATIVE_CYCLE_START_EVENT,
  buildNativeCycleRequest,
  type SchedulerNativeCycleFeedPayload,
  type SchedulerNativeCycleStartPayload,
} from "./nativeSchedulerCycle";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface NativeFeedRefreshRequest {
  feedIds?: string[];
  scope?: SchedulerCycleScope;
  boosts?: ReadonlyMap<string, number>;
  frontloadFeedIds?: ReadonlySet<string>;
  skipFeedIdsForThisCycle?: ReadonlySet<string>;
  forceRefreshFeedIds?: ReadonlySet<string>;
  concurrency?: number;
  signal?: AbortSignal;
  activityKind?: "background" | "foreground";
  skipActivityQueue?: boolean;
  onFeedSettled?: (feedId: string) => void;
  onFeedComplete?: (payload: SchedulerNativeCycleFeedPayload) => void;
}

export interface NativeFeedRefreshResult {
  insertedArticles: number;
  feedResults: SchedulerNativeCycleFeedResult[];
  insertedByFeedId: Map<string, number>;
}

// Native refresh lock with activity-kind awareness.
//
// A foreground switch/manual refresh must never block on a running background
// cycle. The Rust `preview_native_refresh_cycle` IPC has no JS-side cancellation
// channel, so `pauseForStationSelection`'s signal abort cannot stop an in-flight
// background cycle — it runs to completion (tens of seconds for a full-library
// catch-up). Serializing the foreground turn behind it (the old global chain)
// made the article-list spinner stay up for the entire background cycle and
// deferred the SQLite reconcile, which users perceived as a freeze.
//
// Rules:
//  - foreground turns serialize among themselves (preserves per-feed FIFO for
//    rapid switch→switch and avoids duplicate foreground fetches);
//  - background turns serialize among themselves and defer to any running
//    foreground turn (background is best-effort, never user-blocking);
//  - a foreground turn does NOT wait for a running background turn. The two may
//    overlap; the Rust side serializes DB access via `with_connection`, and
//    per-feed FIFO is handled by `feedRefreshCoordinator`. The only cost is up
//    to `foregroundScope.size` duplicate fetches for feeds that also appear in
//    the in-flight background batch — bounded and concurrent.
let foregroundTail: Promise<void> = Promise.resolve();
let backgroundTail: Promise<void> = Promise.resolve();

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    const error = new Error("Feed refresh was aborted");
    error.name = "AbortError";
    throw error;
  }
};

const withNativeRefreshLock = async <T>(
  operation: () => Promise<T>,
  activityKind: "foreground" | "background",
): Promise<T> => {
  if (activityKind === "foreground") {
    const previous = foregroundTail.catch((): void => undefined);
    let releaseTurn!: () => void;
    const currentTurn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    foregroundTail = previous.then(() => currentTurn);
    await previous;
    try {
      return await operation();
    } finally {
      releaseTurn();
    }
  }

  // Background: serialize with other background turns and defer to foreground.
  const previousForeground = foregroundTail.catch((): void => undefined);
  const previousBackground = backgroundTail.catch((): void => undefined);
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  backgroundTail = Promise.all([previousForeground, previousBackground])
    .then(() => currentTurn);
  await Promise.all([previousForeground, previousBackground]);
  try {
    return await operation();
  } finally {
    releaseTurn();
  }
};

export async function runNativeFeedRefresh(
  request: NativeFeedRefreshRequest,
): Promise<NativeFeedRefreshResult> {
  const scope: SchedulerCycleScope = request.scope ?? {
    onlyFeedIds: new Set(request.feedIds ?? []),
  };

  if (scope.onlyFeedIds?.size === 0) {
    return {
      insertedArticles: 0,
      feedResults: [],
      insertedByFeedId: new Map(),
    };
  }

  const forceRefreshFeedIds = request.forceRefreshFeedIds;
  const activityKind = request.activityKind ?? "foreground";
  const scopedFeedIds = scope.onlyFeedIds ?? new Set(request.feedIds ?? []);

  const isScopedFeedEvent = (feedId: string): boolean =>
    scopedFeedIds.size === 0 || scopedFeedIds.has(feedId);

  return withNativeRefreshLock(async () => {
    throwIfAborted(request.signal);

    const unlisteners: UnlistenFn[] = [];
    const queuedRelease = {
      release: null as ((feedId?: string) => void) | null,
    };

    try {
      const startUnlisten = await listen<SchedulerNativeCycleStartPayload>(
        SCHEDULER_NATIVE_CYCLE_START_EVENT,
        (event) => {
          if (request.skipActivityQueue) {
            return;
          }
          const startedFeedIds = (event.payload.feedIds ?? []).filter(isScopedFeedEvent);
          if (startedFeedIds.length === 0) {
            return;
          }
          if (activityKind === 'background') {
            feedRefreshActivity.noteInteractiveRefreshBackgroundBatch(startedFeedIds.length);
          }
          queuedRelease.release = feedRefreshActivity.beginQueuedFeeds(
            startedFeedIds,
            activityKind,
          );
        },
      );
      unlisteners.push(startUnlisten);

      const feedUnlisten = await listen<SchedulerNativeCycleFeedPayload>(
        SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
        (event) => {
          if (!isScopedFeedEvent(event.payload.feedId)) {
            return;
          }
          feedRefreshActivity.recordInteractiveRefreshFeedSettled(event.payload.feedId);
          queuedRelease.release?.(event.payload.feedId);
          request.onFeedSettled?.(event.payload.feedId);
          request.onFeedComplete?.(event.payload);
        },
      );
      unlisteners.push(feedUnlisten);

      throwIfAborted(request.signal);

      const result = await tauriClient.scheduler.previewNativeCycle(
        buildNativeCycleRequest({
          boosts: request.boosts ?? new Map(),
          scope,
          frontloadFeedIds: request.frontloadFeedIds,
          skipFeedIdsForThisCycle: request.skipFeedIdsForThisCycle,
          forceRefreshFeedIds,
          concurrency: request.concurrency ?? getSchedulerConcurrency(),
        }),
      );

      // The native IPC has no cancellation channel: once it resolves, Rust
      // has already committed per-feed inserts + ETags. Foreground turns
      // discard aborted results; background (scheduler) turns return them so
      // the caller can still publish committed inserts from superseded cycles.
      if (activityKind !== "background") {
        throwIfAborted(request.signal);
      }

      if (feedRefreshActivity.getSnapshot().interactiveRefreshScopeTotal > 0) {
        for (const feedResult of result.feedResults) {
          feedRefreshActivity.recordInteractiveRefreshFeedSettled(feedResult.feedId);
        }
      }

      const insertedByFeedId = new Map<string, number>();
      let changedFeeds = 0;
      let notModifiedFeeds = 0;
      let failedFeeds = 0;

      for (const feedResult of result.feedResults) {
        if (feedResult.status === "changed") {
          changedFeeds += 1;
        } else if (feedResult.status === "not-modified") {
          notModifiedFeeds += 1;
        } else if (feedResult.status === "failed") {
          failedFeeds += 1;
        }

        if ((feedResult.insertedCount ?? 0) > 0) {
          insertedByFeedId.set(feedResult.feedId, feedResult.insertedCount ?? 0);
        }
      }

      logNativeFeedRefreshCycleAttribution({
        source: activityKind,
        feedCount: result.feedResults.length,
        changedFeeds,
        notModifiedFeeds,
        failedFeeds,
        insertedArticles: result.insertedArticles,
        perFeedAttributionSuppressed: true,
      });

      return {
        insertedArticles: result.insertedArticles,
        feedResults: result.feedResults,
        insertedByFeedId,
      };
    } finally {
      for (const unlisten of unlisteners) {
        unlisten();
      }
      queuedRelease.release?.();
    }
  }, activityKind);
}
