/**
 * ArticlesManager - now delegates to SQLite via articleStore.
 * Maintains the same public API for backward compatibility.
 */
import * as articleStore from '@/stores/articleStore';
import type { Article } from '@/types/article';

class ArticlesManager {
  /**
   * Store new articles, return count of new articles added
   */
  async storeArticles(feedId: string, articles: Article[]): Promise<number> {
    return articleStore.store(feedId, articles);
  }

  /**
   * Get articles for a feed with optional pagination.
   */
  async getArticlesByFeed(feedId: string, options?: { limit?: number; offset?: number }): Promise<Article[]> {
    const result = await articleStore.query({
      feedIds: [feedId],
      limit: options?.limit,
      offset: options?.offset,
    });
    return result.articles;
  }

  /**
   * Get sorted articles for multiple feeds with optional pagination.
   */
  async getArticlesByFeeds(
    feedIds: string[],
    options?: { limit?: number; offset?: number }
  ): Promise<Article[]> {
    if (feedIds.length === 0) return [];

    const result = await articleStore.query({
      feedIds,
      limit: options?.limit,
      offset: options?.offset,
    });
    return result.articles;
  }

  /**
   * Check if article hash exists
   */
  async hasArticle(hash: string): Promise<boolean> {
    return articleStore.exists(hash);
  }

  /**
   * Mark article as read/unread
   */
  async updateReadStatus(_feedId: string, hash: string, read: boolean): Promise<void> {
    return articleStore.markRead(hash, read);
  }

  /**
   * Update last read/opened timestamp for an article
   */
  async updateLastReadAt(_feedId: string, hash: string, lastReadAt: string = new Date().toISOString()): Promise<void> {
    return articleStore.updateLastReadAt(hash, lastReadAt);
  }

  /**
   * Toggle starred status for an article
   */
  async toggleStarred(_feedId: string, hash: string): Promise<void> {
    await articleStore.toggleStarred(hash);
  }

  /**
   * Update saved status for an article
   */
  async updateSavedStatus(
    _feedId: string,
    hash: string,
    saved: boolean,
    savedArticleId?: string
  ): Promise<void> {
    return articleStore.updateSavedStatus(hash, saved, savedArticleId);
  }

  /**
   * Delete articles older than N days
   */
  async cleanOldArticles(feedId: string, daysToKeep: number): Promise<number> {
    return articleStore.cleanOld(feedId, daysToKeep);
  }

  async cleanOldArticlesAcrossFeeds(monthsToKeep: 1 | 3 | 6): Promise<number> {
    return articleStore.cleanOldAcrossFeeds(monthsToKeep);
  }

  /**
   * Delete all articles for a feed, except saved ones.
   * Returns list of deleted article hashes.
   */
  async deleteArticlesByFeed(feedId: string): Promise<string[]> {
    return articleStore.deleteByFeed(feedId);
  }
}

export const articlesManager = new ArticlesManager();
