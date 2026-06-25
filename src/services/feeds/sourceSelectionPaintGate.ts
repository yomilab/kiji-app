import { sourceSelectionBus } from '@/services/feeds/sourceSelectionBus';
import type { SourceSelectionReadyPayload } from '@/services/feeds/sourceSelectionTypes';
import { sidebarSwitchTrace } from '@/services/performance/sidebarSwitchTrace';

/** Short settle window after the first paint frames before scheduling refresh. */
export const SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS = 48;
/** Collapse rapid station/feed hops into one refresh for the last source. */
export const SOURCE_SELECTION_REFRESH_DEBOUNCE_MS = 64;
export const SOURCE_SELECTION_MIN_REFRESH_DELAY_MS = (
  SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS
);

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

export const waitForArticleListPaintGate = async (
  isSelectionActive: (token: number) => boolean,
  token: number,
): Promise<boolean> => {
  await waitForNextAnimationFrame();
  if (!isSelectionActive(token)) {
    return false;
  }

  await waitForNextAnimationFrame();
  if (!isSelectionActive(token)) {
    return false;
  }

  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS);
  });

  return isSelectionActive(token);
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
