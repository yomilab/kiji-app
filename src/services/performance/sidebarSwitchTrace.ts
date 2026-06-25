import { isDev } from '@/services/system/env';
import { logger } from '@/services/logger';
import { writeE2eEvent } from '@/services/e2e/e2eHarness';
import {
  INTERACTION_PERFORMANCE_BUDGETS,
  INTERACTION_PERFORMANCE_OVERRIDE_STORAGE_KEY,
  roundPerformanceValue,
  type RenderCommitMetric,
} from '@/services/performance/interactionPerformance';

export type SidebarSwitchSourceType = 'feed' | 'tag' | 'smart';

export interface SidebarSwitchTraceStage {
  name: string;
  atMs: number;
  deltaMs: number;
  durationMs?: number;
  context?: Record<string, unknown>;
}

export interface SidebarSwitchTraceRecord {
  token: number;
  sourceKey: string;
  sourceType: SidebarSwitchSourceType;
  startedAt: number;
  stages: SidebarSwitchTraceStage[];
  context: Record<string, unknown>;
  interactiveDurationMs?: number;
  networkDurationMs?: number;
  renderCommit?: RenderCommitMetric | null;
  cancelled: boolean;
  cancelReason?: string;
}

export const SIDEBAR_SWITCH_STAGE_BUDGETS_MS = {
  'coalesce-yield': 12,
  'feed-ids-resolved': 30,
  'sqlite-query': 120,
  'sqlite-reconcile': 120,
  'dispatch-articles': 24,
  'paint-gate': 140,
  'eligible-feeds-resolved': 80,
  'station-network-refresh': 8_000,
  'feed-network-refresh': 8_000,
  interactiveTotal: INTERACTION_PERFORMANCE_BUDGETS.sidebarSwitch.firstCommitLagMs,
  renderCommit: INTERACTION_PERFORMANCE_BUDGETS.sidebarSwitch.renderCommitLagMs,
} as const;

/** Relaxed budgets for real bundled-app E2E (IPC + debug binary overhead). */
export const SIDEBAR_SWITCH_E2E_BUDGETS_MS = {
  coldInteractive: 450,
  warmInteractive: 400,
  harnessInteractive: 800,
  renderCommit: 80,
  sqliteQuery: 120,
  paintGate: 220,
  largeStationMinFeeds: 15,
} as const;

const tracesByToken = new Map<number, SidebarSwitchTraceRecord>();
const latestTokenBySourceKey = new Map<string, number>();

