import { useCallback, useRef, type ProfilerOnRenderCallback } from 'react';
import { useDependencyEffect, useUnmountEffect } from '@/hooks/useLifecycleEffects';
import {
  INTERACTION_PERFORMANCE_BUDGETS,
  interactionPerformance,
  isInteractionPerformanceEnabled,
  roundPerformanceValue,
  type RenderCommitMetric,
} from '@/services/performance/interactionPerformance';

interface UseArticleViewPerformanceMetricsParams {
  standalone: boolean;
  articleOpenTrigger: number;
  articleCloseRequest: number;
  articleViewOverlayPhase: string;
  deckOpen: boolean;
  selectedArticleHash: string | null;
  articleToShowHash: string | null;
  articleDisplayMode: 'basic' | 'reader';
  isFeedLinkedArticle: boolean;
  readerLoading: boolean;
  articleBodyProcessing: boolean;
  clipboardLoading: boolean;
  articleResourceType: 'html' | 'pdf' | 'unsupported' | null;
  rawArticleBodyHtml: string;
}

const countTagOccurrences = (html: string, tagName: string): number => {
  if (!html) {
    return 0;
  }

  const matches = html.match(new RegExp(`<${tagName}\\b`, 'gi'));
  return matches?.length ?? 0;
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

export const useArticleViewPerformanceMetrics = ({
  standalone,
  articleOpenTrigger,
  articleCloseRequest,
  articleViewOverlayPhase,
  deckOpen,
  selectedArticleHash,
  articleToShowHash,
  articleDisplayMode,
  isFeedLinkedArticle,
  readerLoading,
  articleBodyProcessing,
  clipboardLoading,
  articleResourceType,
  rawArticleBodyHtml,
}: UseArticleViewPerformanceMetricsParams): {
  handleArticleViewProfilerRender: ProfilerOnRenderCallback;
} => {
  const latestRenderCommitRef = useRef<RenderCommitMetric | null>(null);
  const lastOpenTriggerRef = useRef(0);
  const lastCloseRequestRef = useRef(0);
  const activeClosingHashRef = useRef<string | null>(null);

  // Keep lag reports focused on concurrent work that could fight the article
  // deck animation: body preprocessing, reader fetch, clipboard fetch, and media density.
  const getArticleViewSnapshot = useCallback(() => {
    return {
      articleHash: articleToShowHash ?? selectedArticleHash,
      articleDisplayMode,
      articleViewOverlayPhase,
      deckOpen,
      isFeedLinkedArticle,
      readerLoading,
      articleBodyProcessing,
      clipboardLoading,
      articleResourceType,
      articleHtmlLength: rawArticleBodyHtml.length,
      articleImageCount: countTagOccurrences(rawArticleBodyHtml, 'img'),
      articleEmbedCount: countTagOccurrences(rawArticleBodyHtml, 'iframe'),
    };
  }, [
    articleBodyProcessing,
    articleDisplayMode,
    articleResourceType,
    articleToShowHash,
    articleViewOverlayPhase,
    clipboardLoading,
    deckOpen,
    isFeedLinkedArticle,
    rawArticleBodyHtml,
    readerLoading,
    selectedArticleHash,
  ]);

  const handleArticleViewProfilerRender = useCallback<ProfilerOnRenderCallback>((
    _id,
    phase,
    actualDuration,
    baseDuration,
    startTime,
    commitTime
  ) => {
    latestRenderCommitRef.current = createRenderCommitMetric(phase, actualDuration, baseDuration, startTime, commitTime);
  }, []);

  useDependencyEffect(() => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (standalone || !selectedArticleHash) {
      return;
    }
    if (articleOpenTrigger <= lastOpenTriggerRef.current) {
      return;
    }

    lastOpenTriggerRef.current = articleOpenTrigger;
    interactionPerformance.beginTimedInteraction('article-view-open', selectedArticleHash, {
      ...getArticleViewSnapshot(),
      requestedByTrigger: articleOpenTrigger,
    }, { exclusiveByKind: true });
  }, [articleOpenTrigger, getArticleViewSnapshot, selectedArticleHash, standalone]);

  // Finish the open sample only after the overlay reaches its fully open phase
  // so the metric reflects the real animation handoff the user sees.
  useDependencyEffect(() => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (standalone || articleViewOverlayPhase !== 'open' || !articleToShowHash) {
      return;
    }

    interactionPerformance.recordTimedInteractionCommit('article-view-open', articleToShowHash, latestRenderCommitRef.current);
    interactionPerformance.completeTimedInteraction('article-view-open', articleToShowHash, {
      summaryMessage: 'Article-view open performance sample',
      lagMessage: 'Article-view open lag detected',
      additionalContext: getArticleViewSnapshot(),
      isLagging: (summary) => {
        return summary.totalDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleViewOpen.totalLagMs
          || (summary.renderCommit?.actualDurationMs ?? 0) >= INTERACTION_PERFORMANCE_BUDGETS.articleViewOpen.renderCommitLagMs;
      },
    });
  }, [articleToShowHash, articleViewOverlayPhase, getArticleViewSnapshot, standalone]);

  useDependencyEffect(() => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (standalone) {
      return;
    }
    if (articleCloseRequest <= lastCloseRequestRef.current) {
      return;
    }

    lastCloseRequestRef.current = articleCloseRequest;
    const closingHash = articleToShowHash ?? selectedArticleHash;
    if (!closingHash) {
      return;
    }

    interactionPerformance.cancelTimedInteraction('article-view-open', closingHash, 'interrupted-by-close', getArticleViewSnapshot());
    interactionPerformance.beginTimedInteraction('article-view-close', closingHash, {
      ...getArticleViewSnapshot(),
      requestedByClose: articleCloseRequest,
    }, { exclusiveByKind: true });
    activeClosingHashRef.current = closingHash;
  }, [articleCloseRequest, articleToShowHash, getArticleViewSnapshot, selectedArticleHash, standalone]);

  useDependencyEffect(() => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (standalone || articleViewOverlayPhase !== 'closed' || !activeClosingHashRef.current) {
      return;
    }

    const closingHash = activeClosingHashRef.current;
    activeClosingHashRef.current = null;

    interactionPerformance.recordTimedInteractionCommit('article-view-close', closingHash, latestRenderCommitRef.current);
    interactionPerformance.completeTimedInteraction('article-view-close', closingHash, {
      summaryMessage: 'Article-view close performance sample',
      lagMessage: 'Article-view close lag detected',
      additionalContext: getArticleViewSnapshot(),
      isLagging: (summary) => {
        return summary.totalDurationMs >= INTERACTION_PERFORMANCE_BUDGETS.articleViewClose.totalLagMs
          || (summary.renderCommit?.actualDurationMs ?? 0) >= INTERACTION_PERFORMANCE_BUDGETS.articleViewClose.renderCommitLagMs;
      },
    });
  }, [articleViewOverlayPhase, getArticleViewSnapshot, standalone]);

  useUnmountEffect(() => {
    if (!isInteractionPerformanceEnabled) {
      return;
    }

    if (selectedArticleHash) {
      interactionPerformance.cancelTimedInteraction('article-view-open', selectedArticleHash, 'article-view-unmounted');
    }
    if (activeClosingHashRef.current) {
      interactionPerformance.cancelTimedInteraction('article-view-close', activeClosingHashRef.current, 'article-view-unmounted');
    }
  });

  return {
    handleArticleViewProfilerRender,
  };
};
