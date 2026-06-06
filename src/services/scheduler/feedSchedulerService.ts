import { feedsManager } from '@/services/feeds/feedsManager';
import { settingsManager } from '@/services/settings';
import { logger } from '@/services/logger';
import type { BackgroundUpdateMode, SchedulerEvent } from './types';

const MODE_INTERVAL_MS: Record<BackgroundUpdateMode, number | null> = {
  'on-launch': null,
  'every-5m': 5 * 60_000,
  'every-10m': 10 * 60_000,
  'every-15m': 15 * 60_000,
  'every-30m': 30 * 60_000,
  'every-1h': 60 * 60_000,
  never: null,
};

class FeedSchedulerService {
  private timer: number | null = null;
  private mode: BackgroundUpdateMode = 'on-launch';
  private cycleInProgress = false;
  private abortController: AbortController | null = null;
  private lifecycleId = 0;
  private listeners = new Set<(event: SchedulerEvent) => void>();

  on(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    this.clearTimerAndAbort();
    const lifecycleId = ++this.lifecycleId;

    try {
      const settings = await settingsManager.getSettings();
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      this.mode = settings.backgroundUpdate ?? 'every-15m';
      logger.info('Scheduler', 'Starting feed scheduler lifecycle', { mode: this.mode });

      if (this.mode === 'never') {
        return;
      }

      if (this.mode === 'on-launch') {
        void this.refreshAllFeeds(lifecycleId).finally(() => {
          this.scheduleNext(lifecycleId);
        });
        return;
      }

      this.scheduleNext(lifecycleId);
    } catch (error) {
      logger.error('Scheduler', 'Failed to start feed scheduler lifecycle', { error });
    }
  }

  stop(): void {
    this.lifecycleId += 1;
    this.clearTimerAndAbort();
    this.cycleInProgress = false;
    logger.info('Scheduler', 'Stopped feed scheduler lifecycle');
  }

  reconfigure(mode: BackgroundUpdateMode): void {
    this.mode = mode;
    this.clearTimerAndAbort();
    const lifecycleId = ++this.lifecycleId;
    logger.info('Scheduler', 'Reconfigured feed scheduler lifecycle', { mode });
    this.scheduleNext(lifecycleId);
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

  private clearTimerAndAbort(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.abortController = null;
  }

  private isCurrentLifecycle(lifecycleId: number): boolean {
    return lifecycleId === this.lifecycleId;
  }

  private scheduleNext(lifecycleId: number): void {
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    const intervalMs = MODE_INTERVAL_MS[this.mode];
    if (intervalMs === null) {
      return;
    }

    this.timer = window.setTimeout(() => {
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }
      void this.refreshAllFeeds(lifecycleId).finally(() => this.scheduleNext(lifecycleId));
    }, intervalMs);
  }

  private async refreshAllFeeds(lifecycleId: number): Promise<void> {
    if (this.cycleInProgress || !this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    this.cycleInProgress = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.emit({ type: 'cycle-start' });

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
    }
  }

  private emit(event: SchedulerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const feedScheduler = new FeedSchedulerService();
