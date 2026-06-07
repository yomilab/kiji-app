export type SidebarIndicatorAction =
  | 'syncing'
  | 'refreshing'
  | 'fetching'
  | 'importing'
  | 'exporting'
  | 'clearing'
  | 'parsing';

const LABELS: Record<
  SidebarIndicatorAction,
  { ongoing: string; done: string; failed: string }
> = {
  syncing: { ongoing: 'Syncing', done: 'Sync done', failed: 'Sync failed' },
  refreshing: { ongoing: 'Refreshing', done: 'Refresh done', failed: 'Refresh failed' },
  fetching: { ongoing: 'Fetching', done: 'Fetch done', failed: 'Fetch failed' },
  importing: { ongoing: 'Importing', done: 'Import done', failed: 'Import failed' },
  exporting: { ongoing: 'Exporting', done: 'Export done', failed: 'Export failed' },
  clearing: { ongoing: 'Clearing', done: 'Clear done', failed: 'Clear failed' },
  parsing: { ongoing: 'Parsing', done: 'Parse done', failed: 'Parse failed' },
};

export interface SidebarIndicatorProgress {
  completed: number;
  total: number;
}

export function sidebarIndicatorOngoing(
  action: SidebarIndicatorAction,
  progress?: SidebarIndicatorProgress | { count: number },
): string {
  const verb = LABELS[action].ongoing;

  if (progress && 'total' in progress && progress.total > 1) {
    return `${verb} ${progress.completed}/${progress.total}`;
  }

  if (progress && 'count' in progress) {
    return `${verb} ${progress.count}…`;
  }

  return `${verb}…`;
}

export function sidebarIndicatorDone(
  action: SidebarIndicatorAction,
  detail?: string | number,
): string {
  const base = LABELS[action].done;
  if (detail === undefined || detail === '') {
    return base;
  }

  return `${base} · ${detail}`;
}

export function sidebarIndicatorFailed(action: SidebarIndicatorAction): string {
  return LABELS[action].failed;
}