const readTraceOverride = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  try {
    return window.localStorage.getItem(INTERACTION_PERFORMANCE_OVERRIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const isSidebarSwitchTraceVerbose = (): boolean => isDev || readTraceOverride();

const getTrace = (token: number): SidebarSwitchTraceRecord | undefined => tracesByToken.get(token);

const pushStage = (
  trace: SidebarSwitchTraceRecord,
  name: string,
  context?: Record<string, unknown>,
  durationMs?: number,
): void => {
  const now = performance.now();
  const previousAt = trace.stages.length > 0
    ? trace.stages[trace.stages.length - 1]!.atMs + trace.startedAt
    : trace.startedAt;
  const stage: SidebarSwitchTraceStage = {
    name,
    atMs: roundPerformanceValue(now - trace.startedAt),
    deltaMs: roundPerformanceValue(now - previousAt),
    ...(durationMs !== undefined ? { durationMs: roundPerformanceValue(durationMs) } : {}),
    ...(context ? { context } : {}),
  };
  trace.stages.push(stage);
  if (context) {
    trace.context = { ...trace.context, ...context };
  }
};

const buildStageDurations = (trace: SidebarSwitchTraceRecord): Record<string, number> => {
  const durations: Record<string, number> = {};
  for (const stage of trace.stages) {
    const value = stage.durationMs ?? stage.deltaMs;
    durations[stage.name] = roundPerformanceValue((durations[stage.name] ?? 0) + value);
  }
  return durations;
};

const findBudgetViolations = (
  trace: SidebarSwitchTraceRecord,
): Array<{ stage: string; durationMs: number; budgetMs: number }> => {
  const violations: Array<{ stage: string; durationMs: number; budgetMs: number }> = [];
  const stageDurations = buildStageDurations(trace);

  for (const [stage, budgetMs] of Object.entries(SIDEBAR_SWITCH_STAGE_BUDGETS_MS)) {
    if (stage === 'interactiveTotal' || stage === 'renderCommit') {
      continue;
    }
    const durationMs = stageDurations[stage];
    if (durationMs !== undefined && durationMs > budgetMs) {
      violations.push({ stage, durationMs, budgetMs });
    }
  }

  if (
    trace.interactiveDurationMs !== undefined
    && trace.interactiveDurationMs > SIDEBAR_SWITCH_STAGE_BUDGETS_MS.interactiveTotal
  ) {
    violations.push({
      stage: 'interactiveTotal',
      durationMs: trace.interactiveDurationMs,
      budgetMs: SIDEBAR_SWITCH_STAGE_BUDGETS_MS.interactiveTotal,
    });
  }

  if (
    trace.renderCommit
    && trace.renderCommit.actualDurationMs > SIDEBAR_SWITCH_STAGE_BUDGETS_MS.renderCommit
  ) {
    violations.push({
      stage: 'renderCommit',
      durationMs: trace.renderCommit.actualDurationMs,
      budgetMs: SIDEBAR_SWITCH_STAGE_BUDGETS_MS.renderCommit,
    });
  }

  return violations;
};

const buildTracePayload = (
  trace: SidebarSwitchTraceRecord,
  phase: 'interactive' | 'network' | 'cancelled',
) => {
  const violations = findBudgetViolations(trace);
  const lagDetected = violations.length > 0;

  return {
    event: 'sidebar-switch-trace',
    phase,
    token: trace.token,
    sourceKey: trace.sourceKey,
    sourceType: trace.sourceType,
    interactiveDurationMs: trace.interactiveDurationMs ?? null,
    networkDurationMs: trace.networkDurationMs ?? null,
    stageTimeline: trace.stages,
    stageDurationsMs: buildStageDurations(trace),
    budgetViolations: violations,
    renderCommit: trace.renderCommit ?? null,
    context: trace.context,
    cancelled: trace.cancelled,
    cancelReason: trace.cancelReason ?? null,
    specialInteractionLog: true,
    requiresDebugging: lagDetected,
    lagDetected,
  };
};

const publishE2eSwitchPerformance = (trace: SidebarSwitchTraceRecord, phase: 'interactive' | 'network'): void => {
  void writeE2eEvent(`station-switch-perf-${trace.token}`, {
    ...buildTracePayload(trace, phase),
    e2eBudgetsMs: SIDEBAR_SWITCH_E2E_BUDGETS_MS,
  });
};

const publishTrace = (
  trace: SidebarSwitchTraceRecord,
  phase: 'interactive' | 'network' | 'cancelled',
): void => {
  const violations = findBudgetViolations(trace);
  const lagDetected = violations.length > 0;
  const verbose = isSidebarSwitchTraceVerbose();

  if (!lagDetected && !verbose && phase !== 'cancelled') {
    if (phase === 'interactive' || phase === 'network') {
      publishE2eSwitchPerformance(trace, phase);
    }
    return;
  }

  const payload = buildTracePayload(trace, phase);

  if (lagDetected || phase === 'cancelled') {
    logger.warn('SidebarSwitchTrace', lagDetected
      ? 'Sidebar switch lag breakdown'
      : 'Sidebar switch cancelled', payload);
  } else {
    logger.info('SidebarSwitchTrace', 'Sidebar switch trace', payload);
  }

  if (phase === 'interactive' || phase === 'network') {
    publishE2eSwitchPerformance(trace, phase);
  }
};

const removeTrace = (token: number): void => {
  const trace = tracesByToken.get(token);
  if (!trace) {
    return;
  }

  tracesByToken.delete(token);
  const latestToken = latestTokenBySourceKey.get(trace.sourceKey);
  if (latestToken === token) {
    latestTokenBySourceKey.delete(trace.sourceKey);
  }
};

export const sidebarSwitchTrace = {
  begin(
    token: number,
    sourceKey: string,
    sourceType: SidebarSwitchSourceType,
    context: Record<string, unknown> = {},
  ): void {
    tracesByToken.set(token, {
      token,
      sourceKey,
      sourceType,
      startedAt: performance.now(),
      stages: [],
      context: { ...context },
      cancelled: false,
    });
    latestTokenBySourceKey.set(sourceKey, token);
    pushStage(tracesByToken.get(token)!, 'selection-began');
  },

  mark(token: number, stage: string, context?: Record<string, unknown>): void {
    const trace = getTrace(token);
    if (!trace || trace.cancelled) {
      return;
    }
    pushStage(trace, stage, context);
  },

  markDuration(
    token: number,
    stage: string,
    durationMs: number,
    context?: Record<string, unknown>,
  ): void {
    const trace = getTrace(token);
    if (!trace || trace.cancelled) {
      return;
    }
    pushStage(trace, stage, context, durationMs);
  },

  cancel(token: number, reason: string, context?: Record<string, unknown>): void {
    const trace = getTrace(token);
    if (!trace || trace.cancelled) {
      return;
    }
    trace.cancelled = true;
    trace.cancelReason = reason;
    if (context) {
      trace.context = { ...trace.context, ...context };
    }
    pushStage(trace, 'selection-cancelled', { reason });
    publishTrace(trace, 'cancelled');
    removeTrace(token);
  },

  completeInteractive(
    sourceKey: string,
    renderCommit: RenderCommitMetric | null,
  ): void {
    const token = latestTokenBySourceKey.get(sourceKey);
    if (token === undefined) {
      return;
    }

    const trace = getTrace(token);
    if (!trace || trace.cancelled || trace.interactiveDurationMs !== undefined) {
      return;
    }

    trace.interactiveDurationMs = roundPerformanceValue(performance.now() - trace.startedAt);
    trace.renderCommit = renderCommit;
    pushStage(trace, 'first-list-commit', {
      renderCommitMs: renderCommit?.actualDurationMs ?? null,
    });
    publishTrace(trace, 'interactive');
  },

  completeNetwork(token: number, context?: Record<string, unknown>): void {
    const trace = getTrace(token);
    if (!trace || trace.cancelled) {
      return;
    }

    trace.networkDurationMs = roundPerformanceValue(performance.now() - trace.startedAt);
    if (context) {
      trace.context = { ...trace.context, ...context };
    }
    pushStage(trace, 'network-phase-complete', context);
    publishTrace(trace, 'network');
    removeTrace(token);
  },

  getTrace(token: number): SidebarSwitchTraceRecord | undefined {
    return getTrace(token);
  },
};

export async function traceSidebarSwitchAsync<T>(
  token: number,
  stage: string,
  operation: () => Promise<T>,
  context?: Record<string, unknown>,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    sidebarSwitchTrace.markDuration(token, stage, performance.now() - startedAt, context);
  }
}
