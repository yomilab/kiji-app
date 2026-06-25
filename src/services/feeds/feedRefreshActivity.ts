export type FeedRefreshActivityScope = 'foreground' | 'background';

export interface FeedRefreshActivitySnapshot {
  activeFeedCount: number;
  queuedFeedCount: number;
  foregroundQueuedFeedCount: number;
  backgroundQueuedFeedCount: number;
  displayFeedCount: number;
  isAnyFeedRefreshing: boolean;
  isForegroundFeedRefreshing: boolean;
  isBackgroundFeedRefreshing: boolean;
}

type FeedRefreshActivityListener = () => void;

export class FeedRefreshActivity {
  private activeFeeds = new Map<string, number>();

  private queuedFeeds = new Map<string, number>();

  private foregroundQueuedFeedTotal = 0;

  private backgroundQueuedFeedTotal = 0;

  private queuedFeedTotal = 0;

  private foregroundReleaseHandles = new Set<(feedId?: string) => void>();

  private listeners = new Set<FeedRefreshActivityListener>();

  private snapshot: FeedRefreshActivitySnapshot = {
    activeFeedCount: 0,
    queuedFeedCount: 0,
    foregroundQueuedFeedCount: 0,
    backgroundQueuedFeedCount: 0,
    displayFeedCount: 0,
    isAnyFeedRefreshing: false,
    isForegroundFeedRefreshing: false,
    isBackgroundFeedRefreshing: false,
  };

  subscribe = (listener: FeedRefreshActivityListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): FeedRefreshActivitySnapshot => this.snapshot;

  beginQueuedFeeds(
    feedIds: string[],
    scope: FeedRefreshActivityScope = 'foreground',
  ): (feedId?: string) => void {
    const pendingFeedCounts = new Map<string, number>();

    for (const feedId of feedIds) {
      const currentCount = this.queuedFeeds.get(feedId) ?? 0;
      this.queuedFeeds.set(feedId, currentCount + 1);
      pendingFeedCounts.set(feedId, (pendingFeedCounts.get(feedId) ?? 0) + 1);
      this.queuedFeedTotal += 1;
      if (scope === 'background') {
        this.backgroundQueuedFeedTotal += 1;
      } else {
        this.foregroundQueuedFeedTotal += 1;
      }
    }

    this.publishSnapshot();

    const releaseFeed = (feedId: string): void => {
      const pendingCount = pendingFeedCounts.get(feedId) ?? 0;
      if (pendingCount <= 0) {
        return;
      }
      if (pendingCount > 1) {
        pendingFeedCounts.set(feedId, pendingCount - 1);
      } else {
        pendingFeedCounts.delete(feedId);
      }

      const nextCount = (this.queuedFeeds.get(feedId) ?? 1) - 1;
      if (nextCount > 0) {
        this.queuedFeeds.set(feedId, nextCount);
      } else {
        this.queuedFeeds.delete(feedId);
      }
      this.queuedFeedTotal = Math.max(0, this.queuedFeedTotal - 1);
      if (scope === 'background') {
        this.backgroundQueuedFeedTotal = Math.max(0, this.backgroundQueuedFeedTotal - 1);
      } else {
        this.foregroundQueuedFeedTotal = Math.max(0, this.foregroundQueuedFeedTotal - 1);
      }
    };

    const release = (feedId?: string) => {
      if (feedId) {
        releaseFeed(feedId);
      } else {
        for (const [pendingFeedId, pendingCount] of Array.from(pendingFeedCounts.entries())) {
          for (let releaseCount = 0; releaseCount < pendingCount; releaseCount += 1) {
            releaseFeed(pendingFeedId);
          }
        }
        if (scope === 'foreground') {
          this.foregroundReleaseHandles.delete(release);
        }
      }

      this.publishSnapshot();
    };

    if (scope === 'foreground') {
      this.foregroundReleaseHandles.add(release);
    }

    return release;
  }

  releaseAllForegroundQueued(): void {
    const handles = Array.from(this.foregroundReleaseHandles);
    this.foregroundReleaseHandles.clear();
    for (const release of handles) {
      release();
    }
  }

  async track<T>(feedId: string, operation: () => Promise<T>): Promise<T> {
    // Track live refresh work independently from any caller-specific loading
    // state so UI surfaces can react to real feed network activity only.
    const release = this.begin(feedId);

    try {
      return await operation();
    } finally {
      release();
    }
  }

  private begin(feedId: string): () => void {
    const currentCount = this.activeFeeds.get(feedId) ?? 0;
    this.activeFeeds.set(feedId, currentCount + 1);
    this.publishSnapshot();

    let released = false;

    return () => {
      if (released) {
        return;
      }
      released = true;

      const nextCount = (this.activeFeeds.get(feedId) ?? 1) - 1;
      if (nextCount > 0) {
        this.activeFeeds.set(feedId, nextCount);
      } else {
        this.activeFeeds.delete(feedId);
      }

      this.publishSnapshot();
    };
  }

  private publishSnapshot(): void {
    const foregroundQueuedFeedCount = this.foregroundQueuedFeedTotal;
    const backgroundQueuedFeedCount = this.backgroundQueuedFeedTotal;
    const queuedFeedCount = this.queuedFeedTotal;
    const displayFeedCount = foregroundQueuedFeedCount > 0
      ? foregroundQueuedFeedCount
      : backgroundQueuedFeedCount > 0
        ? backgroundQueuedFeedCount
        : this.activeFeeds.size;
    const isBackgroundFeedRefreshing = backgroundQueuedFeedCount > 0
      && foregroundQueuedFeedCount === 0;
    const isForegroundFeedRefreshing = foregroundQueuedFeedCount > 0
      || (this.activeFeeds.size > 0 && !isBackgroundFeedRefreshing);
    const nextSnapshot: FeedRefreshActivitySnapshot = {
      activeFeedCount: this.activeFeeds.size,
      queuedFeedCount,
      foregroundQueuedFeedCount,
      backgroundQueuedFeedCount,
      displayFeedCount,
      isAnyFeedRefreshing: displayFeedCount > 0,
      isForegroundFeedRefreshing,
      isBackgroundFeedRefreshing,
    };

    if (
      nextSnapshot.activeFeedCount === this.snapshot.activeFeedCount
      && nextSnapshot.queuedFeedCount === this.snapshot.queuedFeedCount
      && nextSnapshot.foregroundQueuedFeedCount === this.snapshot.foregroundQueuedFeedCount
      && nextSnapshot.backgroundQueuedFeedCount === this.snapshot.backgroundQueuedFeedCount
      && nextSnapshot.displayFeedCount === this.snapshot.displayFeedCount
      && nextSnapshot.isAnyFeedRefreshing === this.snapshot.isAnyFeedRefreshing
      && nextSnapshot.isForegroundFeedRefreshing === this.snapshot.isForegroundFeedRefreshing
      && nextSnapshot.isBackgroundFeedRefreshing === this.snapshot.isBackgroundFeedRefreshing
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.listeners.forEach((listener) => listener());
  }
}

export const feedRefreshActivity = new FeedRefreshActivity();
