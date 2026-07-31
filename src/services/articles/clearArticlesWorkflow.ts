import { articlesManager } from '@/services/articles/articlesManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import * as articleStore from '@/stores/articleStore';

export const countClearableArticles = async (): Promise<number> => {
  const result = await articleStore.query({ filter: { saved: false }, limit: 0 });
  return result.total;
};

export const clearAllArticlesAcrossFeeds = async (feedIds: string[]): Promise<number> => {
  const deletedHashes = await articlesManager.deleteArticlesByFeeds(feedIds);

  const syncedCounts = await articleStore.syncFeedCountsBatch(feedIds);
  if (syncedCounts.length > 0) {
    feedLibraryMutationBus.publishFeedsCountsUpdated(
      syncedCounts.map((counts) => ({
        feedId: counts.feedId,
        unreadCount: counts.unreadCount,
        articleCount: counts.articleCount,
      })),
    );
  }

  return deletedHashes.length;
};
