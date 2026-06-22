import type { Author, Enclosure, MediaThumbnail } from "../../types/article";
import { FEED_FETCH_TIMEOUT_MS } from "../../constants";
import { tauriClient } from "../../lib/tauriClient";
import { enrichFeedItemsWithMatchedDates, matchPublishedDate, matchPublishedDateFromElement, matchUpdatedDate, matchUpdatedDateFromElement } from "./publishDateMatcher";
import { logger } from "../logger/logger";
import { parseFeedWithFeedsmith } from "./feedsmithAdapter";
import {
  estimateUtf8Bytes,
  logFeedNetworkAttribution,
  type FeedParseAttribution,
} from "@/services/diagnostics/webKitAttribution";

export type { Author, Enclosure, MediaThumbnail };

export interface FeedItem {
  id: string;
  title: string;
  content: string;
  link?: string;
  author?: string;
  publishedDate?: string;
  feedId: string;
  updatedDate?: string;
  summary?: string;
  guid?: string;
  previewImage?: string;
  thumbnail?: MediaThumbnail;
  images?: string[];
  enclosures?: Enclosure[];
  categories?: string[];
  authors?: Author[];
  duration?: number;
  episodeNumber?: number;
  seasonNumber?: number;
}

export interface FeedNetworkFetchResult {
  notModified: boolean;
  data?: string;
  etag?: string;
  lastModified?: string;
}

export interface FeedFetchResult {
  notModified: boolean;
  data?: string;
  items?: FeedItem[];
  etag?: string;
  lastModified?: string;
}

export interface FeedParseResultWithDiagnostics {
  items: FeedItem[];
  diagnostics: Omit<FeedParseAttribution, "durationMs" | "workerQueueDepth" | "workerPendingCount">;
}

class FeedsFetcher {
  async fetchFeed(url: string, options?: { signal?: AbortSignal }): Promise<FeedItem[]> {
    const result = await this.fetchFeedWithCache(url, options);
    if (result.notModified || !result.items) {
      throw new Error(
        "Feed not modified, but fetchFeed requires items. Use fetchFeedWithCache instead.",
      );
    }
    return result.items;
  }

