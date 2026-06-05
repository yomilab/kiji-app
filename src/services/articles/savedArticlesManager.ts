import { tauriClient } from '@/lib/tauriClient';
import type { SavedArticleRecord } from '@/lib/tauriClient/contracts';
import type { Article, SavedArticle } from '@/types/article';

function toSavedArticle(record: SavedArticleRecord): SavedArticle {
  const metadata = (record.metadata ?? {}) as Partial<SavedArticle>;
  return {
    id: record.id,
    articleHash: record.articleHash,
    title: record.title ?? '',
    description: record.description ?? '',
    content: record.content ?? '',
    link: record.link ?? undefined,
    author: record.author ?? undefined,
    publishedDate: record.publishedDate ?? undefined,
    savedDate: record.savedDate,
    lastReadAt: record.lastReadAt ?? undefined,
    feedId: record.feedId ?? 'saved',
    feedUrl: record.feedUrl ?? '',
    feedTitle: record.feedTitle ?? undefined,
    feedFavicon: record.feedFavicon ?? undefined,
    feedFaviconHasTransparency: record.feedFaviconHasTransparency ?? undefined,
    feedFaviconBgLight: record.feedFaviconBgLight ?? undefined,
    feedFaviconBgDark: record.feedFaviconBgDark ?? undefined,
    previewImage: record.previewImage ?? metadata.previewImage,
    enclosures: metadata.enclosures,
    duration: metadata.duration,
    episodeNumber: metadata.episodeNumber,
    seasonNumber: metadata.seasonNumber,
    highlights: Array.isArray(record.highlights) ? record.highlights as SavedArticle['highlights'] : [],
    notes: record.notes ?? undefined,
  };
}

function toSavedRecord(article: Article, id: string): SavedArticleRecord {
  return {
    id,
    articleHash: article.hash,
    title: article.title,
    description: article.description,
    content: article.content,
    link: article.link ?? null,
    author: article.author ?? null,
    publishedDate: article.publishedDate ?? null,
    savedDate: new Date().toISOString(),
    lastReadAt: article.lastReadAt ?? null,
    feedId: article.feedId ?? null,
    feedUrl: article.feedUrl ?? null,
    feedTitle: article.feedTitle ?? null,
    feedFavicon: article.feedFavicon ?? null,
    feedFaviconHasTransparency: article.feedFaviconHasTransparency ?? null,
    feedFaviconBgLight: article.feedFaviconBgLight ?? null,
    feedFaviconBgDark: article.feedFaviconBgDark ?? null,
    feedImage: article.feedImage ?? null,
    previewImage: article.previewImage ?? null,
    metadata: {
      enclosures: article.enclosures,
      duration: article.duration,
      episodeNumber: article.episodeNumber,
      seasonNumber: article.seasonNumber,
    },
    highlights: [],
    notes: null,
  };
}

class SavedArticlesManager {
  async saveArticle(article: Article): Promise<SavedArticle> {
    const id = article.savedArticleId ?? crypto.randomUUID();
    await tauriClient.saved.create({ article: toSavedRecord(article, id) });
    const saved = await tauriClient.saved.get({ id });
    return saved ? toSavedArticle(saved) : toSavedArticle(toSavedRecord(article, id));
  }

  async unsaveArticle(id: string): Promise<void> {
    await tauriClient.saved.deleteSaved({ id });
  }

  async getSavedArticle(id: string): Promise<SavedArticle | null> {
    const record = await tauriClient.saved.get({ id });
    return record ? toSavedArticle(record) : null;
  }

  async getSavedArticleByHash(articleHash: string): Promise<SavedArticle | null> {
    const record = await tauriClient.saved.getByArticleHash({ articleHash });
    return record ? toSavedArticle(record) : null;
  }

  async findSavedArticle(articleHash: string, articleUrl?: string): Promise<SavedArticle | null> {
    const byHash = await this.getSavedArticleByHash(articleHash);
    if (byHash || !articleUrl) {
      return byHash;
    }
    const byLink = await tauriClient.saved.getByLink({ link: articleUrl });
    return byLink ? toSavedArticle(byLink) : null;
  }

  async getAllSavedArticles(): Promise<SavedArticle[]> {
    return (await tauriClient.saved.listAll()).map(toSavedArticle);
  }

  async querySavedArticles(limit?: number, offset?: number, searchText?: string) {
    const result = await tauriClient.saved.query({ limit, offset, searchText });
    return {
      articles: result.articles.map(toSavedArticle),
      total: result.total,
    };
  }

  async updateHighlights(id: string, highlights: SavedArticle['highlights']): Promise<void> {
    await tauriClient.saved.updateHighlights({ id, highlights });
  }

  async updateNotes(id: string, notes: string): Promise<void> {
    await tauriClient.saved.updateNotes({ id, notes });
  }

  async updateLastReadAt(id: string, lastReadAt = new Date().toISOString()): Promise<void> {
    await tauriClient.saved.updateLastReadAt({ id, lastReadAt });
  }
}

export const savedArticlesManager = new SavedArticlesManager();
