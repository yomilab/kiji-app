import React from 'react';
import { SHORTCUT_LABELS } from '@/services/shortcuts/shortcutService';
import { Keycaps, SettingsGroup } from '../settingsControls';

interface ShortcutGroup {
  id: string;
  title: string;
  items: ReadonlyArray<{ id: string; label: string; keys: string }>;
}

export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  {
    id: 'feeds',
    title: 'Feeds',
    items: [
      { id: 'add-feed', label: 'Add New Feed', keys: SHORTCUT_LABELS.ADD_FEED },
      { id: 'search', label: 'Search Articles', keys: SHORTCUT_LABELS.SEARCH_ARTICLES },
      { id: 'mark-all-read', label: 'Mark All as Read', keys: SHORTCUT_LABELS.MARK_ALL_READ },
      { id: 'feed-edit-view', label: 'Manage Feeds', keys: SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW },
    ],
  },
  {
    id: 'article',
    title: 'Article',
    items: [
      { id: 'toggle-feed-view-mode', label: 'Toggle Feed View Mode', keys: SHORTCUT_LABELS.TOGGLE_READER_MODE },
      { id: 'close-article', label: 'Close Article View', keys: SHORTCUT_LABELS.CLOSE_ARTICLE_VIEW },
      { id: 'toggle-read', label: 'Mark as Read/Unread', keys: SHORTCUT_LABELS.TOGGLE_READ },
      { id: 'page-down-next-unread', label: 'Next Page, Then Next Unread', keys: SHORTCUT_LABELS.PAGE_DOWN_OR_NEXT_UNREAD },
      { id: 'page-up', label: 'Previous Page', keys: SHORTCUT_LABELS.PAGE_UP },
      { id: 'save-article', label: 'Save/Unsave Article', keys: SHORTCUT_LABELS.SAVE_ARTICLE },
      { id: 'copy-article-url', label: 'Copy Article URL', keys: SHORTCUT_LABELS.COPY_ARTICLE_URL },
      { id: 'vim-scroll-top', label: 'Scroll to Top', keys: SHORTCUT_LABELS.VIM_SCROLL_TOP },
      { id: 'vim-scroll-bottom', label: 'Scroll to Bottom', keys: SHORTCUT_LABELS.VIM_SCROLL_BOTTOM },
      {
        id: 'vim-scroll-half',
        label: 'Scroll Half Page',
        keys: `${SHORTCUT_LABELS.VIM_SCROLL_HALF_DOWN} / ${SHORTCUT_LABELS.VIM_SCROLL_HALF_UP}`,
      },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    items: [
      { id: 'settings', label: 'Open Settings', keys: SHORTCUT_LABELS.OPEN_SETTINGS },
      { id: 'reset-settings', label: 'Reset All Settings', keys: SHORTCUT_LABELS.RESET_SETTINGS },
    ],
  },
];

export const ShortcutsPane: React.FC = () => (
  <div className="settings-section">
    {SHORTCUT_GROUPS.map((group) => (
      <SettingsGroup key={group.id} title={group.title} className="shortcuts-list">
        {group.items.map((shortcut) => (
          <div key={shortcut.id} className="settings-item shortcut-item">
            <span className="shortcut-label">{shortcut.label}</span>
            <Keycaps shortcut={shortcut.keys} />
          </div>
        ))}
      </SettingsGroup>
    ))}
  </div>
);
