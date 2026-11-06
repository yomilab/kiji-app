import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceSelectionBus } from '@/services/feeds/sourceSelectionBus';
import type { FeedSourceRefreshPayload } from '@/services/feeds/sourceSelectionTypes';
import {
  SOURCE_SELECTION_MIN_REFRESH_DELAY_MS,
  SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS,
  SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS,
  SOURCE_SELECTION_REFRESH_DEBOUNCE_MS,
  advanceSourceSelectionRefreshSchedule,
  cancelSourceSelectionRefreshSchedule,
  scheduleSourceRefreshAfterPaint,
  waitForArticleListPaintGate,
} from '@/services/feeds/sourceSelectionPaintGate';
import {
  getRobustnessSnapshot,
  resetRobustnessMetricsForTests,
} from '@/services/diagnostics/robustnessMetrics';

const createFeedPayload = (token: number): FeedSourceRefreshPayload => ({
  kind: 'feed',
  token,
  sourceKey: 'feed:feed-a',
  intent: 'switch',
  refreshOptions: {},
  feedId: 'feed-a',
  feedQuery: {
    feedIds: ['feed-a'],
    limit: 100,
    sort: { field: 'publishedDate', order: 'desc' },
  },
});

describe('sourceSelectionPaintGate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    cancelSourceSelectionRefreshSchedule();
    resetRobustnessMetricsForTests();
  });

  afterEach(() => {
    cancelSourceSelectionRefreshSchedule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not start the refresh when cancelled while the paint gate is waiting', async () => {
    const onRefreshRequested = vi.fn();

    scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
      isSelectionActive: () => true,
      onRefreshRequested,
    });
    // Past the frame that starts the gate, so it is now waiting on its own timers.
    await vi.advanceTimersByTimeAsync(1);
    cancelSourceSelectionRefreshSchedule();
    await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS * 2);

    expect(onRefreshRequested).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('sets no refresh timer when the schedule is cancelled as the paint gate resolves', async () => {
    const onRefreshRequested = vi.fn();
    const aborted: string[] = [];
    const unsubscribe = sourceSelectionBus.subscribe((event) => {
      if (event.type === 'source-refresh-aborted') {
        aborted.push(event.payload.reason);
      }
    });
    let cancelOnNextCheck = false;

    scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
      isSelectionActive: () => {
        // The gate's last check passes, but the schedule is cancelled before
        // its continuation runs (as a test teardown or a new selection would).
        if (cancelOnNextCheck) {
          cancelOnNextCheck = false;
          cancelSourceSelectionRefreshSchedule();
        }
        return true;
      },
      onRefreshRequested,
    });
    await vi.advanceTimersByTimeAsync(1);
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    cancelOnNextCheck = true;
    await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS);

    expect(setTimeoutSpy).not.toHaveBeenCalledWith(
      expect.any(Function),
      SOURCE_SELECTION_REFRESH_DEBOUNCE_MS,
    );
    await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_REFRESH_DEBOUNCE_MS * 2);
    expect(onRefreshRequested).not.toHaveBeenCalled();
    // FeedContext still hears that this selection won't refresh.
    expect(aborted).toEqual(['paint-gate-aborted']);
    unsubscribe();
  });

  it('runs only the newest refresh when a second selection replaces a waiting one', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const aborted: number[] = [];
    const unsubscribe = sourceSelectionBus.subscribe((event) => {
      if (event.type === 'source-refresh-aborted') {
        aborted.push(event.payload.token);
      }
    });

    scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
      isSelectionActive: () => true,
      onRefreshRequested: first,
    });
    await vi.advanceTimersByTimeAsync(1);
    scheduleSourceRefreshAfterPaint(createFeedPayload(2), {
      isSelectionActive: () => true,
      onRefreshRequested: second,
    });
    await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS * 2);

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    // Listeners still hear that the replaced selection won't refresh.
    expect(aborted).toEqual([1]);
    unsubscribe();
  });

  it('publishes local-ready immediately and refresh-requested after paint gate + debounce', async () => {
    const events: string[] = [];
    const unsubscribe = sourceSelectionBus.subscribe((event) => {
      events.push(event.type);
    });
    const onRefreshRequested = vi.fn();
    const payload = createFeedPayload(1);

    scheduleSourceRefreshAfterPaint(payload, {
      isSelectionActive: () => true,
      onRefreshRequested,
    });

    expect(events).toEqual(['source-local-ready']);
    expect(onRefreshRequested).not.toHaveBeenCalled();

    await vi.runAllTimersAsync();

    expect(events).toEqual(['source-local-ready', 'source-refresh-requested']);
    expect(onRefreshRequested).toHaveBeenCalledWith(payload);
    const snapshot = getRobustnessSnapshot();
    expect(snapshot.counters['paintGate.fallbackStart']).toBeUndefined();
    expect(snapshot.durations['paintGate.waitMs']?.count).toBe(1);
    unsubscribe();
  });

  it('aborts scheduled refresh when selection token changes before debounce', async () => {
    const events: string[] = [];
    const unsubscribe = sourceSelectionBus.subscribe((event) => {
      events.push(event.type);
    });
    let activeToken = 1;
    const onRefreshRequested = vi.fn();

    scheduleSourceRefreshAfterPaint(createFeedPayload(activeToken), {
      isSelectionActive: (token) => token === activeToken,
      onRefreshRequested,
    });

    activeToken = 2;
    await vi.runAllTimersAsync();

    expect(events).toContain('source-refresh-aborted');
    expect(onRefreshRequested).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('cancels pending refresh work when selection changes', () => {
    const onRefreshRequested = vi.fn();

    scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
      isSelectionActive: () => true,
      onRefreshRequested,
    });

    cancelSourceSelectionRefreshSchedule();
    vi.advanceTimersByTime(
      SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS + 100,
    );

    expect(onRefreshRequested).not.toHaveBeenCalled();
  });

  it('keeps refresh delay bounded for switch navigation', () => {
    expect(SOURCE_SELECTION_MIN_REFRESH_DELAY_MS).toBe(
      SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS,
    );
    expect(SOURCE_SELECTION_MIN_REFRESH_DELAY_MS).toBeLessThan(200);
  });

  it('aborts paint gate wait when cancelled during rapid station hops', async () => {
    let cancelled = false;
    const painted = waitForArticleListPaintGate(() => true, 1, {
      isCancelled: () => cancelled,
    });

    cancelled = true;
    await vi.runAllTimersAsync();

    await expect(painted).resolves.toBe(false);
  });

  it('does not wait longer than the paint gate wall-clock budget when rAF stalls', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);

    const painted = waitForArticleListPaintGate(() => true, 1);
    await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS + 50);

    await expect(painted).resolves.toBe(true);
  });

  describe('when the window never paints (rAF suspended)', () => {
    const rafCallbacks: FrameRequestCallback[] = [];

    beforeEach(() => {
      rafCallbacks.length = 0;
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        rafCallbacks.push(callback);
        return rafCallbacks.length;
      });
    });

    it('still requests the network refresh after the wall-clock budget', async () => {
      const onRefreshRequested = vi.fn();
      const payload = createFeedPayload(1);

      scheduleSourceRefreshAfterPaint(payload, {
        isSelectionActive: () => true,
        onRefreshRequested,
      });

      await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS * 2 + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS);

      expect(onRefreshRequested).toHaveBeenCalledTimes(1);
      expect(onRefreshRequested).toHaveBeenCalledWith(payload);
      const snapshot = getRobustnessSnapshot();
      expect(snapshot.counters['paintGate.fallbackStart']).toBe(1);
      expect(snapshot.durations['paintGate.waitMs']?.count).toBe(1);
      expect(snapshot.durations['paintGate.waitMs']?.maxMs)
        .toBeGreaterThanOrEqual(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS);
    });

    it('starts the gate once when the frame arrives after the fallback fired', async () => {
      const onRefreshRequested = vi.fn();

      scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
        isSelectionActive: () => true,
        onRefreshRequested,
      });

      await vi.advanceTimersByTimeAsync(SOURCE_SELECTION_PAINT_GATE_MAX_WAIT_MS * 2 + SOURCE_SELECTION_REFRESH_DEBOUNCE_MS);
      // A late frame for the first scheduling must not start a second gate.
      rafCallbacks[0]?.(0);
      await vi.runAllTimersAsync();

      expect(onRefreshRequested).toHaveBeenCalledTimes(1);
      expect(getRobustnessSnapshot().counters['paintGate.fallbackStart']).toBe(1);
    });

    it('cancels the fallback when the selection schedule is cancelled', async () => {
      const onRefreshRequested = vi.fn();

      scheduleSourceRefreshAfterPaint(createFeedPayload(1), {
        isSelectionActive: () => true,
        onRefreshRequested,
      });
      cancelSourceSelectionRefreshSchedule();
      await vi.runAllTimersAsync();

      expect(onRefreshRequested).not.toHaveBeenCalled();
      expect(getRobustnessSnapshot().counters['paintGate.fallbackStart']).toBeUndefined();
      expect(getRobustnessSnapshot().durations['paintGate.waitMs']).toBeUndefined();
    });
  });
});
