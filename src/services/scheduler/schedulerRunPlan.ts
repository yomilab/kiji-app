import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import { computePriority } from './feedPriorityCalculator';
import type { FeedPriorityEntry, SchedulerFeedEntry } from './types';

export interface SchedulerRunPlan {
  prioritized: FeedPriorityEntry[];
  skippedBackoffCount: number;
  skippedSuppressedCount: number;
}

export interface SchedulerRunPlanOptions {
  frontloadFeedIds?: ReadonlySet<string>;
  skipFeedIdsForThisCycle?: ReadonlySet<string>;
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
  options: SchedulerRunPlanOptions = {},
): SchedulerRunPlan => {
  const runnableEntries: FeedPriorityEntry[] = [];
  let skippedBackoffCount = 0;
  let skippedSuppressedCount = 0;

  for (const entry of entries) {
    if (options.skipFeedIdsForThisCycle?.has(entry.feedId)) {
      skippedSuppressedCount += 1;
      continue;
    }

    if (isSchedulerEntryInBackoff(entry, now)) {
      skippedBackoffCount += 1;
      continue;
    }

    runnableEntries.push(computePriority(entry, totalFeeds, boosts.get(entry.feedId)));
  }

  runnableEntries.sort((a, b) => {
    const aFrontloaded = options.frontloadFeedIds?.has(a.feedId) ?? false;
    const bFrontloaded = options.frontloadFeedIds?.has(b.feedId) ?? false;
    if (aFrontloaded !== bFrontloaded) {
      return aFrontloaded ? -1 : 1;
    }

    return b.score - a.score;
  });

  return {
    prioritized: runnableEntries,
    skippedBackoffCount,
    skippedSuppressedCount,
  };
};
