import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { tauriClient } from '@/lib/tauriClient';
import * as articleStore from '@/stores/articleStore';
import * as feedStore from '@/stores/feedStore';
import { feedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { feedRefreshCoordinator } from '@/services/feeds/feedRefreshCoordinator';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';
import { storeParsedFeedContent } from '@/services/feeds/feedRefreshPipeline';
import { maybeRefreshFavicon } from '@/services/favicons/faviconRefreshService';
import { settingsManager } from '@/services/settings';
import { createTaskPool } from '@/services/tasks/taskPool';
import { logger } from '@/services/logger';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { getE2eConfig, resolveE2eConfig } from '@/services/e2e/e2eHarness';
import { createSchedulerRunPlan } from './schedulerRunPlan';
import { getSchedulerConcurrency, setSchedulerRuntimeUiState } from './schedulerConcurrency';
import type { SchedulerCycleScope } from './feedSchedulerServiceTypes';
import {
  collectFeedIdsNeedingCountSync,
  isNativeFeedIngestionEnabled,
} from './nativeSchedulerCycle';
import { runNativeFeedRefresh } from './nativeFeedRefresh';
import {
  mergePendingCycleReason,
  overdueCycleMs,
  shouldRunDeferredCycleNow,
  type PendingCycleReason,
} from './schedulerDeferredCyclePolicy';
import type {
  BackgroundUpdateMode,
  FeedPriorityEntry,
  SchedulerEvent,
  SchedulerFeedEntry,
} from './types';

const SCHEDULER_CYCLE_TICK_EVENT = 'scheduler:cycle-tick';
const SCHEDULER_SYSTEM_SLEEP_EVENT = 'scheduler:system-sleep';
const SCHEDULER_SYSTEM_RESUME_EVENT = 'scheduler:system-resume';
const SCHEDULER_TICK_WAKE_GLOBAL = '__kijiSchedulerTick';
const SCHEDULER_SLEEP_WAKE_GLOBAL = '__kijiSchedulerSleep';
const SCHEDULER_RESUME_WAKE_GLOBAL = '__kijiSchedulerResume';
const STALE_CYCLE_ABORT_MS = 45 * 60 * 1_000;
const MAX_DEFERRED_TICKS_BEFORE_FORCE_ABORT = 3;
// Renderer-side sleep detection: JS timers freeze during system sleep, and the
// native sleep/resume events are not always delivered. A coarse heartbeat
// whose wall-clock delta far exceeds its interval means the machine slept —
// run the same catch-up path as a native resume event.
const SLEEP_GAP_HEARTBEAT_MS = 30_000;
const SLEEP_GAP_DETECT_MS = 120_000;
const STATION_SELECTION_PAUSE_MAX_MS = 10 * 60 * 1_000;
const STARTUP_CYCLE_IDLE_FALLBACK_MS = 30_000;
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

class FeedSchedulerService {
  private cycleInProgress = false;
  private pendingCycleTick = false;
  private pendingCycleReason: PendingCycleReason | null = null;
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
  private stationSelectionPauseTimer: ReturnType<typeof setTimeout> | null = null;
  private activeStationFocus: ActiveStationFocus | null = null;
  private skipOnceFeedIds = new Set<string>();
  private pendingImportRefreshFeedIds: Set<string> | null = null;
  private consecutiveDeferredTicks = 0;
  private activeCycleId = 0;
  private activeCycleDrain: Promise<void> | null = null;
  private resolveActiveCycleDrain: (() => void) | null = null;
  private systemPowerUnlistenSleep: UnlistenFn | null = null;
  private systemPowerUnlistenResume: UnlistenFn | null = null;
  private deferStartupCycleUntilInteraction = false;
  private startupDeferTimer: ReturnType<typeof setTimeout> | null = null;
  private deferredCycleRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepGapHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastSleepGapHeartbeatAt = 0;

  on(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setRuntimeUiState(patch: Partial<{ scrollActive: boolean; articleViewOpen: boolean }>): void {
    setSchedulerRuntimeUiState(patch);
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
      const e2eConfig = await resolveE2eConfig();
      this.deferStartupCycleUntilInteraction = e2eConfig === null && !import.meta.env.VITEST;
      if (this.mode === 'never' || this.mode === 'on-launch') {
        this.clearSleepGapHeartbeat();
      } else {
        this.ensureSleepGapHeartbeat();
      }
      await this.ensureNativeTickListener(lifecycleId);
      await this.ensureSystemPowerListener(lifecycleId);
      this.registerNativeWakeHandlers();

      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      if (this.nativeDriverActive) {
        await this.ensureNativeDriverRunning(lifecycleId);
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
        this.markPendingCycleTick('interval-tick');
        this.invalidateActiveCycle();
        this.clearAbort();
        this.cycleInProgress = false;
      }
      this.stationSelectionPauseTimer = setTimeout(() => {
        this.releaseStationSelectionPause('timeout');
      }, STATION_SELECTION_PAUSE_MAX_MS);
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

    this.clearStationSelectionPauseTimer();
    logger.info('Scheduler', 'Resuming background refresh after station selection');
    this.maybeRunDeferredCycle(this.lifecycleId);
  }

  releaseStationSelectionPause(reason: 'background' | 'timeout' | 'selection-changed'): void {
    if (this.stationSelectionPauseDepth === 0) {
      return;
    }

    this.clearStationSelectionPauseTimer();
    this.stationSelectionPauseDepth = 0;
    logger.info('Scheduler', 'Released station-selection scheduler pause', { reason });

    if (reason === 'selection-changed') {
      this.pendingImportRefreshFeedIds = null;
      feedRefreshActivity.clearInteractiveRefreshDeferredTail();
      if (this.shouldScheduleCatchUpCycle()) {
        this.markPendingCycleTick('catch-up');
      }
      return;
    }

    const lifecycleId = this.lifecycleId;
    if (this.pendingCycleTick || this.shouldScheduleCatchUpCycle()) {
      this.clearPendingCycleTick();
      void this.runScheduledCycle(lifecycleId, this.consumePendingImportRefreshScope());
      return;
    }

    this.maybeRunDeferredCycle(lifecycleId);
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

  isStationSelectionPaused(): boolean {
    return this.isStationSelectionPausedInternal();
  }

  /** First sidebar interaction lifts startup cycle deferral (cycle still waits for selection pause). */
  acknowledgeSidebarInteraction(): void {
    if (!this.deferStartupCycleUntilInteraction) {
      return;
    }

    this.deferStartupCycleUntilInteraction = false;
    this.clearStartupDeferTimer();
    logger.info('Scheduler', 'Startup background refresh deferral lifted after sidebar interaction');
  }

  /** E2E harness: lift startup deferral and run a catch-up cycle after bootstrap selection. */
  async kickE2eHarnessScheduler(): Promise<void> {
    const e2eConfig = getE2eConfig() ?? await resolveE2eConfig();
    if (!e2eConfig) {
      return;
    }

    this.deferStartupCycleUntilInteraction = false;
    this.clearStartupDeferTimer();
    this.markPendingCycleTick('catch-up');

    const lifecycleId = this.lifecycleId;
    await this.ensureNativeDriverRunning(lifecycleId);
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    if (this.isStationSelectionPaused()) {
      this.markPendingCycleTick('catch-up');
      return;
    }

    await this.catchUpAfterResume();
  }

  async stop(): Promise<void> {
    this.lifecycleId += 1;
    this.unregisterNativeWakeHandlers();
    this.clearAbort();
    this.clearDeferredCycleRetryTimer();
    this.clearSleepGapHeartbeat();
    this.cycleInProgress = false;
    this.pendingCycleTick = false;
    this.pendingCycleReason = null;
    this.stationSelectionPauseDepth = 0;
    this.clearStationSelectionPauseTimer();
    this.activeStationFocus = null;
    this.skipOnceFeedIds.clear();
    this.pendingImportRefreshFeedIds = null;
    this.consecutiveDeferredTicks = 0;
    this.deferStartupCycleUntilInteraction = false;
    this.clearStartupDeferTimer();
    this.invalidateActiveCycle();
    this.finishCycleDrain();

    if (this.systemPowerUnlistenSleep) {
      this.systemPowerUnlistenSleep();
      this.systemPowerUnlistenSleep = null;
    }

    if (this.systemPowerUnlistenResume) {
      this.systemPowerUnlistenResume();
      this.systemPowerUnlistenResume = null;
    }

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

    await this.ensureNativeDriverRunning(lifecycleId);
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    if (this.isStationSelectionPaused()) {
      if (this.shouldScheduleCatchUpCycle()) {
        this.markPendingCycleTick('resume');
      }
      return;
    }

    if (this.cycleInProgress) {
      if (this.shouldAbortStaleCycle()) {
        await this.forceAbortActiveCycle('resume');
      } else {
        return;
      }
    }

    const wasOverdue = this.shouldScheduleCatchUpCycle() || this.pendingCycleTick;
    if (!wasOverdue) {
      return;
    }

    await this.runResumeCatchUpCycles(lifecycleId, wasOverdue);
  }

  async handleSystemSleep(): Promise<void> {
    const lifecycleId = this.lifecycleId;
    if (!this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    logger.info('Scheduler', 'Handling system sleep for background refresh');
    if (this.cycleInProgress) {
      await this.forceAbortActiveCycle('system-sleep');
    }
  }

  private async runResumeCatchUpCycles(lifecycleId: number, wasOverdue: boolean): Promise<void> {
    const stationFeedIds = this.activeStationFocus?.feedIds;
    const intervalMs = this.getIntervalMs();
    const overdueMs = this.lastCycleCompletedAt === null
      ? intervalMs
      : Date.now() - this.lastCycleCompletedAt;

    if (wasOverdue && stationFeedIds && stationFeedIds.size > 0) {
      logger.info('Scheduler', 'Running station-first catch-up after resume', {
        mode: this.mode,
        overdueMs,
        stationFeedCount: stationFeedIds.size,
      });
      this.pendingCycleTick = false;
      await this.runScheduledCycle(lifecycleId, { onlyFeedIds: stationFeedIds });
      if (!this.isCurrentLifecycle(lifecycleId)) {
        return;
      }
    }

    if (!wasOverdue && !this.pendingCycleTick) {
      return;
    }

    logger.info('Scheduler', 'Running catch-up background refresh after resume', {
      mode: this.mode,
      overdueMs,
      pendingCycleTick: this.pendingCycleTick,
    });
    this.pendingCycleTick = false;
    await this.runScheduledCycle(lifecycleId, {
      excludeFeedIds: stationFeedIds && stationFeedIds.size > 0 ? stationFeedIds : undefined,
    });
  }

  /**
   * Detects system sleep via wall-clock jumps between heartbeats. Timers
   * freeze during sleep, so a beat whose delta far exceeds the interval means
   * the machine slept; native sleep/resume events are not reliably delivered
   * (observed in production logs), so this is the fallback trigger for the
   * resume catch-up path. Single interval per scheduler session; cleared on
   * `stop()`.
   */
  private ensureSleepGapHeartbeat(): void {
    if (this.sleepGapHeartbeatTimer !== null) {
      return;
    }

    this.lastSleepGapHeartbeatAt = Date.now();
    this.sleepGapHeartbeatTimer = setInterval(() => {
      const now = Date.now();
      const gapMs = now - this.lastSleepGapHeartbeatAt;
      this.lastSleepGapHeartbeatAt = now;
      if (gapMs < SLEEP_GAP_DETECT_MS) {
        return;
      }

      logger.warn('Scheduler', 'Detected system sleep gap via wall-clock jump', {
        gapMs,
        mode: this.mode,
      });
      void this.catchUpAfterResume();
    }, SLEEP_GAP_HEARTBEAT_MS);
  }

  private clearSleepGapHeartbeat(): void {
    if (this.sleepGapHeartbeatTimer !== null) {
      clearInterval(this.sleepGapHeartbeatTimer);
      this.sleepGapHeartbeatTimer = null;
    }
  }

  private pruneExpiredBoosts(now = Date.now()): void {
    for (const [feedId, boostUntil] of this.boosts) {
      if (boostUntil <= now) {
        this.boosts.delete(feedId);
      }
    }
  }

  private markPendingCycleTick(reason: PendingCycleReason): void {
    this.pendingCycleTick = true;
    this.pendingCycleReason = mergePendingCycleReason(this.pendingCycleReason, reason);
  }

  private clearPendingCycleTick(): void {
    this.pendingCycleTick = false;
    this.pendingCycleReason = null;
  }

  private clearDeferredCycleRetryTimer(): void {
    if (this.deferredCycleRetryTimer !== null) {
      clearTimeout(this.deferredCycleRetryTimer);
      this.deferredCycleRetryTimer = null;
    }
  }

  private scheduleDeferredCycleRetry(lifecycleId: number): void {
    if (this.deferredCycleRetryTimer !== null) {
      return;
    }

    const intervalMs = this.getIntervalMs();
    if (!Number.isFinite(intervalMs)) {
      return;
    }

    const remainingMs = Math.max(
      1_000,
      intervalMs - overdueCycleMs(this.lastCycleCompletedAt, intervalMs),
    );

    this.deferredCycleRetryTimer = setTimeout(() => {
      this.deferredCycleRetryTimer = null;
      this.maybeRunDeferredCycle(lifecycleId);
    }, remainingMs);
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

    const importScope: SchedulerCycleScope = {
      onlyFeedIds: new Set(feedIds),
    };

    if (this.cycleInProgress || this.isStationSelectionPaused()) {
      this.markPendingCycleTick('import-boost');
      this.mergePendingImportRefreshFeedIds(feedIds);

      // A cycle that spans a system sleep can stall for hours; a boost is a
      // user-intent signal (station switch, import), so preempt the stale
      // cycle instead of deferring the refresh behind it. Fire-and-forget —
      // boostMany stays synchronous on the selection click path.
      if (!this.isStationSelectionPaused() && this.shouldAbortStaleCycle()) {
        const lifecycleId = this.lifecycleId;
        logger.warn('Scheduler', 'Preempting stale refresh cycle for boosted feeds', {
          feedCount: feedIds.length,
        });
        void this.forceAbortActiveCycle('boost-preempt').then(() => {
          if (
            !this.isCurrentLifecycle(lifecycleId)
            || this.cycleInProgress
            || this.isStationSelectionPaused()
          ) {
            return;
          }
          this.clearPendingCycleTick();
          void this.runScheduledCycle(lifecycleId, this.consumePendingImportRefreshScope());
        });
        return;
      }

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

    void this.runScheduledCycle(this.lifecycleId, importScope);
  }

  private mergePendingImportRefreshFeedIds(feedIds: Iterable<string>): void {
    if (!this.pendingImportRefreshFeedIds) {
      this.pendingImportRefreshFeedIds = new Set(feedIds);
      return;
    }

    for (const feedId of feedIds) {
      this.pendingImportRefreshFeedIds.add(feedId);
    }
  }

  private consumePendingImportRefreshScope(): SchedulerCycleScope {
    if (!this.pendingImportRefreshFeedIds || this.pendingImportRefreshFeedIds.size === 0) {
      return {};
    }

    const onlyFeedIds = this.pendingImportRefreshFeedIds;
    this.pendingImportRefreshFeedIds = null;
    return { onlyFeedIds };
  }

  private clearStartupDeferTimer(): void {
    if (this.startupDeferTimer !== null) {
      clearTimeout(this.startupDeferTimer);
      this.startupDeferTimer = null;
    }
  }

  private ensureStartupDeferFallbackTimer(lifecycleId: number): void {
    if (this.startupDeferTimer !== null || !this.deferStartupCycleUntilInteraction) {
      return;
    }

    this.startupDeferTimer = setTimeout(() => {
      this.startupDeferTimer = null;
      if (!this.isCurrentLifecycle(lifecycleId) || !this.deferStartupCycleUntilInteraction) {
        return;
      }

      this.deferStartupCycleUntilInteraction = false;
      logger.info('Scheduler', 'Startup background refresh deferral expired; scheduling idle catch-up');
      this.maybeRunDeferredCycle(lifecycleId);
    }, STARTUP_CYCLE_IDLE_FALLBACK_MS);
  }

  private isStationSelectionPausedInternal(): boolean {
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

    const reason = this.pendingCycleReason ?? 'interval-tick';
    const intervalMs = this.getIntervalMs();
    if (!shouldRunDeferredCycleNow({
      reason,
      lastCycleCompletedAt: this.lastCycleCompletedAt,
      intervalMs,
    })) {
      logger.info('Scheduler', 'Deferred native scheduler tick coalesced until interval overdue', {
        mode: this.mode,
        reason,
        overdueMs: overdueCycleMs(this.lastCycleCompletedAt, intervalMs),
        intervalMs,
      });
      this.scheduleDeferredCycleRetry(lifecycleId);
      return;
    }

    this.clearDeferredCycleRetryTimer();
    this.clearPendingCycleTick();
    logger.info('Scheduler', 'Running deferred native scheduler tick', { mode: this.mode, reason });
    void this.runScheduledCycle(lifecycleId, this.consumePendingImportRefreshScope());
  }

  private getIntervalMs(): number {
    const e2eConfig = getE2eConfig();
    if (e2eConfig?.schedulerIntervalMs && e2eConfig.schedulerIntervalMs > 0) {
      return e2eConfig.schedulerIntervalMs;
    }

    if (this.mode === 'on-launch' || this.mode === 'never') {
      return Number.POSITIVE_INFINITY;
    }
    return MODE_INTERVAL_MS[this.mode];
  }

  private registerNativeWakeHandlers(): void {
    if (typeof globalThis === 'undefined') {
      return;
    }

    const globalScope = globalThis as Record<string, unknown>;
    globalScope[SCHEDULER_TICK_WAKE_GLOBAL] = () => {
      void this.handleNativeCycleTick(this.lifecycleId);
    };
    globalScope[SCHEDULER_SLEEP_WAKE_GLOBAL] = () => {
      void this.handleSystemSleep();
    };
    globalScope[SCHEDULER_RESUME_WAKE_GLOBAL] = () => {
      void this.catchUpAfterResume();
    };
  }

  private unregisterNativeWakeHandlers(): void {
    if (typeof globalThis === 'undefined') {
      return;
    }

    const globalScope = globalThis as Record<string, unknown>;
    delete globalScope[SCHEDULER_TICK_WAKE_GLOBAL];
    delete globalScope[SCHEDULER_SLEEP_WAKE_GLOBAL];
    delete globalScope[SCHEDULER_RESUME_WAKE_GLOBAL];
  }

  private async ensureNativeDriverRunning(lifecycleId: number): Promise<void> {
    if (
      !this.isCurrentLifecycle(lifecycleId)
      || !this.nativeDriverActive
      || this.mode === 'never'
      || this.mode === 'on-launch'
    ) {
      return;
    }

    try {
      await tauriClient.scheduler.reconfigure({ mode: this.mode });
    } catch (error) {
      logger.warn('Scheduler', 'Failed to ensure native feed scheduler driver is running', { error });
    }
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

    if (this.deferStartupCycleUntilInteraction) {
      this.markPendingCycleTick('startup-defer');
      this.ensureStartupDeferFallbackTimer(lifecycleId);
      logger.info('Scheduler', 'Deferred startup background refresh until sidebar interaction', {
        mode: this.mode,
      });
      return;
    }

    if (this.isStationSelectionPaused()) {
      this.markPendingCycleTick('interval-tick');
      logger.info('Scheduler', 'Deferred native scheduler tick during station selection', {
        mode: this.mode,
      });
      return;
    }

    if (this.cycleInProgress) {
      if (this.shouldAbortStaleCycle()) {
        await this.forceAbortActiveCycle('deferred-tick');
      } else {
        this.markPendingCycleTick('interval-tick');
        this.consecutiveDeferredTicks += 1;
        logger.info('Scheduler', 'Deferred native scheduler tick until current refresh cycle completes', {
          mode: this.mode,
          consecutiveDeferredTicks: this.consecutiveDeferredTicks,
        });
        return;
      }
    }

    this.consecutiveDeferredTicks = 0;
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

  private async runScheduledCycle(
    lifecycleId: number,
    scope: SchedulerCycleScope = {},
  ): Promise<void> {
    if (!this.isCurrentLifecycle(lifecycleId) || this.cycleInProgress) {
      return;
    }

    if (this.isStationSelectionPaused()) {
      this.markPendingCycleTick('interval-tick');
      return;
    }

    await this.refreshAllFeeds(lifecycleId, scope);
  }

  private getStaleCycleThresholdMs(): number {
    const intervalMs = this.getIntervalMs();
    if (!Number.isFinite(intervalMs)) {
      return STALE_CYCLE_ABORT_MS;
    }
    return Math.min(STALE_CYCLE_ABORT_MS, intervalMs * 2);
  }

  private shouldAbortStaleCycle(): boolean {
    if (!this.cycleInProgress) {
      return false;
    }

    if (this.consecutiveDeferredTicks >= MAX_DEFERRED_TICKS_BEFORE_FORCE_ABORT) {
      return true;
    }

    const startedAt = this.lastCycleStartedAt;
    if (startedAt === null) {
      return false;
    }

    return Date.now() - startedAt >= this.getStaleCycleThresholdMs();
  }

  private beginCycleDrain(): void {
    this.finishCycleDrain();
    this.activeCycleDrain = new Promise<void>((resolve) => {
      this.resolveActiveCycleDrain = resolve;
    });
  }

  private finishCycleDrain(): void {
    this.resolveActiveCycleDrain?.();
    this.resolveActiveCycleDrain = null;
    this.activeCycleDrain = null;
  }

  private async awaitCycleDrain(): Promise<void> {
    const drain = this.activeCycleDrain;
    if (!drain) {
      return;
    }
    await drain;
  }

  private invalidateActiveCycle(): void {
    this.activeCycleId += 1;
  }

  private async forceAbortActiveCycle(trigger: string): Promise<boolean> {
    const wasActive = this.cycleInProgress || this.activeCycleDrain !== null;
    if (!wasActive) {
      return false;
    }

    const stallDurationMs = this.lastCycleStartedAt === null
      ? 0
      : Date.now() - this.lastCycleStartedAt;

    logger.warn('Scheduler', 'Aborting stale background refresh cycle', {
      trigger,
      mode: this.mode,
      stallDurationMs,
      consecutiveDeferredTicks: this.consecutiveDeferredTicks,
    });

    this.invalidateActiveCycle();
    this.clearAbort();
    this.cycleInProgress = false;
    this.consecutiveDeferredTicks = 0;
    this.markPendingCycleTick('interval-tick');
    await this.awaitCycleDrain();
    return true;
  }

  private async ensureSystemPowerListener(lifecycleId: number): Promise<void> {
    if (this.systemPowerUnlistenSleep && this.systemPowerUnlistenResume) {
      return;
    }

    this.systemPowerUnlistenSleep = await listen(SCHEDULER_SYSTEM_SLEEP_EVENT, () => {
      void this.handleSystemSleep();
    });
    this.systemPowerUnlistenResume = await listen(SCHEDULER_SYSTEM_RESUME_EVENT, () => {
      void this.catchUpAfterResume();
    });

    if (!this.isCurrentLifecycle(lifecycleId)) {
      this.systemPowerUnlistenSleep();
      this.systemPowerUnlistenSleep = null;
      this.systemPowerUnlistenResume();
      this.systemPowerUnlistenResume = null;
    }
  }

  private clearStationSelectionPauseTimer(): void {
    if (this.stationSelectionPauseTimer !== null) {
      clearTimeout(this.stationSelectionPauseTimer);
      this.stationSelectionPauseTimer = null;
    }
  }

  private clearAbort(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  private isCurrentLifecycle(lifecycleId: number): boolean {
    return lifecycleId === this.lifecycleId;
  }

  private async refreshAllFeeds(
    lifecycleId: number,
    scope: SchedulerCycleScope = {},
  ): Promise<void> {
    if (this.cycleInProgress || !this.isCurrentLifecycle(lifecycleId)) {
      return;
    }

    const cycleId = this.activeCycleId + 1;
    this.activeCycleId = cycleId;
    this.clearDeferredCycleRetryTimer();
    this.clearPendingCycleTick();
    this.beginCycleDrain();
    this.cycleInProgress = true;
    this.lastCycleStartedAt = Date.now();
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    this.emit({ type: 'cycle-start' });
    logger.info('Scheduler', 'Background refresh cycle started', {
      mode: this.mode,
      scopedFeedCount: scope.onlyFeedIds?.size ?? null,
      excludedFeedCount: scope.excludeFeedIds?.size ?? null,
    });

    const cycleStats: SchedulerCycleStats = {
      notModifiedFeeds: 0,
      changedFeeds: 0,
      insertedArticles: 0,
      failedFeeds: 0,
    };
    const feedsNeedingCountSync = new Set<string>();

    try {
      const feeds = await feedStore.getAll();
      if (feeds.length === 0 || signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
        return;
      }

      if (cycleId !== this.activeCycleId) {
        return;
      }

      if (isNativeFeedIngestionEnabled()) {
        await this.executeNativeRefreshCycle({
          lifecycleId,
          cycleId,
          scope,
          signal,
        });
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

      const frontloadFeedIds = scope.onlyFeedIds ?? this.activeStationFocus?.feedIds;
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
          onlyFeedIds: scope.onlyFeedIds,
          excludeFeedIds: scope.excludeFeedIds,
        },
      );

      const releaseQueuedFeeds = prioritized.length > 0
        ? feedRefreshActivity.beginQueuedFeeds(prioritized.map((entry) => entry.feedId), 'background')
        : null;

      try {
        const pool = createTaskPool({ concurrency: getSchedulerConcurrency() });
        for (const entry of prioritized) {
          if (signal.aborted || !this.isCurrentLifecycle(lifecycleId) || cycleId !== this.activeCycleId) {
            break;
          }
          pool.enqueue(() => this.fetchSingleFeed(
            entry,
            signal,
            lifecycleId,
            cycleStats,
            releaseQueuedFeeds,
            feedsNeedingCountSync,
          ));
        }

        await pool.whenIdle();

        if (
          feedsNeedingCountSync.size > 0
          && !signal.aborted
          && this.isCurrentLifecycle(lifecycleId)
          && cycleId === this.activeCycleId
        ) {
          const syncedCounts = await articleStore.syncFeedCountsBatch(Array.from(feedsNeedingCountSync));
          if (syncedCounts.length > 0) {
            feedLibraryMutationBus.publishFeedsCountsUpdated(
              syncedCounts.map((counts) => ({
                feedId: counts.feedId,
                unreadCount: counts.unreadCount,
                articleCount: counts.articleCount,
              })),
            );
          }
        }
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
      this.finishCycleDrain();

      if (cycleId !== this.activeCycleId) {
        logger.info('Scheduler', 'Discarded superseded background refresh cycle completion', {
          mode: this.mode,
          cycleId,
          activeCycleId: this.activeCycleId,
        });
        if (scope.onlyFeedIds && scope.onlyFeedIds.size > 0 && !this.cycleInProgress) {
          feedRefreshActivity.clearInteractiveRefreshDeferredTail();
        }
        return;
      }

      this.cycleInProgress = false;
      this.abortController = null;
      this.lastCycleCompletedAt = Date.now();
      this.consecutiveDeferredTicks = 0;
      this.emit({ type: 'cycle-complete' });
      logger.info('Scheduler', 'Background refresh cycle completed', {
        mode: this.mode,
        durationMs,
      });

      if (scope.onlyFeedIds && scope.onlyFeedIds.size > 0) {
        feedRefreshActivity.clearInteractiveRefreshDeferredTail();
      }

      this.maybeRunDeferredCycle(lifecycleId);
    }
  }

  private async executeNativeRefreshCycle(input: {
    lifecycleId: number;
    cycleId: number;
    scope: SchedulerCycleScope;
    signal: AbortSignal;
  }): Promise<void> {
    const { lifecycleId, cycleId, scope, signal } = input;
    const frontloadFeedIds = scope.onlyFeedIds ?? this.activeStationFocus?.feedIds;
    const skipFeedIdsForThisCycle = this.consumeSkipOnceFeedIds();
    const now = Date.now();
    this.pruneExpiredBoosts(now);

    try {
      if (signal.aborted || !this.isCurrentLifecycle(lifecycleId) || cycleId !== this.activeCycleId) {
        return;
      }

      const result = await runNativeFeedRefresh({
        scope,
        boosts: this.boosts,
        frontloadFeedIds,
        skipFeedIdsForThisCycle,
        signal,
        activityKind: 'background',
        onFeedComplete: (payload) => {
          if (!payload.error) {
            return;
          }

          this.emit({
            type: 'feed-failed',
            feedId: payload.feedId,
            error: payload.error,
          });
        },
      });

      if (signal.aborted || !this.isCurrentLifecycle(lifecycleId) || cycleId !== this.activeCycleId) {
        return;
      }

      const feedIdsToSync = collectFeedIdsNeedingCountSync(result.feedResults);
      if (feedIdsToSync.length > 0) {
        const syncedCounts = await articleStore.syncFeedCountsBatch(feedIdsToSync);
        if (syncedCounts.length > 0) {
          feedLibraryMutationBus.publishFeedsCountsUpdated(
            syncedCounts.map((counts) => ({
              feedId: counts.feedId,
              unreadCount: counts.unreadCount,
              articleCount: counts.articleCount,
            })),
          );
        }
      }

      // Native cycles bypass the per-feed `feed-updated` emit in the legacy
      // path; without this batch event the article list is never re-queried
      // after a background cycle inserts articles (list stays stale until the
      // next cold switch).
      if (result.insertedByFeedId.size > 0) {
        this.emit({
          type: 'feeds-batch-updated',
          updates: Array.from(result.insertedByFeedId, ([feedId, newArticleCount]) => ({
            feedId,
            newArticleCount,
          })),
        });
      }

      logger.info('Scheduler', 'Native background refresh cycle stats', {
        queuedCount: result.feedResults.length,
        executedFeedCount: result.feedResults.length,
        changedFeeds: result.feedResults.filter((feed) => feed.status === 'changed').length,
        notModifiedFeeds: result.feedResults.filter((feed) => feed.status === 'not-modified').length,
        failedFeeds: result.feedResults.filter((feed) => feed.status === 'failed').length,
        insertedArticles: result.insertedArticles,
        activeStationFeedCount: frontloadFeedIds?.size ?? 0,
      });
    } catch (error) {
      logger.error('Scheduler', 'Native background refresh cycle failed', { error });
    }
  }

  private async fetchSingleFeed(
    entry: FeedPriorityEntry,
    signal: AbortSignal,
    lifecycleId: number,
    cycleStats: SchedulerCycleStats,
    releaseQueuedFeeds: ((feedId?: string) => void) | null,
    feedsNeedingCountSync: Set<string>,
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

        const stored = await storeParsedFeedContent({
          feedId: entry.feedId,
          feedUrl: entry.feedUrl,
          feed,
          feedTitle: entry.feedTitle,
          rawText: networkResult.data,
          signal,
        });
        if (signal.aborted || !this.isCurrentLifecycle(lifecycleId)) {
          return;
        }

        cycleStats.changedFeeds += 1;
        cycleStats.insertedArticles += stored.insertedCount;
        feedsNeedingCountSync.add(entry.feedId);

        await feedStore.update(entry.feedId, {
          lastFetched: new Date(),
          lastFailedFetchAt: undefined,
          updateFrequencyScore: stored.updateFrequencyScore ?? feed.updateFrequencyScore,
          consecutiveFailures: 0,
          etag: networkResult.etag,
          lastModifiedHeader: networkResult.lastModified,
        });

        void maybeRefreshFavicon(entry.feedId, entry.feedUrl);
        this.emit({ type: 'feed-updated', feedId: entry.feedId, newArticleCount: stored.insertedCount });
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
