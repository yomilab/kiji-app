import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import { feedsManager } from '@/services/feeds/feedsManager';
import { settingsManager } from '@/services/settings';
import { logger } from '@/services/logger';
import type { BackgroundUpdateMode, SchedulerEvent } from './types';

const SCHEDULER_CYCLE_TICK_EVENT = 'scheduler:cycle-tick';

class FeedSchedulerService {
  private cycleInProgress = false;
  private abortController: AbortController | null = null;
  private lifecycleId = 0;
  private listeners = new Set<(event: SchedulerEvent) => void>();
  private mode: BackgroundUpdateMode = 'every-15m';
  private nativeDriverActive = false;
  private nativeTickUnlisten: UnlistenFn | null = null;

  on(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    this.clearAbort();
    const lifecycleId = ++this.lifecycleId;

    try {
      const settings = await settingsManager.getSettings();
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      this.mode = settings.backgroundUpdate ?? 'every-15m';
      await this.ensureNativeTickListener(lifecycleId);

      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      if (this.nativeDriverActive) {
        await tauriClient.scheduler.reconfigure({ mode: this.mode });
        await this.abortStaleLifecycle(lifecycleId);
        if (!this.isCurrentLifecycle(lifecycleId)) {
          return;
        }
        logger.info('Scheduler', 'Reconfigured native feed scheduler driver', { mode: this.mode });
        return;
      }

      const result = await tauriClient.scheduler.start({ mode: this.mode });
      await this.abortStaleLifecycle(lifecycleId);
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      this.nativeDriverActive = true;
      logger.info('Scheduler', 'Started native feed scheduler driver', {
        mode: this.mode,
        result,
      });
    } catch (error) {
      await this.abortStaleLifecycle(lifecycleId);
      logger.error('Scheduler', 'Failed to start native feed scheduler driver', { error });
    }
  }

  async stop(): Promise<void> {
    this.lifecycleId += 1;
    this.clearAbort();
    this.cycleInProgress = false;

    if (this.nativeTickUnlisten) {
      this.nativeTickUnlisten();
      this.nativeTickUnlisten = null;
    }

    if (this.nativeDriverActive) {
      try {
        await tauriClient.scheduler.stop();
      } catch (error) {
        logger.warn('Scheduler', 'Failed to stop native feed scheduler driver', { error });
      }
      this.nativeDriverActive = false;
    }

    logger.info('Scheduler', 'Stopped feed scheduler lifecycle');
  }

  async reconfigure(mode: BackgroundUpdateMode): Promise<void> {
    this.mode = mode;
    this.clearAbort();
    const lifecycleId = ++this.lifecycleId;
    logger.info('Scheduler', 'Reconfigured feed scheduler lifecycle', { mode });

    try {
      await tauriClient.scheduler.reconfigure({ mode });
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }
      this.nativeDriverActive = true;
    } catch (error) {
      logger.error('Scheduler', 'Failed to reconfigure native feed scheduler driver', { error });
    }
  }

  boostMany(feedIds: string[]): void {
    if (feedIds.length === 0) {
      return;
    }

    logger.info('Scheduler', 'Refreshing imported feeds after OPML import', {
      feedCount: feedIds.length,
    });

    for (const feedId of feedIds) {
      void feedsManager.refreshFeed(feedId).catch((error) => {
        logger.warn('Scheduler', 'Failed to refresh imported feed', { feedId, error });
      });
    }
  }

  private async ensureNativeTickListener(lifecycleId: number): Promise<void> {
    if (this.nativeTickUnlisten) {
      return;
    }

    this.nativeTickUnlisten = await listen(SCHEDULER_CYCLE_TICK_EVENT, () => {
      void this.runScheduledCycle(this.lifecycleId);
    });

    if (!this.isCurrentLifecycle(lifecycleId)) {
      this.nativeTickUnlisten();
      this.nativeTickUnlisten = null;
    }
  }

  private async abortStaleLifecycle(lifecycleId: number): Promise<void> {
    if (this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    try {
      await tauriClient.scheduler.stop();
    } catch (error) {
      logger.warn('Scheduler', 'Failed to stop native driver for stale lifecycle', { error });
    }
    this.nativeDriverActive = false;
  }

  private async runScheduledCycle(lifecycleId: number): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycleId) || this.cycleInProgress) {
      return;
    }

    await this.refreshAllFeeds(lifecycleId);
  }

  private clearAbort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private isCurrentLifecycle(lifecycleId: number): boolean {
    return lifecycleId === this.lifecycleId;
  }

  private async refreshAllFeeds(lifecycleId: number): Promise<void> {
    if (this.cycleInProgress || !this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    this.cycleInProgress = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.emit({ type: 'cycle-start' });
    logger.info('Scheduler', 'Background refresh cycle started', { mode: this.mode });

    try {
      const feeds = await feedsManager.getAllFeeds();
      for (const feed of feeds) {
        if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
          break;
        }

        await feedsManager.refreshFeed(feed.id, { signal })
          .then((result) => {
            this.emit({
              type: 'feed-updated',
              feedId: feed.id,
              newArticleCount: result.insertedCount,
            });
          })
          .catch((error) => {
            if (signal.aborted) {
              return;
            }
            this.emit({
              type: 'feed-failed',
              feedId: feed.id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }
    } finally {
      this.cycleInProgress = false;
      this.abortController = null;
      this.emit({ type: 'cycle-complete' });
      logger.info('Scheduler', 'Background refresh cycle completed', { mode: this.mode });
    }
  }

  private emit(event: SchedulerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const feedScheduler = new FeedSchedulerService();
