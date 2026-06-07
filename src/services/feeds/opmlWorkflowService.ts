import { feedsManager } from '@/services/feeds/feedsManager';
import { opmlImportService, type OpmlImportResult } from '@/services/feeds/opmlImportService';
import { feedScheduler } from '@/services/scheduler/feedSchedulerService';
import { helperTaskClient } from '@/services/tasks/helperTaskClient';
import {
  HELPER_TASK_KIND,
  type FaviconFetchTaskResult,
  type HelperTaskPriority,
  type HelperTaskResultEvent,
} from '@/services/tasks/helperTaskContracts';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { sidebarIndicatorService } from '@/services/ui/sidebarIndicatorService';
import {
  sidebarIndicatorDone,
  sidebarIndicatorOngoing,
} from '@/services/ui/sidebarIndicatorText';

const FAVICON_ENQUEUE_BATCH_SIZE = 25;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

class OpmlWorkflowService {
  private faviconTaskFeedMap = new Map<string, string>();
  private unsubscribeTaskEvents: (() => void) | null = null;
  private backfillScheduled = false;
  private visibleStationFaviconBoosted = new Set<string>();

  attachFaviconTaskListener(): void {
    if (this.unsubscribeTaskEvents) return;

    this.unsubscribeTaskEvents = helperTaskClient.onTaskResult((event) => {
      void this.handleTaskResult(event);
    });

    this.scheduleMissingFaviconBackfill();
  }

  detachFaviconTaskListener(): void {
    this.unsubscribeTaskEvents?.();
    this.unsubscribeTaskEvents = null;
  }

  /** After station selection feed refreshes, bump missing favicons ahead of low-priority backfill. */
  scheduleMissingFaviconsAfterStationSelection(feedIds: string[]): void {
    if (feedIds.length === 0) {
      return;
    }

    void (async () => {
      const feeds = await Promise.all(feedIds.map((feedId) => feedsManager.getFeedById(feedId)));
      this.prioritizeMissingFaviconsForFeeds(
        feeds.filter((feed): feed is NonNullable<typeof feed> => feed !== null),
      );
    })();
  }

  prioritizeMissingFaviconsForFeeds(
    feeds: Array<{ id: string; url: string; emoji?: string; favicon?: string; faviconFetchFailed?: boolean }>,
  ): void {
    const targets = feeds.filter((feed) => (
      !feed.emoji
      && !feed.favicon
      && !feed.faviconFetchFailed
      && !this.visibleStationFaviconBoosted.has(feed.id)
    ));

    if (targets.length === 0) {
      return;
    }

    for (const feed of targets) {
      this.visibleStationFaviconBoosted.add(feed.id);
    }

    void this.enqueueFaviconTasks(targets, 'normal');
  }

  async importFromOpmlText(opmlText: string): Promise<OpmlImportResult> {
    await helperTaskClient.clearTasks();
    this.faviconTaskFeedMap.clear();
    this.visibleStationFaviconBoosted.clear();

    const parsedOpml = await helperTaskClient.runTask({
      kind: HELPER_TASK_KIND.OPML_PARSE,
      priority: 'high',
      payload: { opmlText },
    });

    sidebarIndicatorService.show(
      sidebarIndicatorOngoing('importing', { count: parsedOpml.entries.length }),
    );

    const importResult = await opmlImportService.importEntries(parsedOpml.entries);

    sidebarIndicatorService.show(
      sidebarIndicatorDone('importing', importResult.importedFeeds.length || undefined),
      { durationMs: 4000 },
    );

    if (importResult.importedFeeds.length > 0) {
      feedScheduler.boostMany(importResult.importedFeeds.map((feed) => feed.id));
    }

    if (importResult.importedFeeds.length > 0) {
      sidebarIndicatorService.show(
        sidebarIndicatorOngoing('fetching', { count: importResult.importedFeeds.length }, { subject: 'favicons' }),
      );
      await this.enqueueFaviconTasks(importResult.importedFeeds);
      sidebarIndicatorService.clear();
    }

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
    this.visibleStationFaviconBoosted.delete(feedId);

    if (event.status !== 'completed') {
      await feedsManager.applyFaviconResult(feedId, null);
      return;
    }

    const result = event.result as FaviconFetchTaskResult;
    const updatedFeed = await feedsManager.applyFaviconResult(feedId, result.favicon);

    if (updatedFeed) {
      feedLibraryMutationBus.publishFeedPatched(feedId, {
        favicon: updatedFeed.favicon,
        faviconHasTransparency: updatedFeed.faviconHasTransparency,
        faviconBgLight: updatedFeed.faviconBgLight,
        faviconBgDark: updatedFeed.faviconBgDark,
      });
    }
  }

  private scheduleMissingFaviconBackfill(): void {
    if (this.backfillScheduled) {
      return;
    }

    this.backfillScheduled = true;
    void this.enqueueMissingFaviconTasks();
  }

  private async enqueueMissingFaviconTasks(): Promise<void> {
    const feeds = await feedsManager.getAllFeeds();
    const missing = feeds.filter((feed) => (
      !feed.emoji
      && !feed.favicon
      && !feed.faviconFetchFailed
    ));

    if (missing.length === 0) {
      return;
    }

    await this.enqueueFaviconTasks(missing);
  }

  private hasPendingFaviconTask(feedId: string): boolean {
    for (const pendingFeedId of this.faviconTaskFeedMap.values()) {
      if (pendingFeedId === feedId) {
        return true;
      }
    }

    return false;
  }

  private async enqueueFaviconTasks(
    feeds: Array<{ id: string; url: string }>,
    priority: HelperTaskPriority = 'low',
  ): Promise<void> {
    for (let index = 0; index < feeds.length; index += FAVICON_ENQUEUE_BATCH_SIZE) {
      const batch = feeds.slice(index, index + FAVICON_ENQUEUE_BATCH_SIZE);

      for (const feed of batch) {
        if (this.hasPendingFaviconTask(feed.id)) {
          continue;
        }

        try {
          const task = await helperTaskClient.addTask({
            kind: HELPER_TASK_KIND.FAVICON_FETCH,
            priority,
            payload: {
              feedId: feed.id,
              feedUrl: feed.url,
            },
          });
          this.faviconTaskFeedMap.set(task.taskId, feed.id);
        } catch {
          await feedsManager.applyFaviconResult(feed.id, null);
        }
      }

      if (index + FAVICON_ENQUEUE_BATCH_SIZE < feeds.length) {
        await yieldToEventLoop();
      }
    }
  }
}

export const opmlWorkflowService = new OpmlWorkflowService();
