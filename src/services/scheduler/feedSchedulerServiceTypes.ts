export interface SchedulerCycleScope {
  onlyFeedIds?: ReadonlySet<string>;
  excludeFeedIds?: ReadonlySet<string>;
}
