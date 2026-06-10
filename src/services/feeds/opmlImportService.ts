import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import * as feedStore from '@/stores/feedStore';
import {
  LEGACY_OPML_STATION_NAME_ATTRIBUTE,
  OPML_STATION_NAME_ATTRIBUTE,
  readOpmlOutlineEmoji,
} from './opmlAttributes';

export interface OpmlImportEntry {
  title?: string;
  url: string;
  station?: string;
  emoji?: string;
  stationEmoji?: string;
}

export interface OpmlImportSummary {
  total: number;
  imported: number;
  skippedDuplicate: number;
  invalid: number;
  failed: number;
}

export interface OpmlImportedFeedRef {
  id: string;
  url: string;
}

export interface OpmlImportResult {
  summary: OpmlImportSummary;
  importedFeeds: OpmlImportedFeedRef[];
}

export type OpmlBackgroundTask = () => Promise<void>;

const getOutlineLabel = (outline: Element): string => {
  const raw = outline.getAttribute('title') || outline.getAttribute('text') || '';
  return raw.trim();
};

const getOutlineStationName = (outline: Element): string | undefined => (
  outline.getAttribute(OPML_STATION_NAME_ATTRIBUTE)
  || outline.getAttribute(LEGACY_OPML_STATION_NAME_ATTRIBUTE)
  || undefined
);

const getDirectOutlineChildren = (node: Element): Element[] => {
  return Array.from(node.children).filter(
    (child) => child.tagName.toLowerCase() === 'outline'
  );
};

const normalizeStationName = (value?: string): string | undefined => {
  if (!value) return undefined;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
};

export const normalizeFeedUrl = (url?: string): string | null => {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    parsed.hash = '';

    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    }

    return parsed.toString();
  } catch {
    const fallback = trimmed.replace(/#.*$/, '').replace(/\/+$/, '');
    return fallback || null;
  }
};

export const parseOpmlEntries = (opmlText: string): OpmlImportEntry[] => {
  if (!opmlText.trim()) {
    throw new Error('OPML file is empty.');
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(opmlText, 'text/xml');
  const parseError = xmlDoc.querySelector('parsererror');

  if (parseError) {
    throw new Error('Invalid OPML file.');
  }

  const body = xmlDoc.querySelector('opml > body') || xmlDoc.querySelector('body');
  if (!body) {
    throw new Error('Invalid OPML file: missing body section.');
  }

  const entries: OpmlImportEntry[] = [];

  const walkOutline = (
    outline: Element,
    topStation: string | undefined,
    topStationEmoji: string | undefined,
    depth: number,
  ) => {
    const label = getOutlineLabel(outline);
    const xmlUrl = outline.getAttribute('xmlUrl')?.trim();
    const stationName = depth === 0
      ? normalizeStationName(getOutlineStationName(outline) || label)
      : topStation;
    const stationEmoji = depth === 0
      ? readOpmlOutlineEmoji(outline)
      : topStationEmoji;

    if (xmlUrl) {
      entries.push({
        url: xmlUrl,
        title: label || undefined,
        station: stationName,
        emoji: readOpmlOutlineEmoji(outline),
        stationEmoji,
      });
    }

    const childOutlines = getDirectOutlineChildren(outline);
    for (const child of childOutlines) {
      walkOutline(child, stationName, stationEmoji, depth + 1);
    }
  };

  const rootOutlines = getDirectOutlineChildren(body);
  for (const outline of rootOutlines) {
    walkOutline(outline, undefined, undefined, 0);
  }

  return entries;
};

class OpmlImportService {
  createFaviconHydrationTask(feed: OpmlImportedFeedRef): OpmlBackgroundTask {
    return async () => {
      try {
        const favicon = await faviconFetcher.fetchFavicon(feed.url);
        await feedsManager.updateFeed(feed.id, {
          favicon: favicon || undefined,
          faviconFetchFailed: !favicon,
        });
      } catch {
        await feedsManager.updateFeed(feed.id, { faviconFetchFailed: true });
      }
    };
  }

  createFaviconHydrationTasks(feeds: OpmlImportedFeedRef[]): OpmlBackgroundTask[] {
    return feeds.map((feed) => this.createFaviconHydrationTask(feed));
  }

  async importEntries(entries: OpmlImportEntry[]): Promise<OpmlImportResult> {
    const existingFeeds = await feedsManager.getAllFeeds();
    const existingNormalizedUrls = new Set(
      existingFeeds
        .map((feed) => normalizeFeedUrl(feed.url))
        .filter((url): url is string => Boolean(url))
    );

    const seenInFileUrls = new Set<string>();
    let imported = 0;
    let skippedDuplicate = 0;
    let invalid = 0;
    let failed = 0;
    const importedFeeds: OpmlImportedFeedRef[] = [];
    let nextSortOrder = existingFeeds.length;

    for (const entry of entries) {
      const normalizedUrl = normalizeFeedUrl(entry.url);
      if (!normalizedUrl) {
        invalid += 1;
        continue;
      }

      if (seenInFileUrls.has(normalizedUrl) || existingNormalizedUrls.has(normalizedUrl)) {
        skippedDuplicate += 1;
        continue;
      }

      seenInFileUrls.add(normalizedUrl);

      try {
        const feed = await feedsManager.addFeedWithoutMetadata(entry.url, entry.title);
        existingNormalizedUrls.add(normalizedUrl);

        await feedStore.update(feed.id, { sortOrder: nextSortOrder });
        nextSortOrder += 1;

        if (entry.station) {
          await tagsManager.addTagToFeed(feed.id, entry.station);
          if (entry.stationEmoji) {
            const stationTag = (await tagsManager.getAllTags())
              .find((tag) => tag.name === entry.station);
            if (stationTag && !stationTag.emoji) {
              await tagsManager.updateTag(entry.station, { emoji: entry.stationEmoji });
            }
          }
        }

        if (entry.emoji) {
          await feedsManager.updateFeed(feed.id, { emoji: entry.emoji });
        }

        importedFeeds.push({ id: feed.id, url: feed.url });
        imported += 1;
      } catch {
        failed += 1;
      }
    }

    return {
      summary: {
        total: entries.length,
        imported,
        skippedDuplicate,
        invalid,
        failed,
      },
      importedFeeds,
    };
  }

  async importFromText(opmlText: string): Promise<OpmlImportResult> {
    const entries = parseOpmlEntries(opmlText);
    return this.importEntries(entries);
  }
}

export const opmlImportService = new OpmlImportService();
