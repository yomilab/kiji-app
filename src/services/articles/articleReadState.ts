import type { Article } from '@/types/article';
import { articlesManager } from '@/services/articles/articlesManager';
import { logger } from '@/services/logger';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import * as articleStore from '@/stores/articleStore';

type ReadStateArticle = Pick<Article, 'hash' | 'feedId' | 'isFeedLinked'>;

export const isFeedLinkedArticle = (article: ReadStateArticle): boolean =>
  article.isFeedLinked ?? (article.feedId !== 'clipboard' && article.feedId !== 'saved');

/** Saved snapshots and clipboard articles have no feed read state to flip. */
export const canToggleArticleRead = (
  article: ReadStateArticle | null | undefined,
  selectedSmartView: string | null,
): article is ReadStateArticle =>
  !!article && selectedSmartView !== 'saved' && isFeedLinkedArticle(article);

/**
 * Persist a user read/unread choice (m key, row menu), then publish the
 * feed's fresh unread count so the sidebar follows without a refresh.
 * The caller updates the list row through its usual path.
 */
export async function setArticleReadState(article: ReadStateArticle, read: boolean): Promise<void> {
  await articlesManager.updateReadStatus(article.feedId, article.hash, read);
  void publishFeedCounts(article.feedId);
}

async function publishFeedCounts(feedId: string): Promise<void> {
  try {
    const syncedCounts = await articleStore.syncFeedCountsBatch([feedId]);
    if (syncedCounts.length === 0) return;
    feedLibraryMutationBus.publishFeedsCountsUpdated(
      syncedCounts.map((counts) => ({
        feedId: counts.feedId,
        unreadCount: counts.unreadCount,
        articleCount: counts.articleCount,
      })),
    );
  } catch (error) {
    logger.warn('ArticleReadState', 'Failed to refresh feed counts after a read change', { feedId, error });
  }
}
