import type {
  SchedulerBoost,
  SchedulerNativeCyclePreviewRequest,
  SchedulerRunPlanOptions,
} from "@/lib/tauriClient/contracts";
import type { SchedulerCycleScope } from "./feedSchedulerServiceTypes";

export const SCHEDULER_NATIVE_CYCLE_START_EVENT = "scheduler:native-cycle-start";
export const SCHEDULER_NATIVE_CYCLE_FEED_EVENT = "scheduler:native-cycle-feed";
export const SCHEDULER_NATIVE_CYCLE_COMPLETE_EVENT = "scheduler:native-cycle-complete";

export interface SchedulerNativeCycleStartPayload {
  queuedCount: number;
  feedIds: string[];
}

export interface SchedulerNativeCycleFeedPayload {
  feedId: string;
  insertedCount?: number;
  error?: string;
}

export function isNativeFeedIngestionEnabled(): boolean {
  return import.meta.env.VITE_KIJI_NATIVE_FEED_INGESTION !== "0";
}

export function buildNativeCycleBoosts(boosts: ReadonlyMap<string, number>): SchedulerBoost[] {
  return Array.from(boosts.entries()).map(([feedId, boostUntilMs]) => ({
    feedId,
    boostUntilMs,
  }));
}

export function buildNativeCycleOptions(
  scope: SchedulerCycleScope,
  frontloadFeedIds: ReadonlySet<string> | undefined,
  skipFeedIdsForThisCycle: ReadonlySet<string> | undefined,
  forceRefreshFeedIds?: ReadonlySet<string>,
): SchedulerRunPlanOptions {
  return {
    frontloadFeedIds: frontloadFeedIds ? [...frontloadFeedIds] : undefined,
    skipFeedIdsForThisCycle: skipFeedIdsForThisCycle
      ? [...skipFeedIdsForThisCycle]
      : undefined,
    onlyFeedIds: scope.onlyFeedIds ? [...scope.onlyFeedIds] : undefined,
    excludeFeedIds: scope.excludeFeedIds ? [...scope.excludeFeedIds] : undefined,
    forceRefreshFeedIds: forceRefreshFeedIds ? [...forceRefreshFeedIds] : undefined,
    bypassFailureBackoff: scope.bypassFailureBackoff === true ? true : undefined,
  };
}

export function buildNativeCycleRequest(input: {
  boosts: ReadonlyMap<string, number>;
  scope: SchedulerCycleScope;
  frontloadFeedIds: ReadonlySet<string> | undefined;
  skipFeedIdsForThisCycle: ReadonlySet<string> | undefined;
  forceRefreshFeedIds?: ReadonlySet<string>;
  concurrency: number;
  now?: number;
}): SchedulerNativeCyclePreviewRequest {
  return {
    boosts: buildNativeCycleBoosts(input.boosts),
    nowMs: input.now,
    options: buildNativeCycleOptions(
      input.scope,
      input.frontloadFeedIds,
      input.skipFeedIdsForThisCycle,
      input.forceRefreshFeedIds,
    ),
    concurrency: input.concurrency,
    execute: true,
  };
}

export function collectFeedIdsNeedingCountSync(
  feedResults: Array<{ feedId: string; status: string; insertedCount?: number }>,
): string[] {
  const feedIds = new Set<string>();
  for (const result of feedResults) {
    if (result.status === "changed") {
      feedIds.add(result.feedId);
    }
  }
  return [...feedIds];
}
