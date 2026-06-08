import { getFeedRefreshBlock } from '@/services/feeds/feedRefreshPolicy';
import type { FeedPriorityEntry, SchedulerFeedEntry } from './types';

const WEIGHT_FREQUENCY = 0.40;
const WEIGHT_STALENESS = 0.35;
const WEIGHT_POSITION = 0.10;
const WEIGHT_BOOST = 0.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeFrequencyFromDates(dates: string[]): number {
  if (dates.length < 2) {
    return 0.1;
  }

  const intervals: number[] = [];
  for (let i = 0; i < dates.length - 1; i += 1) {
    const newer = new Date(dates[i]).getTime();
    const older = new Date(dates[i + 1]).getTime();
    const diffMs = newer - older;
    if (diffMs > 0) {
      intervals.push(diffMs);
    }
  }

  if (intervals.length === 0) {
    return 0.1;
  }

  intervals.sort((a, b) => a - b);
  const mid = Math.floor(intervals.length / 2);
  const medianMs = intervals.length % 2 === 0
    ? (intervals[mid - 1] + intervals[mid]) / 2
    : intervals[mid];

  const msPerDay = 86_400_000;
  const postsPerDay = msPerDay / medianMs;

  if (postsPerDay >= 5) return 1.0;
  if (postsPerDay >= 1) return 0.75;
  if (postsPerDay >= 1 / 7) return 0.5;
  if (postsPerDay >= 1 / 30) return 0.25;
  return 0.1;
}

export function computeStalenessScore(lastFetched: Date | null, frequencyScore: number): number {
  if (!lastFetched) {
    return 1.0;
  }

  const elapsedMs = Date.now() - lastFetched.getTime();

  let expectedIntervalMs: number;
  if (frequencyScore >= 1.0) {
    expectedIntervalMs = 30 * 60_000;
  } else if (frequencyScore >= 0.75) {
    expectedIntervalMs = 2 * 3_600_000;
  } else if (frequencyScore >= 0.5) {
    expectedIntervalMs = 6 * 3_600_000;
  } else if (frequencyScore >= 0.25) {
    expectedIntervalMs = 12 * 3_600_000;
  } else {
    expectedIntervalMs = 24 * 3_600_000;
  }

  return clamp(elapsedMs / expectedIntervalMs, 0, 1);
}

export function computePositionScore(sortOrder: number, totalFeeds: number): number {
  if (totalFeeds <= 1) {
    return 1.0;
  }
  return clamp(1 - sortOrder / (totalFeeds - 1), 0, 1);
}

export function computeManualBoost(boostUntil: number | undefined): number {
  if (!boostUntil) {
    return 0.0;
  }
  return Date.now() < boostUntil ? 1.0 : 0.0;
}

export function computePriority(
  entry: SchedulerFeedEntry,
  totalFeeds: number,
  boostUntil?: number,
): FeedPriorityEntry {
  const frequency = entry.updateFrequencyScore;
  const staleness = computeStalenessScore(entry.lastFetched, frequency);
  const position = computePositionScore(entry.sortOrder, totalFeeds);
  const boost = computeManualBoost(boostUntil);

  const rawScore =
    WEIGHT_FREQUENCY * frequency +
    WEIGHT_STALENESS * staleness +
    WEIGHT_POSITION * position +
    WEIGHT_BOOST * boost;

  const failurePenalty = Math.pow(0.5, entry.consecutiveFailures);
  const refreshBlock = getFeedRefreshBlock(entry, 0, { includeBackoff: true });
  const backoffMultiplier = refreshBlock?.kind === 'backoff' ? 0.1 : 1.0;
  const score = rawScore * failurePenalty * backoffMultiplier;

  return { ...entry, score };
}
