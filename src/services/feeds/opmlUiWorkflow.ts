import { feedsManager, type Feed } from '@/services/feeds/feedsManager';
import type { OpmlImportResult, OpmlImportSummary } from '@/services/feeds/opmlImportService';
import { opmlWorkflowService } from '@/services/feeds/opmlWorkflowService';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';

const pluralizeFeeds = (count: number): string => `${count} feed${count === 1 ? '' : 's'}`;

export const formatOpmlImportSummary = (summary: OpmlImportSummary): string => {
  if (summary.total === 0) {
    return 'No feed entries found in OPML file.';
  }

  return `Imported ${pluralizeFeeds(summary.imported)}. Skipped ${summary.skippedDuplicate} duplicates, ${summary.invalid} invalid, ${summary.failed} failed.`;
};

interface ApplyOpmlImportResultOptions {
  refreshTotalFeeds: () => Promise<void>;
  notifyFeedLibraryChanged?: () => void;
}

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
  options: ApplyOpmlImportResultOptions
): Promise<OpmlImportResult> => {
  const importResult = await opmlWorkflowService.importFromOpmlText(opmlText);
  await applyOpmlImportResultToLibrary(importResult, options);
  return importResult;
};

export const openOpmlFileForImport = async (): Promise<string | null> => {
  if (!window.electronAPI?.openOpmlFile) {
    throw new Error('Import is only available in the desktop app.');
  }

  const selectedFile = await window.electronAPI.openOpmlFile();
  if (selectedFile.canceled) {
    return null;
  }

  const opmlText = selectedFile.content?.trim();
  if (!opmlText) {
    throw new Error('Selected file is empty.');
  }

  return opmlText;
};
