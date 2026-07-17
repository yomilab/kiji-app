export interface SchedulerCycleScope {
  onlyFeedIds?: ReadonlySet<string>;
  excludeFeedIds?: ReadonlySet<string>;
  /** Resume catch-up: retry feeds even when overnight sleep left them in failure backoff. */
  bypassFailureBackoff?: boolean;
}
