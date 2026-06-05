import { opmlImportService, parseOpmlEntries, type OpmlImportResult } from '@/services/feeds/opmlImportService';
import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';

const pluralizeFeeds = (count: number): string => `${count} feed${count === 1 ? '' : 's'}`;

class OpmlWorkflowService {
  attachFaviconTaskListener(): void {}

  async detachFaviconTaskListener(): Promise<void> {}

  async importFromOpmlText(opmlText: string): Promise<OpmlImportResult> {
    const entries = parseOpmlEntries(opmlText);
    sidebarIndicatorService.show(`Importing ${pluralizeFeeds(entries.length)}`);
    const result = await opmlImportService.importEntries(entries);
    sidebarIndicatorService.show(
      result.importedFeeds.length > 0
        ? `Imported ${pluralizeFeeds(result.importedFeeds.length)}.`
        : 'No new feeds to import',
      { durationMs: 4000 },
    );
    return result;
  }
}

export const opmlWorkflowService = new OpmlWorkflowService();
