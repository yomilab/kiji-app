import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import { convertFeedItemsToArticles } from '@/services/articles/articleConverter';
import { feedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { feedRefreshCoordinator } from '@/services/feeds/feedRefreshCoordinator';
import { feedsFetcher, parseFeed } from '@/services/feeds/feedsFetcher';
import { maybeRefreshFavicon } from '@/services/favicons/faviconRefreshService';
import { settingsManager } from '@/services/settings';
import { createTaskPool } from '@/services/tasks/taskPool';
import { logger } from '@/services/logger';
import { computeFrequencyFromDates } from './feedPriorityCalculator';
import { createSchedulerRunPlan } from './schedulerRunPlan';
import type {
  BackgroundUpdateMode,
  FeedPriorityEntry,
  SchedulerEvent,
  SchedulerFeedEntry,
} from './types';

const SCHEDULER_CYCLE_TICK_EVENT = 'scheduler:cycle-tick';
const STALE_CYCLE_ABORT_MS = 45 * 60 * 1_000;
const BOOST_TTL_MS = 5 * 60_000;

const MODE_INTERVAL_MS: Record<Exclude<BackgroundUpdateMode, 'on-launch' | 'never'>, number> = {
  'every-5m': 5 * 60_000,
  'every-10m': 10 * 60_000,
  'every-15m': 15 * 60_000,
  'every-30m': 30 * 60_000,
  'every-1h': 60 * 60_000,
};

interface SchedulerCycleStats {
  notModifiedFeeds: number;
  changedFeeds: number;
  insertedArticles: number;
  failedFeeds: number;
}

interface ActiveStationFocus {
  sourceKey: string;
  feedIds: Set<string>;
}

const getConcurrency = (): number => {
  if (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) {
    return Math.min(8, Math.max(3, navigator.hardwareConcurrency));
  }
  return 3;
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
  private boosts = new Map<string, number>();
  private stationSelectionPauseDepth = 0;
  private activeStationFocus: ActiveStationFocus | null = null;
  private skipOnceFeedIds = new Set<string>();

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

  pauseForStationSelection(): void {
    if (this.stationSelectionPauseDepth === 0) {
      logger.info('Scheduler', 'Pausing background refresh for station selection');
      if (this.cycleInProgress) {
        this.pendingCycleTick = true;
        this.clearAbort();
      }
    }

    this.stationSelectionPauseDepth += 1;
  }

  resumeAfterStationSelection(): void {
    if (this.stationSelectionPauseDepth === 0) {
      return;
    }

    this.stationSelectionPauseDepth -= 1;
    if (this.stationSelectionPauseDepth > 0) {
      return;
    }

    logger.info('Scheduler', 'Resuming background refresh after station selection');
    this.maybeRunDeferredCycle(this.lifecycleId);
  }

  setActiveStationFocus(sourceKey: string, feedIds: string[]): void {
    this.activeStationFocus = {
      sourceKey,
      feedIds: new Set(feedIds),
    };
  }

  clearActiveStationFocus(sourceKey?: string): void {
    if (!this.activeStationFocus) {
      return;
    }

    if (sourceKey && this.activeStationFocus.sourceKey !== sourceKey) {
      return;
    }

    this.activeStationFocus = null;
  }

  suppressFeedsForNextCycle(feedIds: string[]): void {
    for (const feedId of feedIds) {
      this.skipOnceFeedIds.add(feedId);
    }
  }

  async stop(): Promise<void> {
    this.lifecycleId += 1;
    this.clearAbort();
    this.cycleInProgress = false;
    this.pendingCycleTick = false;
    this.stationSelectionPauseDepth = 0;
    this.activeStationFocus = null;
    this.skipOnceFeedIds.clear();

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

    if (this.isStationSelectionPaused()) {
      if (this.shouldScheduleCatchUpCycle()) {
        this.pendingCycleTick = true;
      }
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

    if (!this.shouldScheduleCatchUpCycle()) {
      return;
    }

    const intervalMs = this.getIntervalMs();
    const overdueMs = this.lastCycleCompletedAt === null
      ? intervalMs
      : Date.now() - this.lastCycleCompletedAt;

    logger.info('Scheduler', 'Running catch-up background refresh after resume', {
      mode: this.mode,
      overdueMs,
      pendingCycleTick: this.pendingCycleTick,
    });
    this.pendingCycleTick = false;
    await this.runScheduledCycle(lifecycleId);
  }

  private pruneExpiredBoosts(now = Date.now()): void {
    for (const [feedId, boostUntil] of this.boosts) {
      if (boostUntil <= now) {
        this.boosts.delete(feedId);
      }
    }
  }

  boostMany(feedIds: string[]): void {
    if (feedIds.length === 0) {
      return;
    }

    const boostUntil = Date.now() + BOOST_TTL_MS;
    this.pruneExpiredBoosts(boostUntil);
    for (const feedId of feedIds) {
      this.boosts.set(feedId, boostUntil);
    }

    if (this.cycleInProgress || this.isStationSelectionPaused()) {
      this.pendingCycleTick = true;
      logger.info('Scheduler', this.isStationSelectionPaused()
        ? 'Deferred boosted import refresh during station selection'
        : 'Deferred boosted import refresh until current cycle completes', {
        feedCount: feedIds.length,
      });
      return;
    }

    logger.info('Scheduler', 'Boosted feed priorities after import', {
      feedCount: feedIds.length,
    });

    void this.runScheduledCycle(this.lifecycleId);
  }

  private isStationSelectionPaused(): boolean {
    return this.stationSelectionPauseDepth > 0;
  }

  private shouldScheduleCatchUpCycle(): boolean {
    if (this.pendingCycleTick) {
      return true;
    }

    const intervalMs = this.getIntervalMs();
    const overdueMs = this.lastCycleCompletedAt === null
      ? intervalMs
      : Date.now() - this.lastCycleCompletedAt;
    return overdueMs >= intervalMs;
  }

  private maybeRunDeferredCycle(lifecycleId: number): void {
    if (
      !this.pendingCycleTick
      || this.cycleInProgress
      || !this.isCurrentLifecycle(lifecycleId)
      || this.isStationSelectionPaused()
    ) {
      return;
    }

    this.pendingCycleTick = false;
    logger.info('Scheduler', 'Running deferred native scheduler tick', { mode: this.mode });
    void this.runScheduledCycle(lifecycleId);
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

    if (this.isStationSelectionPaused()) {
      this.pendingCycleTick = true;
      logger.info('Scheduler', 'Deferred native scheduler tick during station selection', {
        mode: this.mode,
      });
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

    if (this.isStationSelectionPaused()) {
      this.pendingCycleTick = true;
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

    const cycleStats: SchedulerCycleStats = {
      notModifiedFeeds: 0,
      changedFeeds: 0,
      insertedArticles: 0,
      failedFeeds: 0,
    };

    try {
      const feeds = await feedStore.getAll();
      if (feeds.length === 0 || signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      const totalFeeds = feeds.length;
      const entries: SchedulerFeedEntry[] = feeds.map((feed) => ({
        feedId: feed.id,
        feedUrl: feed.url,
        feedTitle: feed.title,
        lastFetched: feed.lastFetched ?? null,
        lastFailedFetchAt: feed.lastFailedFetchAt ?? null,
        sortOrder: feed.sortOrder ?? 0,
        updateFrequencyScore: feed.updateFrequencyScore ?? 0,
        consecutiveFailures: feed.consecutiveFailures ?? 0,
      }));

      const frontloadFeedIds = this.activeStationFocus?.feedIds;
      const skipFeedIdsForThisCycle = this.consumeSkipOnceFeedIds();
      const now = Date.now();
      this.pruneExpiredBoosts(now);
      const { prioritized, skippedBackoffCount, skippedSuppressedCount } = createSchedulerRunPlan(
        entries,
        totalFeeds,
        this.boosts,
        now,
        {
          frontloadFeedIds,
          skipFeedIdsForThisCycle,
        },
      );

      const releaseQueuedFeeds = prioritized.length > 0
        ? feedRefreshActivity.beginQueuedFeeds(prioritized.map((entry) => entry.feedId), 'background')
        : null;

      try {
        const pool = createTaskPool({ concurrency: getConcurrency() });
        for (const entry of prioritized) {
          if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
            break;
          }
          pool.enqueue(() => this.fetchSingleFeed(
            entry,
            signal,
            lifecycleId,
            cycleStats,
            releaseQueuedFeeds,
          ));
        }

        await pool.whenIdle();
      } finally {
        releaseQueuedFeeds?.();
      }

      logger.info('Scheduler', 'Background refresh cycle stats', {
        totalFeeds,
        scheduledFeeds: prioritized.length,
        skippedBackoffFeeds: skippedBackoffCount,
        skippedSuppressedFeeds: skippedSuppressedCount,
        activeStationFeedCount: frontloadFeedIds?.size ?? 0,
        ...cycleStats,
      });
    } catch (error) {
      logger.error('Scheduler', 'Background refresh cycle failed', { error });
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

      this.maybeRunDeferredCycle(lifecycleId);
    }
  }

  private async fetchSingleFeed(
    entry: FeedPriorityEntry,
    signal: AbortSignal,
    lifecycleId: number,
    cycleStats: SchedulerCycleStats,
    releaseQueuedFeeds: ((feedId?: string) => void) | null,
  ): Promise<void> {
    let queuedFeedReleased = false;
    const settleQueuedFeed = (): void => {
      if (queuedFeedReleased || !releaseQueuedFeeds) {
        return;
      }
      queuedFeedReleased = true;
      releaseQueuedFeeds(entry.feedId);
    };

    if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
      settleQueuedFeed();
      return;
    }

    try {
      await feedRefreshCoordinator.run(entry.feedId, async () => {
        if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
          settleQueuedFeed();
          return;
        }

        const feed = await feedStore.getById(entry.feedId);
        if (!feed || signal.aborted) {
          settleQueuedFeed();
          return;
        }

        const networkResult = await feedRefreshActivity.track(
          entry.feedId,
          () => feedsFetcher.fetchFeedNetworkWithCache(entry.feedUrl, {
            etag: feed.etag,
            lastModified: feed.lastModifiedHeader,
            signal,
          }),
        );
        settleQueuedFeed();

        if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
          return;
        }

        if (networkResult.notModified || !networkResult.data) {
          await feedStore.update(entry.feedId, {
            lastFetched: new Date(),
            lastFailedFetchAt: undefined,
            consecutiveFailures: 0,
            etag: networkResult.etag,
            lastModifiedHeader: networkResult.lastModified,
          });
          cycleStats.notModifiedFeeds += 1;
          return;
        }

        const feedItems = parseFeed(networkResult.data, entry.feedUrl);
        const articles = await convertFeedItemsToArticles(feedItems, {
          feedId: entry.feedId,
          feedUrl: entry.feedUrl,
          feed,
          feedTitle: entry.feedTitle,
        });
        if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
          return;
        }

        const insertedCount = await articleStore.store(entry.feedId, articles);
        cycleStats.changedFeeds += 1;
        cycleStats.insertedArticles += insertedCount;

        const { articles: recentArticles } = await articleStore.query({
          feedIds: [entry.feedId],
          sort: { field: 'publishedDate', order: 'desc' },
          limit: 50,
        });

        const dates = recentArticles
          .map((article) => article.publishedDate)
          .filter((date): date is string => !!date);
        const newFrequency = computeFrequencyFromDates(dates);

        await feedStore.update(entry.feedId, {
          lastFetched: new Date(),
          lastFailedFetchAt: undefined,
          updateFrequencyScore: newFrequency,
          consecutiveFailures: 0,
          etag: networkResult.etag,
          lastModifiedHeader: networkResult.lastModified,
        });

        const unreadCount = await articleStore.getUnreadCount(entry.feedId);
        const articleCount = await articleStore.getArticleCount(entry.feedId);
        await feedStore.update(entry.feedId, { unreadCount, articleCount });

        void maybeRefreshFavicon(entry.feedId, entry.feedUrl);
        this.emit({ type: 'feed-updated', feedId: entry.feedId, newArticleCount: insertedCount });
      }, { signal });
    } catch (error) {
      settleQueuedFeed();

      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      cycleStats.failedFeeds += 1;
      logger.warn('Scheduler', 'Feed fetch failed in scheduler cycle', {
        feedId: entry.feedId,
        error: message,
      });

      await feedStore.update(entry.feedId, {
        consecutiveFailures: (entry.consecutiveFailures ?? 0) + 1,
        lastFailedFetchAt: new Date(),
      });

      this.emit({ type: 'feed-failed', feedId: entry.feedId, error: message });
    }
  }

  private consumeSkipOnceFeedIds(): Set<string> | undefined {
    if (this.skipOnceFeedIds.size === 0) {
      return undefined;
    }

    const skipFeedIds = new Set(this.skipOnceFeedIds);
    this.skipOnceFeedIds.clear();
    return skipFeedIds;
  }

  private emit(event: SchedulerEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }
}

export const feedScheduler = new FeedSchedulerService();
