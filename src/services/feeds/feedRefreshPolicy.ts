import type { Feed } from "./types";

export const FEED_FAILURE_BACKOFF_BASE_MS = 15 * 60_000;
export const FEED_FAILURE_BACKOFF_MAX_MS = 3 * 60 * 60_000;

const FEED_FAILURE_BACKOFF_MAX_BY_FREQUENCY: Array<{ minimumScore: number; maxMs: number }> = [
  { minimumScore: 1.0, maxMs: 30 * 60_000 },
  { minimumScore: 0.75, maxMs: 2 * 60 * 60_000 },
];

export interface FeedRefreshBlock {
  kind: "cooldown" | "backoff";
  waitMs: number;
  failureCount?: number;
}

type RefreshPolicyFeed = Pick<Feed, "lastFetched" | "lastFailedFetchAt" | "consecutiveFailures"> &
  Partial<Pick<Feed, "updateFrequencyScore">>;

export function getFeedFailureBackoffMaxMs(updateFrequencyScore = 0): number {
  const activityTier = FEED_FAILURE_BACKOFF_MAX_BY_FREQUENCY.find(
    (tier) => updateFrequencyScore >= tier.minimumScore,
  );
  return activityTier?.maxMs ?? FEED_FAILURE_BACKOFF_MAX_MS;
}

export function getFeedFailureBackoffMs(failures: number, updateFrequencyScore = 0): number {
  if (failures <= 0) {
    return 0;
  }
  return Math.min(
    getFeedFailureBackoffMaxMs(updateFrequencyScore),
    FEED_FAILURE_BACKOFF_BASE_MS * Math.pow(2, failures - 1),
  );
}

export function getFeedRefreshBlock(
  feed: RefreshPolicyFeed,
  cooldownMs: number,
  options: { includeBackoff?: boolean; now?: number } = {},
): FeedRefreshBlock | null {
  const { includeBackoff = false, now = Date.now() } = options;
  const failures = feed.consecutiveFailures ?? 0;
  const failureAnchor = feed.lastFailedFetchAt ?? feed.lastFetched ?? null;

  if (includeBackoff && failures > 0 && failureAnchor) {
    const backoffMs = getFeedFailureBackoffMs(failures, feed.updateFrequencyScore ?? 0);
    const retryAt = failureAnchor.getTime() + backoffMs;
    if (retryAt > now) {
      return { kind: "backoff", waitMs: retryAt - now, failureCount: failures };
    }
  }

  if (feed.lastFetched) {
    const nextAllowedAt = feed.lastFetched.getTime() + cooldownMs;
    if (nextAllowedAt > now) {
      return { kind: "cooldown", waitMs: nextAllowedAt - now };
    }
  }

  return null;
}
