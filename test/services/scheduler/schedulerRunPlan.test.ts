import { describe, expect, it } from 'vitest';
import { createSchedulerRunPlan, isSchedulerEntryInBackoff } from '@/services/scheduler/schedulerRunPlan';
import type { SchedulerFeedEntry } from '@/services/scheduler/types';

const createEntry = (
  feedId: string,
  overrides: Partial<SchedulerFeedEntry> = {},
): SchedulerFeedEntry => ({
  feedId,
  feedUrl: `https://${feedId}.example.com/feed.xml`,
  feedTitle: `Feed ${feedId}`,
  lastFetched: new Date('2026-05-09T00:00:00.000Z'),
  lastFailedFetchAt: null,
  sortOrder: 0,
  updateFrequencyScore: 0.5,
  consecutiveFailures: 0,
  ...overrides,
});

describe('schedulerRunPlan', () => {
  it('treats feeds inside the active failure backoff window as blocked', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const blocked = createEntry('blocked', {
      consecutiveFailures: 2,
      lastFailedFetchAt: new Date(now - 20 * 60_000),
    });

    expect(isSchedulerEntryInBackoff(blocked, now)).toBe(true);
  });

  it('filters active-backoff feeds before scheduler work is queued', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const runnable = createEntry('runnable');
    const blocked = createEntry('blocked', {
      consecutiveFailures: 3,
      lastFailedFetchAt: new Date(now - 30 * 60_000),
    });
    const expired = createEntry('expired', {
      consecutiveFailures: 1,
      lastFailedFetchAt: new Date(now - 20 * 60_000),
    });

    const plan = createSchedulerRunPlan(
      [blocked, runnable, expired],
      3,
      new Map(),
      now,
    );

    expect(plan.skippedBackoffCount).toBe(1);
    expect(plan.prioritized.map((entry) => entry.feedId).sort()).toEqual(['expired', 'runnable']);
  });

  it('keeps high-frequency feeds runnable after their shorter backoff cap expires', () => {
    const now = new Date('2026-05-09T12:00:00.000Z').getTime();
    const activeFeed = createEntry('active', {
      consecutiveFailures: 12,
      lastFailedFetchAt: new Date(now - 45 * 60_000),
      updateFrequencyScore: 1.0,
    });

    const plan = createSchedulerRunPlan(
      [activeFeed],
      1,
      new Map(),
      now,
    );

    expect(plan.skippedBackoffCount).toBe(0);
    expect(plan.prioritized.map((entry) => entry.feedId)).toEqual(['active']);
  });
});
