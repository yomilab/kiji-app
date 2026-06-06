import { tauriClient } from "../lib/tauriClient";
import type { ArticleRecord } from "../lib/tauriClient/contracts";
import type { Article } from "../types/article";
import type { ArticleQuery, ArticleQueryResult } from "../types/articleQuery";
import { normalizePublishedDate } from "../services/articles/publishedDateNormalizer";

type ArticleMetadata = Partial<Pick<
  Article,
  | "updatedDate"
  | "summary"
  | "guid"
  | "previewImage"
  | "thumbnail"
  | "images"
  | "enclosures"
  | "categories"
  | "authors"
  | "duration"
  | "episodeNumber"
  | "seasonNumber"
  | "savedDate"
  | "isFeedLinked"
>>;

export function recordToArticle(record: ArticleRecord, options: { now?: Date } = {}): Article {
  const metadata = normalizeMetadata(record.metadata);
  return {
    hash: record.hash,
    title: record.title,
    description: record.description,
    content: record.content,
    link: record.link ?? undefined,
    author: record.author ?? undefined,
    publishedDate: normalizePublishedDate(record.publishedDate, options),
    fetchedDate: record.fetchedDate,
    feedId: record.feedId,
    feedUrl: record.feedUrl ?? "",
    feedTitle: record.feedTitle ?? undefined,
    feedFavicon: record.feedFavicon ?? undefined,
    feedFaviconHasTransparency: record.feedFaviconHasTransparency ?? undefined,
    feedFaviconBgLight: record.feedFaviconBgLight ?? undefined,
    feedFaviconBgDark: record.feedFaviconBgDark ?? undefined,
    feedImage: record.feedImage ?? undefined,
    read: record.read,
    starred: record.starred,
    saved: record.saved,
    savedArticleId: record.savedArticleId ?? undefined,
    lastReadAt: record.lastReadAt ?? undefined,
    ...metadata,
  };
}

export function articleToRecord(article: Article): ArticleRecord {
  return {
    hash: article.hash,
    feedId: article.feedId,
    title: article.title,
    description: article.description,
    content: article.content,
    link: article.link ?? null,
    author: article.author ?? null,
    publishedDate: normalizePublishedDate(article.publishedDate) ?? null,
    fetchedDate: article.fetchedDate,
    read: article.read,
    starred: article.starred,
    saved: article.saved,
    savedArticleId: article.savedArticleId ?? null,
    lastReadAt: article.lastReadAt ?? null,
    metadata: buildMetadata(article),
    feedUrl: article.feedUrl ?? null,
    feedTitle: article.feedTitle ?? null,
    feedFavicon: article.feedFavicon ?? null,
    feedFaviconHasTransparency: article.feedFaviconHasTransparency ?? null,
    feedFaviconBgLight: article.feedFaviconBgLight ?? null,
    feedFaviconBgDark: article.feedFaviconBgDark ?? null,
    feedImage: article.feedImage ?? null,
  };
}

export async function query(q: ArticleQuery): Promise<ArticleQueryResult> {
  const now = new Date();
  const result = await tauriClient.articles.query({
    feedIds: q.feedIds,
    tagName: q.tagName,
    read: q.filter?.read,
    starred: q.filter?.starred,
    saved: q.filter?.saved,
    sortField: q.sort?.field === "publishedDate" ? "published_date" : q.sort?.field === "fetchedDate" ? "fetched_date" : undefined,
    sortOrder: q.sort?.order,
    searchText: q.searchText,
    limit: q.limit,
    offset: q.offset,
    cursorDate: q.cursor?.effectiveDate,
    cursorHash: q.cursor?.hash,
    includeTotal: q.includeTotal,
  });

  return {
    articles: result.articles.map((record) => recordToArticle(record, { now })),
    total: result.total,
  };
}

export async function store(_feedId: string, articles: Article[]): Promise<number> {
  if (articles.length === 0) {
    return 0;
  }
  return tauriClient.articles.insertBatch({ articles: articles.map(articleToRecord) });
}

export async function getByHash(hash: string): Promise<Article | null> {
  const record = await tauriClient.articles.get({ hash });
  return record ? recordToArticle(record) : null;
}

export async function getContent(hash: string): Promise<string | null> {
  return tauriClient.articles.getContent({ hash });
}

export async function getSavedContent(id: string): Promise<string | null> {
  return tauriClient.saved.getContent({ id });
}

export async function exists(hash: string): Promise<boolean> {
  return tauriClient.articles.exists({ hash });
}

export async function markRead(hash: string, read: boolean): Promise<void> {
  await tauriClient.articles.updateRead({ hash, read });
}

export async function updateLastReadAt(hash: string, lastReadAt = new Date().toISOString()): Promise<void> {
  await tauriClient.articles.updateLastReadAt({ hash, lastReadAt });
}

export async function toggleStarred(hash: string): Promise<boolean> {
  return tauriClient.articles.toggleStarred({ hash });
}

export async function updateSavedStatus(
  hash: string,
  saved: boolean,
  savedArticleId?: string,
): Promise<void> {
  await tauriClient.articles.updateSavedState({ hash, saved, savedArticleId });
}

export async function deleteByFeed(feedId: string): Promise<string[]> {
  return tauriClient.articles.deleteByFeed({ feedId });
}

export async function cleanOld(feedId: string, daysToKeep: number): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  return tauriClient.articles.cleanOldByFeed({ feedId, cutoffDate: cutoffDate.toISOString() });
}

export async function cleanOldAcrossFeeds(monthsToKeep: 1 | 3 | 6): Promise<number> {
  const cutoffDate = getMonthsAgoCutoffDate(monthsToKeep);
  return tauriClient.articles.cleanOldAcrossFeeds({ cutoffDate: cutoffDate.toISOString() });
}

export async function getUnreadCount(feedId: string): Promise<number> {
  return tauriClient.articles.countUnreadByFeed({ feedId });
}

export async function getArticleCount(feedId: string): Promise<number> {
  return tauriClient.articles.countByFeed({ feedId });
}

export async function updateFeedMeta(
  feedId: string,
  meta: {
    feedUrl?: string;
    feedTitle?: string;
    feedFavicon?: string;
    feedFaviconHasTransparency?: boolean;
    feedFaviconBgLight?: string;
    feedFaviconBgDark?: string;
    feedImage?: string;
  },
): Promise<void> {
  await tauriClient.articles.updateFeedMeta({ feedId, meta });
}

function buildMetadata(article: Article): ArticleMetadata | null {
  const metadata: ArticleMetadata = {};
  const keys: Array<keyof ArticleMetadata> = [
    "updatedDate",
    "summary",
    "guid",
    "previewImage",
    "thumbnail",
    "images",
    "enclosures",
    "categories",
    "authors",
    "duration",
    "episodeNumber",
    "seasonNumber",
    "savedDate",
    "isFeedLinked",
  ];

  for (const key of keys) {
    if (article[key] !== undefined) {
      metadata[key] = article[key] as never;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : null;
}

function normalizeMetadata(value: unknown): ArticleMetadata {
  return value && typeof value === "object" ? value as ArticleMetadata : {};
}

function getMonthsAgoCutoffDate(monthsToKeep: 1 | 3 | 6): Date {
  const cutoffDate = new Date();
  const dayOfMonth = cutoffDate.getDate();
  cutoffDate.setDate(1);
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsToKeep);
  const lastDayOfTargetMonth = new Date(
    cutoffDate.getFullYear(),
    cutoffDate.getMonth() + 1,
    0,
  ).getDate();
  cutoffDate.setDate(Math.min(dayOfMonth, lastDayOfTargetMonth));
  return cutoffDate;
}
