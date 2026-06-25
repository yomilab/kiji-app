import type { SchedulerNativeCycleFeedResult } from "@/lib/tauriClient/contracts";
import { tauriClient } from "@/lib/tauriClient";
import { logNativeFeedRefreshAttribution } from "@/services/diagnostics/webKitAttribution";
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

let nativeRefreshTail: Promise<void> = Promise.resolve();

const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    const error = new Error("Feed refresh was aborted");
    error.name = "AbortError";
    throw error;
  }
};

const withNativeRefreshLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = nativeRefreshTail.catch((): void => undefined);
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  nativeRefreshTail = previous.then(() => currentTurn);
  await previous;
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
          const startedFeedIds = event.payload.feedIds ?? [];
          if (startedFeedIds.length === 0) {
            return;
          }
          queuedRelease.release = feedRefreshActivity.beginQueuedFeeds(
            startedFeedIds,
            request.activityKind ?? "foreground",
          );
        },
      );
      unlisteners.push(startUnlisten);

      const feedUnlisten = await listen<SchedulerNativeCycleFeedPayload>(
        SCHEDULER_NATIVE_CYCLE_FEED_EVENT,
        (event) => {
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

      throwIfAborted(request.signal);

      const insertedByFeedId = new Map<string, number>();
      for (const feedResult of result.feedResults) {
        logNativeFeedRefreshAttribution({
          feedId: feedResult.feedId,
          status: feedResult.status,
          insertedCount: feedResult.insertedCount,
          error: feedResult.error,
          source: request.activityKind ?? "foreground",
        });
        if ((feedResult.insertedCount ?? 0) > 0) {
          insertedByFeedId.set(feedResult.feedId, feedResult.insertedCount ?? 0);
        }
      }

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
  });
}
