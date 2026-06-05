import { isDev } from '@/services/system/env';
import { logger } from '@/services/logger';

export type InteractionKind = 'sidebar-switch' | 'article-list-scroll' | 'article-list-load-more' | 'article-view-open' | 'article-view-close';

export interface RenderCommitMetric {
  phase: 'mount' | 'update' | 'nested-update';
  actualDurationMs: number;
  baseDurationMs: number;
  startTimeMs: number;
  commitTimeMs: number;
}

export interface MainProcessPerfSnapshot {
  timestamp: string;
  processes: Array<{
    pid: number;
    type: string;
    cpu: number;
    mem: number;
  }>;
  main: {
    pid: number;
    rssMb: number;
    heapUsedMb: number;
    heapTotalMb: number;
    externalMb: number;
    handles: number;
    requests: number;
  };
}

interface RendererHeapSnapshot {
  usedJsHeapMb: number;
  totalJsHeapMb: number;
  jsHeapLimitMb: number;
}

interface ActiveInteractionRecord {
  kind: InteractionKind;
  key: string;
  startedAt: number;
  context: Record<string, unknown>;
  stages: Record<string, number>;
  latestRenderCommit: RenderCommitMetric | null;
}

export interface TimedInteractionSummary {
  kind: InteractionKind;
  key: string;
  totalDurationMs: number;
  stageDurationsMs: Record<string, number>;
  renderCommit: RenderCommitMetric | null;
  context: Record<string, unknown>;
}

interface TimedInteractionCompletionOptions {
  summaryMessage: string;
  lagMessage: string;
  additionalContext?: Record<string, unknown>;
  isLagging: (summary: TimedInteractionSummary) => boolean;
}

interface ScrollSessionSummary {
  totalDurationMs: number;
  frameCount: number;
  slowFrameCount: number;
  severeFrameCount: number;
  longTaskCount: number;
  maxFrameMs: number;
  averageFrameMs: number;
  maxLongTaskMs: number;
  eventCount: number;
  scrollDistancePx: number;
  context: Record<string, unknown>;
}

export interface ArticleListLoadMoreMetric {
  sourceKey: string | null;
  requestedLimit: number;
  nextLimit: number;
  receivedCount: number;
  queryDurationMs: number;
  renderCommitMs: number;
  totalDurationMs: number;
  offset: number;
  buffered: boolean;
  appendMode: 'urgent' | 'transition';
  isSearchActive: boolean;
}

const ACTIVE_DIAGNOSTIC_SNAPSHOT_COOLDOWN_MS = 12_000;
export const INTERACTION_PERFORMANCE_OVERRIDE_STORAGE_KEY = 'debug:interaction-performance';

const activeInteractions = new Map<string, ActiveInteractionRecord>();
const lastDiagnosticSnapshotAtByKind = new Map<InteractionKind, number>();

const PERFORMANCE_WITH_MEMORY = performance as Performance & {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
};

const toInteractionMapKey = (kind: InteractionKind, key: string): string => `${kind}:${key}`;

export const roundPerformanceValue = (value: number): number => Number(value.toFixed(1));

export const getActiveInteractionPerformanceRecords = (): Array<{
  kind: InteractionKind;
  key: string;
  durationMs: number;
  context: Record<string, unknown>;
  stages: Record<string, number>;
  latestRenderCommit: RenderCommitMetric | null;
}> => Array.from(activeInteractions.values()).map((record) => ({
  kind: record.kind,
  key: record.key,
  durationMs: roundPerformanceValue(performance.now() - record.startedAt),
  context: { ...record.context },
  stages: buildStageDurations(record),
  latestRenderCommit: record.latestRenderCommit,
}));

