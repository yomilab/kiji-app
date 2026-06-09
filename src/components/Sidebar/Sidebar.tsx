import React, { useState, useEffect, useRef, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FeedList } from './FeedList';
import { TagManager } from './TagManager';
import { SmartViews } from './SmartViews';
import { SidebarWidgets } from './SidebarWidgets';
import { BottomWidget } from './BottomWidget';
import { SectionTitle } from './SectionTitle';
import { settingsManager } from '@/services/settings';
import { useFeedNavigation, useFeedUI, useFeedCollection } from '@/contexts/FeedContext';
import { feedsManager } from '@/services/feeds/feedsManager';
import { isOpenAddFeedShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import { useFeedRefreshActivity } from '@/hooks/useFeedRefreshActivity';
import { useUserMessageChannel } from '@/hooks/useUserMessageChannel';
import { SIDEBAR_INDICATOR_CHANNEL } from '@/services/ui/sidebarIndicatorService';
import { sidebarIndicatorOngoing } from '@/services/ui/sidebarIndicatorText';
import './Sidebar.css';

const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 600;

export const formatFeedRefreshStatus = (
  displayFeedCount: number,
  isBackgroundFeedRefreshing: boolean,
): string => {
  if (isBackgroundFeedRefreshing) {
    return sidebarIndicatorOngoing('syncing', undefined, { subject: 'all' });
  }

  return sidebarIndicatorOngoing('refreshing', { count: Math.max(1, displayFeedCount) });
};

export const Sidebar: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [sidebarLibrary, setSidebarLibrary] = useState({ title: 'Library', visible: true });
  const [isDragging, setIsDragging] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [showSyncing, setShowSyncing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const syncStartTimeRef = useRef<number | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);
  const { articles } = useFeedCollection();
  const { selectedSmartView } = useFeedNavigation();
  const { totalFeeds, feedLibraryVersion } = useFeedUI();
  const {
    displayFeedCount,
    isAnyFeedRefreshing,
    isBackgroundFeedRefreshing,
  } = useFeedRefreshActivity();
  const sidebarIndicatorText = useUserMessageChannel(SIDEBAR_INDICATOR_CHANNEL);
  const exportProgressText = useUserMessageChannel('export-progress');

  const MIN_SYNC_DURATION = 500; // minimum syncing display time in ms

  // Handle syncing state with minimum display duration
  useEffect(() => {
    if (isAnyFeedRefreshing && totalFeeds > 0) {
      // Start syncing - record start time and show syncing immediately
      syncStartTimeRef.current = Date.now();
      setShowSyncing(true);

      // Clear any pending timeout
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
        syncTimeoutRef.current = null;
      }
    } else {
      // Syncing finished - ensure minimum display duration
      if (syncStartTimeRef.current) {
        const elapsed = Date.now() - syncStartTimeRef.current;
        const remaining = Math.max(0, MIN_SYNC_DURATION - elapsed);

        syncTimeoutRef.current = window.setTimeout(() => {
          setShowSyncing(false);
          syncStartTimeRef.current = null;
        }, remaining);
      } else {
        setShowSyncing(false);
      }
    }
  }, [isAnyFeedRefreshing, totalFeeds, feedLibraryVersion]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        window.clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  // Reload the displayed sync time when scheduler-driven library updates land,
  // even if no visible loading state changed during a background cycle.
  useEffect(() => {
    const loadLastSyncTime = async () => {
      try {
        // Don't load sync time if there are no feeds
        if (totalFeeds === 0) {
          setLastSyncTime(null);
          return;
        }

        const feeds = await feedsManager.getAllFeeds();
        if (feeds.length === 0) {
          setLastSyncTime(null);
          return;
        }
        // Get the most recent lastFetched time from all feeds
        const lastFetched = feeds
          .map((f) => f.lastFetched ? new Date(f.lastFetched) : null)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];

        // Only update if the time has actually changed to prevent blink
        setLastSyncTime((prevTime) => {
          if (!lastFetched && !prevTime) return null;
          if (!lastFetched || !prevTime) return lastFetched || null;
          if (lastFetched.getTime() === prevTime.getTime()) return prevTime;
          return lastFetched;
        });
      } catch (error) {
        console.error('Error loading last sync time:', error);
      }
    };

    loadLastSyncTime();
  }, [feedLibraryVersion, isAnyFeedRefreshing, totalFeeds]);

  // Keyboard shortcut: Cmd+N to open add feed modal
  useEffect(() => {
    return keybindingService.register({
      type: 'keydown',
      priority: 15,
      handler: (e: KeyboardEvent) => {
        if (isOpenAddFeedShortcut(e)) {
          e.preventDefault();
          setShowAddModal(true);
        }
      },
    });
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onAppMenuCommand) {
      return;
    }

    return window.electronAPI.onAppMenuCommand((command) => {
      if (command.type === 'openAddSubscription') {
        setShowAddModal(true);
      }
    });
  }, []);

  // Load sidebar width from settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [width, library] = await Promise.all([
          settingsManager.getSidebarWidth(),
          settingsManager.getSidebarLibrary(),
        ]);
        setSidebarWidth(width);
        setSidebarLibrary(library);
      } catch (error) {
        console.error('Error loading sidebar width from settings:', error);
      }
    };

    loadSettings();
  }, []);

  // Handle mouse move while dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!sidebarRef.current) return;

      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const newWidth = e.clientX - sidebarRect.left;

      // Constrain width between min and max
      const constrainedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      setSidebarWidth(constrainedWidth);
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      // Save width to settings when drag ends
      try {
        await settingsManager.setSidebarWidth(sidebarWidth);
      } catch (error) {
        console.error('Error saving sidebar width to settings:', error);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, sidebarWidth]);

  const handleOpenAddModal = () => {
    setShowAddModal(true);
  };

  const handleCloseAddModal = () => {
    setShowAddModal(false);
  };

  const handleBorderMouseDown = () => {
    setIsDragging(true);
  };

  const isInteractiveDragBlockTarget = (target: EventTarget | null): boolean =>
    target instanceof Element
    && target.closest(
      'button, a, input, textarea, select, option, [role="button"], [contenteditable="true"], .sidebar-resize-handle',
    ) !== null;

  const handleWindowDragMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (isInteractiveDragBlockTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const currentWindow = getCurrentWindow();
    void (event.detail === 2 ? currentWindow.toggleMaximize() : currentWindow.startDragging());
  };

  const formatSyncTime = (date: Date | null): string => {
    if (!date) return '';

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateAtMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());

    // Check if the date is today
    if (dateAtMidnight.getTime() === today.getTime()) {
      return `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
    }

    // Otherwise return the date
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Memoize the sync text to prevent flickering when switching feeds
  const syncText = useMemo(() => {
    if (sidebarIndicatorText) {
      return sidebarIndicatorText;
    }

    if (exportProgressText) {
      return exportProgressText;
    }

    if (isAnyFeedRefreshing) {
      return formatFeedRefreshStatus(displayFeedCount, isBackgroundFeedRefreshing);
    }

    // Show "syncing" if currently syncing
    if (showSyncing) {
      return sidebarIndicatorOngoing('syncing');
    }

    // No feeds at all
    if (totalFeeds === 0) {
      return 'No feeds';
    }

    // Show "No articles" only for Saved view when empty
    if (selectedSmartView === 'saved' && articles.length === 0) {
      return 'No articles';
    }

    // Default: show sync time
    return formatSyncTime(lastSyncTime);
  }, [
    articles.length,
    exportProgressText,
    displayFeedCount,
    isBackgroundFeedRefreshing,
    isAnyFeedRefreshing,
    lastSyncTime,
    selectedSmartView,
    showSyncing,
    sidebarIndicatorText,
    totalFeeds,
  ]);

  return (
    <aside
      ref={sidebarRef}
      className="sidebar p-0 u-h-100vh sidebar-bg is-flex is-flex-direction-column is-overflow-hidden has-border-right"
      style={{ width: `${sidebarWidth}px` }}
      data-section="sidebar"
      data-component="sidebar"
    >
      {/* Draggable border */}
      <div
        className={`sidebar-resize-handle ${isDragging ? 'is-dragging' : ''}`}
        onMouseDown={handleBorderMouseDown}
        data-action="resize-sidebar"
      />

      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div
          className="sidebar-top-chrome"
          onMouseDown={handleWindowDragMouseDown}
          data-component="sidebar-top-chrome"
        >
          {/* Widgets aligned with traffic lights */}
          <div
            className="sidebar-widgets-container"
            data-component="sidebar-top-widgets"
          >
            <SidebarWidgets onAddFeed={handleOpenAddModal} />
          </div>

          {/* Feeds title section */}
          <div
            className="sidebar-title-container"
            data-component="sidebar-title-section"
          >
            <h1 className="title m-0 theme-text-primary" data-section="app-title" data-component="app-title">Feeds</h1>
            <p
              className={`sync-indicator ${showSyncing && !sidebarIndicatorText && !exportProgressText && !isAnyFeedRefreshing ? 'is-syncing' : ''}`}
              data-component="sync-indicator"
            >
              {syncText}
            </p>
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="sidebar-content-scrollable" data-component="sidebar-nav">
          {sidebarLibrary.visible && (
            <>
              <SectionTitle title={sidebarLibrary.title} />
              <SmartViews />
            </>
          )}

          <SectionTitle title="Stations" />
          <TagManager />

          {sidebarLibrary.visible && (
            <FeedList
              showAddModal={showAddModal}
              onCloseAddModal={handleCloseAddModal}
            />
          )}
        </div>

        {/* Bottom widget fixed at bottom */}
        <BottomWidget data-component="sidebar-bottom-widgets" />
      </div>
    </aside>
  );
};
