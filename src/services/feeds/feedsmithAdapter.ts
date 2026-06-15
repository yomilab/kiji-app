import { parseFeed as parseFeedsmith } from "feedsmith";
import type { Atom, Json, Rdf, Rss } from "feedsmith";
import type { Author, Enclosure, MediaThumbnail } from "../../types/article";
import { getOptionalField, getTextValue } from "./feedValueExtractor";
import { matchPublishedDate, matchUpdatedDate } from "./publishDateMatcher";
import type { FeedItem } from "./feedsFetcher";

export function parseFeedWithFeedsmith(rawText: string, feedUrl: string): FeedItem[] {
  const parsed = parseFeedsmith(rawText);
  return convertToFeedItems(parsed, feedUrl);
}

function convertToFeedItems(parsedFeed: unknown, feedUrl: string): FeedItem[] {
  const parsed = parsedFeed as { format: string; feed: unknown };

  switch (parsed.format) {
    case "rss":
      return convertRssItems(parsed.feed as Rss.Feed<unknown>, feedUrl);
    case "atom":
      return convertAtomEntries(parsed.feed as Atom.Feed<unknown>, feedUrl);
    case "rdf":
      return convertRdfItems(parsed.feed as Rdf.Feed<unknown>, feedUrl);
    case "json":
      return convertJsonItems(parsed.feed as Json.Feed<unknown>, feedUrl);
    default:
      throw new Error(`Unsupported feed format: ${parsed.format}`);
  }
}

function convertRssItems(feed: Rss.Feed<unknown>, feedUrl: string): FeedItem[] {
  return (
    feed.items?.map((item, index): FeedItem => {
      const thumbnail = extractThumbnail(item);
      const images = extractImages(item);
      const duration = parseDuration(item.itunes?.duration);
      const enclosures = extractEnclosures(item, duration);
      const authors = extractAuthors(item);
      const contentValue = item.content?.encoded || item.itunes?.summary || item.description || "";
      const previewImage = pickPreviewImage({
        thumbnail: thumbnail?.url,
        images,
        content: contentValue,
      });

      return {
        id: item.guid?.value || generateItemId(feedUrl, index),
        title: getTextValue(item.title) || "",
        content: contentValue,
        summary: item.description !== contentValue ? item.description : undefined,
        link: item.link,
        author: item.authors?.[0] || authors?.[0]?.name || item.itunes?.author,
        publishedDate: matchPublishedDate({
          explicit: [
            getTextValue(item.pubDate),
            getTextValue(item.dc?.dates?.[0]),
            getOptionalField(item, "published"),
            getOptionalField(item, "updated"),
          ],
          source: item,
        }),
        guid: item.guid?.value,
        feedId: feedUrl,
        updatedDate: matchUpdatedDate({
          explicit: [getOptionalField(item, "updated")],
          source: item,
        }),
        previewImage,
        thumbnail,
        images,
        enclosures,
        categories: extractCategories(item),
        authors,
        duration,
        episodeNumber: item.itunes?.episode,
        seasonNumber: item.itunes?.season,
      };
    }) ?? []
  );
}

function convertAtomEntries(feed: Atom.Feed<unknown>, feedUrl: string): FeedItem[] {
  return (
    feed.entries?.map((entry, index): FeedItem => {
      const link = entry.links?.find((l) => l.rel === "alternate" || !l.rel)?.href;
      const thumbnail = extractAtomThumbnail(entry);
      const images = extractAtomImages(entry);
      const contentValue = getAtomTextValue(entry.content) || getAtomTextValue(entry.summary) || "";
      const summaryValue = getAtomTextValue(entry.summary);
      const contentRawValue = getAtomTextValue(entry.content);
      const previewImage = pickPreviewImage({
        thumbnail: thumbnail?.url,
        images,
        content: contentValue,
      });

      return {
        id: entry.id || generateItemId(feedUrl, index),
        title: getTextValue(entry.title) || "",
        content: contentValue,
        summary: summaryValue !== contentRawValue ? summaryValue : undefined,
        link,
        author: entry.authors?.[0]?.name,
        publishedDate: matchPublishedDate({
          explicit: [getTextValue(entry.published), getTextValue(entry.updated)],
          source: entry,
        }),
        updatedDate: matchUpdatedDate({
          explicit: [getTextValue(entry.updated)],
          source: entry,
        }),
        guid: entry.id,
        feedId: feedUrl,
        previewImage,
        thumbnail,
        images,
        enclosures: extractAtomEnclosures(entry),
        categories: entry.categories?.map((c) => c.term || c.label).filter(Boolean) as string[],
        authors: entry.authors?.map((a) => ({
          name: a.name || "",
          email: a.email,
          uri: a.uri,
        })),
        duration: parseDuration(entry.itunes?.duration),
        episodeNumber: entry.itunes?.episode,
        seasonNumber: entry.itunes?.season,
      };
    }) ?? []
  );
}

