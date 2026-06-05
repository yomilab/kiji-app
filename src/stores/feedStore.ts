import { tauriClient } from "../lib/tauriClient";
import type { FeedRecord } from "../lib/tauriClient/contracts";
import type { Feed } from "../services/feeds/types";

export function recordToFeed(record: FeedRecord): Feed {
  return {
    id: record.id,
    title: record.title,
    url: record.url,
    createdAt: new Date(record.createdAt),
    description: record.description ?? undefined,
    lastFetched: record.lastFetched ? new Date(record.lastFetched) : undefined,
    lastFailedFetchAt: record.lastFailedFetchAt ? new Date(record.lastFailedFetchAt) : undefined,
    unreadCount: record.unreadCount,
    articleCount: record.articleCount,
    tags: record.tags,
    favicon: record.favicon ?? undefined,
    faviconHasTransparency: record.faviconHasTransparency ?? undefined,
    faviconDominantColor: record.faviconDominantColor ?? undefined,
    faviconBgLight: record.faviconBgLight ?? undefined,
    faviconBgDark: record.faviconBgDark ?? undefined,
    faviconFetchFailed: record.faviconFetchFailed,
    lastFaviconRefresh: record.lastFaviconRefresh ? new Date(record.lastFaviconRefresh) : undefined,
    emoji: record.emoji ?? undefined,
    image: record.image ?? undefined,
    categories: record.categories,
    language: record.language ?? undefined,
    isPodcast: record.isPodcast,
    podcastMetadata: record.podcastMetadata as Feed["podcastMetadata"],
    readerModeEnabled: record.readerModeEnabled,
    sortOrder: record.sortOrder,
    updateFrequencyScore: record.updateFrequencyScore,
    consecutiveFailures: record.consecutiveFailures,
    etag: record.etag ?? undefined,
    lastModifiedHeader: record.lastModifiedHeader ?? undefined,
  };
}

export function feedToRecord(feed: Feed): FeedRecord {
  return {
    id: feed.id,
    title: feed.title,
    url: feed.url,
    createdAt: feed.createdAt?.toISOString() ?? new Date().toISOString(),
    description: feed.description ?? null,
    lastFetched: feed.lastFetched?.toISOString() ?? null,
    lastFailedFetchAt: feed.lastFailedFetchAt?.toISOString() ?? null,
    unreadCount: feed.unreadCount ?? 0,
    articleCount: feed.articleCount ?? 0,
    tags: feed.tags,
    favicon: feed.favicon ?? null,
    faviconHasTransparency: feed.faviconHasTransparency ?? null,
    faviconDominantColor: feed.faviconDominantColor ?? null,
    faviconBgLight: feed.faviconBgLight ?? null,
    faviconBgDark: feed.faviconBgDark ?? null,
    faviconFetchFailed: feed.faviconFetchFailed ?? false,
    emoji: feed.emoji ?? null,
    image: feed.image ?? null,
    categories: feed.categories ?? [],
    language: feed.language ?? null,
    isPodcast: feed.isPodcast ?? false,
    podcastMetadata: feed.podcastMetadata ?? null,
    readerModeEnabled: feed.readerModeEnabled ?? false,
    etag: feed.etag ?? null,
    lastModifiedHeader: feed.lastModifiedHeader ?? null,
    sortOrder: feed.sortOrder ?? 0,
    updateFrequencyScore: feed.updateFrequencyScore ?? 0,
    consecutiveFailures: feed.consecutiveFailures ?? 0,
    lastFaviconRefresh: feed.lastFaviconRefresh?.toISOString() ?? null,
  };
}

export async function getAll(): Promise<Feed[]> {
  return (await tauriClient.feeds.list()).map(recordToFeed);
}

export async function getById(id: string): Promise<Feed | null> {
  const record = await tauriClient.feeds.get({ id });
  return record ? recordToFeed(record) : null;
}

export async function getByUrl(url: string): Promise<Feed | null> {
  const record = await tauriClient.feeds.getByUrl({ url });
  return record ? recordToFeed(record) : null;
}

export async function add(feed: Feed): Promise<void> {
  await tauriClient.feeds.create({ feed: feedToRecord(feed) });
}

export async function update(id: string, updates: Partial<Feed>): Promise<void> {
  const recordUpdates = feedToRecord({ id, title: "", url: "", tags: [], ...updates });
  await tauriClient.feeds.update({ id, updates: partialFeedRecord(updates, recordUpdates) });
}

export async function remove(id: string): Promise<boolean> {
  return tauriClient.feeds.deleteFeed({ id });
}

export async function updateUnreadCount(id: string, count: number): Promise<void> {
  await tauriClient.feeds.updateUnreadCount({ id, count });
}

export async function updateArticleCount(id: string, count: number): Promise<void> {
  await tauriClient.feeds.updateArticleCount({ id, count });
}

export async function updateLastFetched(id: string): Promise<void> {
  await tauriClient.feeds.updateLastFetched({ id, lastFetched: new Date().toISOString() });
}

export async function getCount(): Promise<number> {
  return tauriClient.feeds.count();
}

export const tags = {
  list: () => tauriClient.feeds.tags.list(),
  listWithFeedIds: () => tauriClient.feeds.tags.listWithFeedIds(),
  upsert: tauriClient.feeds.tags.upsert,
  update: tauriClient.feeds.tags.update,
  rename: tauriClient.feeds.tags.rename,
  delete: tauriClient.feeds.tags.delete,
  attachFeed: tauriClient.feeds.tags.attachFeed,
  detachFeed: tauriClient.feeds.tags.detachFeed,
  listFeedIds: tauriClient.feeds.tags.listFeedIds,
  listByFeed: tauriClient.feeds.tags.listByFeed,
};

function partialFeedRecord(updates: Partial<Feed>, record: FeedRecord): Partial<Omit<FeedRecord, "id">> {
  const partial: Partial<Omit<FeedRecord, "id">> = {};
  for (const key of Object.keys(updates) as Array<keyof Feed>) {
    if (key === "id") {
      continue;
    }
    const recordKey = key as keyof Omit<FeedRecord, "id">;
    partial[recordKey] = record[recordKey] as never;
  }
  return partial;
}
