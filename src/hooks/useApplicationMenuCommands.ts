import { useCallback, useEffect } from 'react';
import type { SmartViewId } from '@/constants';
import type { Theme } from '@/services/settings';
import type { ArticleListUpdatePayload } from '@/contexts/FeedContext';
import { articlesManager } from '@/services/articles/articlesManager';
import { savedArticlesManager } from '@/services/articles/savedArticlesManager';
import { feedsManager } from '@/services/feeds/feedsManager';
import { opmlExportService } from '@/services/feeds/opmlExportService';
import {
  formatOpmlImportSummary,
  importOpmlTextIntoLibrary,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { APP_DOWNLOADS_URL } from '@/config/appIdentity';
import { logger } from '@/services/logger';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import { appToastService } from '@/services/ui/appToastService';
import { runWithSidebarBatchProgress } from '@/services/ui/batchSidebarProgress';
import { confirmDialog } from '@/services/ui/confirmDialogService';
import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { tagsManager } from '@/services/tags/tagsManager';
import * as articleStore from '@/stores/articleStore';

interface UseApplicationMenuCommandsInput {
  activeArticleHash: string | null;
  requestCloseArticle: () => void;
  selectedSmartView: SmartViewId | 'pinned' | null;
  selectSmartView: (viewType: 'saved' | 'unread' | 'all' | 'pinned') => Promise<void>;
  clearFeedSelection: () => void;
  refreshTotalFeeds: () => Promise<void>;
  notifyFeedLibraryChanged: () => void;
  updateArticleInList: (hash: string, updates?: ArticleListUpdatePayload) => void;
  reloadCurrentSourceFromStore: () => Promise<void>;
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

export const useApplicationMenuCommands = ({
  activeArticleHash,
  requestCloseArticle,
  selectedSmartView,
  selectSmartView,
  clearFeedSelection,
  refreshTotalFeeds,
  notifyFeedLibraryChanged,
  updateArticleInList,
  reloadCurrentSourceFromStore,
  theme,
  setTheme,
}: UseApplicationMenuCommandsInput): void => {
  const closeActiveArticleIfNeeded = useCallback(() => {
    if (activeArticleHash) {
      requestCloseArticle();
    }
  }, [activeArticleHash, requestCloseArticle]);

  const handleExportFeeds = useCallback(async () => {
    if (!window.electronAPI?.saveOpmlFile) {
      sidebarIndicatorService.show('Export: desktop only', { durationMs: 5000 });
      return;
    }

    sidebarIndicatorService.show('Export OPML…');
    try {
      const opmlText = await opmlExportService.buildOpmlText();
      const saveResult = await window.electronAPI.saveOpmlFile(opmlText, 'Feeds.opml');
      if (saveResult.canceled) {
        sidebarIndicatorService.clear();
        return;
      }

      sidebarIndicatorService.show('Exported OPML', { durationMs: 5000 });
    } catch (error) {
      logger.error('AppMenu', 'Failed to export feeds from menu', { error });
      sidebarIndicatorService.show('Export failed', { durationMs: 5000 });
    }
  }, []);

  const handleClearFeeds = useCallback(async () => {
    const feeds = await feedsManager.getAllFeeds();
    if (feeds.length === 0) {
      sidebarIndicatorService.show('No feeds', { durationMs: 4000 });
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Clear all feeds',
      message: 'Clear all feeds?\n\nThis removes every subscription and its feed-linked articles. Saved articles stay in Saved.',
    });
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    try {
      const tags = await tagsManager.getAllTags();
      await runWithSidebarBatchProgress('Clear feeds', feeds.length, async (reportProgress) => {
        for (let index = 0; index < feeds.length; index += 1) {
          const feed = feeds[index];
          await articlesManager.deleteArticlesByFeed(feed.id);
          await feedsManager.deleteFeed(feed.id);
          feedLibraryMutationBus.publishFeedDeleted(feed.id);
          reportProgress(index + 1);
        }
      });

      sidebarIndicatorService.show('Clear stations…');
      for (const tag of tags) {
        await tagsManager.deleteTag(tag.name);
      }

      feedLibraryMutationBus.publishStationsHydrated([]);
      clearFeedSelection();
      await refreshTotalFeeds();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(`Cleared ${feeds.length} feeds`, { durationMs: 5000 });
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear feeds from menu', { error });
      sidebarIndicatorService.show('Clear feeds failed', { durationMs: 5000 });
    }
  }, [
    clearFeedSelection,
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    refreshTotalFeeds,
  ]);

  const handleImportFeeds = useCallback(async () => {
    try {
      const opmlText = await openOpmlFileForImport();
      if (!opmlText) {
        return;
      }

      const importResult = await importOpmlTextIntoLibrary(opmlText, {
        refreshTotalFeeds,
        notifyFeedLibraryChanged,
      });
      appToastService.show(formatOpmlImportSummary(importResult.summary));
    } catch (importError) {
      appToastService.show(
        importError instanceof Error ? importError.message : 'Failed to import OPML file.'
      );
    }
  }, [notifyFeedLibraryChanged, refreshTotalFeeds]);

  const handleClearSavedArticles = useCallback(async () => {
    const savedArticles = await savedArticlesManager.getAllSavedArticles();
    if (savedArticles.length === 0) {
      sidebarIndicatorService.show('No saved', { durationMs: 4000 });
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Clear saved articles',
      message: 'Clear all saved articles?\n\nThis removes every saved article and clears its saved status in your library.',
    });
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    try {
      await runWithSidebarBatchProgress('Clear saved', savedArticles.length, async (reportProgress) => {
        for (let index = 0; index < savedArticles.length; index += 1) {
          const savedArticle = savedArticles[index];
          await savedArticlesService.unsaveArticle(savedArticle.id, savedArticle.title);
          await articleStore.updateSavedStatus(savedArticle.articleHash, false);
          updateArticleInList(savedArticle.articleHash, {
            saved: false,
            savedArticleId: undefined,
          });
          reportProgress(index + 1);
        }
      });

      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(`Cleared ${savedArticles.length} saved`, { durationMs: 5000 });
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear saved articles from menu', { error });
      sidebarIndicatorService.show('Clear saved failed', { durationMs: 5000 });
    }
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
    updateArticleInList,
  ]);

  const handleClearArticles = useCallback(async () => {
    const feeds = await feedsManager.getAllFeeds();
    if (feeds.length === 0) {
      sidebarIndicatorService.show('No articles', { durationMs: 4000 });
      return;
    }

    const confirmed = await confirmDialog({
      title: 'Clear all articles',
      message: 'Clear all feed articles?\n\nThis deletes non-saved articles from every subscription. Your feeds and saved articles stay in place.',
    });
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    try {
      let deletedArticleCount = 0;
      await runWithSidebarBatchProgress('Clear articles', feeds.length, async (reportProgress) => {
        for (let index = 0; index < feeds.length; index += 1) {
          const feed = feeds[index];
          const deletedHashes = await articlesManager.deleteArticlesByFeed(feed.id);
          deletedArticleCount += deletedHashes.length;
          const [unreadCount, articleCount] = await Promise.all([
            articleStore.getUnreadCount(feed.id),
            articleStore.getArticleCount(feed.id),
          ]);
          await feedsManager.updateFeed(feed.id, {
            unreadCount,
            articleCount,
          });
          reportProgress(index + 1);
        }
      });

      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        deletedArticleCount > 0
          ? `Cleared ${deletedArticleCount}`
          : 'Nothing to clear',
        { durationMs: 5000 }
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear articles from menu', { error });
      sidebarIndicatorService.show('Clear failed', { durationMs: 5000 });
    }
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
  ]);

  const handleClearArticlesOlderThan = useCallback(async (months: 1 | 3) => {
    const ageLabel = months === 1 ? '>1mo' : `>${months}mo`;
    const confirmed = await confirmDialog({
      title: `Clear articles older than ${months === 1 ? '1 month' : `${months} months`}`,
      message: `Clear articles older than ${months === 1 ? '1 month' : `${months} months`}?\n\nThis deletes non-saved, non-starred subscription articles older than ${months === 1 ? '1 month' : `${months} months`}. Your feeds, starred articles, and saved articles stay in place.`,
    });
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    try {
      sidebarIndicatorService.show(`Clear ${ageLabel}…`);
      const deletedArticleCount = await articlesManager.cleanOldArticlesAcrossFeeds(months);
      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        deletedArticleCount > 0
          ? `Cleared ${deletedArticleCount} (${ageLabel})`
          : `None ${ageLabel}`,
        { durationMs: 5000 }
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear old articles from menu', { months, error });
      sidebarIndicatorService.show(`Clear ${ageLabel} failed`, { durationMs: 5000 });
    }
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
  ]);

  useEffect(() => {
    if (!window.electronAPI?.updateAppMenuState) {
      return;
    }

    void window.electronAPI.updateAppMenuState({
      theme,
      libraryView: selectedSmartView === 'saved' || selectedSmartView === 'unread' || selectedSmartView === 'all'
        ? selectedSmartView
        : null,
    });
  }, [selectedSmartView, theme]);

  useEffect(() => {
    if (!window.electronAPI?.onAppMenuCommand) {
      return;
    }

    return window.electronAPI.onAppMenuCommand((command) => {
      logger.info('AppMenu', 'Received native app menu command', { commandType: command.type });

      switch (command.type) {
        case 'importFeeds':
          void handleImportFeeds();
          break;
        case 'checkUpdates':
          if (!window.electronAPI?.openExternal) {
            appToastService.show('Downloads page is not available.');
            break;
          }

          void window.electronAPI.openExternal(APP_DOWNLOADS_URL)
            .then(() => {
              appToastService.show('Opened the KiJi downloads page.');
            })
            .catch((error) => {
              logger.error('AppMenu', 'Failed to open downloads page from Check Updates', { error });
              appToastService.show('Failed to open the KiJi downloads page.');
            });
          break;
        case 'exportFeeds':
          void handleExportFeeds();
          break;
        case 'exportSavedArticles':
          void savedArticlesIOService.exportSavedArticles();
          break;
        case 'clearFeeds':
          void handleClearFeeds();
          break;
        case 'clearSavedArticles':
          void handleClearSavedArticles();
          break;
        case 'clearArticles':
          void handleClearArticles();
          break;
        case 'clearArticlesOlderThan':
          void handleClearArticlesOlderThan(command.months);
          break;
        case 'setTheme':
          setTheme(command.theme);
          break;
        case 'selectLibraryView':
          void selectSmartView(command.libraryView);
          break;
        default:
          break;
      }
    });
  }, [
    handleClearArticles,
    handleClearArticlesOlderThan,
    handleClearFeeds,
    handleImportFeeds,
    handleClearSavedArticles,
    handleExportFeeds,
    selectSmartView,
    setTheme,
  ]);
};
