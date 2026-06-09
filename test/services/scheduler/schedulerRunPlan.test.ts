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

  it('front-loads active station feeds while preserving score order inside each partition', () => {
    const highRest = createEntry('high-rest', { updateFrequencyScore: 1.0, sortOrder: 0 });
    const lowStation = createEntry('low-station', { updateFrequencyScore: 0.1, sortOrder: 2 });
    const highStation = createEntry('high-station', { updateFrequencyScore: 0.9, sortOrder: 1 });
    const lowRest = createEntry('low-rest', { updateFrequencyScore: 0.1, sortOrder: 3 });

    const plan = createSchedulerRunPlan(
      [highRest, lowStation, highStation, lowRest],
      4,
      new Map(),
      Date.now(),
      { frontloadFeedIds: new Set(['low-station', 'high-station']) },
    );

    expect(plan.prioritized.map((entry) => entry.feedId)).toEqual([
      'high-station',
      'low-station',
      'high-rest',
      'low-rest',
    ]);
  });

  it('suppresses refreshed station feeds for one scheduler cycle', () => {
    const plan = createSchedulerRunPlan(
      [
        createEntry('station-1'),
        createEntry('station-2'),
        createEntry('other'),
      ],
      3,
      new Map(),
      Date.now(),
      {
        frontloadFeedIds: new Set(['station-1', 'station-2']),
        skipFeedIdsForThisCycle: new Set(['station-1', 'station-2']),
      },
    );

    expect(plan.skippedSuppressedCount).toBe(2);
    expect(plan.prioritized.map((entry) => entry.feedId)).toEqual(['other']);
  });
});
