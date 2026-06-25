import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIDEBAR_SWITCH_STAGE_BUDGETS_MS,
  sidebarSwitchTrace,
} from '@/services/performance/sidebarSwitchTrace';

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('@/services/logger', () => ({
  logger,
}));

vi.mock('@/services/system/env', () => ({
  isDev: false,
}));

describe('sidebarSwitchTrace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(performance, 'now').mockImplementation(() => 0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs a lag breakdown when interactive timing exceeds budget', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 250;
      return now;
    });

    sidebarSwitchTrace.begin(1, 'tag:Tech', 'tag', { tagName: 'Tech' });
    sidebarSwitchTrace.mark(1, 'sqlite-query', { articleCount: 120 });
    sidebarSwitchTrace.completeInteractive('tag:Tech', {
      phase: 'update',
      actualDurationMs: 40,
      baseDurationMs: 30,
      startTimeMs: 0,
      commitTimeMs: 40,
    });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const payload = logger.warn.mock.calls[0]?.[2] as {
      lagDetected: boolean;
      budgetViolations: Array<{ stage: string }>;
      interactiveDurationMs: number;
    };
    expect(payload.lagDetected).toBe(true);
    expect(payload.interactiveDurationMs).toBeGreaterThan(
      SIDEBAR_SWITCH_STAGE_BUDGETS_MS.interactiveTotal,
    );
    expect(payload.budgetViolations.some((violation) => violation.stage === 'interactiveTotal')).toBe(true);
  });

  it('does not log successful interactive traces outside verbose mode', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 20;
      return now;
    });

    sidebarSwitchTrace.begin(2, 'feed:abc', 'feed');
    sidebarSwitchTrace.completeInteractive('feed:abc', {
      phase: 'update',
      actualDurationMs: 12,
      baseDurationMs: 10,
      startTimeMs: 0,
      commitTimeMs: 12,
    });

    expect(logger.info).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not publish interactive trace more than once per switch token', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => {
      now += 20;
      return now;
    });

    sidebarSwitchTrace.begin(3, 'tag:Daily', 'tag');
    sidebarSwitchTrace.completeInteractive('tag:Daily', {
      phase: 'update',
      actualDurationMs: 12,
      baseDurationMs: 10,
      startTimeMs: 0,
      commitTimeMs: 12,
    });
    sidebarSwitchTrace.completeInteractive('tag:Daily', {
      phase: 'update',
      actualDurationMs: 80,
      baseDurationMs: 10,
      startTimeMs: 0,
      commitTimeMs: 80,
    });

    const trace = sidebarSwitchTrace.getTrace(3);
    expect(trace?.stages.filter((stage) => stage.name === 'first-list-commit')).toHaveLength(1);
    expect(trace?.renderCommit?.actualDurationMs).toBe(12);
  });
});
