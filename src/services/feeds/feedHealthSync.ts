import * as feedStore from '@/stores/feedStore';
import { getAllFeedMetadataCached } from '@/services/feeds/feedMetadataCache';
import { feedHealthFields, isFeedFailing } from '@/services/feeds/feedHealth';
import type { Feed } from '@/services/feeds/types';
import { logger } from '@/services/logger';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import type { SchedulerEvent } from '@/services/scheduler/types';

/**
 * Refresh cycles write feed failure state straight to SQLite without a bus publish. After a
 * cycle (or a UI refresh) that could have moved it, read the slim sidebar snapshot once, diff
 * each feed's health against the last known value, and publish only the changed feeds on the
 * existing `feedsCountsUpdated` path so sidebar rows and Manage Feeds update in place.
 *
 * Event driven only: nothing runs while the library is healthy and no cycle reports a failure.
 * `known` holds one short string per feed and is replaced on every read, so it never outgrows
 * the library. The failing ids are also readable as a tiny store so collapsed station rows can
 * show their hint without loading the feed catalog themselves.
 */

const NO_FAILING: ReadonlySet<string> = new Set();

let known: Map<string, string> | null = null;
let failingIds: ReadonlySet<string> = NO_FAILING;
const listeners = new Set<() => void>();
let seeding: Promise<void> | null = null;
let inFlight: Promise<void> | null = null;
let rerunRequested = false;

const signatureOf = (feed: Feed): string => {
  const health = feedHealthFields(feed);
  return `${health.consecutiveFailures}|${health.lastFetchedMs ?? ''}|${health.lastFailedFetchAtMs ?? ''}`;
};

const remember = (feeds: Feed[]): Feed[] => {
  const previous = known;
  const next = new Map<string, string>();
  const changed: Feed[] = [];
  const failing = new Set<string>();
  for (const feed of feeds) {
    const signature = signatureOf(feed);
    next.set(feed.id, signature);
    if (isFeedFailing(feed)) failing.add(feed.id);
    if (previous && previous.get(feed.id) !== signature) changed.push(feed);
  }
  known = next;
  const sameFailing = failing.size === failingIds.size && [...failing].every((id) => failingIds.has(id));
  if (!sameFailing) {
    failingIds = failing.size === 0 ? NO_FAILING : failing;
    for (const listener of listeners) listener();
  }
  return changed;
};

/** Ids of feeds that can't update, as of the last read (empty until the first one). */
export const getFailingFeedIds = (): ReadonlySet<string> => failingIds;

export const subscribeFailingFeedIds = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Baseline from feeds already in hand (sidebar snapshot, Storybook fixtures). */
export function seedFeedHealth(feeds: Feed[]): void {
  if (!known) remember(feeds);
}

/** Baseline from the sidebar's own snapshot load (shares its in-flight IPC). */
const ensureSeeded = (): Promise<void> => {
  if (known) return Promise.resolve();
  if (!seeding) {
    seeding = getAllFeedMetadataCached()
      .then(seedFeedHealth)
      .finally(() => {
        seeding = null;
      });
  }
  return seeding;
};

const syncOnce = async (): Promise<void> => {
  await ensureSeeded();
  const { feeds } = await feedStore.listSidebarSnapshot();
  const changed = remember(feeds);
  if (changed.length === 0) return;
  feedLibraryMutationBus.publishFeedsCountsUpdated(changed.map((feed) => ({
    feedId: feed.id,
    unreadCount: feed.unreadCount ?? 0,
    articleCount: feed.articleCount ?? 0,
    health: feedHealthFields(feed),
  })));
};

/** Re-read feed health and publish changes. Overlapping calls coalesce into one follow-up read. */
export function syncFeedHealth(): Promise<void> {
  if (inFlight) {
    rerunRequested = true;
    return inFlight;
  }
  const run = async (): Promise<void> => {
    do {
      rerunRequested = false;
      await syncOnce();
    } while (rerunRequested);
  };
  inFlight = run()
    .catch((error: unknown) => {
      logger.warn('FeedHealthSync', 'Failed to read feed status after a refresh', { error });
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

type SchedulerSubscribe = (listener: (event: SchedulerEvent) => void) => () => void;

/**
 * Main window only. Syncs after a cycle in which a feed failed, or while some feed is known to
 * be failing (so its recovery clears the marker). Healthy libraries cost nothing per cycle.
 */
export function installFeedHealthSync(subscribe: SchedulerSubscribe): () => void {
  let cycleHadFailure = false;
  void ensureSeeded().catch((error: unknown) => {
    logger.warn('FeedHealthSync', 'Failed to read initial feed status', { error });
  });
  return subscribe((event) => {
    if (event.type === 'feed-failed') {
      cycleHadFailure = true;
      return;
    }
    if (event.type !== 'cycle-complete') return;
    const shouldSync = cycleHadFailure || failingIds.size > 0 || known === null;
    cycleHadFailure = false;
    if (shouldSync) void syncFeedHealth();
  });
}

/** After a UI refresh of one feed: sync only when it failed or was failing before. */
export function syncFeedHealthAfterRefresh(previous: Pick<Feed, 'consecutiveFailures'>, failed: boolean): void {
  if (failed || isFeedFailing(previous)) {
    void syncFeedHealth();
  }
}

/** Test-only: forget the baseline between cases. */
export function resetFeedHealthSyncForTests(): void {
  known = null;
  failingIds = NO_FAILING;
  listeners.clear();
  seeding = null;
  inFlight = null;
  rerunRequested = false;
}
