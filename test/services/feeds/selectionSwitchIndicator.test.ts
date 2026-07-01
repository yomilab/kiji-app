import { describe, expect, it } from 'vitest';
import { FeedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { formatFeedRefreshStatus } from '@/components/Sidebar/Sidebar';

describe('selection switch indicator', () => {
  it('shows foreground feed count only when station refresh is active alongside background sync', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['bg-1', 'bg-2', 'bg-3'], 'background');
    activity.beginQueuedFeeds(['fg-1'], 'foreground');

    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 1,
      backgroundQueuedFeedCount: 3,
      displayFeedCount: 1,
      isForegroundFeedRefreshing: true,
      isBackgroundFeedRefreshing: false,
    });
    const snapshot = activity.getSnapshot();
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: snapshot.displayFeedCount,
        isBackgroundFeedRefreshing: snapshot.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: snapshot.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: snapshot.interactiveRefreshCompleted,
      }),
    ).toMatch(/1/);
  });

  it('shows `Refreshing x/N feeds` against the station scope, not the foreground cap', () => {
    const activity = new FeedRefreshActivity();

    // A 50-feed station switch: 6 foreground (capped), 44 deferred. The
    // indicator must report the station total (50), not the cap (6). The scope
    // is set atomically with the queue, so the FIRST snapshot already carries
    // the scope (no transient `Refreshing 6 feeds` frame).
    const release = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50 },
    );
    const scopeToken = activity.getInteractiveRefreshScopeGeneration();

    const before = activity.getSnapshot();
    expect(before.interactiveRefreshScopeTotal).toBe(50);
    expect(before.interactiveRefreshCompleted).toBe(0);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: before.displayFeedCount,
        isBackgroundFeedRefreshing: before.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: before.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: before.interactiveRefreshCompleted,
      }),
    ).toMatch(/Refreshing 0\/50 feeds/);

    // Settle 3 of 6 foreground feeds → completed counts up, scope stays 50.
    release('fg-1');
    release('fg-2');
    release('fg-3');
    const mid = activity.getSnapshot();
    expect(mid.interactiveRefreshCompleted).toBe(3);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: mid.displayFeedCount,
        isBackgroundFeedRefreshing: mid.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: mid.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: mid.interactiveRefreshCompleted,
      }),
    ).toMatch(/Refreshing 3\/50 feeds/);

    // Switch ends → scope cleared, indicator no longer shows the station total.
    activity.clearInteractiveRefreshScope(scopeToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('never shows the foreground cap when scope is missing but multiple feeds are queued', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
    );

    const snapshot = activity.getSnapshot();
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: snapshot.displayFeedCount,
        isBackgroundFeedRefreshing: snapshot.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: snapshot.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: snapshot.interactiveRefreshCompleted,
      }),
    ).toBe('Refreshing feeds');
  });

  it('releaseAllForegroundQueued clears interactive switch scope', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50 },
    );
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.releaseAllForegroundQueued();
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      interactiveRefreshScopeTotal: 0,
      interactiveRefreshCompleted: 0,
    });
  });

  it('a stale switch clear does not clobber a newer switch scope (rapid hopping)', () => {
    const activity = new FeedRefreshActivity();

    // First switch starts (50 feeds).
    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50 },
    );
    const oldToken = activity.getInteractiveRefreshScopeGeneration();

    // User hops to a 30-feed station before the first switch's finally runs.
    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 30 },
    );
    const newToken = activity.getInteractiveRefreshScopeGeneration();
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(30);

    // The stale first switch's finally clears with its old token — must NOT
    // clobber the newer 30-feed scope.
    activity.clearInteractiveRefreshScope(oldToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(30);

    // The newer switch's clear (correct token) still works.
    activity.clearInteractiveRefreshScope(newToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('replaces stale foreground counts when a new station refresh starts', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['old-1', 'old-2', 'old-3']);
    activity.releaseAllForegroundQueued();
    activity.beginQueuedFeeds(['new-1', 'new-2']);

    expect(activity.getSnapshot().displayFeedCount).toBe(2);
  });

  it('counts only eligible feeds queued at network refresh start', () => {
    const activity = new FeedRefreshActivity();
    const release = activity.beginQueuedFeeds(['eligible-a', 'eligible-b'], 'foreground');

    expect(activity.getSnapshot().displayFeedCount).toBe(2);
    release('eligible-a');
    expect(activity.getSnapshot().displayFeedCount).toBe(1);
    release();
    expect(activity.getSnapshot().displayFeedCount).toBe(0);
  });
});
