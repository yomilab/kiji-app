import type { Feed } from './types';

/**
 * One definition of "this feed can't update", shared by the sidebar marker and the Manage
 * Feeds status column: a feed is failing while its last refresh attempts failed in a row
 * (`consecutiveFailures > 0`); the next successful refresh resets the count to 0.
 */

/** Health fields carried by `feedsCountsUpdated` bus entries (plain numbers so they cross windows). */
export interface FeedHealthFields {
  consecutiveFailures: number;
  lastFetchedMs: number | null;
  lastFailedFetchAtMs: number | null;
}

type DateLike = Date | string | number | undefined | null;

const msOf = (value: DateLike): number | null => {
  if (value === undefined || value === null) return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

export const feedFailureCount = (feed: Pick<Feed, 'consecutiveFailures'>): number => (
  Math.max(0, feed.consecutiveFailures ?? 0)
);

export const isFeedFailing = (feed: Pick<Feed, 'consecutiveFailures'>): boolean => feedFailureCount(feed) > 0;

export const feedHealthFields = (
  feed: Pick<Feed, 'consecutiveFailures' | 'lastFetched' | 'lastFailedFetchAt'>,
): FeedHealthFields => ({
  consecutiveFailures: feedFailureCount(feed),
  lastFetchedMs: msOf(feed.lastFetched),
  lastFailedFetchAtMs: msOf(feed.lastFailedFetchAt),
});

/** Feed fields to merge for a health entry (undefined clears a date, as SQLite NULL does). */
export const feedPatchFromHealth = (
  health: FeedHealthFields,
): Pick<Feed, 'consecutiveFailures' | 'lastFetched' | 'lastFailedFetchAt'> => ({
  consecutiveFailures: health.consecutiveFailures,
  lastFetched: health.lastFetchedMs === null ? undefined : new Date(health.lastFetchedMs),
  lastFailedFetchAt: health.lastFailedFetchAtMs === null ? undefined : new Date(health.lastFailedFetchAtMs),
});

const sinceWords = (sinceMs: number, now: number): string | null => {
  const minutes = Math.floor(Math.max(0, now - sinceMs) / 60_000);
  if (minutes < 60) return null;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? 'an hour' : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'a day' : `${days} days`;
};

/**
 * Plain-language tooltip for a failing feed ("KiJi couldn’t update this feed for 2 days"),
 * counted from the last good update (or from when the feed was added). Null when healthy.
 */
export const describeFeedOutage = (
  feed: Pick<Feed, 'consecutiveFailures' | 'lastFetched' | 'createdAt'>,
  now: number = Date.now(),
): string | null => {
  if (!isFeedFailing(feed)) return null;
  const sinceMs = msOf(feed.lastFetched) ?? msOf(feed.createdAt);
  const since = sinceMs === null ? null : sinceWords(sinceMs, now);
  return since
    ? `KiJi couldn’t update this feed for ${since}.`
    : 'KiJi couldn’t update this feed.';
};

export const describeStationOutage = (failingCount: number): string | null => {
  if (failingCount <= 0) return null;
  return failingCount === 1
    ? 'KiJi couldn’t update 1 feed in this station.'
    : `KiJi couldn’t update ${failingCount} feeds in this station.`;
};
