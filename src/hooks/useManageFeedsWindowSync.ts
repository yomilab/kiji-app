import { useEffect, useRef } from 'react';
import { emitTo } from '@tauri-apps/api/event';
import {
  useFeedCollectionActions,
  useFeedNavigation,
  useFeedOverlay,
  useFeedUIActions,
} from '@/contexts/FeedContext';
import { logger } from '@/services/logger';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { installFeedHealthSync } from '@/services/feeds/feedHealthSync';
import type { FeedLibraryMutationMessage } from '@/services/ui/feedLibraryMutationBus';
import {
  FEED_LIBRARY_STATUS_CHANGED_EVENT,
  installFeedLibraryWindowBridge,
  MAIN_WINDOW_LABEL,
  MANAGE_FEEDS_WINDOW_LABEL,
} from '@/services/ui/feedLibraryWindowBridge';

/** Coalesce a burst of edits (bulk delete, drag reorder) into one list reload. */
export const MANAGE_FEEDS_LIST_RELOAD_DELAY_MS = 150;

const RELOAD_KINDS = new Set<FeedLibraryMutationMessage['kind']>([
  'feedDeleted',
  'stationDeleted',
  'stationPatched',
  'feedPatched',
]);

/** Feed edits that change what article rows show (feed name, icon, which feed). */
const affectsVisibleRows = (message: FeedLibraryMutationMessage): boolean => {
  if (!RELOAD_KINDS.has(message.kind)) {
    return false;
  }
  if (message.kind === 'feedPatched') {
    const { changes } = message;
    return changes.title !== undefined || changes.emoji !== undefined || changes.url !== undefined;
  }
  if (message.kind === 'stationPatched') {
    return message.station.feedIds !== undefined || message.previousName !== message.station.name;
  }
  return true;
};

/**
 * Main window side of the Manage Feeds bridge. Library edits made in that window land on this
 * window's bus (sidebar rows, caches); this hook also keeps navigation and the article list
 * honest: a deleted selected feed clears the selection, a renamed selected station follows its
 * new name, and edits that change visible rows reload the active source once (deferred while an
 * article is open, so the overlay never loses its row mid-read).
 */
export function useManageFeedsWindowSync(): void {
  const { selectedFeedId, selectedTag, selectedSmartView, clearFeedSelection, selectTag } = useFeedNavigation();
  const { reloadCurrentSourceFromStore } = useFeedCollectionActions();
  const { refreshTotalFeeds } = useFeedUIActions();
  const { articleViewOverlayPhase } = useFeedOverlay();

  const latestRef = useRef({
    selectedFeedId,
    selectedTag,
    selectedSmartView,
    clearFeedSelection,
    selectTag,
    reloadCurrentSourceFromStore,
    refreshTotalFeeds,
    articleViewOverlayPhase,
  });
  latestRef.current = {
    selectedFeedId,
    selectedTag,
    selectedSmartView,
    clearFeedSelection,
    selectTag,
    reloadCurrentSourceFromStore,
    refreshTotalFeeds,
    articleViewOverlayPhase,
  };

  const pendingReloadRef = useRef(false);
  const reloadTimerRef = useRef<number | null>(null);
  const flushReloadRef = useRef<() => void>(() => {});

  flushReloadRef.current = () => {
    const latest = latestRef.current;
    if (!pendingReloadRef.current) {
      return;
    }
    if (latest.articleViewOverlayPhase !== 'closed') {
      // Retried by the overlay-closed effect below.
      return;
    }
    pendingReloadRef.current = false;
    if (latest.selectedSmartView === 'saved') {
      // Saved rows outlive their feeds; nothing on screen depends on the library.
      return;
    }
    void latest.reloadCurrentSourceFromStore().catch((error: unknown) => {
      logger.warn('ManageFeedsSync', 'Failed to reload the article list after a library change', { error });
      // Re-stash for the next event-driven trigger (next library change or overlay close).
      pendingReloadRef.current = true;
    });
  };

  useEffect(() => {
    const scheduleReload = () => {
      pendingReloadRef.current = true;
      if (reloadTimerRef.current !== null) {
        return;
      }
      reloadTimerRef.current = window.setTimeout(() => {
        reloadTimerRef.current = null;
        flushReloadRef.current();
      }, MANAGE_FEEDS_LIST_RELOAD_DELAY_MS);
    };

    const handleRemoteMutation = (message: FeedLibraryMutationMessage) => {
      const latest = latestRef.current;

      if (message.kind === 'feedDeleted') {
        void latest.refreshTotalFeeds().catch((error: unknown) => {
          logger.warn('ManageFeedsSync', 'Failed to refresh the feed total after a delete', { error });
        });
        if (latest.selectedFeedId === message.feedId) {
          latest.clearFeedSelection();
          return;
        }
      }

      if (
        message.kind === 'stationPatched'
        && latest.selectedTag === message.previousName
        && message.station.name !== message.previousName
      ) {
        void latest.selectTag(message.station.name).catch((error: unknown) => {
          logger.warn('ManageFeedsSync', 'Failed to follow a renamed station', { error });
        });
        return;
      }

      if (message.kind === 'stationDeleted' && latest.selectedTag === message.stationName) {
        // TagManager clears the selection for a deleted selected station.
        return;
      }

      if (affectsVisibleRows(message)) {
        scheduleReload();
      }
    };

    const removeBridge = installFeedLibraryWindowBridge({
      selfLabel: MAIN_WINDOW_LABEL,
      peerLabel: MANAGE_FEEDS_WINDOW_LABEL,
      onRemoteMutation: handleRemoteMutation,
    });

    // Feed status (failures, last update) is written by refresh cycles without a bus
    // publish; tell Manage Feeds once per finished cycle so its status column stays current.
    const removeSchedulerListener = feedScheduler.on((event) => {
      if (event.type !== 'cycle-complete') {
        return;
      }
      void emitTo(MANAGE_FEEDS_WINDOW_LABEL, FEED_LIBRARY_STATUS_CHANGED_EVENT, null).catch((error: unknown) => {
        logger.warn('ManageFeedsSync', 'Failed to notify Manage Feeds about a finished refresh', { error });
      });
    });

    // Sidebar "can't update" markers follow the same cycles (diffed, published on the bus).
    const removeFeedHealthSync = installFeedHealthSync((listener) => feedScheduler.on(listener));

    return () => {
      removeBridge();
      removeSchedulerListener();
      removeFeedHealthSync();
      if (reloadTimerRef.current !== null) {
        window.clearTimeout(reloadTimerRef.current);
        reloadTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (articleViewOverlayPhase === 'closed') {
      flushReloadRef.current();
    }
  }, [articleViewOverlayPhase]);
}
