import React, { useState, useEffect, useRef, useCallback } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { FeedList } from './FeedList';
import { TagManager } from './TagManager';
import { SmartViews } from './SmartViews';
import { SidebarWidgets } from './SidebarWidgets';
import { BottomWidget } from './BottomWidget';
import { SectionTitle, type SidebarSectionId } from './SectionTitle';
import { settingsManager } from '@/services/settings';
import { useFeedUI } from '@/contexts/FeedContext';
import { feedsManager } from '@/services/feeds/feedsManager';
import { isOpenAddFeedShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import { useFeedRefreshActivity } from '@/hooks/useFeedRefreshActivity';
import { isInteractiveStationRefreshInProgress } from '@/services/feeds/feedRefreshActivity';
import { useUserMessageChannel } from '@/hooks/useUserMessageChannel';
import { SIDEBAR_INDICATOR_CHANNEL } from '@/services/ui/sidebarIndicatorService';
import { beginLayoutColumnResize, endLayoutColumnResize } from '@/services/ui/layoutColumnResize';
import { resolveHoveredSidebarSection } from './sidebarSectionHover';
import { SidebarSyncIndicator } from './SidebarSyncIndicator';
import './Sidebar.css';

const MIN_SIDEBAR_WIDTH = 250;
const MAX_SIDEBAR_WIDTH = 600;

const SidebarSection: React.FC<{
  sectionId: SidebarSectionId;
  expanded: boolean;
  pointerInside: boolean;
  children: React.ReactNode;
}> = ({ sectionId, expanded, pointerInside, children }) => {
  return (
    <div
      className={`sidebar-section${expanded ? ' is-expanded' : ''}${pointerInside ? ' is-pointer-inside' : ''}`}
      data-component="sidebar-section"
      data-section={sectionId}
      data-pointer-inside={pointerInside ? 'true' : 'false'}
    >
      {children}
    </div>
  );
};

export { formatFeedRefreshStatus, type FeedRefreshStatusInput } from './SidebarSyncIndicator';

export const Sidebar: React.FC = () => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [sidebarLibrary, setSidebarLibrary] = useState({ title: 'Library', visible: true });
  const [libraryExpanded, setLibraryExpanded] = useState(true);
  const [stationsExpanded, setStationsExpanded] = useState(true);
  const [hoveredSection, setHoveredSection] = useState<SidebarSectionId | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const [showSyncing, setShowSyncing] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const syncStartTimeRef = useRef<number | null>(null);
  const syncTimeoutRef = useRef<number | null>(null);
  const { totalFeeds, feedLibraryVersion } = useFeedUI();
  const refreshActivity = useFeedRefreshActivity();
  const {
    displayFeedCount,
    isAnyFeedRefreshing,
    isBackgroundFeedRefreshing,
    interactiveRefreshScopeTotal,
    interactiveRefreshCompleted,
  } = refreshActivity;
  const stationRefreshInProgress = isInteractiveStationRefreshInProgress(refreshActivity);
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
  }, [feedLibraryVersion, totalFeeds]);

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
    if (!window.kijiAPI?.onAppMenuCommand) {
      return;
    }

    return window.kijiAPI.onAppMenuCommand((command) => {
      if (command.type === 'openAddSubscription') {
        setShowAddModal(true);
      }
    });
  }, []);

  // Load sidebar width / library / section fold from settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const [width, library, sectionFold] = await Promise.all([
          settingsManager.getSidebarWidth(),
          settingsManager.getSidebarLibrary(),
          settingsManager.getSidebarSectionFold(),
        ]);
        setSidebarWidth(width);
        setSidebarLibrary(library);
        setLibraryExpanded(sectionFold.libraryExpanded);
        setStationsExpanded(sectionFold.stationsExpanded);
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
      e.preventDefault();
      if (!sidebarRef.current) return;

      const sidebarRect = sidebarRef.current.getBoundingClientRect();
      const newWidth = e.clientX - sidebarRect.left;

      // Constrain width between min and max
      const constrainedWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, newWidth));
      setSidebarWidth(constrainedWidth);
    };

    const handleMouseUp = async () => {
      setIsDragging(false);
      endLayoutColumnResize('sidebar');
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

  useEffect(() => {
    return () => {
      endLayoutColumnResize('sidebar');
    };
  }, []);

  const handleBorderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!beginLayoutColumnResize(event, 'sidebar')) {
      return;
    }
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

  const syncHoveredSection = useCallback((clientX: number, clientY: number) => {
    lastPointerRef.current = { x: clientX, y: clientY };
    const next = resolveHoveredSidebarSection(clientX, clientY);
    setHoveredSection((current) => (current === next ? current : next));
  }, []);

  const scheduleHoveredSectionSync = useCallback(() => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const point = lastPointerRef.current;
        if (!point) {
          setHoveredSection(null);
          return;
        }
        syncHoveredSection(point.x, point.y);
      });
    });
  }, [syncHoveredSection]);

  const handleNavPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    syncHoveredSection(event.clientX, event.clientY);
  };

  const handleNavPointerLeave = (event: React.PointerEvent<HTMLDivElement>) => {
    const related = event.relatedTarget;
    if (related instanceof Node && event.currentTarget.contains(related)) {
      return;
    }
    lastPointerRef.current = null;
    setHoveredSection(null);
  };

  const handleNavTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.propertyName !== 'grid-template-rows' && event.propertyName !== 'flex-grow') {
      return;
    }
    const point = lastPointerRef.current;
    if (!point) {
      setHoveredSection(null);
      return;
    }
    syncHoveredSection(point.x, point.y);
  };

  const handleToggleLibrary = (point: { x: number; y: number }) => {
    lastPointerRef.current = point;
    setLibraryExpanded((current) => {
      const next = !current;
      void settingsManager.setSidebarSectionFold({ libraryExpanded: next }).catch((error) => {
        console.error('Error saving library section fold:', error);
      });
      return next;
    });
    scheduleHoveredSectionSync();
  };

  const handleToggleStations = (point: { x: number; y: number }) => {
    lastPointerRef.current = point;
    setStationsExpanded((current) => {
      const next = !current;
      void settingsManager.setSidebarSectionFold({ stationsExpanded: next }).catch((error) => {
        console.error('Error saving stations section fold:', error);
      });
      return next;
    });
    scheduleHoveredSectionSync();
  };

  return (
    <aside
      ref={sidebarRef}
      className="sidebar p-0 u-h-100 sidebar-bg is-flex is-flex-direction-column is-overflow-hidden has-border-right"
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

      <div className="sidebar-body">
        <div
          className="sidebar-top-chrome"
          onMouseDown={handleWindowDragMouseDown}
          data-component="sidebar-top-chrome"
        >
          {/* Widgets aligned with traffic lights. The Feeds title was removed so
              this chrome is only the overlay drag region + refresh/add actions. */}
          <div
            className="sidebar-widgets-container"
            data-component="sidebar-top-widgets"
          >
            <SidebarWidgets onAddFeed={handleOpenAddModal} />
          </div>
        </div>

        {/* Library chrome stays put. Stations, nested station feeds, and
            unstationed feeds share one scroller down to Settings. */}
        <div
          className="sidebar-content"
          data-component="sidebar-nav"
          onPointerMove={handleNavPointerMove}
          onPointerLeave={handleNavPointerLeave}
          onTransitionEnd={handleNavTransitionEnd}
        >
          {sidebarLibrary.visible && (
            <SidebarSection
              sectionId="library"
              expanded={libraryExpanded}
              pointerInside={hoveredSection === 'library'}
            >
              <SectionTitle
                title={sidebarLibrary.title}
                sectionId="library"
                expanded={libraryExpanded}
                onToggle={handleToggleLibrary}
              />
              <div
                className={`sidebar-section-body${libraryExpanded ? ' is-expanded' : ''}`}
                data-component="sidebar-section-body"
                data-section="library"
              >
                <div className="sidebar-section-body-clip">
                  <SmartViews />
                </div>
              </div>
            </SidebarSection>
          )}

          <SidebarSection
            sectionId="stations"
            expanded={stationsExpanded}
            pointerInside={hoveredSection === 'stations'}
          >
            <SectionTitle
              title="Stations"
              sectionId="stations"
              expanded={stationsExpanded}
              onToggle={handleToggleStations}
            />
            <div
              className={`sidebar-section-body${stationsExpanded ? ' is-expanded' : ''}`}
              data-component="sidebar-section-body"
              data-section="stations"
            >
              <div className="sidebar-section-body-clip">
                <div
                  className="sidebar-nav-body sidebar-scroll-region"
                  data-component="sidebar-nav-body"
                >
                  <TagManager />

                  {sidebarLibrary.visible && (
                    <FeedList
                      showAddModal={showAddModal}
                      onCloseAddModal={handleCloseAddModal}
                    />
                  )}
                </div>
              </div>
            </div>
          </SidebarSection>
        </div>

        {/* Settings stack + independent SyncIndicator share this bottom row. */}
        <BottomWidget>
          <SidebarSyncIndicator
            sidebarIndicatorText={sidebarIndicatorText}
            exportProgressText={exportProgressText}
            displayFeedCount={displayFeedCount}
            isBackgroundFeedRefreshing={isBackgroundFeedRefreshing}
            interactiveRefreshScopeTotal={interactiveRefreshScopeTotal}
            interactiveRefreshCompleted={interactiveRefreshCompleted}
            isAnyFeedRefreshing={isAnyFeedRefreshing}
            stationRefreshInProgress={stationRefreshInProgress}
            showSyncing={showSyncing}
            totalFeeds={totalFeeds}
            lastSyncTime={lastSyncTime}
          />
        </BottomWidget>
      </div>
    </aside>
  );
};