  async fetchFeedNetworkWithCache(
    url: string,
    options: { etag?: string; lastModified?: string; signal?: AbortSignal } = {},
  ): Promise<FeedNetworkFetchResult> {
    const normalizedUrl = validateFeedUrl(url);
    const requestId = `feed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const abortListener = () => {
      void tauriClient.feeds.abortRequest({ requestId });
    };

    options.signal?.addEventListener("abort", abortListener, { once: true });
    const startedAt = performance.now();
    try {
      this.throwIfAborted(options.signal);
      const response = await tauriClient.feeds.fetchWithCache({
        url: normalizedUrl,
        requestId,
        etag: options.etag,
        lastModified: options.lastModified,
        timeout: FEED_FETCH_TIMEOUT_MS,
      });
      this.throwIfAborted(options.signal);
      const durationMs = Math.round(performance.now() - startedAt);

      if (response.notModified || !response.data) {
        logFeedNetworkAttribution({
          feedUrl: normalizedUrl,
          requestId,
          notModified: true,
          responseBytes: 0,
          responseChars: 0,
          durationMs,
        });
        return {
          notModified: true,
          etag: response.etag ?? undefined,
          lastModified: response.lastModified ?? undefined,
        };
      }

      logFeedNetworkAttribution({
        feedUrl: normalizedUrl,
        requestId,
        notModified: false,
        responseBytes: estimateUtf8Bytes(response.data),
        responseChars: response.data.length,
        durationMs,
      });

      return {
        notModified: false,
        data: response.data,
        etag: response.etag ?? undefined,
        lastModified: response.lastModified ?? undefined,
      };
    } finally {
      options.signal?.removeEventListener("abort", abortListener);
    }
  }

  async fetchFeedWithCache(
    url: string,
    options: { etag?: string; lastModified?: string; signal?: AbortSignal } = {},
  ): Promise<FeedFetchResult> {
    const normalizedUrl = validateFeedUrl(url);
    const networkResult = await this.fetchFeedNetworkWithCache(url, options);

    if (networkResult.notModified || !networkResult.data) {
      return {
        notModified: true,
        etag: networkResult.etag,
        lastModified: networkResult.lastModified,
      };
    }

    return {
      notModified: false,
      data: networkResult.data,
      items: parseFeed(networkResult.data, normalizedUrl),
      etag: networkResult.etag,
      lastModified: networkResult.lastModified,
    };
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      const error = new Error("Feed fetch was aborted");
      error.name = "AbortError";
      throw error;
    }
  }
}

export const feedsFetcher = new FeedsFetcher();

export function parseFeed(rawText: string, feedUrl: string): FeedItem[] {
  return parseFeedWithDiagnostics(rawText, feedUrl).items;
}

export function parseFeedWithDiagnostics(rawText: string, feedUrl: string): FeedParseResultWithDiagnostics {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Received empty response from feed URL");
  }
  const baseDiagnostics = {
    feedUrl,
    rawBytes: estimateUtf8Bytes(rawText),
    rawChars: rawText.length,
  };

  try {
    const items = assertItems(parseFeedWithFeedsmith(trimmed, feedUrl));
    const dateEnrichment = enrichFeedItemsWithMatchedDates(items, trimmed);
    return {
      items,
      diagnostics: {
        ...baseDiagnostics,
        parserPath: "feedsmith",
        itemCount: items.length,
        domParserUsed: dateEnrichment.domParserUsed,
        domNodeCount: dateEnrichment.domParserUsed ? dateEnrichment.elementCount : undefined,
        dateEnrichmentDomParserUsed: dateEnrichment.domParserUsed,
        dateEnrichmentElementCount: dateEnrichment.elementCount,
        ...summarizeFeedItems(items),
      },
    };
  } catch (feedsmithError) {
    logger.warn("FeedsFetcher", "Feedsmith parsing failed, using fallback parser", {
      feedUrl,
      error: feedsmithError,
    });
  }

  if (trimmed.startsWith("{")) {
    const items = parseJsonFeed(trimmed, feedUrl);
    return {
      items,
      diagnostics: {
        ...baseDiagnostics,
        parserPath: "json-feed",
        itemCount: items.length,
        domParserUsed: false,
        ...summarizeFeedItems(items),
      },
    };
  }

  const xmlDoc = new DOMParser().parseFromString(trimmed, "text/xml");
  const parseError = xmlDoc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Failed to parse feed XML: ${parseError.textContent ?? "Unknown parsing error"}`);
  }

  if (xmlDoc.querySelector("feed")) {
    const items = parseAtomFeed(xmlDoc, feedUrl);
    return {
      items,
      diagnostics: {
        ...baseDiagnostics,
        parserPath: "atom-dom-fallback",
        itemCount: items.length,
        domParserUsed: true,
        ...summarizeFeedDom(xmlDoc),
        ...summarizeFeedItems(items),
      },
    };
  }
  if (xmlDoc.querySelector("rss, channel, rdf\\:RDF, RDF")) {
    const items = parseRssFeed(xmlDoc, feedUrl);
    return {
      items,
      diagnostics: {
        ...baseDiagnostics,
        parserPath: "rss-dom-fallback",
        itemCount: items.length,
        domParserUsed: true,
        ...summarizeFeedDom(xmlDoc),
        ...summarizeFeedItems(items),
      },
    };
  }

  throw new Error("Feed format not recognized. Expected RSS, Atom, or JSON Feed.");
}

function summarizeFeedDom(xmlDoc: Document): Pick<FeedParseAttribution, "domNodeCount" | "imageElementCount" | "mediaElementCount"> {
  return {
    domNodeCount: xmlDoc.querySelectorAll("*").length,
    imageElementCount: xmlDoc.querySelectorAll("image, img, media\\:thumbnail, media\\:content, itunes\\:image").length,
    mediaElementCount: xmlDoc.querySelectorAll("enclosure, media\\:content, media\\:thumbnail, itunes\\:image").length,
  };
}

function summarizeFeedItems(items: FeedItem[]): Pick<FeedParseAttribution, "enclosureCount" | "maxItemContentChars" | "totalItemContentChars"> {
  let enclosureCount = 0;
  let maxItemContentChars = 0;
  let totalItemContentChars = 0;

  for (const item of items) {
    const contentChars = item.content.length + (item.summary?.length ?? 0);
    totalItemContentChars += contentChars;
    maxItemContentChars = Math.max(maxItemContentChars, contentChars);
    enclosureCount += item.enclosures?.length ?? 0;
  }

  return {
    enclosureCount,
    maxItemContentChars,
    totalItemContentChars,
  };
}

