import * as articleStore from "../../stores/articleStore";
import * as feedStore from "../../stores/feedStore";
import { FEED_FETCH_TIMEOUT_MS } from "../../constants";
import { convertFeedItemsToArticles } from "../articles/articleConverter";
import { analyzeFaviconAppearance } from "../favicons/faviconTransparency";
import { faviconFetcher } from "../favicons/faviconFetcher";
import { tauriClient } from "../../lib/tauriClient";
import { feedRefreshActivity } from "./feedRefreshActivity";
import { feedRefreshCoordinator } from "./feedRefreshCoordinator";
import { feedsFetcher } from "./feedsFetcher";
import type { Feed } from "./types";

export type { Feed } from "./types";

export interface AddFeedOptions {
  skipMetadataFetch?: boolean;
  skipFaviconRefresh?: boolean;
  id?: string;
}

export interface RefreshFeedResult {
  feedId: string;
  notModified: boolean;
  insertedCount: number;
}

class FeedsManager {
  async getAllFeeds(): Promise<Feed[]> {
    return feedStore.getAll();
  }

  async getFeedById(id: string): Promise<Feed | null> {
    return feedStore.getById(id);
  }

  async getFeedByUrl(url: string): Promise<Feed | null> {
    return feedStore.getByUrl(url);
  }

  async addFeed(url: string, title?: string, options: AddFeedOptions = {}): Promise<Feed> {
    const normalizedUrl = new URL(url.trim()).toString();
    const existingFeed = await this.getFeedByUrl(normalizedUrl);
    if (existingFeed) {
      throw new Error("This feed URL already exists in your library.");
    }

    const existingFeeds = await this.getAllFeeds();
    const metadata = options.skipMetadataFetch
      ? {}
      : await this.extractFeedMetadata(normalizedUrl);
    const now = new Date();
    const feed: Feed = {
      id: options.id ?? this.generateId(),
      url: normalizedUrl,
      title: title ?? metadata.title ?? normalizedUrl,
      createdAt: now,
      description: metadata.description,
      unreadCount: 0,
      articleCount: 0,
      tags: [],
      sortOrder: existingFeeds.length,
      image: metadata.image,
      categories: metadata.categories,
      language: metadata.language,
      isPodcast: metadata.isPodcast,
      podcastMetadata: metadata.podcastMetadata,
    };

    await feedStore.add(feed);
    if (!options.skipFaviconRefresh) {
      await this.refreshFavicon(feed.id, metadata.xmlText);
    }
    return (await this.getFeedById(feed.id)) ?? feed;
  }

  async addFeedWithoutMetadata(url: string, title?: string): Promise<Feed> {
    return this.addFeed(url, title, {
      skipMetadataFetch: true,
      skipFaviconRefresh: true,
    });
  }

  async updateFeed(id: string, updates: Partial<Feed>): Promise<Feed | null> {
    await feedStore.update(id, updates);
    return feedStore.getById(id);
  }

  async deleteFeed(id: string): Promise<boolean> {
    return feedStore.remove(id);
  }

  async refreshFeed(
    id: string,
    options: { signal?: AbortSignal; force?: boolean } = {},
  ): Promise<RefreshFeedResult> {
    return feedRefreshCoordinator.run(id, async () => {
      const feed = await this.requireFeed(id);

      try {
        const result = await feedRefreshActivity.track(id, () =>
          feedsFetcher.fetchFeedWithCache(feed.url, {
            etag: options.force ? undefined : feed.etag,
            lastModified: options.force ? undefined : feed.lastModifiedHeader,
            signal: options.signal,
          }),
        );

        if (result.notModified) {
          await feedStore.update(id, {
            lastFetched: new Date(),
            etag: result.etag ?? feed.etag,
            lastModifiedHeader: result.lastModified ?? feed.lastModifiedHeader,
            consecutiveFailures: 0,
            lastFailedFetchAt: undefined,
          });
          return { feedId: id, notModified: true, insertedCount: 0 };
        }

        const articles = await convertFeedItemsToArticles(result.items ?? [], {
          feedId: id,
          feedUrl: feed.url,
          feed,
          fetchTime: new Date(),
        });
        const insertedCount = await articleStore.store(id, articles);
        const articleCount = await articleStore.getArticleCount(id);
        const unreadCount = await articleStore.getUnreadCount(id);

        await feedStore.update(id, {
          lastFetched: new Date(),
          lastFailedFetchAt: undefined,
          consecutiveFailures: 0,
          etag: result.etag ?? feed.etag,
          lastModifiedHeader: result.lastModified ?? feed.lastModifiedHeader,
          articleCount,
          unreadCount,
        });

        return { feedId: id, notModified: false, insertedCount };
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        if (!aborted) {
          await feedStore.update(id, {
            lastFailedFetchAt: new Date(),
            consecutiveFailures: (feed.consecutiveFailures ?? 0) + 1,
          });
        }
        throw error;
      }
    }, options);
  }

