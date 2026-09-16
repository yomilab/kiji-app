export interface SchedulerCycleScope {
  onlyFeedIds?: ReadonlySet<string>;
  excludeFeedIds?: ReadonlySet<string>;
  /** Resume catch-up and paused station-open boostMany: retry feeds in failure backoff. */
  bypassFailureBackoff?: boolean;
}