function parseRssFeed(xmlDoc: Document, feedUrl: string): FeedItem[] {
  const items = Array.from(xmlDoc.querySelectorAll("item")).map((item, index) => {
    const content = textFromSelectors(item, [
      "content\\:encoded",
      "encoded",
      "itunes\\:summary",
      "description",
      "summary",
    ]);
    const link = cleanLink(textFromSelectors(item, ["link", "guid", "dc\\:identifier"]), feedUrl);
    const image = extractImage(item, feedUrl);
    const duration = parseDuration(textFromSelectors(item, ["itunes\\:duration", "duration"]));
    const guid = textFromSelectors(item, ["guid"]);
    const title = textFromSelectors(item, ["title", "dc\\:title"]);

    return {
      id: guid || link || `${feedUrl}-${index}`,
      title,
      content,
      summary: textFromSelectors(item, ["description"]) || undefined,
      link,
      author: textFromSelectors(item, ["author", "dc\\:creator", "itunes\\:author"]) || undefined,
      publishedDate: matchPublishedDateFromElement(item, {
        explicit: [textFromSelectors(item, ["pubDate", "dc\\:date", "published", "updated"])],
      }),
      guid: guid || undefined,
      feedId: feedUrl,
      previewImage: image,
      thumbnail: image ? { url: image } : undefined,
      images: image ? [image] : undefined,
      enclosures: extractEnclosures(item, feedUrl, duration),
      categories: uniqueText(Array.from(item.querySelectorAll("category")).map((node) => node.textContent)),
      duration,
    } satisfies FeedItem;
  });

  return assertItems(items);
}

function parseAtomFeed(xmlDoc: Document, feedUrl: string): FeedItem[] {
  const items = Array.from(xmlDoc.querySelectorAll("entry")).map((entry, index) => {
    const content = textFromSelectors(entry, ["content", "summary"]);
    const link =
      Array.from(entry.querySelectorAll("link")).find((node) => !node.getAttribute("rel") || node.getAttribute("rel") === "alternate")?.getAttribute("href") ??
      textFromSelectors(entry, ["id"]);
    const image = extractImage(entry, feedUrl);
    const authors = Array.from(entry.querySelectorAll("author")).map((author): Author => ({
      name: textFromSelectors(author, ["name"]) || author.textContent?.trim() || "",
      email: textFromSelectors(author, ["email"]) || undefined,
      uri: textFromSelectors(author, ["uri"]) || undefined,
    })).filter((author) => author.name);

    return {
      id: textFromSelectors(entry, ["id"]) || link || `${feedUrl}-${index}`,
      title: textFromSelectors(entry, ["title"]),
      content,
      summary: textFromSelectors(entry, ["summary"]) || undefined,
      link: cleanLink(link ?? "", feedUrl),
      author: authors[0]?.name,
      publishedDate: matchPublishedDateFromElement(entry, {
        explicit: [
          textFromSelectors(entry, ["published"]),
          textFromSelectors(entry, ["updated"]),
        ],
      }),
      updatedDate: matchUpdatedDateFromElement(entry, {
        explicit: [textFromSelectors(entry, ["updated"])],
      }),
      guid: textFromSelectors(entry, ["id"]) || undefined,
      feedId: feedUrl,
      previewImage: image,
      thumbnail: image ? { url: image } : undefined,
      images: image ? [image] : undefined,
      enclosures: extractAtomEnclosures(entry, feedUrl),
      categories: uniqueText(Array.from(entry.querySelectorAll("category")).map((node) => node.getAttribute("term") ?? node.getAttribute("label"))),
      authors,
    } satisfies FeedItem;
  });

  return assertItems(items);
}