  async applyFaviconResult(id: string, favicon: string | null): Promise<Feed | null> {
    const refreshedAt = new Date();

    if (!favicon) {
      const existing = await feedStore.getById(id);
      if (existing?.favicon) {
        return existing;
      }

      await feedStore.update(id, {
        faviconFetchFailed: true,
        lastFaviconRefresh: refreshedAt,
      });
      return feedStore.getById(id);
    }

    const appearance = await analyzeFaviconAppearance(favicon);
    await feedStore.update(id, {
      favicon,
      faviconHasTransparency: appearance.hasTransparency,
      faviconDominantColor: appearance.dominantColor ?? undefined,
      faviconBgLight: appearance.containerBgLight ?? undefined,
      faviconBgDark: appearance.containerBgDark ?? undefined,
      faviconFetchFailed: false,
      lastFaviconRefresh: refreshedAt,
    });
    await articleStore.updateFeedMeta(id, {
      feedFavicon: favicon,
      feedFaviconHasTransparency: appearance.hasTransparency,
      feedFaviconBgLight: appearance.containerBgLight ?? undefined,
      feedFaviconBgDark: appearance.containerBgDark ?? undefined,
    });
    return feedStore.getById(id);
  }

  async refreshFavicon(id: string, feedXmlText?: string): Promise<string | null> {
    const feed = await this.requireFeed(id);
    const favicon = await faviconFetcher.fetchFavicon(feed.url, feedXmlText);
    await this.applyFaviconResult(id, favicon);
    return favicon;
  }

  generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
  }

  private async requireFeed(id: string): Promise<Feed> {
    const feed = await this.getFeedById(id);
    if (!feed) {
      throw new Error(`Feed not found: ${id}`);
    }
    return feed;
  }

  private async extractFeedMetadata(url: string): Promise<Partial<Feed> & { xmlText?: string }> {
    try {
      const xmlText = await feedsFetcherText(url);
      const doc = new DOMParser().parseFromString(xmlText, "text/xml");
      const channel = doc.querySelector("channel");
      const atomFeed = doc.querySelector("feed");
      const isPodcast = !!doc.querySelector("itunes\\:author, itunes\\:category, itunes\\:image");
      const podcastCategories = Array.from(doc.querySelectorAll("itunes\\:category"))
        .map((node) => node.getAttribute("text") ?? node.textContent?.trim())
        .filter((value): value is string => !!value);
      const podcastAuthor = text(doc.documentElement, "itunes\\:author") || undefined;

      return {
        title: text(channel, "title") || text(atomFeed, "title") || undefined,
        description: text(channel, "description") || text(atomFeed, "subtitle") || undefined,
        image:
          text(channel, "image > url") ||
          text(atomFeed, "logo") ||
          text(atomFeed, "icon") ||
          undefined,
        categories: Array.from(doc.querySelectorAll("category"))
          .map((node) => node.textContent?.trim())
          .filter((value): value is string => !!value),
        language: text(channel, "language") || undefined,
        isPodcast,
        podcastMetadata: isPodcast
          ? { author: podcastAuthor, categories: podcastCategories }
          : undefined,
        xmlText,
      };
    } catch {
      return {};
    }
  }
}

async function feedsFetcherText(url: string): Promise<string> {
  const response = await tauriClient.feeds.fetchWithCache({
    url,
    timeout: FEED_FETCH_TIMEOUT_MS,
  });
  return response.data ?? "";
}

function text(root: ParentNode | null, selector: string): string {
  return root?.querySelector(selector)?.textContent?.trim() ?? "";
}

export const feedsManager = new FeedsManager();
