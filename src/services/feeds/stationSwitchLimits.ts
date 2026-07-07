/** Stations at or above this feed count use the non-blocking cold-switch path. */
export const LARGE_STATION_FEED_THRESHOLD = 15;

/** Max feeds refreshed in foreground during a station switch (Phase B). */
export const STATION_SWITCH_FOREGROUND_REFRESH_CAP = 6;

/** Cap sqlite reconcile query size so warm switches do not scan hundreds of rows. */
export const STATION_SWITCH_SQLITE_RECONCILE_LIMIT = 100;

export type StationSwitchIdleCancel = () => void;

export const scheduleStationSwitchIdleWork = (work: () => void): StationSwitchIdleCancel => {
  let cancelled = false;
  const run = (): void => {
    if (cancelled) {
      return;
    }
    work();
  };

  if (typeof requestIdleCallback !== 'undefined') {
    const idleId = requestIdleCallback(run, { timeout: 2_000 });
    return () => {
      cancelled = true;
      cancelIdleCallback(idleId);
    };
  }

  const timerId = window.setTimeout(run, 1);
  return () => {
    cancelled = true;
    window.clearTimeout(timerId);
  };
};
