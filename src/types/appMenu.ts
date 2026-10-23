import type { SmartViewId } from '@/constants';
import type { Theme } from '@/services/settings';

/** Library views with an app menu item (Today is sidebar-only for now). */
export type AppMenuLibraryView = Exclude<SmartViewId, 'today'>;

export const toAppMenuLibraryView = (view: string | null | undefined): AppMenuLibraryView | null => (
  view === 'saved' || view === 'unread' || view === 'all' || view === 'read' ? view : null
);

export type AppMenuCommand =
  | { type: 'openAddSubscription' }
  | { type: 'importFeeds' }
  | { type: 'checkUpdates' }
  | { type: 'exportFeeds' }
  | { type: 'exportSavedArticles' }
  | { type: 'clearFeeds' }
  | { type: 'clearSavedArticles' }
  | { type: 'clearArticles' }
  | { type: 'clearArticlesOlderThan'; months: 3 }
  | { type: 'setTheme'; theme: Theme }
  | { type: 'selectLibraryView'; libraryView: AppMenuLibraryView }
  /** Article text size; `window` names the window it is for (absent = the window that receives it). */
  | { type: 'readerTextSize'; action: 'bigger' | 'smaller' | 'reset'; window?: 'main' | 'article' };

export interface AppMenuState {
  theme: Theme;
  libraryView: AppMenuLibraryView | null;
  /** When true, Check for Updates becomes Update KiJi Reader. */
  updateAvailable?: boolean;
}
