import { feedsManager } from '@/services/feeds/feedsManager';
import { opmlImportService, type OpmlImportResult } from '@/services/feeds/opmlImportService';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { helperTaskClient } from '@/services/tasks/helperTaskClient';
import {
  HELPER_TASK_KIND,
  type FaviconFetchTaskResult,
  type HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';

class OpmlWorkflowService {
  private faviconTaskFeedMap = new Map<string, string>();
  private unsubscribeTaskEvents: (() => void) | null = null;

  attachFaviconTaskListener(): void {
    if (this.unsubscribeTaskEvents) return;

    this.unsubscribeTaskEvents = helperTaskClient.onTaskResult((event) => {
      void this.handleTaskResult(event);
    });
  }

  async detachFaviconTaskListener(): Promise<void> {
    this.unsubscribeTaskEvents?.();
    this.unsubscribeTaskEvents = null;
    this.faviconTaskFeedMap.clear();
    await helperTaskClient.clearTasks();
  }

  async importFromOpmlText(opmlText: string): Promise<OpmlImportResult> {
    await helperTaskClient.clearTasks();
    this.faviconTaskFeedMap.clear();

    const parsedOpml = await helperTaskClient.runTask({
      kind: HELPER_TASK_KIND.OPML_PARSE,
      priority: 'high',
      payload: { opmlText },
    });

    sidebarIndicatorService.show(`Import ${parsedOpml.entries.length} feeds`);

    const importResult = await opmlImportService.importEntries(parsedOpml.entries);

    if (importResult.importedFeeds.length > 0) {
      sidebarIndicatorService.show(
        `Imported ${importResult.importedFeeds.length} · fetching`,
        { durationMs: 4000 },
      );
    } else {
      sidebarIndicatorService.show('No new feeds', { durationMs: 4000 });
    }

    if (importResult.importedFeeds.length > 0) {
      feedScheduler.boostMany(importResult.importedFeeds.map((feed) => feed.id));
    }

    await Promise.all(importResult.importedFeeds.map(async (feed) => {
      try {
        const task = await helperTaskClient.addTask({
          kind: HELPER_TASK_KIND.FAVICON_FETCH,
          priority: 'low',
          payload: {
            feedId: feed.id,
            feedUrl: feed.url,
          },
        });
        this.faviconTaskFeedMap.set(task.taskId, feed.id);
      } catch {
        await feedsManager.updateFeed(feed.id, { faviconFetchFailed: true });
      }
    }));

    return importResult;
  }

  private async handleTaskResult(event: HelperTaskResultEvent): Promise<void> {
    if (event.kind !== HELPER_TASK_KIND.FAVICON_FETCH) {
      return;
    }

    const feedId = this.faviconTaskFeedMap.get(event.taskId);
    if (!feedId) {
      return;
    }

    this.faviconTaskFeedMap.delete(event.taskId);

    if (event.status !== 'completed') {
      await feedsManager.updateFeed(feedId, { faviconFetchFailed: true });
      return;
    }

    const result = event.result as FaviconFetchTaskResult;
    const updatedFeed = await feedsManager.updateFeed(feedId, {
      favicon: result.favicon || undefined,
      faviconFetchFailed: !result.favicon,
    });

    if (updatedFeed) {
      feedLibraryMutationBus.publishFeedPatched(feedId, {
        favicon: updatedFeed.favicon,
        faviconHasTransparency: updatedFeed.faviconHasTransparency,
        faviconBgLight: updatedFeed.faviconBgLight,
        faviconBgDark: updatedFeed.faviconBgDark,
      });
    }
  }
}

export const opmlWorkflowService = new OpmlWorkflowService();
