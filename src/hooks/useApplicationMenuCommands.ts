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
      sidebarIndicatorService.show('Feed export is only available in the desktop app.', { durationMs: 5000 });
      return;
    }

    const opmlText = await opmlExportService.buildOpmlText();
    const saveResult = await window.electronAPI.saveOpmlFile(opmlText, 'Feeds.opml');
    if (saveResult.canceled) {
      return;
    }

    sidebarIndicatorService.show('Exported feeds to OPML.', { durationMs: 5000 });
  }, []);

  const handleClearFeeds = useCallback(async () => {
    const feeds = await feedsManager.getAllFeeds();
    if (feeds.length === 0) {
      sidebarIndicatorService.show('No feeds to clear.', { durationMs: 4000 });
      return;
    }

    const confirmed = window.confirm(
      'Clear all feeds?\n\nThis removes every subscription and its feed-linked articles. Saved articles stay in Saved.'
    );
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    const tags = await tagsManager.getAllTags();
    for (const feed of feeds) {
      await articlesManager.deleteArticlesByFeed(feed.id);
      await feedsManager.deleteFeed(feed.id);
      feedLibraryMutationBus.publishFeedDeleted(feed.id);
    }

    for (const tag of tags) {
      await tagsManager.deleteTag(tag.name);
    }

    feedLibraryMutationBus.publishStationsHydrated([]);
    clearFeedSelection();
    await refreshTotalFeeds();
    notifyFeedLibraryChanged();
    sidebarIndicatorService.show(`Cleared ${feeds.length} subscriptions.`, { durationMs: 5000 });
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
      sidebarIndicatorService.show('No saved articles to clear.', { durationMs: 4000 });
      return;
    }

    const confirmed = window.confirm(
      'Clear all saved articles?\n\nThis removes every saved article and clears its saved status in your library.'
    );
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    for (const savedArticle of savedArticles) {
      await savedArticlesService.unsaveArticle(savedArticle.id, savedArticle.title);
      await articleStore.updateSavedStatus(savedArticle.articleHash, false);
      updateArticleInList(savedArticle.articleHash, {
        saved: false,
        savedArticleId: undefined,
      });
    }

    await reloadCurrentSourceFromStore();
    notifyFeedLibraryChanged();
    sidebarIndicatorService.show(`Cleared ${savedArticles.length} saved articles.`, { durationMs: 5000 });
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
    updateArticleInList,
  ]);

  const handleClearArticles = useCallback(async () => {
    const feeds = await feedsManager.getAllFeeds();
    if (feeds.length === 0) {
      sidebarIndicatorService.show('No feed articles to clear.', { durationMs: 4000 });
      return;
    }

    const confirmed = window.confirm(
      'Clear all feed articles?\n\nThis deletes non-saved articles from every subscription. Your feeds and saved articles stay in place.'
    );
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    let deletedArticleCount = 0;
    for (const feed of feeds) {
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
    }

    await reloadCurrentSourceFromStore();
    notifyFeedLibraryChanged();
    sidebarIndicatorService.show(
      deletedArticleCount > 0
        ? `Cleared ${deletedArticleCount} articles.`
        : 'No non-saved articles needed clearing.',
      { durationMs: 5000 }
    );
  }, [
    closeActiveArticleIfNeeded,
    notifyFeedLibraryChanged,
    reloadCurrentSourceFromStore,
  ]);

  const handleClearArticlesOlderThan = useCallback(async (months: 1 | 3) => {
    const label = months === 1 ? '1 month' : `${months} months`;
    const confirmed = window.confirm(
      `Clear articles older than ${label}?\n\nThis deletes non-saved, non-starred subscription articles older than ${label}. Your feeds, starred articles, and saved articles stay in place.`
    );
    if (!confirmed) {
      return;
    }

    closeActiveArticleIfNeeded();

    const deletedArticleCount = await articlesManager.cleanOldArticlesAcrossFeeds(months);
    await reloadCurrentSourceFromStore();
    notifyFeedLibraryChanged();
    sidebarIndicatorService.show(
      deletedArticleCount > 0
        ? `Cleared ${deletedArticleCount} articles older than ${label}.`
        : `No articles older than ${label} needed clearing.`,
      { durationMs: 5000 }
    );
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
