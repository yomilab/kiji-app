import { sourceSelectionBus } from '@/services/feeds/sourceSelectionBus';
import type { SourceSelectionReadyPayload } from '@/services/feeds/sourceSelectionTypes';
import { sidebarSwitchTrace } from '@/services/performance/sidebarSwitchTrace';

/** Short settle window after the first paint frames before scheduling refresh. */
export const SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS = 48;
/** Wall-clock cap so a frozen rAF queue cannot block cold-switch SQLite for minutes. */
export const SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS = 500;
/** Collapse rapid station/feed hops into one refresh for the last source. */
export const SOURCE_SELECTION_REFRESH_DEBOUNCE_MS = 64;
export const SOURCE_SELECTION_MIN_REFRESH_DELAY_MS = (
  SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS
);

export interface ArticleListPaintGateOptions {
  isCancelled?: () => boolean;
}

let paintGateRafId: number | null = null;
let refreshDebounceTimerId: number | null = null;

export const cancelSourceSelectionRefreshSchedule = (): void => {
  if (paintGateRafId !== null) {
    window.cancelAnimationFrame(paintGateRafId);
    paintGateRafId = null;
  }

  if (refreshDebounceTimerId !== null) {
    window.clearTimeout(refreshDebounceTimerId);
    refreshDebounceTimerId = null;
  }
};

const waitForNextAnimationFrame = (): Promise<void> => (
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  })
);

const shouldAbortPaintGate = (
  isSelectionActive: (token: number) => boolean,
  token: number,
  options?: ArticleListPaintGateOptions,
): boolean => (
  options?.isCancelled?.() === true || !isSelectionActive(token)
);

const waitPaintGateBudget = (ms: number): Promise<void> => (
  new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    window.setTimeout(resolve, ms);
  })
);

export const waitForArticleListPaintGate = async (
  isSelectionActive: (token: number) => boolean,
  token: number,
  options?: ArticleListPaintGateOptions,
): Promise<boolean> => {
  const deadline = performance.now() + SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS;
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

  if (!hidden) {
    for (let frame = 0; frame < 2; frame += 1) {
      if (shouldAbortPaintGate(isSelectionActive, token, options)) {
        return false;
      }

      const remainingMs = deadline - performance.now();
      if (remainingMs <= 0) {
        break;
      }

      await Promise.race([
        waitForNextAnimationFrame(),
        waitPaintGateBudget(remainingMs),
      ]);

      if (shouldAbortPaintGate(isSelectionActive, token, options)) {
        return false;
      }
    }
  }

  if (shouldAbortPaintGate(isSelectionActive, token, options)) {
    return false;
  }

  const settleMs = Math.min(
    SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS,
    Math.max(0, deadline - performance.now()),
  );
  if (settleMs > 0) {
    await waitPaintGateBudget(settleMs);
  }

  return !shouldAbortPaintGate(isSelectionActive, token, options);
};

export const scheduleSourceRefreshAfterPaint = (
  payload: SourceSelectionReadyPayload,
  options: {
    isSelectionActive: (token: number) => boolean;
    onRefreshRequested: (payload: SourceSelectionReadyPayload) => void;
  },
): void => {
  cancelSourceSelectionRefreshSchedule();
  sourceSelectionBus.publishLocalReady(payload);
  sidebarSwitchTrace.mark(payload.token, 'paint-gate-scheduled');
  const paintGateStartedAt = performance.now();

  paintGateRafId = window.requestAnimationFrame(() => {
    paintGateRafId = null;

    void (async () => {
      const painted = await waitForArticleListPaintGate(options.isSelectionActive, payload.token);
      if (!painted) {
        sourceSelectionBus.publishRefreshAborted(
          payload.token,
          payload.sourceKey,
          'paint-gate-aborted',
        );
        return;
      }

      sidebarSwitchTrace.markDuration(
        payload.token,
        'paint-gate',
        performance.now() - paintGateStartedAt,
      );
      sidebarSwitchTrace.mark(payload.token, 'paint-gate-painted');

      refreshDebounceTimerId = window.setTimeout(() => {
        refreshDebounceTimerId = null;

        if (!options.isSelectionActive(payload.token)) {
          sourceSelectionBus.publishRefreshAborted(
            payload.token,
            payload.sourceKey,
            'debounce-aborted',
          );
          return;
        }

        sidebarSwitchTrace.mark(payload.token, 'refresh-debounced');
        sourceSelectionBus.publishRefreshRequested(payload);
        options.onRefreshRequested(payload);
      }, SOURCE_SELECTION_REFRESH_DEBOUNCE_MS);
    })();
  });
};

/** Test helper for fake-timer suites. */
export const advanceSourceSelectionRefreshSchedule = (
  advanceTimersByTime: (ms: number) => void,
): void => {
  advanceTimersByTime(0);
  advanceTimersByTime(0);
  advanceTimersByTime(SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS);
  advanceTimersByTime(SOURCE_SELECTION_REFRESH_DEBOUNCE_MS);
};
