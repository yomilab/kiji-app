import { feedsManager } from '@/services/feeds/feedsManager';
import { faviconFetcher } from '@/services/favicons/faviconFetcher';
import { applyOpmlImportEntries } from './applyOpmlImportEntries';
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
    return applyOpmlImportEntries(entries);
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
