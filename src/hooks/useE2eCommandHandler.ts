import { useEffect, useRef } from 'react';
import {
  useFeedCollection,
  useFeedNavigation,
  useFeedOverlay,
  useFeedUIActions,
} from '@/contexts/FeedContext';
import { feedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { feedsManager } from '@/services/feeds/feedsManager';
import { opmlExportService } from '@/services/feeds/opmlExportService';
import {
  importOpmlTextIntoLibrary,
  navigateAfterOpmlImport,
} from '@/services/feeds/opmlUiWorkflow';
import { readE2eTextFile, takeE2eCommand, writeE2eHarnessText } from '@/services/e2e/e2eCommands';
import { getE2eConfig, waitForE2eConfig, writeE2eEvent } from '@/services/e2e/e2eHarness';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { isMainRendererWindow } from '@/utils/rendererWindow';
import { logger } from '@/services/logger';
import * as articleStore from '@/stores/articleStore';

const COMMAND_POLL_MS = 150;

function scrollArticleListElement(options: { toEnd?: boolean; delta?: number }): void {
  const listElement = document.querySelector<HTMLElement>('[data-section="article-list-items"]');
  if (!listElement) {
    return;
  }

  if (options.toEnd) {
    listElement.scrollTop = listElement.scrollHeight;
    listElement.dispatchEvent(new Event('scroll', { bubbles: true }));
    return;
  }

  if (typeof options.delta === 'number') {
    listElement.scrollTop += options.delta;
    listElement.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
}

export const useE2eCommandHandler = (): void => {
  const navigation = useFeedNavigation();
  const collection = useFeedCollection();
  const overlay = useFeedOverlay();
  const uiActions = useFeedUIActions();

  const navigationRef = useRef(navigation);
  const collectionRef = useRef(collection);
  const overlayRef = useRef(overlay);
  const uiActionsRef = useRef(uiActions);

  navigationRef.current = navigation;
  collectionRef.current = collection;
  overlayRef.current = overlay;
  uiActionsRef.current = uiActions;

  const busyRef = useRef(false);

  useEffect(() => {
    if (!isMainRendererWindow()) {
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const runImportOpml = async (path: string): Promise<void> => {
      const { refreshTotalFeeds, notifyFeedLibraryChanged } = uiActionsRef.current;
      const { selectTag, selectFeed } = navigationRef.current;

      await writeE2eEvent('opml-import-started', { path });
      const opmlText = await readE2eTextFile(path);
      const importResult = await importOpmlTextIntoLibrary(opmlText, {
        refreshTotalFeeds,
        notifyFeedLibraryChanged,
        fileName: path.split('/').pop(),
      });
      await navigateAfterOpmlImport(importResult, { selectTag, selectFeed });
      const stations = await tagsManager.getAllTags();
      const feeds = await Promise.all(
        importResult.importedFeeds.map(async ({ id }) => feedsManager.getFeedById(id)),
      );
      await writeE2eEvent('opml-import-complete', {
        feedCount: importResult.importedFeeds.length,
        stationCount: stations.length,
        stationNames: stations.map((station) => station.name),
        feeds: feeds
          .filter((feed): feed is NonNullable<typeof feed> => feed !== null)
          .map((feed) => ({ id: feed.id, title: feed.title, url: feed.url })),
      });
    };

    const runExportOpml = async (): Promise<void> => {
      const opmlText = await opmlExportService.buildOpmlText();
      await writeE2eHarnessText('exports/feeds.opml', opmlText);
      const outlineCount = (opmlText.match(/type="rss"/g) ?? []).length;
      await writeE2eEvent('opml-export-complete', {
        byteLength: opmlText.length,
        outlineCount,
      });
    };

    const runRenameStation = async (from: string, to: string): Promise<void> => {
      const { openFeedEditView } = navigationRef.current;

      await openFeedEditView();
      await writeE2eEvent('feed-edit-opened', { isFeedEditView: true });
      const stations = await tagsManager.getAllTags();
      const previousStation = stations.find((station) => station.name === from);
      await tagsManager.renameTag(from, to);
      if (previousStation) {
        feedLibraryMutationBus.publishStationPatched(from, {
          name: to,
          emoji: previousStation.emoji,
          feedIds: previousStation.feedIds,
          createdAt: previousStation.createdAt,
          sortOrder: previousStation.sortOrder,
        });
      }
      const updatedStations = await tagsManager.getAllTags();
      await writeE2eEvent('feed-edit-saved', { renamedFrom: from, renamedTo: to });
      await writeE2eEvent('station-library-snapshot', {
        stationNames: updatedStations.map((station) => station.name),
      });
    };

    const runDeleteStation = async (stationName: string): Promise<void> => {
      const stations = await tagsManager.getAllTags();
      const target = stations.find((station) => station.name === stationName);
      const affectedFeedIds = target?.feedIds ?? [];
      await tagsManager.deleteTag(stationName);
      feedLibraryMutationBus.publishStationDeleted(stationName, affectedFeedIds);
      const remaining = await tagsManager.getAllTags();
      await writeE2eEvent('feed-delete-confirmed', { stationName });
      await writeE2eEvent('station-library-snapshot', {
        stationNames: remaining.map((station) => station.name),
      });
    };

    const handleCommand = async (command: { name: string; payload: Record<string, unknown> }): Promise<void> => {
      const {
        selectFeed,
        selectTag,
        openFeedEditView,
        closeFeedEditView,
        selectedTag,
        selectedFeedId,
      } = navigationRef.current;
      const { articles, loadMoreArticles } = collectionRef.current;
      const { selectArticle, requestCloseArticle } = overlayRef.current;

      switch (command.name) {
        case 'select-station': {
          const stationName = String(command.payload.stationName ?? '');
          if (!stationName) return;
          await selectTag(stationName, { forceNetwork: true });
          await writeE2eEvent('navigation-changed', {
            sourceType: 'tag',
            sourceId: stationName,
            selectedTag: stationName,
            selectedFeedId: null,
          });
          const refreshSnapshot = feedRefreshActivity.getSnapshot();
          await writeE2eEvent('refresh-indicator-snapshot', {
            ...refreshSnapshot,
            selectedTag: stationName,
            selectedFeedId: null,
            navigationNonce: null,
            indicatorText: refreshSnapshot.isBackgroundFeedRefreshing || refreshSnapshot.isForegroundFeedRefreshing
              ? `refreshing:${refreshSnapshot.displayFeedCount}`
              : null,
          });
          return;
        }
        case 'select-feed': {
          let feedId = typeof command.payload.feedId === 'string' ? command.payload.feedId : '';
          let feedUrl = typeof command.payload.feedUrl === 'string' ? command.payload.feedUrl : '';
          let feedTitle = typeof command.payload.feedTitle === 'string' ? command.payload.feedTitle : '';
          if (!feedId) {
            return;
          }
          if (!feedUrl || !feedTitle) {
            const feed = await feedsManager.getFeedById(feedId);
            if (!feed) return;
            feedUrl = feed.url;
            feedTitle = feed.title;
          }
          await selectFeed(feedId, feedUrl, feedTitle, { forceNetwork: true });
          await writeE2eEvent('navigation-changed', {
            sourceType: 'feed',
            sourceId: feedId,
            selectedTag,
            selectedFeedId: feedId,
          });
          return;
        }
        case 'open-article': {
          const hash = typeof command.payload.hash === 'string'
            ? command.payload.hash
            : articles[Number(command.payload.index ?? 0)]?.hash;
          if (!hash) return;
          selectArticle(hash);
          return;
        }
        case 'close-article': {
          requestCloseArticle();
          return;
        }
        case 'toggle-reader-mode': {
          window.dispatchEvent(new CustomEvent('kiji-e2e:toggle-reader-mode'));
          return;
        }
        case 'scroll-list': {
          const toEnd = command.payload.toEnd === true;
          const delta = typeof command.payload.delta === 'number' ? command.payload.delta : undefined;
          const beforeLoaded = articles.length;
          scrollArticleListElement({ toEnd, delta });
          if (toEnd) {
            await loadMoreArticles({ priority: 'urgent' });
          }
          const listElement = document.querySelector<HTMLElement>('[data-section="article-list-items"]');
          let loadedCount = articles.length;
          if (selectedFeedId) {
            const queryResult = await articleStore.query({
              feedIds: [selectedFeedId],
              limit: 200,
              offset: 0,
            });
            loadedCount = queryResult.articles.length;
          }
          await writeE2eEvent('scroll-state', {
            scrollTop: listElement?.scrollTop ?? 0,
            loadedCount,
            beforeLoaded,
            toEnd: toEnd === true,
          });
          if (toEnd) {
            await writeE2eEvent('load-more-complete', {
              loadedCount,
            });
          }
          return;
        }
        case 'open-feed-edit': {
          openFeedEditView();
          await writeE2eEvent('feed-edit-opened', { isFeedEditView: true });
          return;
        }
        case 'close-feed-edit': {
          closeFeedEditView();
          await writeE2eEvent('feed-edit-closed', { isFeedEditView: false });
          return;
        }
        case 'rename-station': {
          const from = String(command.payload.from ?? command.payload.oldName ?? '');
          const to = String(command.payload.to ?? command.payload.newName ?? '');
          if (!from || !to) return;
          await runRenameStation(from, to);
          return;
        }
        case 'delete-station': {
          const stationName = String(command.payload.stationName ?? '');
          if (!stationName) return;
          await runDeleteStation(stationName);
          return;
        }
        case 'import-opml': {
          const path = String(command.payload.path ?? getE2eConfig()?.opmlPath ?? '');
          if (!path) return;
          await runImportOpml(path);
          return;
        }
        case 'export-opml': {
          await runExportOpml();
          return;
        }
        default:
          logger.warn('E2E', 'Unknown harness command', { command: command.name });
      }
    };

    void (async () => {
      const config = await waitForE2eConfig();
      if (!config || disposed) {
        return;
      }

      timer = setInterval(() => {
        if (disposed || busyRef.current) {
          return;
        }

        void (async () => {
          const command = await takeE2eCommand();
          if (!command || disposed) {
            return;
          }

          busyRef.current = true;
          try {
            await handleCommand(command);
          } catch (error) {
            await writeE2eEvent('command-error', {
              command: command.name,
              message: error instanceof Error ? error.message : String(error),
            });
            logger.error('E2E', 'Harness command failed', { command: command.name, error });
          } finally {
            busyRef.current = false;
          }
        })();
      }, COMMAND_POLL_MS);
    })();

    return () => {
      disposed = true;
      if (timer !== null) {
        clearInterval(timer);
      }
    };
  }, []);
};
