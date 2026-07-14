import type { SmartViewId } from '@/constants';
import type { Theme } from '@/services/settings';

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
  | { type: 'selectLibraryView'; libraryView: SmartViewId };

export interface AppMenuState {
  theme: Theme;
  libraryView: SmartViewId | null;
  /** When true, Check for Updates becomes Update KiJi. */
  updateAvailable?: boolean;
}
