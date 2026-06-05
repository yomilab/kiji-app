export type BackgroundUpdateMode =
  | 'on-launch'
  | 'every-5m'
  | 'every-10m'
  | 'every-15m'
  | 'every-30m'
  | 'every-1h'
  | 'never';

export interface SchedulerFeedEntry {
  feedId: string;
  feedUrl: string;
  feedTitle: string;
  lastFetched: Date | null;
  lastFailedFetchAt: Date | null;
  sortOrder: number;
  updateFrequencyScore: number;
  consecutiveFailures: number;
}

export interface FeedPriorityEntry extends SchedulerFeedEntry {
  score: number;
}

export type SchedulerEventType = 'cycle-start' | 'cycle-complete' | 'feed-updated' | 'feed-failed';

export interface SchedulerEvent {
  type: SchedulerEventType;
  feedId?: string;
  newArticleCount?: number;
  error?: string;
}
