import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOOST_TTL_MS = 5 * 60_000;

describe('feedScheduler boost map retention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-11T08:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('drops expired boost entries instead of retaining them forever', async () => {
    vi.resetModules();

    const feedIds = Array.from({ length: 1500 }, (_, index) => `feed-${index}`);
    const { feedScheduler } = await import('@/services/scheduler/feedSchedulerService');

    feedScheduler.boostMany(feedIds.slice(0, 800));
    feedScheduler.boostMany(feedIds.slice(800));

    vi.advanceTimersByTime(BOOST_TTL_MS + 1);
    feedScheduler.boostMany(['feed-new']);

    const internalBoosts = (feedScheduler as unknown as { boosts: Map<string, number> }).boosts;
    expect(internalBoosts.size).toBe(1);
    expect(internalBoosts.has('feed-new')).toBe(true);
    expect(internalBoosts.has('feed-0')).toBe(false);
  });
});
