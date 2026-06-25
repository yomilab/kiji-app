import type { Article } from '@/types/article';
import type { Feed } from '@/services/feeds/types';
import { convertFeedItemsToArticles } from '@/services/articles/articleConverter';
import { computeFrequencyFromDates } from '@/services/scheduler/feedPriorityCalculator';
import * as articleStore from '@/stores/articleStore';
import { parseFeedOffMainThread } from '@/services/feeds/feedParseWorkerClient';

export interface StoreParsedFeedOptions {
  feedId: string;
  feedUrl: string;
  feed?: Feed | null;
  feedTitle?: string;
  rawText: string;
  signal?: AbortSignal;
}

export interface StoreParsedFeedResult {
  insertedCount: number;
  articles: Article[];
  updateFrequencyScore?: number;
}

/** Renderer parse/store path used when native ingestion is disabled or for add-feed validation. */
export async function storeParsedFeedContent(
  options: StoreParsedFeedOptions,
): Promise<StoreParsedFeedResult> {
  const { feedId, feedUrl, feed, feedTitle, rawText, signal } = options;

  if (signal?.aborted) {
    return { insertedCount: 0, articles: [] };
  }

  const feedItems = await parseFeedOffMainThread(rawText, feedUrl);
  if (signal?.aborted) {
    return { insertedCount: 0, articles: [] };
  }

  const articles = await convertFeedItemsToArticles(feedItems, {
    feedId,
    feedUrl,
    feed,
    feedTitle,
  });
  if (signal?.aborted) {
    return { insertedCount: 0, articles: [] };
  }

  const insertedCount = await articleStore.store(feedId, articles);
  const dates = articles
    .map((article) => article.publishedDate)
    .filter((date): date is string => !!date);
  const updateFrequencyScore = dates.length > 0
    ? computeFrequencyFromDates(dates)
    : undefined;

  return {
    insertedCount,
    articles,
    updateFrequencyScore,
  };
}
