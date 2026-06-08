import { describe, expect, it } from 'vitest';
import { FeedRefreshActivity, type FeedRefreshActivitySnapshot } from '@/services/feeds/feedRefreshActivity';

const createDeferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('FeedRefreshActivity', () => {
  it('tracks active feed refreshes until the last fetch finishes', async () => {
    const activity = new FeedRefreshActivity();
    const firstTurn = createDeferred<void>();
    const secondTurn = createDeferred<void>();
    const snapshots: FeedRefreshActivitySnapshot[] = [];

    const unsubscribe = activity.subscribe(() => {
      snapshots.push({ ...activity.getSnapshot() });
    });

    const firstRun = activity.track('feed-1', async () => {
      await firstTurn.promise;
    });
    const secondRun = activity.track('feed-2', async () => {
      await secondTurn.promise;
    });

    await flushMicrotasks();
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 2,
      queuedFeedCount: 0,
      displayFeedCount: 2,
      isAnyFeedRefreshing: true,
    });

    firstTurn.resolve();
    await firstRun;
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 1,
      queuedFeedCount: 0,
      displayFeedCount: 1,
      isAnyFeedRefreshing: true,
    });

    secondTurn.resolve();
    await secondRun;
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 0,
      displayFeedCount: 0,
      isAnyFeedRefreshing: false,
    });

    expect(snapshots).toEqual([
      { activeFeedCount: 1, queuedFeedCount: 0, displayFeedCount: 1, isAnyFeedRefreshing: true },
      { activeFeedCount: 2, queuedFeedCount: 0, displayFeedCount: 2, isAnyFeedRefreshing: true },
      { activeFeedCount: 1, queuedFeedCount: 0, displayFeedCount: 1, isAnyFeedRefreshing: true },
      { activeFeedCount: 0, queuedFeedCount: 0, displayFeedCount: 0, isAnyFeedRefreshing: false },
    ]);

    unsubscribe();
  });

  it('counts queued station feeds down without increasing active network fetch count', async () => {
    const activity = new FeedRefreshActivity();
    const snapshots: FeedRefreshActivitySnapshot[] = [];

    const unsubscribe = activity.subscribe(() => {
      snapshots.push({ ...activity.getSnapshot() });
    });

    const releaseQueuedFeed = activity.beginQueuedFeeds(['feed-1', 'feed-2', 'feed-3']);

    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 3,
      displayFeedCount: 3,
      isAnyFeedRefreshing: true,
    });

    releaseQueuedFeed('feed-1');
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 2,
      displayFeedCount: 2,
      isAnyFeedRefreshing: true,
    });

    releaseQueuedFeed();
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 0,
      displayFeedCount: 0,
      isAnyFeedRefreshing: false,
    });

    expect(snapshots).toEqual([
      { activeFeedCount: 0, queuedFeedCount: 3, displayFeedCount: 3, isAnyFeedRefreshing: true },
      { activeFeedCount: 0, queuedFeedCount: 2, displayFeedCount: 2, isAnyFeedRefreshing: true },
      { activeFeedCount: 0, queuedFeedCount: 0, displayFeedCount: 0, isAnyFeedRefreshing: false },
    ]);

    unsubscribe();
  });
});
