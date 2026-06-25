/**
 * E2E performance budgets for station sidebar switches.
 * Keep in sync with SIDEBAR_SWITCH_E2E_BUDGETS_MS in sidebarSwitchTrace.ts.
 */
export const STATION_SWITCH_E2E_BUDGETS_MS = {
  coldInteractive: 450,
  warmInteractive: 400,
  harnessInteractive: 800,
  renderCommit: 80,
  sqliteQuery: 120,
  paintGate: 220,
  largeStationMinFeeds: 15,
};
