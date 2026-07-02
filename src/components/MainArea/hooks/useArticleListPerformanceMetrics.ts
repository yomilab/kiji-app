import { useCallback, useRef, type ProfilerOnRenderCallback, type RefObject } from 'react';
import { useDependencyEffect, useUnmountEffect } from '@/hooks/useLifecycleEffects';
import {
  INTERACTION_PERFORMANCE_BUDGETS,
  interactionPerformance,
  isInteractionPerformanceEnabled,
  roundPerformanceValue,
  type RenderCommitMetric,
} from '@/services/performance/interactionPerformance';
import { sidebarSwitchTrace } from '@/services/performance/sidebarSwitchTrace';

interface UseArticleListPerformanceMetricsParams {
  sourceKey: string;
  navigationNonce: number;
  sourceLabel: string | null;
  variant: 'common' | 'saved';
  filteredCount: number;
  visibleRowCount: number;
  totalVirtualSizePx: number;
  isSearchActive: boolean;
  isLoadingMoreArticles: boolean;
  articleListItemsRef: RefObject<HTMLDivElement | null>;
}

interface ActiveScrollSession {
  startedAt: number;
  lastScrollTop: number;
  lastFrameAt: number | null;
  eventCount: number;
  totalScrollDistancePx: number;
  frameCount: number;
  slowFrameCount: number;
  severeFrameCount: number;
  totalFrameDurationMs: number;
  maxFrameMs: number;
  longTaskCount: number;
  maxLongTaskMs: number;
  pendingPreviewImagesMax: number;
  sawLoadingMoreArticles: boolean;
  rafId: number | null;
  idleTimerId: number | null;
  longTaskObserver: PerformanceObserver | null;
}

const SCROLL_SUMMARY_COOLDOWN_MS = 8_000;

const supportsLongTaskObserver = (): boolean => {
  return typeof PerformanceObserver !== 'undefined'
    && Array.isArray(PerformanceObserver.supportedEntryTypes)
    && PerformanceObserver.supportedEntryTypes.includes('longtask');
};

const createRenderCommitMetric = (
  phase: 'mount' | 'update' | 'nested-update',
  actualDuration: number,
  baseDuration: number,
  startTime: number,
  commitTime: number
): RenderCommitMetric => ({
  phase,
  actualDurationMs: roundPerformanceValue(actualDuration),
  baseDurationMs: roundPerformanceValue(baseDuration),
  startTimeMs: roundPerformanceValue(startTime),
  commitTimeMs: roundPerformanceValue(commitTime),
});

