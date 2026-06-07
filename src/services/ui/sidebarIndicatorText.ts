export type SidebarIndicatorAction =
  | 'syncing'
  | 'refreshing'
  | 'fetching'
  | 'importing'
  | 'exporting'
  | 'clearing'
  | 'parsing';

export type SidebarIndicatorSubject =
  | 'feeds'
  | 'articles'
  | 'saved'
  | 'favicons'
  | 'opml';

export interface SidebarIndicatorTextOptions {
  subject?: SidebarIndicatorSubject;
}

const LABELS: Record<
  SidebarIndicatorAction,
  { ongoing: string; done: string; failed: string }
> = {
  syncing: { ongoing: 'Syncing', done: 'Synced', failed: 'Sync failed' },
  refreshing: { ongoing: 'Refreshing', done: 'Refreshed', failed: 'Refresh failed' },
  fetching: { ongoing: 'Fetching', done: 'Fetched', failed: 'Fetch failed' },
  importing: { ongoing: 'Importing', done: 'Imported', failed: 'Import failed' },
  exporting: { ongoing: 'Exporting', done: 'Exported', failed: 'Export failed' },
  clearing: { ongoing: 'Clearing', done: 'Cleared', failed: 'Clear failed' },
  parsing: { ongoing: 'Parsing', done: 'Parsed', failed: 'Parse failed' },
};

const SUBJECT_LABELS: Record<SidebarIndicatorSubject, string> = {
  feeds: 'feeds',
  articles: 'articles',
  saved: 'saved',
  favicons: 'favicons',
  opml: 'OPML',
};

const FAILED_VERBS: Record<SidebarIndicatorAction, string> = {
  syncing: 'Sync',
  refreshing: 'Refresh',
  fetching: 'Fetch',
  importing: 'Import',
  exporting: 'Export',
  clearing: 'Clear',
  parsing: 'Parse',
};

const DEFAULT_SUBJECTS: Partial<Record<SidebarIndicatorAction, SidebarIndicatorSubject>> = {
  syncing: 'feeds',
  refreshing: 'feeds',
  fetching: 'favicons',
  importing: 'feeds',
  exporting: 'articles',
  parsing: 'opml',
};

export interface SidebarIndicatorProgress {
  completed: number;
  total: number;
}

function resolveSubject(
  action: SidebarIndicatorAction,
  subject?: SidebarIndicatorSubject,
): SidebarIndicatorSubject | undefined {
  return subject ?? DEFAULT_SUBJECTS[action];
}

function subjectLabel(
  action: SidebarIndicatorAction,
  subject?: SidebarIndicatorSubject,
): string | undefined {
  const resolved = resolveSubject(action, subject);
  return resolved ? SUBJECT_LABELS[resolved] : undefined;
}

function joinParts(parts: Array<string | undefined>): string {
  return parts.filter((part): part is string => Boolean(part)).join(' ');
}

export function sidebarIndicatorOngoing(
  action: SidebarIndicatorAction,
  progress?: SidebarIndicatorProgress | { count: number },
  options?: SidebarIndicatorTextOptions,
): string {
  const verb = LABELS[action].ongoing;
  const subject = subjectLabel(action, options?.subject);

  if (progress && 'total' in progress && progress.total > 1) {
    return joinParts([verb, `${progress.completed}/${progress.total}`, subject]);
  }

  if (progress && 'count' in progress) {
    return joinParts([verb, String(progress.count), subject]);
  }

  return joinParts([verb, subject]);
}

export function sidebarIndicatorDone(
  action: SidebarIndicatorAction,
  detail?: string | number,
  options?: SidebarIndicatorTextOptions,
): string {
  const base = LABELS[action].done;
  const subject = subjectLabel(action, options?.subject);

  if (detail === undefined || detail === '') {
    return joinParts([base, subject]);
  }

  return joinParts([base, String(detail), subject]);
}

export function sidebarIndicatorFailed(
  action: SidebarIndicatorAction,
  options?: SidebarIndicatorTextOptions,
): string {
  const subject = subjectLabel(action, options?.subject);
  if (subject) {
    return `${FAILED_VERBS[action]} ${subject} failed`;
  }

  return LABELS[action].failed;
}
