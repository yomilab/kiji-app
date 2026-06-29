import { describe, expect, it } from 'vitest';
import {
  isCycleIntervalOverdue,
  mergePendingCycleReason,
  overdueCycleMs,
  shouldRunDeferredCycleNow,
} from '@/services/scheduler/schedulerDeferredCyclePolicy';

describe('schedulerDeferredCyclePolicy', () => {
  it('keeps the higher-priority pending reason', () => {
    expect(mergePendingCycleReason('interval-tick', 'resume')).toBe('resume');
    expect(mergePendingCycleReason('resume', 'interval-tick')).toBe('resume');
    expect(mergePendingCycleReason(null, 'import-boost')).toBe('import-boost');
  });

  it('runs import/resume/catch-up/startup defer immediately', () => {
    const now = 1_000_000;
    const lastCompleted = now - 60_000;
    const intervalMs = 15 * 60_000;

    for (const reason of ['import-boost', 'resume', 'catch-up', 'startup-defer'] as const) {
      expect(shouldRunDeferredCycleNow({
        reason,
        lastCycleCompletedAt: lastCompleted,
        intervalMs,
        now,
      })).toBe(true);
    }
  });

  it('coalesces interval ticks until the mode interval is overdue', () => {
    const now = 1_000_000;
    const intervalMs = 15 * 60_000;

    expect(shouldRunDeferredCycleNow({
      reason: 'interval-tick',
      lastCycleCompletedAt: now - (5 * 60_000),
      intervalMs,
      now,
    })).toBe(false);

    expect(shouldRunDeferredCycleNow({
      reason: 'interval-tick',
      lastCycleCompletedAt: now - intervalMs,
      intervalMs,
      now,
    })).toBe(true);
  });

  it('reports overdue interval milliseconds', () => {
    const now = 1_000_000;
    const intervalMs = 15 * 60_000;

    expect(overdueCycleMs(now - (5 * 60_000), intervalMs, now)).toBe(5 * 60_000);
    expect(isCycleIntervalOverdue(now - intervalMs, intervalMs, now)).toBe(true);
  });
});
