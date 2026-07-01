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
  /**
   * Total feeds targeted by the current interactive (switch / manual station)
   * refresh — the station's feed count, NOT the foreground cap. Zero outside an
   * interactive refresh. Drives the `Refreshing x/N feeds` indicator so the
   * sidebar reports the true scope instead of the internal 6-feed cap.
   */
  interactiveRefreshScopeTotal: number;
  /** Completed foreground feeds in the current interactive refresh (numerator x). */
  interactiveRefreshCompleted: number;
}

type FeedRefreshActivityListener = () => void;

export class FeedRefreshActivity {
  private activeFeeds = new Map<string, number>();

  private queuedFeeds = new Map<string, number>();

  private foregroundQueuedFeedTotal = 0;

  private backgroundQueuedFeedTotal = 0;

  private queuedFeedTotal = 0;

  private foregroundReleaseHandles = new Set<(feedId?: string) => void>();

  // Interactive (switch / manual station) refresh scope. The scope total is the
  // station's feed count (NOT the foreground cap); the foreground total is the
  // capped count actually fetched this turn. Completed = foregroundTotal - the
  // remaining foreground queue. Both are set once at switch start and cleared
  // once at switch end (one-shot, navigation-class — not per-feed).
  //
  // A generation token guards `clearInteractiveRefreshScope` so a stale switch's
  // `finally` cannot clobber a newer switch's scope (rapid station hopping). The
  // scope is set atomically inside `beginQueuedFeeds` (via `scopeTotal`) so the
  // first publish already carries the true scope — no `Refreshing 6 feeds` flash
  // from a publish where the queue is set but the scope is not.
  private interactiveRefreshScopeTotal = 0;
  private interactiveRefreshForegroundTotal = 0;
  private interactiveRefreshScopeGeneration = 0;

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
    interactiveRefreshScopeTotal: 0,
    interactiveRefreshCompleted: 0,
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
    options?: { scopeTotal?: number },
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

    // Atomic scope + queue publish: when a switch records its station scope,
    // set it BEFORE the single publishSnapshot so the first snapshot already
    // carries `scopeTotal` and `foregroundTotal`. This avoids a transient
    // `Refreshing 6 feeds` (scope=0, fg=cap) frame at switch start.
    if (options?.scopeTotal !== undefined && scope === 'foreground') {
      this.interactiveRefreshScopeTotal = Math.max(0, Math.floor(options.scopeTotal));
      this.interactiveRefreshForegroundTotal = feedIds.length;
      this.interactiveRefreshScopeGeneration += 1;
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
    // Aborting foreground queue on a new selection must also drop any
    // interactive switch scope — otherwise a cleared queue with a stale scope
    // shows a misleading completed count, or a re-queued cap without scope
    // shows `Refreshing 6 feeds`.
    if (this.interactiveRefreshScopeTotal !== 0 || this.interactiveRefreshForegroundTotal !== 0) {
      this.interactiveRefreshScopeTotal = 0;
      this.interactiveRefreshForegroundTotal = 0;
      this.interactiveRefreshScopeGeneration += 1;
      this.publishSnapshot();
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

  /**
   * Generation of the currently-active interactive refresh scope. Captured
   * right after `beginQueuedFeeds(..., { scopeTotal })` and passed to
   * `clearInteractiveRefreshScope(generation)` so a stale switch's `finally`
   * cannot clear a newer switch's scope during rapid station hopping.
   */
  getInteractiveRefreshScopeGeneration(): number {
    return this.interactiveRefreshScopeGeneration;
  }

  clearInteractiveRefreshScope(generation?: number): void {
    // If a newer scope was set after this caller captured its generation, do
    // nothing — the newer switch owns the scope now.
    if (generation !== undefined && generation !== this.interactiveRefreshScopeGeneration) {
      return;
    }
    if (this.interactiveRefreshScopeTotal === 0 && this.interactiveRefreshForegroundTotal === 0) {
      return;
    }
    this.interactiveRefreshScopeTotal = 0;
    this.interactiveRefreshForegroundTotal = 0;
    this.publishSnapshot();
  }

  private publishSnapshot(): void {
    // Station-switch handoff: Phase B calls beginQueuedFeeds(foreground,
    // 'foreground') for the capped foreground set and setInteractiveRefreshScope
    // with the station's full feed count, so the sidebar shows `Refreshing x/N
    // feeds` against the station total (NOT the cap). When Phase B releases
    // those and boostMany starts the background cycle for deferred feeds,
    // beginQueuedFeeds(deferred, 'background') flips the sidebar to "Syncing
    // all". The brief gap between foreground release and background start is a
    // true idle moment (nothing is fetching) and is intentionally shown as the
    // static fallback rather than a misleading "Syncing all".
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
    // Completed foreground feeds in the current interactive refresh. Clamped to
    // [0, scopeTotal]; only meaningful while a scope is set.
    const interactiveRefreshScopeTotal = this.interactiveRefreshScopeTotal;
    const interactiveRefreshCompleted = interactiveRefreshScopeTotal > 0
      ? Math.min(
          interactiveRefreshScopeTotal,
          Math.max(0, this.interactiveRefreshForegroundTotal - foregroundQueuedFeedCount),
        )
      : 0;
    const nextSnapshot: FeedRefreshActivitySnapshot = {
      activeFeedCount: this.activeFeeds.size,
      queuedFeedCount,
      foregroundQueuedFeedCount,
      backgroundQueuedFeedCount,
      displayFeedCount,
      isAnyFeedRefreshing: displayFeedCount > 0,
      isForegroundFeedRefreshing,
      isBackgroundFeedRefreshing,
      interactiveRefreshScopeTotal,
      interactiveRefreshCompleted,
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
      && nextSnapshot.interactiveRefreshScopeTotal === this.snapshot.interactiveRefreshScopeTotal
      && nextSnapshot.interactiveRefreshCompleted === this.snapshot.interactiveRefreshCompleted
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.listeners.forEach((listener) => listener());
  }
}

export const feedRefreshActivity = new FeedRefreshActivity();
