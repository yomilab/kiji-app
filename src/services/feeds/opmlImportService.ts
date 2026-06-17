import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import * as feedStore from '@/stores/feedStore';
import {
  LEGACY_OPML_STATION_NAME_ATTRIBUTE,
  OPML_STATION_NAME_ATTRIBUTE,
  readOpmlOutlineEmoji,
} from './opmlAttributes';
import { parseOpmlXmlDocument } from './opmlDocument';
import {
  deriveOpmlDefaultStationName,
  isFlatOpmlRoot,
  normalizeStationName,
  resolveOutlineStationName,
} from './opmlStationResolution';

export interface OpmlImportEntry {
  title?: string;
  url: string;
  station?: string;
  emoji?: string;
  stationEmoji?: string;
  rootOutlineIndex?: number;
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

export type OpmlImportNavigationTarget =
  | { type: 'station'; stationName: string }
  | { type: 'feed'; feedId: string; feedUrl: string; feedTitle: string };

export interface OpmlImportResult {
  summary: OpmlImportSummary;
  importedFeeds: OpmlImportedFeedRef[];
  navigationTarget?: OpmlImportNavigationTarget;
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

export interface ParseOpmlEntriesOptions {
  defaultStationName?: string;
  fileName?: string;
  url?: string;
}

export const parseOpmlEntries = (
  opmlText: string,
  options: ParseOpmlEntriesOptions = {},
): OpmlImportEntry[] => {
  if (!opmlText.trim()) {
    throw new Error('OPML file is empty.');
  }

  const xmlDoc = parseOpmlXmlDocument(opmlText);
  const body = xmlDoc.querySelector('opml > body') || xmlDoc.querySelector('body');
  if (!body) {
    throw new Error('Invalid OPML file: missing body section.');
  }

  const rootOutlines = getDirectOutlineChildren(body);
  const rootOutlineHasXmlUrl = rootOutlines.map((outline) => Boolean(outline.getAttribute('xmlUrl')?.trim()));
  const opmlHeadTitle = xmlDoc.querySelector('opml > head > title')?.textContent?.trim();
  const flatImportStation = isFlatOpmlRoot(rootOutlineHasXmlUrl)
    ? (
      normalizeStationName(options.defaultStationName)
      ?? deriveOpmlDefaultStationName({
        fileName: options.fileName,
        url: options.url,
        opmlHeadTitle,
      })
    )
    : undefined;

  const entries: OpmlImportEntry[] = [];

  const walkOutline = (
    outline: Element,
    topStation: string | undefined,
    topStationEmoji: string | undefined,
    depth: number,
    rootOutlineIndex: number,
  ) => {
    const label = getOutlineLabel(outline);
    const xmlUrl = outline.getAttribute('xmlUrl')?.trim();
    const stationName = resolveOutlineStationName({
      depth,
      hasXmlUrl: Boolean(xmlUrl),
      label,
      explicitStationName: getOutlineStationName(outline),
      inheritedStation: topStation,
      flatImportStation,
    });
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
        rootOutlineIndex,
      });
    }

    const childOutlines = getDirectOutlineChildren(outline);
    for (const child of childOutlines) {
      walkOutline(child, stationName, stationEmoji, depth + 1, rootOutlineIndex);
    }
  };

  rootOutlines.forEach((outline, rootOutlineIndex) => {
    walkOutline(outline, undefined, undefined, 0, rootOutlineIndex);
  });

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
    const [existingFeeds, existingTags] = await Promise.all([
      feedsManager.getAllFeeds(),
      tagsManager.getAllTags(),
    ]);
    const existingNormalizedUrls = new Set(
      existingFeeds
        .map((feed) => normalizeFeedUrl(feed.url))
        .filter((url): url is string => Boolean(url))
    );

    const stationOrderInFile = new Map<string, number>();
    for (const entry of entries) {
      if (!entry.station || entry.rootOutlineIndex === undefined) {
        continue;
      }

      const currentOrder = stationOrderInFile.get(entry.station);
      if (currentOrder === undefined || entry.rootOutlineIndex < currentOrder) {
        stationOrderInFile.set(entry.station, entry.rootOutlineIndex);
      }
    }

    const maxExistingStationSortOrder = existingTags.reduce(
      (max, tag) => Math.max(max, tag.sortOrder ?? 0),
      -1,
    );
    const stationSortOrderBase = maxExistingStationSortOrder + 1;
    const assignedStationSortOrders = new Map<string, number>();

    const seenInFileUrls = new Set<string>();
    let imported = 0;
    let skippedDuplicate = 0;
    let invalid = 0;
    let failed = 0;
    const importedFeeds: OpmlImportedFeedRef[] = [];
    const importedStations: string[] = [];
    let firstImportedFeedNavigation: Extract<OpmlImportNavigationTarget, { type: 'feed' }> | null = null;
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
          if (!assignedStationSortOrders.has(entry.station)) {
            const fileOrder = stationOrderInFile.get(entry.station) ?? assignedStationSortOrders.size;
            assignedStationSortOrders.set(entry.station, stationSortOrderBase + fileOrder);
          }

          await tagsManager.updateTag(entry.station, {
            sortOrder: assignedStationSortOrders.get(entry.station),
          });

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

        if (entry.station && !importedStations.includes(entry.station)) {
          importedStations.push(entry.station);
        }

        if (!firstImportedFeedNavigation) {
          firstImportedFeedNavigation = {
            type: 'feed',
            feedId: feed.id,
            feedUrl: feed.url,
            feedTitle: feed.title || entry.title || feed.url,
          };
        }
      } catch {
        failed += 1;
      }
    }

    const navigationTarget: OpmlImportNavigationTarget | undefined = importedStations.length > 0
      ? { type: 'station', stationName: importedStations[0] }
      : firstImportedFeedNavigation ?? undefined;

    return {
      summary: {
        total: entries.length,
        imported,
        skippedDuplicate,
        invalid,
        failed,
      },
      importedFeeds,
      navigationTarget,
    };
  }

  async importFromText(
    opmlText: string,
    options: ParseOpmlEntriesOptions = {},
  ): Promise<OpmlImportResult> {
    const entries = parseOpmlEntries(opmlText, options);
    return this.importEntries(entries);
  }
}

export const opmlImportService = new OpmlImportService();
