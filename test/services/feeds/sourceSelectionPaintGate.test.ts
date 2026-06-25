import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceSelectionBus } from '@/services/feeds/sourceSelectionBus';
import type { FeedSourceRefreshPayload } from '@/services/feeds/sourceSelectionTypes';
import {
  SOURCE_SELECTION_MIN_REFRESH_DELAY_MS,
  SOURCE_SELECTION_PAINT_GATE_TIMEOUT_MS,
  SOURCE_SELECTION_REFRESH_DEBOUNCE_MS,
  advanceSourceSelectionRefreshSchedule,
  cancelSourceSelectionRefreshSchedule,
  scheduleSourceRefreshAfterPaint,
} from '@/services/feeds/sourceSelectionPaintGate';

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
  });

  afterEach(() => {
    cancelSourceSelectionRefreshSchedule();
    vi.unstubAllGlobals();
    vi.useRealTimers();
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
});
