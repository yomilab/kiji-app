import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import { assertValidOpmlText } from '@/services/feeds/opmlDocument';
import type { OpmlImportResult, OpmlImportSummary, ParseOpmlEntriesOptions } from '@/services/feeds/opmlImportService';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import { httpClient } from '@/services/http/httpClientFactory';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

const pluralizeFeeds = (count: number): string => `${count} feed${count === 1 ? '' : 's'}`;

export const isLikelyOpmlUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.opml');
  } catch {
    return false;
  }
};

export { isOpmlDocument } from '@/services/feeds/opmlDocument';

export const fetchOpmlTextFromUrl = async (url: string): Promise<string> => {
  const text = await httpClient.get(url, {
    headers: {
      Accept: 'application/xml, text/xml, application/opml+xml, */*',
    },
  });

  assertValidOpmlText(text, { emptyMessage: 'OPML URL returned empty content.' });

  return text;
};

export const formatOpmlImportSummary = (summary: OpmlImportSummary): string => {
  if (summary.total === 0) {
    return 'No feed entries found in OPML file.';
  }

  return `Imported ${pluralizeFeeds(summary.imported)}. Skipped ${summary.skippedDuplicate} duplicates, ${summary.invalid} invalid, ${summary.failed} failed.`;
};

export interface OpmlImportNavigationActions {
  selectTag: (tagName: string) => Promise<void>;
  selectFeed: (
    feedId: string,
    feedUrl: string,
    feedTitle: string,
    options?: { forceNetwork?: boolean },
  ) => Promise<void>;
}

export const navigateAfterOpmlImport = async (
  importResult: OpmlImportResult,
  actions: OpmlImportNavigationActions,
): Promise<void> => {
  const { navigationTarget } = importResult;
  if (!navigationTarget) {
    return;
  }

  if (navigationTarget.type === 'station') {
    await actions.selectTag(navigationTarget.stationName);
    return;
  }

  await actions.selectFeed(
    navigationTarget.feedId,
    navigationTarget.feedUrl,
    navigationTarget.feedTitle,
    { forceNetwork: true },
  );
};

interface ApplyOpmlImportResultOptions {
  refreshTotalFeeds: () => Promise<void>;
  notifyFeedLibraryChanged?: () => void;
}

export interface OpmlImportIntoLibraryOptions extends ApplyOpmlImportResultOptions, ParseOpmlEntriesOptions {}

export const applyOpmlImportResultToLibrary = async (
  importResult: OpmlImportResult,
  {
    refreshTotalFeeds,
    notifyFeedLibraryChanged,
  }: ApplyOpmlImportResultOptions
): Promise<void> => {
  // Rehydrate the sidebar from the imported feeds and affected stations so
  // file-picker imports follow the same UI update path as drag-and-drop.
  const importedFeedIds = new Set(importResult.importedFeeds.map(({ id }) => id));
  const [importedFeeds, allTags] = await Promise.all([
    Promise.all(importResult.importedFeeds.map(({ id }) => feedsManager.getFeedById(id))),
    tagsManager.getAllTags(),
  ]);

  feedLibraryMutationBus.publishFeedsAdded(
    importedFeeds.filter((feed): feed is Feed => feed !== null)
  );
  feedLibraryMutationBus.publishStationsHydrated(allTags);

  for (const tag of allTags) {
    if (!tag.feedIds.some((feedId) => importedFeedIds.has(feedId))) {
      continue;
    }

    feedLibraryMutationBus.publishStationPatched(tag.name, {
      name: tag.name,
      emoji: tag.emoji,
      feedIds: tag.feedIds,
      createdAt: tag.createdAt,
      sortOrder: tag.sortOrder,
    });
  }

  await refreshTotalFeeds();
  notifyFeedLibraryChanged?.();
};

export const importOpmlTextIntoLibrary = async (
  opmlText: string,
  options: OpmlImportIntoLibraryOptions,
): Promise<OpmlImportResult> => {
  const { refreshTotalFeeds, notifyFeedLibraryChanged, defaultStationName, fileName, url } = options;
  const importResult = await opmlWorkflowService.importFromOpmlText(opmlText, {
    defaultStationName,
    fileName,
    url,
  });
  await applyOpmlImportResultToLibrary(importResult, {
    refreshTotalFeeds,
    notifyFeedLibraryChanged,
  });
  return importResult;
};

export const importOpmlFromUrlIntoLibrary = async (
  url: string,
  options: OpmlImportIntoLibraryOptions,
): Promise<OpmlImportResult> => {
  const opmlText = await fetchOpmlTextFromUrl(url);
  return importOpmlTextIntoLibrary(opmlText, { ...options, url });
};

export interface OpmlFileImportResult {
  opmlText: string;
  fileName?: string;
}

export const openOpmlFileForImport = async (): Promise<OpmlFileImportResult | null> => {
  if (!window.kijiAPI?.openOpmlFile) {
    throw new Error('Import is only available in the desktop app.');
  }

  const selectedFile = await window.kijiAPI.openOpmlFile();
  if (selectedFile.canceled) {
    return null;
  }

  const opmlText = selectedFile.content?.trim();
  if (!opmlText) {
    throw new Error('Selected file is empty.');
  }

  return {
    opmlText,
    fileName: selectedFile.fileName,
  };
};
