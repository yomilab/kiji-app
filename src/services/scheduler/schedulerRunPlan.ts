import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import { computePriority } from './feedPriorityCalculator';
import type { FeedPriorityEntry, SchedulerFeedEntry } from './types';

export interface SchedulerRunPlan {
  prioritized: FeedPriorityEntry[];
  skippedBackoffCount: number;
}

export const isSchedulerEntryInBackoff = (
  entry: SchedulerFeedEntry,
  now = Date.now(),
): boolean => getFeedRefreshBlock(entry, 0, { includeBackoff: true, now })?.kind === 'backoff';

export const createSchedulerRunPlan = (
  entries: SchedulerFeedEntry[],
  totalFeeds: number,
  boosts: ReadonlyMap<string, number>,
  now = Date.now(),
): SchedulerRunPlan => {
  const runnableEntries: FeedPriorityEntry[] = [];
  let skippedBackoffCount = 0;

  for (const entry of entries) {
    if (isSchedulerEntryInBackoff(entry, now)) {
      skippedBackoffCount += 1;
      continue;
    }

    runnableEntries.push(computePriority(entry, totalFeeds, boosts.get(entry.feedId)));
  }

  runnableEntries.sort((a, b) => b.score - a.score);

  return {
    prioritized: runnableEntries,
    skippedBackoffCount,
  };
};
