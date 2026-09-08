import { describe, expect, it } from 'vitest';
import { computePriority } from '@/services/scheduler/feedPriorityCalculator';
import type { SchedulerFeedEntry } from '@/services/scheduler/types';

const baseEntry = (overrides: Partial<SchedulerFeedEntry> = {}): SchedulerFeedEntry => ({
  feedId: 'feed-a',
  feedUrl: 'https://a.example/feed',
  feedTitle: 'A',
  lastFetched: new Date('2026-01-01T00:00:00.000Z'),
  lastFailedFetchAt: null,
  consecutiveFailures: 0,
  updateFrequencyScore: 0.5,
  sortOrder: 0,
  ...overrides,
});

describe('computePriority', () => {
  it('does not use sidebar sortOrder as refresh priority', () => {
    const first = computePriority(baseEntry({ feedId: 'z', sortOrder: 0 }), 10);
    const last = computePriority(baseEntry({ feedId: 'a', sortOrder: 9 }), 10);
    expect(first.score).toBe(last.score);
  });
});