function parseJsonFeed(rawText: string, feedUrl: string): FeedItem[] {
  const feed = JSON.parse(rawText) as {
    items?: Array<{
      id?: string;
      title?: string;
      content_html?: string;
      content_text?: string;
      summary?: string;
      url?: string;
      date_published?: string;
      date_modified?: string;
      image?: string;
      tags?: string[];
      authors?: Array<{ name?: string; url?: string }>;
      attachments?: Array<{ url: string; mime_type?: string; size_in_bytes?: number; duration_in_seconds?: number }>;
    }>;
  };

  return assertItems((feed.items ?? []).map((item, index): FeedItem => {
    const content = item.content_html ?? item.content_text ?? "";
    const authors = item.authors?.map((author) => ({ name: author.name ?? "", uri: author.url })).filter((author) => author.name);
    const enclosures = item.attachments?.map((attachment) => ({
      url: attachment.url,
      type: attachment.mime_type ?? "application/octet-stream",
      length: attachment.size_in_bytes,
      duration: attachment.duration_in_seconds,
    }));

    return {
      id: item.id ?? item.url ?? `${feedUrl}-${index}`,
      title: item.title ?? "",
      content,
      summary: item.summary,
      link: item.url,
      author: authors?.[0]?.name,
      publishedDate: matchPublishedDate({
        explicit: [item.date_published, item.date_modified],
        source: item,
      }),
      updatedDate: matchUpdatedDate({
        explicit: [item.date_modified],
        source: item,
      }),
      guid: item.id,
      feedId: feedUrl,
      previewImage: item.image,
      thumbnail: item.image ? { url: item.image } : undefined,
      images: item.image ? [item.image] : undefined,
      enclosures,
      categories: item.tags,
      authors,
      duration: enclosures?.[0]?.duration,
    };
  }));
}

function assertItems(items: FeedItem[]): FeedItem[] {
  const readable = items.filter((item) => item.title || item.link || item.enclosures?.length);
  if (readable.length === 0) {
    throw new Error("No feed items found in the feed");
  }
  return readable;
}

function validateFeedUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Invalid feed URL provided");
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Feed URL must use HTTP or HTTPS");
  }
  return parsed.toString();
}

function textFromSelectors(element: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const found = element.querySelector(selector) ?? element.getElementsByTagName(selector)[0];
    const text = found?.textContent?.trim() ?? found?.getAttribute("href")?.trim() ?? "";
    if (text) {
      return text;
    }
  }
  return "";
}

function cleanLink(link: string, baseUrl: string): string | undefined {
  const trimmed = link.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return trimmed;
  }
}

function extractImage(item: Element, feedUrl: string): string | undefined {
  const candidate = item.querySelector("media\\:thumbnail, media\\:content, itunes\\:image, enclosure, image");
  const raw = candidate?.getAttribute("url") ?? candidate?.getAttribute("href") ?? candidate?.textContent ?? "";
  return cleanLink(raw, feedUrl);
}

function extractEnclosures(item: Element, feedUrl: string, duration?: number): Enclosure[] | undefined {
  const enclosures = Array.from(item.querySelectorAll("enclosure"))
    .map((enclosure): Enclosure | null => {
      const url = cleanLink(enclosure.getAttribute("url") ?? "", feedUrl);
      if (!url) {
        return null;
      }
      return {
        url,
        type: enclosure.getAttribute("type") ?? "application/octet-stream",
        length: parsePositiveNumber(enclosure.getAttribute("length")),
        duration,
      };
    })
    .filter((enclosure): enclosure is Enclosure => !!enclosure);
  return enclosures.length > 0 ? enclosures : undefined;
}

function extractAtomEnclosures(entry: Element, feedUrl: string): Enclosure[] | undefined {
  const enclosures = Array.from(entry.querySelectorAll('link[rel="enclosure"]'))
    .map((link): Enclosure | null => {
      const url = cleanLink(link.getAttribute("href") ?? "", feedUrl);
      return url ? { url, type: link.getAttribute("type") ?? "application/octet-stream", length: parsePositiveNumber(link.getAttribute("length")) } : null;
    })
    .filter((enclosure): enclosure is Enclosure => !!enclosure);
  return enclosures.length > 0 ? enclosures : undefined;
}

function parseDuration(duration?: string | number | null): number | undefined {
  if (duration === undefined || duration === null || duration === "") {
    return undefined;
  }
  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }
  const parts = duration.split(":").map(Number);
  if (!parts.every((part) => Number.isFinite(part) && part >= 0)) {
    return undefined;
  }
  const seconds =
    parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] :
      parts.length === 2 ? parts[0] * 60 + parts[1] :
        parts[0];
  return seconds > 0 ? seconds : undefined;
}

function parsePositiveNumber(value?: string | null): number | undefined {
  const parsed = value ? Number(value) : undefined;
  return parsed !== undefined && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function uniqueText(values: Array<string | null | undefined>): string[] | undefined {
  const unique = Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean))) as string[];
  return unique.length > 0 ? unique : undefined;
}
