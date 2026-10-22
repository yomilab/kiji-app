import { APP_MENU_NAME, APP_OFFICIAL_NAME } from '@/config/appIdentity';
import type { AppMenuCommand, AppMenuState } from '@/types/appMenu';

export type AppMenuLocalAction =
  | { type: 'openSettings' }
  | { type: 'openManageFeeds' }
  | { type: 'about' }
  | { type: 'quit' }
  | { type: 'helpSupport' }
  | { type: 'helpWebsite' };

export type AppMenuAction = AppMenuCommand | AppMenuLocalAction;

export type AppMenuItem =
  | { kind: 'separator'; id: string }
  | {
      kind: 'item';
      id: string;
      label: string;
      action: AppMenuAction;
      checked?: boolean;
      disabled?: boolean;
      shortcutHint?: string;
    }
  | {
      kind: 'submenu';
      id: string;
      label: string;
      children: AppMenuItem[];
    };

export interface AppMenuTopLevel {
  id: string;
  label: string;
  accessKey: string;
  items: AppMenuItem[];
}

/** Windows/Linux in-app menu tree (macOS uses the native system menu bar). */
export function buildWindowsAppMenuTree(state: AppMenuState): AppMenuTopLevel[] {
  const theme = state.theme;
  const libraryView = state.libraryView;
  // Saved has no read state and Read is already read (same rule as the native menu).
  const markReadDisabled = libraryView === 'saved' || libraryView === 'read';

  return [
    {
      id: 'kiji',
      label: APP_MENU_NAME,
      accessKey: 'k',
      items: [
        {
          kind: 'item',
          id: 'about',
          label: `About ${APP_OFFICIAL_NAME}`,
          action: { type: 'about' },
        },
        {
          kind: 'item',
          id: 'check-updates',
          label: state.updateAvailable ? `Update ${APP_OFFICIAL_NAME}` : 'Check for Updates',
          action: { type: 'checkUpdates' },
        },
        { kind: 'separator', id: 'kiji-sep-app' },
        {
          kind: 'item',
          id: 'settings',
          label: 'Settings...',
          action: { type: 'openSettings' },
          shortcutHint: 'Ctrl+,',
        },
        { kind: 'separator', id: 'kiji-sep-quit' },
        {
          kind: 'item',
          id: 'quit',
          label: `Quit ${APP_MENU_NAME}`,
          action: { type: 'quit' },
        },
      ],
    },
    {
      id: 'file',
      label: 'File',
      accessKey: 'f',
      items: [
        {
          kind: 'item',
          id: 'export-feeds',
          label: 'Export Feeds',
          action: { type: 'exportFeeds' },
        },
        {
          kind: 'item',
          id: 'export-saved',
          label: 'Export Saved Articles',
          action: { type: 'exportSavedArticles' },
        },
        { kind: 'separator', id: 'file-sep-1' },
        {
          kind: 'item',
          id: 'clear-feeds',
          label: 'Clear Feeds',
          action: { type: 'clearFeeds' },
        },
        {
          kind: 'item',
          id: 'clear-saved',
          label: 'Clear Saved Articles',
          action: { type: 'clearSavedArticles' },
        },
        {
          kind: 'item',
          id: 'clear-old-3m',
          label: 'Clear Articles Older Than 3 Months',
          action: { type: 'clearArticlesOlderThan', months: 3 },
        },
        {
          kind: 'item',
          id: 'clear-all-articles',
          label: 'Clear All Articles',
          action: { type: 'clearArticles' },
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      accessKey: 'v',
      items: [
        {
          kind: 'submenu',
          id: 'theme',
          label: 'Theme',
          children: [
            {
              kind: 'item',
              id: 'theme-auto',
              label: 'Automatic',
              action: { type: 'setTheme', theme: 'auto' },
              checked: theme === 'auto',
            },
            {
              kind: 'item',
              id: 'theme-light',
              label: 'Light',
              action: { type: 'setTheme', theme: 'light' },
              checked: theme === 'light',
            },
            {
              kind: 'item',
              id: 'theme-dark',
              label: 'Dark',
              action: { type: 'setTheme', theme: 'dark' },
              checked: theme === 'dark',
            },
          ],
        },
        {
          kind: 'submenu',
          id: 'library',
          label: 'Library',
          children: [
            {
              kind: 'item',
              id: 'library-saved',
              label: 'Saved',
              action: { type: 'selectLibraryView', libraryView: 'saved' },
              checked: libraryView === 'saved',
            },
            {
              kind: 'item',
              id: 'library-unread',
              label: 'Unread',
              action: { type: 'selectLibraryView', libraryView: 'unread' },
              checked: libraryView === 'unread',
            },
            {
              kind: 'item',
              id: 'library-all',
              label: 'All Items',
              action: { type: 'selectLibraryView', libraryView: 'all' },
              checked: libraryView === 'all',
            },
            {
              kind: 'item',
              id: 'library-read',
              label: 'Read',
              action: { type: 'selectLibraryView', libraryView: 'read' },
              checked: libraryView === 'read',
            },
          ],
        },
      ],
    },
    {
      id: 'article',
      label: 'Article',
      accessKey: 'a',
      items: [
        {
          kind: 'item',
          id: 'mark-all-read',
          label: 'Mark All as Read',
          action: { type: 'markAllRead' },
          disabled: markReadDisabled,
          shortcutHint: 'Ctrl+Shift+K',
        },
        { kind: 'separator', id: 'article-sep-older' },
        {
          kind: 'item',
          id: 'mark-older-day-read',
          label: 'Mark Older Than a Day as Read',
          action: { type: 'markAllRead', olderThanDays: 1 },
          disabled: markReadDisabled,
        },
        {
          kind: 'item',
          id: 'mark-older-week-read',
          label: 'Mark Older Than a Week as Read',
          action: { type: 'markAllRead', olderThanDays: 7 },
          disabled: markReadDisabled,
        },
      ],
    },
    {
      id: 'subscriptions',
      label: 'Subscriptions',
      accessKey: 's',
      items: [
        {
          kind: 'item',
          id: 'add-subscription',
          label: 'Add Subscription',
          action: { type: 'openAddSubscription' },
          shortcutHint: 'Ctrl+N',
        },
        {
          kind: 'item',
          id: 'import-feeds',
          label: 'Import Feeds',
          action: { type: 'importFeeds' },
        },
        { kind: 'separator', id: 'subscriptions-sep-manage' },
        {
          kind: 'item',
          id: 'manage-feeds',
          label: 'Manage Feeds...',
          action: { type: 'openManageFeeds' },
          shortcutHint: 'Ctrl+E',
        },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      accessKey: 'h',
      items: [
        {
          kind: 'item',
          id: 'help-support',
          label: 'Support',
          action: { type: 'helpSupport' },
        },
        {
          kind: 'item',
          id: 'help-website',
          label: 'Visit Our Website',
          action: { type: 'helpWebsite' },
        },
      ],
    },
  ];
}

export function isInAppMenuBarOs(os: string | null | undefined): boolean {
  return os === 'windows' || os === 'linux' || os === 'other';
}

export function readDocumentOs(): string {
  if (typeof document === 'undefined') {
    return 'macos';
  }
  return document.documentElement.getAttribute('data-os') ?? 'macos';
}
