import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { NotificationToast } from '@/components/common/NotificationToast';
import {
  FeedsGlyph,
  ImportExportGlyph,
  PlusGlyph,
  SidebarItemsGlyph,
  StationsGlyph,
} from '@/components/SettingsWindow/settingsIcons';
import { useSystemAccentColor } from '@/hooks/useSystemAccentColor';
import { useUserMessageChannel } from '@/hooks/useUserMessageChannel';
import { logger } from '@/services/logger';
import { isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import { createDeferredUnsubscribe } from '@/services/tauri/tauriEventSubscription';
import { APP_TOAST_CHANNEL, appToastService } from '@/services/ui/appToastService';
import {
  installFeedLibraryWindowBridge,
  MAIN_WINDOW_LABEL,
  MANAGE_FEEDS_WINDOW_LABEL,
} from '@/services/ui/feedLibraryWindowBridge';
import type { SmartViewId } from '@/constants';
import type { ManageFeedsTarget } from '@/types/manageFeeds';
import { FeedsPane } from './FeedsPane';
import { ImportExportPane, IMPORT_EXPORT_COPY, runInMainWindow } from './ImportExportPane';
import { LibraryPane } from './LibraryPane';
import { needsAttention, pluralize, type ManageFeedsTab } from './manageFeedsModel';
import { StationsPane } from './StationsPane';
import { useManageFeedsLibrary } from './useManageFeedsLibrary';
import '@/components/SettingsWindow/SettingsWindow.css';
import './ManageFeedsWindow.css';

export const MANAGE_FEEDS_WINDOW_OPEN_EVENT = 'manage-feeds-window:open';

export const MANAGE_FEEDS_TABS: ReadonlyArray<{ id: ManageFeedsTab; label: string; icon: React.ReactNode }> = [
  { id: 'feeds', label: 'Feeds', icon: <FeedsGlyph /> },
  { id: 'stations', label: 'Stations', icon: <StationsGlyph /> },
  { id: 'library', label: 'Library', icon: <SidebarItemsGlyph /> },
  { id: 'import-export', label: 'Import & Export', icon: <ImportExportGlyph /> },
];

const TAB_FOR_TARGET: Record<ManageFeedsTarget['kind'], ManageFeedsTab> = {
  feed: 'feeds',
  station: 'stations',
  'smart-view': 'library',
};

const handleWindowDragMouseDown = (event: React.MouseEvent<HTMLElement>) => {
  if (event.button !== 0) return;
  if (
    event.target instanceof Element
    && event.target.closest('button, a, input, textarea, select, option, [role="button"], [contenteditable="true"]') !== null
  ) {
    return;
  }
  event.preventDefault();
  const currentWindow = getCurrentWindow();
  void (event.detail === 2 ? currentWindow.toggleMaximize() : currentWindow.startDragging());
};

/**
 * Manage Feeds: a separate window for subscriptions, stations, sidebar Library items, and
 * import/export. It edits SQLite directly and keeps the main window in step through the
 * feed-library window bridge; the scheduler and article loading stay in the main window.
 */
export const ManageFeedsWindow: React.FC = () => {
  useSystemAccentColor();
  const library = useManageFeedsLibrary();
  const [activeTab, setActiveTab] = useState<ManageFeedsTab>('feeds');
  const [target, setTarget] = useState<ManageFeedsTarget | null>(null);
  const toastMessage = useUserMessageChannel(APP_TOAST_CHANNEL);

  useEffect(() => installFeedLibraryWindowBridge({
    selfLabel: MANAGE_FEEDS_WINDOW_LABEL,
    peerLabel: MAIN_WINDOW_LABEL,
  }), []);

  useEffect(() => {
    let active = true;
    const takeTarget = () => {
      void window.kijiAPI?.takeManageFeedsTarget?.()
        .then((next) => {
          if (!active || !next) return;
          setActiveTab(TAB_FOR_TARGET[next.kind] ?? 'feeds');
          setTarget(next);
        })
        .catch((error: unknown) => {
          logger.warn('ManageFeeds', 'Failed to read the row to reveal', { error });
        });
    };
    logger.info('ManageFeeds', 'Manage feeds window mounted');
    takeTarget();
    const unsubscribe = createDeferredUnsubscribe(listen(MANAGE_FEEDS_WINDOW_OPEN_EVENT, takeTarget));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const openAddFeed = useCallback(() => {
    void runInMainWindow({ type: 'openAddSubscription' }).then((ok) => {
      if (!ok) appToastService.show(IMPORT_EXPORT_COPY.mainWindowFailed);
    });
  }, []);

  useEffect(() => keybindingService.register({
    type: 'keydown',
    priority: 20,
    handler: (event: KeyboardEvent) => {
      if (isCloseOnEscapeShortcut(event)) {
        if (document.querySelector('.emoji-submenu, .mf-menu')) return;
        const target = event.target as HTMLElement | null;
        if (target && ['input', 'textarea', 'select'].includes(target.tagName.toLowerCase())) {
          target.blur();
          return;
        }
        void getCurrentWindow().close();
        return;
      }
      const primary = event.metaKey || event.ctrlKey;
      if (primary && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'n' && !document.querySelector('.modal-backdrop')) {
        event.preventDefault();
        openAddFeed();
        return;
      }
      if (primary && !event.altKey && !event.shiftKey && /^[1-4]$/.test(event.key) && !document.querySelector('.modal-backdrop')) {
        event.preventDefault();
        setActiveTab(MANAGE_FEEDS_TABS[Number(event.key) - 1].id);
      }
    },
  }), [openAddFeed]);

  const clearTarget = useCallback(() => setTarget(null), []);
  const attentionCount = useMemo(() => library.feeds.filter(needsAttention).length, [library.feeds]);

  const header = (() => {
    switch (activeTab) {
      case 'feeds':
        return {
          title: 'Feeds',
          subtitle: library.status === 'ready'
            ? `${pluralize(library.feeds.length, 'feed')}${attentionCount > 0 ? ` · ${attentionCount} can’t update` : ''}`
            : 'Your subscriptions',
        };
      case 'stations':
        return { title: 'Stations', subtitle: library.status === 'ready' ? `${pluralize(library.stations.length, 'station')}` : 'Groups of feeds' };
      case 'library':
        return {
          title: 'Library',
          subtitle: `${pluralize(library.libraryItems.length, 'view')} · ${library.libraryItems.filter((item) => item.visible).length} shown`,
        };
      case 'import-export':
      default:
        return { title: 'Import & Export', subtitle: 'Add, import and back up subscriptions' };
    }
  })();

  const activeLabel = MANAGE_FEEDS_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Feeds';

  // The window title follows the tab, like a macOS settings window (also shown in the
  // title strip, since the native title is hidden under the overlay title bar).
  useEffect(() => {
    void getCurrentWindow().setTitle(activeLabel).catch((error: unknown) => {
      logger.warn('ManageFeeds', 'Failed to set the window title', { error });
    });
  }, [activeLabel]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = MANAGE_FEEDS_TABS.findIndex((tab) => tab.id === activeTab);
    let next = index;
    if (event.key === 'ArrowRight') next = (index + 1) % MANAGE_FEEDS_TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + MANAGE_FEEDS_TABS.length) % MANAGE_FEEDS_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = MANAGE_FEEDS_TABS.length - 1;
    else return;
    event.preventDefault();
    const nextId = MANAGE_FEEDS_TABS[next].id;
    setActiveTab(nextId);
    document.getElementById(`mf-tab-${nextId}`)?.focus();
  };

  const renderPane = () => {
    switch (activeTab) {
      case 'feeds':
        return (
          <FeedsPane
            library={library}
            isActive
            revealFeedId={target?.kind === 'feed' ? target.id : null}
            onRevealHandled={clearTarget}
            onAddFeed={openAddFeed}
          />
        );
      case 'stations':
        return (
          <StationsPane
            library={library}
            revealStationName={target?.kind === 'station' ? target.id : null}
            onRevealHandled={clearTarget}
          />
        );
      case 'library':
        return (
          <LibraryPane
            library={library}
            revealItemId={target?.kind === 'smart-view' ? target.id as SmartViewId : null}
            onRevealHandled={clearTarget}
          />
        );
      case 'import-export':
      default:
        return <ImportExportPane feedCount={library.feeds.length} stationCount={library.stations.length} />;
    }
  };

  return (
    <div className="settings-window manage-feeds-window">
      <header className="mf-titlebar" onMouseDown={handleWindowDragMouseDown}>
        <div className="mf-window-title" aria-hidden="true">{activeLabel}</div>
        <div
          className="mf-toolbar-tabs"
          role="tablist"
          aria-label="Manage feeds"
          onKeyDown={handleTabKeyDown}
        >
          {MANAGE_FEEDS_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                id={`mf-tab-${tab.id}`}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-controls="mf-tabpanel"
                tabIndex={isActive ? 0 : -1}
                className={`mf-toolbar-tab${isActive ? ' is-active' : ''}`}
                data-tab={tab.id}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="mf-toolbar-tab-icon" aria-hidden="true">
                  {tab.icon}
                </span>
                <span className="mf-toolbar-tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      <main
        className="mf-main"
        id="mf-tabpanel"
        role="tabpanel"
        aria-labelledby={`mf-tab-${activeTab}`}
      >
        <div className="mf-pane" key={activeTab}>
          <div className="mf-pane-header">
            <p className="mf-pane-summary">{header.subtitle}</p>
            {activeTab === 'feeds' ? (
              <button type="button" className="settings-action-button settings-action-button-primary" onClick={openAddFeed}>
                <PlusGlyph />
                Add Feed…
              </button>
            ) : null}
          </div>
          {renderPane()}
        </div>
      </main>
      {toastMessage ? <NotificationToast message={toastMessage} role="alert" className="mf-toast" /> : null}
    </div>
  );
};
