import { feedsManager } from '@/services/feeds/feedsManager';
import type { BackgroundUpdateMode, SchedulerEvent } from './types';

const INTERVAL_MS: Record<Exclude<BackgroundUpdateMode, 'on-launch' | 'never'>, number> = {
  'every-5m': 5 * 60_000,
  'every-10m': 10 * 60_000,
  'every-15m': 15 * 60_000,
  'every-30m': 30 * 60_000,
  'every-1h': 60 * 60_000,
};

class FeedSchedulerService {
  private timer: number | null = null;
  private mode: BackgroundUpdateMode = 'every-15m';
  private listeners = new Set<(event: SchedulerEvent) => void>();

  on(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  start(): void {
    void this.refreshAllFeeds();
    this.scheduleNext();
  }

  stop(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  reconfigure(mode: BackgroundUpdateMode): void {
    this.mode = mode;
    this.stop();
    this.scheduleNext();
  }

  private scheduleNext(): void {
    if (this.mode === 'never' || this.mode === 'on-launch') {
      return;
    }

    this.timer = window.setTimeout(() => {
      void this.refreshAllFeeds().finally(() => this.scheduleNext());
    }, INTERVAL_MS[this.mode]);
  }

  private async refreshAllFeeds(): Promise<void> {
    this.emit({ type: 'cycle-start' });
    const feeds = await feedsManager.getAllFeeds();
    for (const feed of feeds) {
      await feedsManager.refreshFeed(feed.id)
        .then((result) => {
          this.emit({
            type: 'feed-updated',
            feedId: feed.id,
            newArticleCount: result.insertedCount,
          });
        })
        .catch((error) => {
          this.emit({
            type: 'feed-failed',
            feedId: feed.id,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
    this.emit({ type: 'cycle-complete' });
  }

  private emit(event: SchedulerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const feedScheduler = new FeedSchedulerService();