const readInteractionPerformanceOverride = (): boolean => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  try {
    return window.localStorage.getItem(INTERACTION_PERFORMANCE_OVERRIDE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

// Keep the diagnostics path out of packaged production builds by default. When
// a packaged build needs investigation later, a developer can opt in locally by
// setting localStorage["debug:interaction-performance"] = "1" and reloading.
export const isInteractionPerformanceEnabled = isDev || readInteractionPerformanceOverride();

const buildStageDurations = (record: ActiveInteractionRecord): Record<string, number> => {
  return Object.fromEntries(
    Object.entries(record.stages).map(([stage, timestamp]) => [stage, roundPerformanceValue(timestamp - record.startedAt)])
  );
};

const getRendererHeapSnapshot = (): RendererHeapSnapshot | null => {
  const memory = PERFORMANCE_WITH_MEMORY.memory;
  if (!memory) {
    return null;
  }

  return {
    usedJsHeapMb: roundPerformanceValue(memory.usedJSHeapSize / 1024 / 1024),
    totalJsHeapMb: roundPerformanceValue(memory.totalJSHeapSize / 1024 / 1024),
    jsHeapLimitMb: roundPerformanceValue(memory.jsHeapSizeLimit / 1024 / 1024),
  };
};

const getDiagnosticSnapshotCooldownMs = (kind: InteractionKind): number => {
  const now = performance.now();
  const lastSnapshotAt = lastDiagnosticSnapshotAtByKind.get(kind);
  if (lastSnapshotAt === undefined) {
    return 0;
  }

  return Math.max(0, ACTIVE_DIAGNOSTIC_SNAPSHOT_COOLDOWN_MS - (now - lastSnapshotAt));
};

const requestMainProcessSnapshot = async (): Promise<MainProcessPerfSnapshot | null> => {
  if (!isInteractionPerformanceEnabled) {
    return null;
  }

  if (!window.electronAPI?.perfSnapshot) {
    return null;
  }

  try {
    return await window.electronAPI.perfSnapshot();
  } catch (error) {
    logger.warn('InteractionPerformance', 'Failed to capture main-process performance snapshot', {
      specialInteractionLog: true,
      requiresDebugging: true,
      error,
    });
    return null;
  }
};

const requestLagDiagnostics = async (
  kind: InteractionKind,
  message: string,
  context: Record<string, unknown>
): Promise<void> => {
  if (!isInteractionPerformanceEnabled) {
    return;
  }

  const remainingCooldownMs = getDiagnosticSnapshotCooldownMs(kind);
  if (remainingCooldownMs > 0) {
    logger.warn('InteractionPerformance', `${message} (snapshot skipped during cooldown)`, {
      ...context,
      specialInteractionLog: true,
      requiresDebugging: true,
      lagDetected: true,
      diagnosticSnapshotCaptured: false,
      diagnosticSnapshotCooldownMs: roundPerformanceValue(remainingCooldownMs),
      rendererHeap: getRendererHeapSnapshot(),
    });
    return;
  }

  lastDiagnosticSnapshotAtByKind.set(kind, performance.now());
  const mainProcessSnapshot = await requestMainProcessSnapshot();

  logger.warn('InteractionPerformance', `${message} (diagnostics captured)`, {
    ...context,
    specialInteractionLog: true,
    requiresDebugging: true,
    lagDetected: true,
    diagnosticSnapshotCaptured: true,
    rendererHeap: getRendererHeapSnapshot(),
    mainProcessSnapshot,
    renderer: {
      hardwareConcurrency: navigator.hardwareConcurrency ?? null,
      deviceMemoryGb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
      visibilityState: document.visibilityState,
    },
  });
};

export const interactionPerformance = {
  beginTimedInteraction(
    kind: InteractionKind,
    key: string,
    context: Record<string, unknown>,
    options?: { exclusiveByKind?: boolean }
  ): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (options?.exclusiveByKind) {
      for (const [activeKey, record] of activeInteractions.entries()) {
        if (record.kind === kind) {
          activeInteractions.delete(activeKey);
        }
      }
    }

    activeInteractions.set(toInteractionMapKey(kind, key), {
      kind,
      key,
      startedAt: performance.now(),
      context: { ...context },
      stages: {},
      latestRenderCommit: null,
    });
  },

  cancelTimedInteraction(
    kind: InteractionKind,
    key: string,
    reason: string,
    additionalContext?: Record<string, unknown>
  ): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const mapKey = toInteractionMapKey(kind, key);
    const record = activeInteractions.get(mapKey);
    if (!record) {
      return;
    }

    activeInteractions.delete(mapKey);
    logger.info('InteractionPerformance', 'Cancelled timed interaction sample', {
      ...record.context,
      ...additionalContext,
      interactionKind: kind,
      interactionKey: key,
      event: 'interaction-cancelled',
      reason,
      specialInteractionLog: true,
      requiresDebugging: false,
    });
  },

  markTimedInteractionStage(
    kind: InteractionKind,
    key: string,
    stage: string,
    additionalContext?: Record<string, unknown>
  ): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const record = activeInteractions.get(toInteractionMapKey(kind, key));
    if (!record) {
      return;
    }

    record.stages[stage] = performance.now();
    if (additionalContext) {
      record.context = {
        ...record.context,
        ...additionalContext,
      };
    }
  },

  recordTimedInteractionCommit(kind: InteractionKind, key: string, renderCommit: RenderCommitMetric | null): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const record = activeInteractions.get(toInteractionMapKey(kind, key));
    if (!record || !renderCommit) {
      return;
    }

    record.latestRenderCommit = renderCommit;
  },

  completeTimedInteraction(
    kind: InteractionKind,
    key: string,
    options: TimedInteractionCompletionOptions
  ): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const mapKey = toInteractionMapKey(kind, key);
    const record = activeInteractions.get(mapKey);
    if (!record) {
      return;
    }

    activeInteractions.delete(mapKey);

    const summary: TimedInteractionSummary = {
      kind,
      key,
      totalDurationMs: roundPerformanceValue(performance.now() - record.startedAt),
      stageDurationsMs: buildStageDurations(record),
      renderCommit: record.latestRenderCommit,
      context: {
        ...record.context,
        ...options.additionalContext,
      },
    };

    const logContext = {
      ...summary.context,
      interactionKind: kind,
      interactionKey: key,
      totalDurationMs: summary.totalDurationMs,
      stageDurationsMs: summary.stageDurationsMs,
      renderCommit: summary.renderCommit,
      specialInteractionLog: true,
      requiresDebugging: false,
      lagDetected: false,
    };

    if (options.isLagging(summary)) {
      logger.warn('InteractionPerformance', options.lagMessage, {
        ...logContext,
        requiresDebugging: true,
        lagDetected: true,
      });
      void requestLagDiagnostics(kind, options.lagMessage, logContext);
      return;
    }

    logger.info('InteractionPerformance', options.summaryMessage, logContext);
  },

  reportScrollSession(summaryMessage: string, lagMessage: string, summary: ScrollSessionSummary): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const logContext = {
      ...summary.context,
      interactionKind: 'article-list-scroll' as const,
      event: 'article-list-scroll-session',
      totalDurationMs: summary.totalDurationMs,
      frameCount: summary.frameCount,
      slowFrameCount: summary.slowFrameCount,
      severeFrameCount: summary.severeFrameCount,
      longTaskCount: summary.longTaskCount,
      maxFrameMs: summary.maxFrameMs,
      averageFrameMs: summary.averageFrameMs,
      maxLongTaskMs: summary.maxLongTaskMs,
      eventCount: summary.eventCount,
      scrollDistancePx: summary.scrollDistancePx,
      specialInteractionLog: true,
      requiresDebugging: false,
      lagDetected: false,
    };

    const hasLag = summary.severeFrameCount > 0
      || summary.longTaskCount > 0
      || (summary.frameCount >= 8 && summary.slowFrameCount / summary.frameCount >= 0.3 && summary.maxFrameMs >= 32);

    if (hasLag) {
      logger.warn('InteractionPerformance', lagMessage, {
        ...logContext,
        requiresDebugging: true,
        lagDetected: true,
      });
      void requestLagDiagnostics('article-list-scroll', lagMessage, logContext);
      return;
    }

    logger.info('InteractionPerformance', summaryMessage, logContext);
  },

  reportArticleListLoadMore(metric: ArticleListLoadMoreMetric): void {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const logContext = {
      ...metric,
      interactionKind: 'article-list-load-more' as const,
      event: 'article-list-load-more',
      specialInteractionLog: true,
      requiresDebugging: false,
      lagDetected: false,
    };

    const hasLag = metric.queryDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleListLoadMore.queryLagMs
      || metric.renderCommitMs >= INTERACTION_PERFORMANCE_BUDGETS.articleListLoadMore.renderCommitLagMs
      || metric.totalDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleListLoadMore.totalLagMs;

    if (hasLag) {
      logger.warn('InteractionPerformance', 'Article-list load-more lag detected', {
        ...logContext,
        requiresDebugging: true,
        lagDetected: true,
      });
      void requestLagDiagnostics('article-list-load-more', 'Article-list load-more lag detected', logContext);
      return;
    }

    logger.info('InteractionPerformance', 'Article-list load-more performance sample', logContext);
  },
};

export const INTERACTION_PERFORMANCE_BUDGETS = {
  sidebarSwitch: {
    firstCommitLagMs: 180,
    renderCommitLagMs: 32,
  },
  articleListScroll: {
    slowFrameMs: 24,
    severeFrameMs: 50,
    idleWindowMs: 180,
    minimumFrameCount: 6,
  },
  articleListLoadMore: {
    queryLagMs: 90,
    renderCommitLagMs: 32,
    totalLagMs: 140,
  },
  articleViewOpen: {
    totalLagMs: 320,
    renderCommitLagMs: 32,
  },
  articleViewClose: {
    totalLagMs: 340,
    renderCommitLagMs: 32,
  },
  longTask: {
    lagMs: 50,
  },
} as const;
