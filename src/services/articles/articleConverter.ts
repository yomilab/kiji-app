import type { Article } from "../../types/article";
import type { Feed } from "../feeds/types";
import type { FeedItem } from "../feeds/feedsFetcher";
import { articleHasher } from "./articleHasher";
import { normalizePublishedDate } from "./publishedDateNormalizer";

export interface ConvertOptions {
  feedId: string;
  feedUrl: string;
  feed?: Feed | null;
  feedTitle?: string;
  fetchTime?: Date;
}

export async function convertFeedItemsToArticles(
  items: FeedItem[],
  options: ConvertOptions,
): Promise<Article[]> {
  const { feedId, feedUrl, feed, feedTitle, fetchTime = new Date() } = options;
  const now = new Date();
  const fallbackBaseTime = Number.isFinite(fetchTime.getTime())
    ? Math.min(fetchTime.getTime(), now.getTime())
    : now.getTime();

  return Promise.all(
    items.map(async (item, index): Promise<Article> => {
      const hash = await articleHasher.generateHash(item);
      const publishedDate =
        normalizePublishedDate(item.publishedDate, { now }) ??
        new Date(fallbackBaseTime - index).toISOString();
      const processed = processArticleContent(item, feedUrl);

      return {
        hash,
        title: processed.title,
        description: processed.description,
        content: processed.content,
        link: item.link,
        author: item.author ?? item.authors?.find((author) => author.name?.trim())?.name,
        publishedDate,
        fetchedDate: now.toISOString(),
        feedId,
        feedUrl,
        feedTitle: feed?.title ?? feedTitle,
        feedFavicon: feed?.favicon,
        feedFaviconHasTransparency: feed?.faviconHasTransparency,
        feedFaviconBgLight: feed?.faviconBgLight,
        feedFaviconBgDark: feed?.faviconBgDark,
        feedImage: feed?.image,
        read: false,
        starred: false,
        saved: false,
        updatedDate: item.updatedDate,
        summary: item.summary,
        guid: item.guid,
        previewImage: item.previewImage,
        thumbnail: item.thumbnail,
        images: item.images,
        enclosures: item.enclosures,
        categories: item.categories,
        authors: item.authors,
        duration: item.duration,
        episodeNumber: item.episodeNumber,
        seasonNumber: item.seasonNumber,
      };
    }),
  );
}

function processArticleContent(item: FeedItem, feedUrl?: string): {
  title: string;
  content: string;
  description: string;
} {
  const contentBaseUrl = item.link ?? feedUrl;
  const content = injectLeadImage(item.content, pickPrimaryImage(item, contentBaseUrl));

  if (item.title?.trim()) {
    const summaryText = toDisplayText(item.summary ?? "");
    const descriptionSource =
      summaryText.length >= 90 ? item.summary ?? item.content : item.content;
    return {
      title: toDisplayText(item.title),
      content,
      description: generateDescription(descriptionSource),
    };
  }

  const fallbackTitle = toDisplayText(item.summary ?? item.content).slice(0, 120).trim();
  return {
    title: fallbackTitle || "(No Title)",
    content,
    description: generateDescription(item.summary ?? item.content),
  };
}

function toDisplayText(raw: string): string {
  if (!raw) {
    return "";
  }

  try {
    const doc = new DOMParser().parseFromString(raw, "text/html");
    return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } catch {
    return raw.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}

function generateDescription(content: string): string {
  const text = toDisplayText(content);
  if (text.length <= 320) {
    return text;
  }

  const trimmed = Array.from(text).slice(0, 320).join("").trim();
  const lastSpaceIndex = trimmed.lastIndexOf(" ");
  return `${trimmed.slice(0, lastSpaceIndex > 224 ? lastSpaceIndex : trimmed.length).trim()}...`;
}

function pickPrimaryImage(item: FeedItem, baseUrl?: string): string | undefined {
  const candidates = [item.thumbnail?.url, ...(item.images ?? []), item.previewImage];
  for (const candidate of candidates) {
    const resolved = resolveUrl(candidate, baseUrl);
    if (resolved) {
      return resolved;
    }
  }
  return undefined;
}

function resolveUrl(url: string | undefined, baseUrl?: string): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed) {
    return undefined;
  }

  const candidate = trimmed.startsWith("//") ? `https:${trimmed}` : trimmed;
  if (!baseUrl) {
    return candidate;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return candidate;
  }
}

function injectLeadImage(content: string, imageUrl?: string): string {
  if (!imageUrl || /<img\b/i.test(content)) {
    return content;
  }

  return `<figure class="article-lead-image"><img src="${escapeAttribute(imageUrl)}" alt="" /></figure>${content}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
