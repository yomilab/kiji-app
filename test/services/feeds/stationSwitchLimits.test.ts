import { describe, expect, it, vi } from 'vitest';
import {
  LARGE_STATION_FEED_THRESHOLD,
  STATION_SWITCH_FOREGROUND_REFRESH_CAP,
  STATION_SWITCH_SQLITE_RECONCILE_LIMIT,
  scheduleStationSwitchIdleWork,
} from '@/services/feeds/stationSwitchLimits';

describe('stationSwitchLimits', () => {
  it('uses production-scale thresholds for large stations', () => {
    expect(LARGE_STATION_FEED_THRESHOLD).toBeGreaterThanOrEqual(15);
    expect(STATION_SWITCH_FOREGROUND_REFRESH_CAP).toBeGreaterThan(0);
    expect(STATION_SWITCH_FOREGROUND_REFRESH_CAP).toBeLessThan(LARGE_STATION_FEED_THRESHOLD);
    expect(STATION_SWITCH_SQLITE_RECONCILE_LIMIT).toBe(100);
  });

  it('cancels idle station-switch work before it runs', () => {
    vi.useFakeTimers();
    const work = vi.fn();
    const cancel = scheduleStationSwitchIdleWork(work);

    cancel();
    vi.runAllTimers();

    expect(work).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