export const useArticleListPerformanceMetrics = ({
  sourceKey,
  navigationNonce,
  sourceLabel,
  variant,
  filteredCount,
  visibleRowCount,
  totalVirtualSizePx,
  isSearchActive,
  isLoadingMoreArticles,
  articleListItemsRef,
}: UseArticleListPerformanceMetricsParams): {
  handleListProfilerRender: ProfilerOnRenderCallback;
  handleScrollPerformanceEvent: (scrollTop: number) => void;
} => {
  const latestRenderCommitRef = useRef<RenderCommitMetric | null>(null);
  const activeScrollSessionRef = useRef<ActiveScrollSession | null>(null);
  const lastScrollInfoLogAtRef = useRef(0);

  // Sample only lightweight list-side work so lag reports explain whether the
  // scroll or switch overlapped with fetch churn or visible preview-image loads.
  const getListSnapshot = useCallback(() => {
    const scrollElement = articleListItemsRef.current;
    const previewImages = scrollElement
      ? Array.from(scrollElement.querySelectorAll<HTMLImageElement>('.article-list-item-preview-image-content'))
      : [];

    return {
      sourceKey,
      sourceLabel,
      variant,
      filteredCount,
      visibleRowCount,
      totalVirtualSizePx: roundPerformanceValue(totalVirtualSizePx),
      isSearchActive,
      isLoadingMoreArticles,
      scrollTop: roundPerformanceValue(scrollElement?.scrollTop ?? 0),
      scrollHeight: roundPerformanceValue(scrollElement?.scrollHeight ?? 0),
      clientHeight: roundPerformanceValue(scrollElement?.clientHeight ?? 0),
      visiblePreviewImageCount: previewImages.length,
      pendingPreviewImages: previewImages.filter((image) => !image.complete).length,
    };
  }, [
    articleListItemsRef,
    filteredCount,
    isLoadingMoreArticles,
    isSearchActive,
    sourceKey,
    sourceLabel,
    totalVirtualSizePx,
    variant,
    visibleRowCount,
  ]);

  const finalizeScrollSession = useCallback(() => {
    const session = activeScrollSessionRef.current;
    if (!session) {
      return;
    }

    activeScrollSessionRef.current = null;

    if (session.rafId !== null) {
      window.cancelAnimationFrame(session.rafId);
    }
    if (session.idleTimerId !== null) {
      window.clearTimeout(session.idleTimerId);
    }
    session.longTaskObserver?.disconnect();

    const totalDurationMs = roundPerformanceValue(performance.now() - session.startedAt);
    const averageFrameMs = session.frameCount > 0
      ? roundPerformanceValue(session.totalFrameDurationMs / session.frameCount)
      : 0;

    const summaryContext = {
      ...getListSnapshot(),
      pendingPreviewImagesMax: session.pendingPreviewImagesMax,
      paginationDuringScroll: session.sawLoadingMoreArticles,
    };

    const hasPotentialLag = session.severeFrameCount > 0
      || session.longTaskCount > 0
      || (
        session.frameCount >= INTERACTION_PERFORMANCE_BUDGETS.articleListScroll.minimumFrameCount
        && session.slowFrameCount / session.frameCount >= 0.3
        && session.maxFrameMs >= 32
      );

    if (!hasPotentialLag && performance.now() - lastScrollInfoLogAtRef.current < SCROLL_SUMMARY_COOLDOWN_MS) {
      return;
    }

    lastScrollInfoLogAtRef.current = performance.now();

    interactionPerformance.reportScrollSession(
      'Article-list scroll performance sample',
      'Article-list scroll lag detected',
      {
        totalDurationMs,
        frameCount: session.frameCount,
        slowFrameCount: session.slowFrameCount,
        severeFrameCount: session.severeFrameCount,
        longTaskCount: session.longTaskCount,
        maxFrameMs: roundPerformanceValue(session.maxFrameMs),
        averageFrameMs,
        maxLongTaskMs: roundPerformanceValue(session.maxLongTaskMs),
        eventCount: session.eventCount,
        scrollDistancePx: roundPerformanceValue(session.totalScrollDistancePx),
        context: summaryContext,
      }
    );
  }, [getListSnapshot]);

  const ensureScrollFrameLoop = useCallback((session: ActiveScrollSession) => {
    const step = (timestamp: number) => {
      if (activeScrollSessionRef.current !== session) {
        return;
      }

      if (session.lastFrameAt !== null) {
        const frameDurationMs = timestamp - session.lastFrameAt;
        session.frameCount += 1;
        session.totalFrameDurationMs += frameDurationMs;
        session.maxFrameMs = Math.max(session.maxFrameMs, frameDurationMs);

        if (frameDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleListScroll.slowFrameMs) {
          session.slowFrameCount += 1;
        }
        if (frameDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleListScroll.severeFrameMs) {
          session.severeFrameCount += 1;
        }
      }

      session.lastFrameAt = timestamp;
      session.rafId = window.requestAnimationFrame(step);
    };

    session.rafId = window.requestAnimationFrame(step);
  }, []);

  const ensureLongTaskObserver = useCallback((session: ActiveScrollSession) => {
    if (!supportsLongTaskObserver()) {
      return;
    }

    session.longTaskObserver = new PerformanceObserver((entryList) => {
      if (activeScrollSessionRef.current !== session) {
        return;
      }

      for (const entry of entryList.getEntries()) {
        session.longTaskCount += 1;
        session.maxLongTaskMs = Math.max(session.maxLongTaskMs, entry.duration);
      }
    });

    session.longTaskObserver.observe({ entryTypes: ['longtask'] });
  }, []);

  const handleListProfilerRender = useCallback<ProfilerOnRenderCallback>((
    _id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  ) => {
    latestRenderCommitRef.current = createRenderCommitMetric(phase, actualDuration, baseDuration, startTime, commitTime);
  }, []);

  const getListSnapshotRef = useRef(getListSnapshot);
  getListSnapshotRef.current = getListSnapshot;

  // Close sidebar-switch samples on the first committed list render for the new
  // source so we measure the user's visible handoff, not only async fetch work.
  useDependencyEffect(() => {
    sidebarSwitchTrace.completeInteractive(sourceKey, latestRenderCommitRef.current);

    if (!isInteractionPerformanceEnabled) {
      return;
    }

    interactionPerformance.recordTimedInteractionCommit('sidebar-switch', sourceKey, latestRenderCommitRef.current);
    interactionPerformance.completeTimedInteraction('sidebar-switch', sourceKey, {
      summaryMessage: 'Sidebar switch performance sample',
      lagMessage: 'Sidebar switch lag detected',
      additionalContext: getListSnapshotRef.current(),
      isLagging: (summary) => {
        return summary.totalDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.sidebarSwitch.firstCommitLagMs
          || (summary.renderCommit?.actualDurationMs ?? 0) >= INTERACTION_PERFORMANCE_BUDGETS.sidebarSwitch.renderCommitLagMs;
      },
    });
  }, [sourceKey, navigationNonce]);

  const handleScrollPerformanceEvent = useCallback((scrollTop: number) => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    const scrollSnapshot = getListSnapshot();
    let session = activeScrollSessionRef.current;

    if (!session) {
      session = {
        startedAt: performance.now(),
        lastScrollTop: scrollTop,
        lastFrameAt: null,
        eventCount: 0,
        totalScrollDistancePx: 0,
        frameCount: 0,
        slowFrameCount: 0,
        severeFrameCount: 0,
        totalFrameDurationMs: 0,
        maxFrameMs: 0,
        longTaskCount: 0,
        maxLongTaskMs: 0,
        pendingPreviewImagesMax: scrollSnapshot.pendingPreviewImages,
        sawLoadingMoreArticles: scrollSnapshot.isLoadingMoreArticles,
        rafId: null,
        idleTimerId: null,
        longTaskObserver: null,
      };

      activeScrollSessionRef.current = session;
      ensureScrollFrameLoop(session);
      ensureLongTaskObserver(session);
    }

    session.eventCount += 1;
    session.totalScrollDistancePx += Math.abs(scrollTop - session.lastScrollTop);
    session.lastScrollTop = scrollTop;
    session.pendingPreviewImagesMax = Math.max(session.pendingPreviewImagesMax, scrollSnapshot.pendingPreviewImages);
    session.sawLoadingMoreArticles = session.sawLoadingMoreArticles || scrollSnapshot.isLoadingMoreArticles;

    if (session.idleTimerId !== null) {
      window.clearTimeout(session.idleTimerId);
    }

    session.idleTimerId = window.setTimeout(() => {
      finalizeScrollSession();
    }, INTERACTION_PERFORMANCE_BUDGETS.articleListScroll.idleWindowMs);
  }, [ensureLongTaskObserver, ensureScrollFrameLoop, finalizeScrollSession, getListSnapshot]);

  useUnmountEffect(() => {
    finalizeScrollSession();
  });

  return {
    handleListProfilerRender,
    handleScrollPerformanceEvent,
  };
};
