import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import { feedsManager } from '@/services/feeds/feedsManager';
import { settingsManager } from '@/services/settings';
import { logger } from '@/services/logger';
import type { BackgroundUpdateMode, SchedulerEvent } from './types';

const SCHEDULER_CYCLE_TICK_EVENT = 'scheduler:cycle-tick';
const STALE_CYCLE_ABORT_MS = 45 * 60 * 1_000;

const MODE_INTERVAL_MS: Record<Exclude<BackgroundUpdateMode, 'on-launch' | 'never'>, number> = {
  'every-5m': 5 * 60_000,
  'every-10m': 10 * 60_000,
  'every-15m': 15 * 60_000,
  'every-30m': 30 * 60_000,
  'every-1h': 60 * 60_000,
};

class FeedSchedulerService {
  private cycleInProgress = false;
  private pendingCycleTick = false;
  private abortController: AbortController | null = null;
  private lifecycleId = 0;
  private listeners = new Set<(event: SchedulerEvent) => void>();
  private mode: BackgroundUpdateMode = 'every-15m';
  private nativeDriverActive = false;
  private nativeTickUnlisten: UnlistenFn | null = null;
  private lastCycleStartedAt: number | null = null;
  private lastCycleCompletedAt: number | null = null;

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
    this.pendingCycleTick = false;

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

  async catchUpAfterResume(): Promise<void> {
    if (this.mode === 'never' || this.mode === 'on-launch') {
      return;
    }

    const lifecycleId = this.lifecycleId;
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    if (this.cycleInProgress) {
      const startedAt = this.lastCycleStartedAt;
      if (startedAt !== null && Date.now() - startedAt >= STALE_CYCLE_ABORT_MS) {
        logger.warn('Scheduler', 'Aborting stale background refresh cycle after resume', {
          mode: this.mode,
          stallDurationMs: Date.now() - startedAt,
        });
        this.clearAbort();
        this.cycleInProgress = false;
        this.pendingCycleTick = true;
      } else {
        return;
      }
    }

    const intervalMs = this.getIntervalMs();
    const overdueMs = this.lastCycleCompletedAt === null
      ? intervalMs
      : Date.now() - this.lastCycleCompletedAt;

    if (this.pendingCycleTick || overdueMs >= intervalMs) {
      logger.info('Scheduler', 'Running catch-up background refresh after resume', {
        mode: this.mode,
        overdueMs,
        pendingCycleTick: this.pendingCycleTick,
      });
      this.pendingCycleTick = false;
      await this.runScheduledCycle(lifecycleId);
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

  private getIntervalMs(): number {
    if (this.mode === 'on-launch' || this.mode === 'never') {
      return Number.POSITIVE_INFINITY;
    }
    return MODE_INTERVAL_MS[this.mode];
  }

  private async ensureNativeTickListener(lifecycleId: number): Promise<void> {
    if (this.nativeTickUnlisten) {
      return;
    }

    this.nativeTickUnlisten = await listen(SCHEDULER_CYCLE_TICK_EVENT, () => {
      void this.handleNativeCycleTick(this.lifecycleId);
    });

    if (!this.isCurrentLifecycle(lifecycleId)) {
      this.nativeTickUnlisten();
      this.nativeTickUnlisten = null;
    }
  }

  private async handleNativeCycleTick(lifecycleId: number): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    if (this.cycleInProgress) {
      this.pendingCycleTick = true;
      logger.info('Scheduler', 'Deferred native scheduler tick until current refresh cycle completes', {
        mode: this.mode,
      });
      return;
    }

    await this.runScheduledCycle(lifecycleId);
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
    this.lastCycleStartedAt = Date.now();
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
      const durationMs = this.lastCycleStartedAt === null
        ? null
        : Date.now() - this.lastCycleStartedAt;
      this.cycleInProgress = false;
      this.abortController = null;
      this.lastCycleCompletedAt = Date.now();
      this.emit({ type: 'cycle-complete' });
      logger.info('Scheduler', 'Background refresh cycle completed', {
        mode: this.mode,
        durationMs,
      });

      if (this.pendingCycleTick && this.isCurrentLifecycle(lifecycleId)) {
        this.pendingCycleTick = false;
        logger.info('Scheduler', 'Running deferred native scheduler tick', { mode: this.mode });
        void this.runScheduledCycle(lifecycleId);
      }
    }
  }

  private emit(event: SchedulerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const feedScheduler = new FeedSchedulerService();
