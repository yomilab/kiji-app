import { describe, expect, it } from 'vitest';
import {
  LARGE_STATION_FEED_THRESHOLD,
  STATION_SWITCH_FOREGROUND_REFRESH_CAP,
  STATION_SWITCH_SQLITE_RECONCILE_LIMIT,
} from '@/services/feeds/stationSwitchLimits';

describe('stationSwitchLimits', () => {
  it('uses production-scale thresholds for large stations', () => {
    expect(LARGE_STATION_FEED_THRESHOLD).toBeGreaterThanOrEqual(15);
    expect(STATION_SWITCH_FOREGROUND_REFRESH_CAP).toBeGreaterThan(0);
    expect(STATION_SWITCH_FOREGROUND_REFRESH_CAP).toBeLessThan(LARGE_STATION_FEED_THRESHOLD);
    expect(STATION_SWITCH_SQLITE_RECONCILE_LIMIT).toBe(100);
  });
});
