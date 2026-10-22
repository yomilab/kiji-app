import { describe, expect, it } from 'vitest';
import {
  describeFeedOutage,
  describeStationOutage,
  feedHealthFields,
  feedPatchFromHealth,
  isFeedFailing,
} from '@/services/feeds/feedHealth';
import { describeFeedStatus, needsAttention } from '@/components/ManageFeedsWindow/manageFeedsModel';
import type { Feed } from '@/services/feeds/feedsManager';

const NOW = new Date('2026-10-22T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const feed = (overrides: Partial<Feed>): Feed => ({
  id: 'f',
  title: 'Feed',
  url: 'https://example.com/feed.xml',
  tags: [],
  ...overrides,
});

const CASES: Feed[] = [
  feed({}),
  feed({ consecutiveFailures: 0, lastFetched: new Date(NOW - HOUR) }),
  feed({ consecutiveFailures: 1, lastFetched: new Date(NOW - 2 * DAY), lastFailedFetchAt: new Date(NOW - HOUR) }),
  feed({ consecutiveFailures: 7 }),
  feed({ consecutiveFailures: -3 }),
];

describe('feedHealth', () => {
  it('uses the same "can’t update" rule as Manage Feeds', () => {
    expect(needsAttention).toBe(isFeedFailing);
    for (const entry of CASES) {
      const manageFeedsFailing = describeFeedStatus(entry, NOW).health === 'failing';
      expect(isFeedFailing(entry)).toBe(manageFeedsFailing);
      expect(describeFeedOutage(entry, NOW) !== null).toBe(manageFeedsFailing);
    }
  });

  it('says how long the feed has not updated, in plain language', () => {
    expect(describeFeedOutage(feed({ consecutiveFailures: 3, lastFetched: new Date(NOW - 2 * DAY - HOUR) }), NOW))
      .toBe('KiJi couldn’t update this feed for 2 days.');
    expect(describeFeedOutage(feed({ consecutiveFailures: 1, lastFetched: new Date(NOW - DAY) }), NOW))
      .toBe('KiJi couldn’t update this feed for a day.');
    expect(describeFeedOutage(feed({ consecutiveFailures: 1, lastFetched: new Date(NOW - 5 * HOUR) }), NOW))
      .toBe('KiJi couldn’t update this feed for 5 hours.');
    expect(describeFeedOutage(feed({ consecutiveFailures: 1, lastFetched: new Date(NOW - 10 * 60 * 1000) }), NOW))
      .toBe('KiJi couldn’t update this feed.');
    // Never updated: counted from when it was added.
    expect(describeFeedOutage(feed({ consecutiveFailures: 2, createdAt: new Date(NOW - 3 * DAY) }), NOW))
      .toBe('KiJi couldn’t update this feed for 3 days.');
    expect(describeFeedOutage(feed({ consecutiveFailures: 0 }), NOW)).toBeNull();
  });

  it('describes a station with failing feeds', () => {
    expect(describeStationOutage(0)).toBeNull();
    expect(describeStationOutage(1)).toBe('KiJi couldn’t update 1 feed in this station.');
    expect(describeStationOutage(3)).toBe('KiJi couldn’t update 3 feeds in this station.');
  });

  it('round-trips health through plain bus fields', () => {
    const source = feed({ consecutiveFailures: 4, lastFetched: new Date(NOW - DAY), lastFailedFetchAt: new Date(NOW) });
    const health = feedHealthFields(source);
    expect(health).toEqual({ consecutiveFailures: 4, lastFetchedMs: NOW - DAY, lastFailedFetchAtMs: NOW });
    expect(JSON.parse(JSON.stringify(health))).toEqual(health);
    expect(feedPatchFromHealth(health)).toEqual({
      consecutiveFailures: 4,
      lastFetched: new Date(NOW - DAY),
      lastFailedFetchAt: new Date(NOW),
    });
    expect(feedPatchFromHealth({ consecutiveFailures: 0, lastFetchedMs: NOW, lastFailedFetchAtMs: null }).lastFailedFetchAt)
      .toBeUndefined();
  });
});