function getAtomTextValue(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && "value" in value) {
    const nested = (value as { value?: unknown }).value;
    if (typeof nested === "string") {
      return nested;
    }
  }
  return undefined;
}

function convertRdfItems(feed: Rdf.Feed<unknown>, feedUrl: string): FeedItem[] {
  return (
    feed.items?.map((item, index): FeedItem => {
      const contentValue = item.description || "";
      const previewImage = pickPreviewImage({ content: contentValue });

      return {
        id: item.link || generateItemId(feedUrl, index),
        title: getTextValue(item.title) || "",
        content: item.description || "",
        link: item.link,
        author: getTextValue(item.dc?.creators?.[0]),
        publishedDate: matchPublishedDate({
          explicit: [
            getTextValue(item.dc?.dates?.[0]),
            getOptionalField(item, "published"),
            getOptionalField(item, "updated"),
            getTextValue(item.atom?.updated),
          ],
          source: item,
        }),
        guid: item.link,
        feedId: feedUrl,
        updatedDate: matchUpdatedDate({
          explicit: [
            getOptionalField(item, "updated"),
            getTextValue(item.atom?.updated),
          ],
          source: item,
        }),
        summary: undefined,
        previewImage,
        thumbnail: undefined,
        images: undefined,
        enclosures: undefined,
        categories: item.dc?.subjects?.filter(Boolean) as string[] | undefined,
        authors: item.dc?.creators?.length
          ? item.dc.creators
              .map((creator) => getTextValue(creator))
              .filter((creator): creator is string => !!creator)
              .map((name) => ({ name }))
          : undefined,
        duration: undefined,
        episodeNumber: undefined,
        seasonNumber: undefined,
      };
    }) ?? []
  );
}

function convertJsonItems(feed: Json.Feed<unknown>, feedUrl: string): FeedItem[] {
  return (
    feed.items?.map((item, index): FeedItem => {
      const structuredAuthors = item.authors?.map((a) => ({
        name: a.name || "",
        uri: a.url,
      }));
      const primaryStructuredAuthor = structuredAuthors?.find((a) => a.name)?.name;
      const author = primaryStructuredAuthor;
      const thumbnail = item.image ? { url: item.image } : undefined;
      const images = item.image ? [item.image] : undefined;
      const previewImage = pickPreviewImage({
        thumbnail: thumbnail?.url,
        images,
        content: item.content_html || item.content_text || "",
      });
      const enclosures = item.attachments
        ?.filter((att): att is typeof att & { url: string } => !!att.url)
        .map(
          (att): Enclosure => ({
            url: att.url,
            type: att.mime_type || "application/octet-stream",
            length: att.size_in_bytes,
            duration: att.duration_in_seconds,
          }),
        );

      return {
        id: item.id || generateItemId(feedUrl, index),
        title: getTextValue(item.title) || "",
        content: item.content_html || item.content_text || "",
        summary: item.summary,
        link: item.url,
        author,
        publishedDate: matchPublishedDate({
          explicit: [getTextValue(item.date_published), getTextValue(item.date_modified)],
          source: item,
        }),
        updatedDate: matchUpdatedDate({
          explicit: [getTextValue(item.date_modified)],
          source: item,
        }),
        guid: item.id,
        feedId: feedUrl,
        previewImage,
        thumbnail,
        images,
        enclosures,
        categories: item.tags,
        authors: structuredAuthors,
        duration: item.attachments?.[0]?.duration_in_seconds,
        episodeNumber: undefined,
        seasonNumber: undefined,
      };
    }) ?? []
  );
}

function extractThumbnail(item: Rss.Item<unknown>): MediaThumbnail | undefined {
  if (item.media?.thumbnails?.[0]) {
    const thumb = item.media.thumbnails[0];
    if (thumb.url) {
      return {
        url: thumb.url,
        width: thumb.width,
        height: thumb.height,
      };
    }
  }

  if (item.itunes?.image) {
    return { url: item.itunes.image };
  }

  const imageEnclosure = item.enclosures?.find((e) => e.type?.startsWith("image/") && e.url);
  if (imageEnclosure?.url) {
    return { url: imageEnclosure.url };
  }

  return undefined;
}

function extractImages(item: Rss.Item<unknown>): string[] | undefined {
  const images: string[] = [];

  item.media?.contents?.forEach((content) => {
    if ((content.medium === "image" || content.type?.startsWith("image/")) && content.url) {
      images.push(content.url);
    }
  });

  const mediaImageUrl = (item as unknown as { image?: { url?: string } })?.image?.url;
  if (mediaImageUrl) {
    images.push(mediaImageUrl);
  }

  item.enclosures?.forEach((enclosure) => {
    if (enclosure.type?.startsWith("image/") && enclosure.url) {
      images.push(enclosure.url);
    }
  });

  return uniqueNonEmpty(images);
}

