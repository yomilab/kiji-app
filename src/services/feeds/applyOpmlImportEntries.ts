import { feedsManager } from '@/services/feeds/feedsManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { withNonLibraryImportLock } from './libraryReorderQueue';
import type {
  OpmlImportEntry,
  OpmlImportResult,
  OpmlImportNavigationTarget,
  OpmlImportedFeedRef,
} from './opmlImportService';

const normalizeFeedUrl = (url?: string): string | null => {
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

export const applyOpmlImportEntries = async (
  entries: OpmlImportEntry[],
): Promise<OpmlImportResult> => withNonLibraryImportLock(async () => {
  const [existingFeeds, existingTags] = await Promise.all([
    feedsManager.getAllFeeds(),
    tagsManager.getAllTags(),
  ]);
  const feedByNormalizedUrl = new Map(
    existingFeeds.flatMap((feed) => {
      const normalizedUrl = normalizeFeedUrl(feed.url);
      return normalizedUrl ? [[normalizedUrl, feed] as const] : [];
    }),
  );

  const stationOrderInFile: string[] = [];
  const stationMembershipInFile = new Map<string, string[]>();
  const unstationedIdsInFile: string[] = [];
  let invalid = 0;
  let skippedDuplicate = 0;
  let imported = 0;
  let failed = 0;
  const importedFeeds: OpmlImportedFeedRef[] = [];
  const importedStations: string[] = [];
  let firstImportedFeedNavigation: Extract<OpmlImportNavigationTarget, { type: 'feed' }> | null = null;

  const ensureStationOrder = (stationName: string) => {
    if (!stationOrderInFile.includes(stationName)) {
      stationOrderInFile.push(stationName);
    }
  };

  const appendMembership = (stationName: string, feedId: string) => {
    const members = stationMembershipInFile.get(stationName) ?? [];
    if (!members.includes(feedId)) {
      members.push(feedId);
      stationMembershipInFile.set(stationName, members);
    }
  };

  for (const entry of entries) {
    const normalizedUrl = normalizeFeedUrl(entry.url);
    if (!normalizedUrl) {
      invalid += 1;
      continue;
    }

    let feed = feedByNormalizedUrl.get(normalizedUrl) ?? null;
    if (!feed) {
      try {
        feed = await feedsManager.addFeedWithoutMetadata(entry.url, entry.title);
        feedByNormalizedUrl.set(normalizedUrl, feed);
        imported += 1;
        importedFeeds.push({ id: feed.id, url: feed.url });
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
        continue;
      }
    } else {
      skippedDuplicate += 1;
    }

    if (entry.emoji) {
      await feedsManager.updateFeed(feed.id, { emoji: entry.emoji });
    }

    if (entry.station) {
      ensureStationOrder(entry.station);
      await tagsManager.addTagToFeed(feed.id, entry.station);
      appendMembership(entry.station, feed.id);
      if (entry.stationEmoji) {
        await tagsManager.updateTag(entry.station, { emoji: entry.stationEmoji });
      }
      if (!importedStations.includes(entry.station)) {
        importedStations.push(entry.station);
      }
    } else if (!unstationedIdsInFile.includes(feed.id)) {
      unstationedIdsInFile.push(feed.id);
    }
  }

  const existingStationNames = existingTags.map((tag) => tag.name);
  const nextStationOrder = [
    ...stationOrderInFile,
    ...existingStationNames.filter((name) => !stationOrderInFile.includes(name)),
  ];
  if (nextStationOrder.length > 0) {
    try {
      await tagsManager.reorderStations(nextStationOrder);
    } catch {
      // Newly created stations may not be listed yet; hydrate reloads.
    }
  }

  const currentTags = await tagsManager.getAllTags();
  const tagByName = new Map(currentTags.map((tag) => [tag.name, tag]));
  for (const [stationName, fileFeedIds] of stationMembershipInFile) {
    const currentIds = tagByName.get(stationName)?.feedIds ?? [];
    const extras = currentIds.filter((feedId) => !fileFeedIds.includes(feedId));
    try {
      await tagsManager.reorderMembership(stationName, [...fileFeedIds, ...extras]);
    } catch {
      // Membership may still be settling for a newly created station.
    }
  }

  if (unstationedIdsInFile.length > 0) {
    const allFeeds = await feedsManager.getAllFeeds();
    const currentUntagged = allFeeds
      .filter((candidate) => !candidate.tags || candidate.tags.length === 0)
      .map((candidate) => candidate.id);
    const extras = currentUntagged.filter((feedId) => !unstationedIdsInFile.includes(feedId));
    const nextUntagged = [
      ...unstationedIdsInFile.filter((feedId) => currentUntagged.includes(feedId)),
      ...extras,
    ];
    if (nextUntagged.length > 0) {
      try {
        await feedsManager.reorderUnstationed(nextUntagged);
      } catch {
        // Ignore if the unstationed set changed mid-import.
      }
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
});
