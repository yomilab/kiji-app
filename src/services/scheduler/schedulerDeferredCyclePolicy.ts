export type PendingCycleReason =
  | 'interval-tick'
  | 'startup-defer'
  | 'resume'
  | 'catch-up'
  | 'import-boost';

const PENDING_CYCLE_REASON_PRIORITY: Record<PendingCycleReason, number> = {
  'interval-tick': 1,
  'startup-defer': 2,
  'resume': 3,
  'catch-up': 4,
  'import-boost': 5,
};

export function mergePendingCycleReason(
  existing: PendingCycleReason | null,
  incoming: PendingCycleReason,
): PendingCycleReason {
  if (!existing) {
    return incoming;
  }

  return PENDING_CYCLE_REASON_PRIORITY[incoming] > PENDING_CYCLE_REASON_PRIORITY[existing]
    ? incoming
    : existing;
}

export function isCycleIntervalOverdue(
  lastCycleCompletedAt: number | null,
  intervalMs: number,
  now = Date.now(),
): boolean {
  if (!Number.isFinite(intervalMs)) {
    return false;
  }

  if (lastCycleCompletedAt === null) {
    return true;
  }

  return now - lastCycleCompletedAt >= intervalMs;
}

export function shouldRunDeferredCycleNow(input: {
  reason: PendingCycleReason;
  lastCycleCompletedAt: number | null;
  intervalMs: number;
  now?: number;
}): boolean {
  const now = input.now ?? Date.now();

  if (
    input.reason === 'import-boost'
    || input.reason === 'resume'
    || input.reason === 'catch-up'
    || input.reason === 'startup-defer'
  ) {
    return true;
  }

  return isCycleIntervalOverdue(input.lastCycleCompletedAt, input.intervalMs, now);
}

export function overdueCycleMs(
  lastCycleCompletedAt: number | null,
  intervalMs: number,
  now = Date.now(),
): number {
  if (!Number.isFinite(intervalMs)) {
    return 0;
  }

  if (lastCycleCompletedAt === null) {
    return intervalMs;
  }

  return Math.max(0, now - lastCycleCompletedAt);
}
