import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useFeedCollectionActions,
  useFeedNavigation,
  useFeedOverlay,
} from '@/contexts/FeedContext';
import { useTheme } from '@/contexts/ThemeContext';
import { logger } from '@/services/logger';
import {
  isOpenCommandPaletteShortcut,
  keybindingService,
  SHORTCUT_LABELS,
} from '@/services/shortcuts/shortcutService';
import { storage } from '@/services/storage/storageFactory';
import { publishAppMenuCommand } from '@/services/ui/appMenuCommandBus';
import { publishArticleViewCommand } from '@/services/ui/articleViewCommandBus';
import { openManageFeedsWindow } from '@/services/ui/openManageFeedsWindow';
import { openSettingsWindow } from '@/services/ui/openSettingsWindow';
import { CommandPalette } from './CommandPalette';
import { loadCommandPaletteCatalog, peekCommandPaletteCatalog } from './commandPaletteCatalog';
import {
  buildCommandPaletteEntries,
  COMMAND_PALETTE_RECENT_STORAGE_KEY,
  parseRecentCommandPaletteKeys,
  pushRecentCommandPaletteKey,
  type CommandPaletteActionSpec,
  type CommandPaletteCatalog,
  type CommandPaletteEntry,
} from './commandPaletteModel';

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName.toLowerCase();
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
};

const THEME_ACTIONS: CommandPaletteActionSpec[] = [
  { id: 'theme-auto', title: 'Theme: Automatic' },
  { id: 'theme-light', title: 'Theme: Light' },
  { id: 'theme-dark', title: 'Theme: Dark' },
];

/**
 * ⌘K / Ctrl+K quick switcher for the main window. Sources are picked through
 * the same navigation calls as a sidebar click; an open article closes first.
 */
export const CommandPaletteHost: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [catalog, setCatalog] = useState<CommandPaletteCatalog | null>(null);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  const isOpenRef = useRef(false);
  const recentLoadedRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const { selectFeed, selectTag, selectSmartView, selectedSmartView } = useFeedNavigation();
  const { articleViewOverlayPhase, isArticleClosing, requestCloseArticle } = useFeedOverlay();
  const { refreshFeed } = useFeedCollectionActions();
  const { theme, setTheme } = useTheme();

  const open = useCallback(() => {
    if (isOpenRef.current) return;
    isOpenRef.current = true;
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setCatalog(peekCommandPaletteCatalog());
    setIsOpen(true);

    void loadCommandPaletteCatalog().then((next) => {
      if (isOpenRef.current) setCatalog(next);
    }).catch((error: unknown) => {
      logger.warn('CommandPalette', 'Failed to load library for the palette', { error });
    });

    if (!recentLoadedRef.current) {
      recentLoadedRef.current = true;
      void storage.get(COMMAND_PALETTE_RECENT_STORAGE_KEY).then((raw) => {
        setRecentKeys((current) => (current.length > 0 ? current : parseRecentCommandPaletteKeys(raw)));
      }).catch(() => {});
    }
  }, []);

  const close = useCallback(() => {
    if (!isOpenRef.current) return;
    isOpenRef.current = false;
    setIsOpen(false);
    const previous = restoreFocusRef.current;
    restoreFocusRef.current = null;
    if (previous?.isConnected) {
      previous.focus({ preventScroll: true });
    }
  }, []);

  useEffect(() => keybindingService.register({
    type: 'keydown',
    capture: true,
    priority: 1500,
    isEnabled: () => !isOpenRef.current,
    handler: (event: KeyboardEvent) => {
      if (!isOpenCommandPaletteShortcut(event) || isEditableTarget(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    },
  }), [open]);

  // Unmount (window teardown) must not leave the ref claiming an open palette.
  useEffect(() => () => {
    isOpenRef.current = false;
  }, []);

  // The active hash outlives a close (row highlight), so the overlay phase decides.
  const articleOpen = articleViewOverlayPhase !== 'closed' && !isArticleClosing;
  const actions = useMemo<CommandPaletteActionSpec[]>(() => [
    { id: 'refresh', title: 'Refresh', shortcut: SHORTCUT_LABELS.REFRESH_FEED },
    { id: 'add-feed', title: 'Add Feed', shortcut: SHORTCUT_LABELS.ADD_FEED },
    { id: 'manage-feeds', title: 'Manage Feeds', shortcut: SHORTCUT_LABELS.OPEN_FEED_EDIT_VIEW },
    { id: 'settings', title: 'Settings', shortcut: SHORTCUT_LABELS.OPEN_SETTINGS },
    ...(articleOpen && selectedSmartView !== 'saved'
      ? [{ id: 'toggle-reader-mode' as const, title: 'Toggle Reader Mode', shortcut: SHORTCUT_LABELS.TOGGLE_READER_MODE }]
      : []),
    ...THEME_ACTIONS.filter((action) => action.id !== `theme-${theme}`),
  ], [articleOpen, selectedSmartView, theme]);

  const entries = useMemo(
    () => (catalog ? buildCommandPaletteEntries(catalog, actions) : buildCommandPaletteEntries({ feeds: [], stations: [], smartViews: [] }, actions)),
    [actions, catalog],
  );

  const handlePick = useCallback((entry: CommandPaletteEntry) => {
    setRecentKeys((current) => {
      const next = pushRecentCommandPaletteKey(current, entry.key);
      void storage.set(COMMAND_PALETTE_RECENT_STORAGE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
    close();

    const closeArticleForSource = () => {
      if (articleOpen) requestCloseArticle();
    };

    switch (entry.kind) {
      case 'smart':
        closeArticleForSource();
        void selectSmartView(entry.viewId);
        return;
      case 'station':
        closeArticleForSource();
        void selectTag(entry.name, {}, entry.feedIds);
        return;
      case 'feed':
        closeArticleForSource();
        // Same options as the sidebar row: unstationed rows force a network check.
        void selectFeed(
          entry.feed.id,
          entry.feed.url,
          entry.feed.title,
          entry.feed.tags.length === 0 ? { forceNetwork: true } : undefined,
        );
        return;
      case 'action':
        switch (entry.actionId) {
          case 'refresh':
            void refreshFeed();
            return;
          case 'add-feed':
            publishAppMenuCommand({ type: 'openAddSubscription' });
            return;
          case 'manage-feeds':
            void openManageFeedsWindow();
            return;
          case 'settings':
            void openSettingsWindow();
            return;
          case 'toggle-reader-mode':
            publishArticleViewCommand('toggleReaderMode');
            return;
          case 'theme-auto':
            setTheme('auto');
            return;
          case 'theme-light':
            setTheme('light');
            return;
          case 'theme-dark':
            setTheme('dark');
            return;
          default:
            return;
        }
      default:
        return;
    }
  }, [articleOpen, close, refreshFeed, requestCloseArticle, selectFeed, selectSmartView, selectTag, setTheme]);

  if (!isOpen) return null;

  return (
    <CommandPalette
      entries={entries}
      recentKeys={recentKeys}
      onPick={handlePick}
      onClose={close}
    />
  );
};
