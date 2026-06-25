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
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 2,
      isAnyFeedRefreshing: true,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    firstTurn.resolve();
    await firstRun;
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 1,
      queuedFeedCount: 0,
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 1,
      isAnyFeedRefreshing: true,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    secondTurn.resolve();
    await secondRun;
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 0,
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 0,
      isAnyFeedRefreshing: false,
      isForegroundFeedRefreshing: false,
      isBackgroundFeedRefreshing: false,
    });

    expect(snapshots).toEqual([
      { activeFeedCount: 1, queuedFeedCount: 0, foregroundQueuedFeedCount: 0, backgroundQueuedFeedCount: 0, displayFeedCount: 1, isAnyFeedRefreshing: true, isForegroundFeedRefreshing: true, isBackgroundFeedRefreshing: false },
      { activeFeedCount: 2, queuedFeedCount: 0, foregroundQueuedFeedCount: 0, backgroundQueuedFeedCount: 0, displayFeedCount: 2, isAnyFeedRefreshing: true, isForegroundFeedRefreshing: true, isBackgroundFeedRefreshing: false },
      { activeFeedCount: 1, queuedFeedCount: 0, foregroundQueuedFeedCount: 0, backgroundQueuedFeedCount: 0, displayFeedCount: 1, isAnyFeedRefreshing: true, isForegroundFeedRefreshing: true, isBackgroundFeedRefreshing: false },
      { activeFeedCount: 0, queuedFeedCount: 0, foregroundQueuedFeedCount: 0, backgroundQueuedFeedCount: 0, displayFeedCount: 0, isAnyFeedRefreshing: false, isForegroundFeedRefreshing: false, isBackgroundFeedRefreshing: false },
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
      foregroundQueuedFeedCount: 3,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 3,
      isAnyFeedRefreshing: true,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    releaseQueuedFeed('feed-1');
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 2,
      foregroundQueuedFeedCount: 2,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 2,
      isAnyFeedRefreshing: true,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    releaseQueuedFeed();
    expect(activity.getSnapshot()).toEqual({
      activeFeedCount: 0,
      queuedFeedCount: 0,
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 0,
      isAnyFeedRefreshing: false,
      isForegroundFeedRefreshing: false,
      isBackgroundFeedRefreshing: false,
    });

    expect(snapshots).toEqual([
      { activeFeedCount: 0, queuedFeedCount: 3, foregroundQueuedFeedCount: 3, backgroundQueuedFeedCount: 0, displayFeedCount: 3, isAnyFeedRefreshing: true, isForegroundFeedRefreshing: true, isBackgroundFeedRefreshing: false },
      { activeFeedCount: 0, queuedFeedCount: 2, foregroundQueuedFeedCount: 2, backgroundQueuedFeedCount: 0, displayFeedCount: 2, isAnyFeedRefreshing: true, isForegroundFeedRefreshing: true, isBackgroundFeedRefreshing: false },
      { activeFeedCount: 0, queuedFeedCount: 0, foregroundQueuedFeedCount: 0, backgroundQueuedFeedCount: 0, displayFeedCount: 0, isAnyFeedRefreshing: false, isForegroundFeedRefreshing: false, isBackgroundFeedRefreshing: false },
    ]);

    unsubscribe();
  });

  it('distinguishes foreground station queues from background scheduler queues', () => {
    const activity = new FeedRefreshActivity();

    const releaseForeground = activity.beginQueuedFeeds(['station-1', 'station-2']);
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 2,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 2,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    const releaseBackground = activity.beginQueuedFeeds(['scheduler-1'], 'background');
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 2,
      backgroundQueuedFeedCount: 1,
      displayFeedCount: 2,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    releaseForeground();
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 1,
      displayFeedCount: 1,
      isForegroundFeedRefreshing: false,
      isBackgroundFeedRefreshing: true,
    });

    releaseBackground();
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      backgroundQueuedFeedCount: 0,
      displayFeedCount: 0,
      isForegroundFeedRefreshing: false,
      isBackgroundFeedRefreshing: false,
    });
  });

  it('releases all foreground queued batches when selection is superseded', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['feed-a', 'feed-b']);
    activity.beginQueuedFeeds(['feed-c', 'feed-d', 'feed-e']);

    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 5,
      displayFeedCount: 5,
    });

    activity.releaseAllForegroundQueued();

    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      displayFeedCount: 0,
      isForegroundFeedRefreshing: false,
    });
  });

  it('uses foreground queue size for displayFeedCount when both scopes are active', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['scheduler-1', 'scheduler-2'], 'background');
    activity.beginQueuedFeeds(['station-1'], 'foreground');

    expect(activity.getSnapshot()).toMatchObject({
      queuedFeedCount: 3,
      foregroundQueuedFeedCount: 1,
      backgroundQueuedFeedCount: 2,
      displayFeedCount: 1,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });
  });

  it('suppresses background refresh indicator while foreground station refresh is active', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['station-1'], 'foreground');
    activity.beginQueuedFeeds(['scheduler-1'], 'background');
    expect(activity.getSnapshot()).toMatchObject({
      backgroundQueuedFeedCount: 1,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });

    activity.releaseAllForegroundQueued();
    expect(activity.getSnapshot()).toMatchObject({
      backgroundQueuedFeedCount: 1,
      isForegroundFeedRefreshing: false,
      isBackgroundFeedRefreshing: true,
    });
  });
});
