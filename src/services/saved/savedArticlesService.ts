import { prepareArticleForList } from '@/services/articles/articleListMemory';
import { savedArticlesManager } from '@/services/articles/savedArticlesManager';
import * as articleStore from '@/stores/articleStore';
import type { Article, SavedArticle } from '@/types/article';
import { savedArticlesSyncEventBus } from '@/services/saved/sync/savedArticlesSyncEventBus';

class SavedArticlesService {
  /**
   * Load articles for Saved smart view from saved storage only.
   */
  async getSavedViewArticles(): Promise<Article[]> {
    const savedArticles = await savedArticlesManager.getAllSavedArticles();
    return savedArticles.map((savedArticle) => this.toListArticle(savedArticle));
  }

  /**
   * Query articles for Saved smart view with pagination.
   */
  async querySavedViewArticles(limit?: number, offset?: number, searchText?: string): Promise<{ articles: Article[], total: number }> {
    const result = await savedArticlesManager.querySavedArticles(limit, offset, searchText);
    return {
      articles: result.articles.map((savedArticle) => this.toListArticle(savedArticle)),
      total: result.total,
    };
  }

  /**
   * Enrichment of saved list rows with optional feed metadata (title/favicon) when available.

   * Now reads from SQLite instead of loading entire feed article JSON blobs.
   */
  async enrichSavedViewArticlesMeta(items: Article[]): Promise<Article[]> {
    if (items.length === 0) return items;

    const hashesToHydrate = items
      .filter((item) => item.isFeedLinked && item.feedId && item.feedId !== 'saved' && item.feedId !== 'clipboard')
      .map((item) => item.hash);

    if (hashesToHydrate.length === 0) return items;

    // Fetch matching articles from SQLite by hash (fast indexed lookup)
    const matchMap = new Map<string, Article>();
    for (const hash of hashesToHydrate) {
      const match = await articleStore.getByHash(hash);
      if (match) matchMap.set(hash, match);
    }

    return items.map((item) => {
      if (!item.isFeedLinked || !item.feedId || item.feedId === 'saved' || item.feedId === 'clipboard') {
        return item;
      }

      const match = matchMap.get(item.hash);
      if (!match) return item;

      const feedTitle = item.feedTitle || match.feedTitle;
      const feedFavicon = item.feedFavicon || match.feedFavicon;
      const feedFaviconHasTransparency = item.feedFaviconHasTransparency ?? match.feedFaviconHasTransparency;
      const feedFaviconBgLight = item.feedFaviconBgLight ?? match.feedFaviconBgLight;
      const feedFaviconBgDark = item.feedFaviconBgDark ?? match.feedFaviconBgDark;
      const publishedDate = item.publishedDate || match.publishedDate;
      const previewImage = item.previewImage || match.previewImage;
      const enclosures = item.enclosures?.length ? item.enclosures : match.enclosures;
      const duration = item.duration ?? match.duration;
      const episodeNumber = item.episodeNumber ?? match.episodeNumber;
      const seasonNumber = item.seasonNumber ?? match.seasonNumber;

      if (
        feedTitle === item.feedTitle
        && feedFavicon === item.feedFavicon
        && feedFaviconHasTransparency === item.feedFaviconHasTransparency
        && feedFaviconBgLight === item.feedFaviconBgLight
        && feedFaviconBgDark === item.feedFaviconBgDark
        && publishedDate === item.publishedDate
        && previewImage === item.previewImage
        && enclosures === item.enclosures
        && duration === item.duration
        && episodeNumber === item.episodeNumber
        && seasonNumber === item.seasonNumber
      ) {
        return item;
      }

      return {
        ...item,
        feedTitle,
        feedFavicon,
        feedFaviconHasTransparency,
        feedFaviconBgLight,
        feedFaviconBgDark,
        publishedDate,
        previewImage,
        enclosures,
        duration,
        episodeNumber,
        seasonNumber,
      };
    });
  }

  async saveArticle(article: Article): Promise<SavedArticle> {
    const savedArticle = await savedArticlesManager.saveArticle(article);
    savedArticlesSyncEventBus.publish({
      type: 'saved',
      savedArticleId: savedArticle.id,
      title: savedArticle.title || null,
    });
    return savedArticle;
  }

  async unsaveArticle(savedArticleId: string, articleTitle?: string | null): Promise<void> {
    await savedArticlesManager.unsaveArticle(savedArticleId);
    savedArticlesSyncEventBus.publish({
      type: 'unsaved',
      savedArticleId,
      title: articleTitle || null,
    });
  }

  async findSavedArticle(articleHash: string, articleUrl?: string): Promise<SavedArticle | null> {
    return savedArticlesManager.findSavedArticle(articleHash, articleUrl);
  }

  async updateLastReadAt(articleHash: string, articleUrl?: string, lastReadAt: string = new Date().toISOString()): Promise<void> {
    const savedArticle = await savedArticlesManager.findSavedArticle(articleHash, articleUrl);
    if (!savedArticle) return;
    await savedArticlesManager.updateLastReadAt(savedArticle.id, lastReadAt);
  }

  private toListArticle(savedArticle: SavedArticle): Article {
    const isFeedLinked = !!savedArticle.feedId && savedArticle.feedId !== 'clipboard' && savedArticle.feedId !== 'saved';

    return prepareArticleForList({
      hash: savedArticle.articleHash,
      title: savedArticle.title,
      description: savedArticle.description,
      content: savedArticle.content,
      link: savedArticle.link,
      author: savedArticle.author,
      publishedDate: savedArticle.publishedDate,
      fetchedDate: savedArticle.savedDate,
      feedId: savedArticle.feedId || 'saved',
      feedUrl: savedArticle.feedUrl || savedArticle.link || '',
      feedTitle: savedArticle.feedTitle,
      feedFavicon: savedArticle.feedFavicon,
      feedFaviconHasTransparency: savedArticle.feedFaviconHasTransparency,
      feedFaviconBgLight: savedArticle.feedFaviconBgLight,
      feedFaviconBgDark: savedArticle.feedFaviconBgDark,
      previewImage: savedArticle.previewImage,
      enclosures: savedArticle.enclosures,
      duration: savedArticle.duration,
      episodeNumber: savedArticle.episodeNumber,
      seasonNumber: savedArticle.seasonNumber,
      read: true,
      starred: false,
      saved: true,
      savedArticleId: savedArticle.id,
      savedDate: savedArticle.savedDate,
      lastReadAt: savedArticle.lastReadAt,
      isFeedLinked,
    });
  }
}

export const savedArticlesService = new SavedArticlesService();
