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
  navigateAfterOpmlImport,
  openOpmlFileForImport,
} from '@/services/feeds/opmlUiWorkflow';
import { openAboutWindow } from '@/services/system/appUpdateService';
import { logger } from '@/services/logger';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { savedArticlesService } from '@/services/saved/savedArticlesService';
import { appToastService } from '@/services/ui/appToastService';
import { runWithSidebarBatchProgress } from '@/services/ui/batchSidebarProgress';
import { confirmDialog } from '@/services/ui/confirmDialogService';
import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';
import {
  sidebarIndicatorDone,
  sidebarIndicatorFailed,
  sidebarIndicatorOngoing,
} from '@/services/ui/sidebarIndicatorText';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { tagsManager } from '@/services/tags/tagsManager';
import * as articleStore from '@/stores/articleStore';

interface UseApplicationMenuCommandsInput {
  activeArticleHash: string | null;
  requestCloseArticle: () => void;
  selectedSmartView: SmartViewId | 'pinned' | null;
  selectSmartView: (viewType: 'saved' | 'unread' | 'all' | 'pinned') => Promise<void>;
  clearFeedSelection: () => void;
  selectFeed: (feedId: string, feedUrl: string, feedTitle: string, options?: { forceNetwork?: boolean }) => Promise<void>;
  selectTag: (tagName: string) => Promise<void>;
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
  selectFeed,
  selectTag,
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
    if (!window.kijiAPI?.saveOpmlFile) {
      sidebarIndicatorService.show('Export unavailable', { durationMs: 5000 });
      return;
    }

    sidebarIndicatorService.show(sidebarIndicatorOngoing('exporting', undefined, { subject: 'feeds' }));
    try {
      const opmlText = await opmlExportService.buildOpmlText();
      const saveResult = await window.kijiAPI.saveOpmlFile(opmlText, 'Feeds.opml');
      if (saveResult.canceled) {
        sidebarIndicatorService.clear();
        return;
      }

      sidebarIndicatorService.show(
        sidebarIndicatorDone('exporting', undefined, { subject: 'feeds' }),
        { durationMs: 5000 },
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to export feeds from menu', { error });
      sidebarIndicatorService.show(
        sidebarIndicatorFailed('exporting', { subject: 'feeds' }),
        { durationMs: 5000 },
      );
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
      await runWithSidebarBatchProgress('clearing', feeds.length, async (reportProgress) => {
        for (let index = 0; index < feeds.length; index += 1) {
          const feed = feeds[index];
          await articlesManager.deleteArticlesByFeed(feed.id);
          await feedsManager.deleteFeed(feed.id);
          feedLibraryMutationBus.publishFeedDeleted(feed.id);
          reportProgress(index + 1);
        }
      }, { subject: 'feeds' });

      sidebarIndicatorService.show(sidebarIndicatorOngoing('clearing', undefined, { subject: 'feeds' }));
      for (const tag of tags) {
        await tagsManager.deleteTag(tag.name);
      }

      feedLibraryMutationBus.publishStationsHydrated([]);
      clearFeedSelection();
      await refreshTotalFeeds();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        sidebarIndicatorDone('clearing', feeds.length, { subject: 'feeds' }),
        { durationMs: 5000 },
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear feeds from menu', { error });
      sidebarIndicatorService.show(sidebarIndicatorFailed('clearing', { subject: 'feeds' }), { durationMs: 5000 });
    }
  }, [
    clearFeedSelection,
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    refreshTotalFeeds,
  ]);

  const handleImportFeeds = useCallback(async () => {
    try {
      const selectedFile = await openOpmlFileForImport();
      if (!selectedFile) {
        return;
      }

      const importResult = await importOpmlTextIntoLibrary(selectedFile.opmlText, {
        refreshTotalFeeds,
        notifyFeedLibraryChanged,
        fileName: selectedFile.fileName,
      });
      await navigateAfterOpmlImport(importResult, { selectFeed, selectTag });
      appToastService.show(formatOpmlImportSummary(importResult.summary));
    } catch (importError) {
      appToastService.show(
        importError instanceof Error ? importError.message : 'Failed to import OPML file.'
      );
    }
  }, [notifyFeedLibraryChanged, refreshTotalFeeds, selectFeed, selectTag]);

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
      await runWithSidebarBatchProgress('clearing', savedArticles.length, async (reportProgress) => {
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
      }, { subject: 'saved' });

      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        sidebarIndicatorDone('clearing', savedArticles.length, { subject: 'saved' }),
        { durationMs: 5000 },
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear saved articles from menu', { error });
      sidebarIndicatorService.show(sidebarIndicatorFailed('clearing', { subject: 'saved' }), { durationMs: 5000 });
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
      await runWithSidebarBatchProgress('clearing', feeds.length, async (reportProgress) => {
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
      }, { subject: 'articles' });

      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        sidebarIndicatorDone(
          'clearing',
          deletedArticleCount > 0 ? deletedArticleCount : undefined,
          { subject: 'articles' },
        ),
        { durationMs: 5000 },
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear articles from menu', { error });
      sidebarIndicatorService.show(sidebarIndicatorFailed('clearing', { subject: 'articles' }), { durationMs: 5000 });
    }
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
  ]);

  const handleClearArticlesOlderThan = useCallback(async (months: 3) => {
    const confirmed = await confirmDialog({
      title: 'Clear articles older than 3 months',
      message: 'Clear articles older than 3 months?\n\nThis deletes non-saved, non-starred subscription articles older than 3 months. Your feeds, starred articles, and saved articles stay in place.',
    });
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    try {
      sidebarIndicatorService.show(sidebarIndicatorOngoing('clearing', undefined, { subject: 'articles' }));
      const deletedArticleCount = await articlesManager.cleanOldArticlesAcrossFeeds(months);
      await reloadCurrentSourceFromStore();
      notifyFeedLibraryChanged();
      sidebarIndicatorService.show(
        sidebarIndicatorDone(
          'clearing',
          deletedArticleCount > 0 ? deletedArticleCount : undefined,
          { subject: 'articles' },
        ),
        { durationMs: 5000 },
      );
    } catch (error) {
      logger.error('AppMenu', 'Failed to clear old articles from menu', { months, error });
      sidebarIndicatorService.show(sidebarIndicatorFailed('clearing', { subject: 'articles' }), { durationMs: 5000 });
    }
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
  ]);

  useEffect(() => {
    if (!window.kijiAPI?.updateAppMenuState) {
      return;
    }

    void window.kijiAPI.updateAppMenuState({
      theme,
      libraryView: selectedSmartView === 'saved' || selectedSmartView === 'unread' || selectedSmartView === 'all'
        ? selectedSmartView
        : null,
    });
  }, [selectedSmartView, theme]);

  useEffect(() => {
    if (!window.kijiAPI?.onAppMenuCommand) {
      return;
    }

    return window.kijiAPI.onAppMenuCommand((command) => {
      logger.info('AppMenu', 'Received native app menu command', { commandType: command.type });

      switch (command.type) {
        case 'importFeeds':
          void handleImportFeeds();
          break;
        case 'checkUpdates':
          void (async () => {
            try {
              await openAboutWindow({ checkOnOpen: true });
            } catch (error) {
              logger.error('AppMenu', 'Failed to open About window from Check for Updates', { error });
            }
          })();
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