function extractEnclosures(item: Rss.Item<unknown>, duration?: number): Enclosure[] | undefined {
  if (!item.enclosures || item.enclosures.length === 0) {
    return undefined;
  }

  return item.enclosures
    .filter((enc): enc is typeof enc & { url: string } => !!enc.url)
    .map(
      (enc): Enclosure => ({
        url: enc.url,
        type: enc.type || "application/octet-stream",
        length: enc.length,
        duration,
      }),
    );
}

function extractCategories(item: Rss.Item<unknown>): string[] | undefined {
  const categories: string[] = [];

  if (item.categories) {
    categories.push(...(item.categories.filter(Boolean) as string[]));
  }

  if (item.dc?.subjects) {
    categories.push(...(item.dc.subjects.filter(Boolean) as string[]));
  }

  return categories.length > 0 ? categories : undefined;
}

function extractAuthors(item: Rss.Item<unknown>): Author[] | undefined {
  const authors: Author[] = [];
  const seenNames = new Set<string>();
  const addAuthor = (name?: string, email?: string) => {
    const normalizedName = name?.trim();
    if (!normalizedName || seenNames.has(normalizedName)) {
      return;
    }
    seenNames.add(normalizedName);
    authors.push(email ? { name: normalizedName, email } : { name: normalizedName });
  };

  if (item.authors) {
    for (const rssAuthor of item.authors) {
      const match = rssAuthor.match(/^(.+?)\s*\((.+?)\)$/);
      if (match) {
        addAuthor(match[2], match[1]);
      } else {
        addAuthor(rssAuthor);
      }
    }
  }

  const dcCreator = item.dc?.creators?.[0];
  if (dcCreator) {
    addAuthor(dcCreator);
  }

  return authors.length > 0 ? authors : undefined;
}

function parseDuration(duration?: string | number): number | undefined {
  if (!duration) {
    return undefined;
  }

  if (typeof duration === "number") {
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  }

  const parts = duration.split(":").map(Number);
  if (!parts.every((part) => Number.isFinite(part) && part >= 0)) {
    return undefined;
  }

  let seconds: number | undefined;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  }

  return seconds && seconds > 0 ? seconds : undefined;
}

function extractAtomThumbnail(entry: Atom.Entry<unknown>): MediaThumbnail | undefined {
  const thumb = entry.media?.thumbnails?.[0];
  if (thumb?.url) {
    return { url: thumb.url, width: thumb.width, height: thumb.height };
  }

  if (entry.itunes?.image) {
    return { url: entry.itunes.image };
  }

  const imageLink = entry.links?.find((l) => l.rel === "enclosure" && l.type?.startsWith("image/") && l.href);
  if (imageLink?.href) {
    return { url: imageLink.href };
  }

  return undefined;
}

function extractAtomImages(entry: Atom.Entry<unknown>): string[] | undefined {
  const images: string[] = [];

  entry.media?.contents?.forEach((content) => {
    if ((content.medium === "image" || content.type?.startsWith("image/")) && content.url) {
      images.push(content.url);
    }
  });

  return uniqueNonEmpty(images);
}

function pickPreviewImage(input: {
  thumbnail?: string;
  images?: string[];
  content?: string;
}): string | undefined {
  const fromThumbnail = input.thumbnail?.trim();
  if (fromThumbnail) {
    return fromThumbnail;
  }

  const fromImages = input.images?.find((url) => !!url?.trim())?.trim();
  if (fromImages) {
    return fromImages;
  }

  return extractFirstImageFromHtml(input.content);
}

function extractFirstImageFromHtml(html?: string): string | undefined {
  if (!html) {
    return undefined;
  }
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return match?.[1]?.trim() || undefined;
}

function uniqueNonEmpty(values: string[]): string[] | undefined {
  const unique = Array.from(new Set(values.map((value) => value?.trim()).filter(Boolean))) as string[];
  return unique.length > 0 ? unique : undefined;
}

function extractAtomEnclosures(entry: Atom.Entry<unknown>): Enclosure[] | undefined {
  const enclosures: Enclosure[] = [];

  entry.links?.forEach((link) => {
    if (link.rel === "enclosure" && link.href) {
      enclosures.push({
        url: link.href,
        type: link.type || "application/octet-stream",
        length: link.length,
        duration: undefined,
      });
    }
  });

  return enclosures.length > 0 ? enclosures : undefined;
}

function generateItemId(feedUrl: string, index: number): string {
  return `${feedUrl}-${index}-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
