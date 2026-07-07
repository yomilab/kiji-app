import { describe, expect, it } from 'vitest';
import { FeedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { formatFeedRefreshStatus } from '@/components/Sidebar/Sidebar';

describe('selection switch indicator', () => {
  it('never shows queue depth when scope is missing (avoids exposing foreground cap)', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['bg-1', 'bg-2', 'bg-3'], 'background');
    activity.beginQueuedFeeds(['fg-1'], 'foreground');

    const snapshot = activity.getSnapshot();
    expect(snapshot.displayFeedCount).toBe(1);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: snapshot.displayFeedCount,
        isBackgroundFeedRefreshing: snapshot.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: snapshot.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: snapshot.interactiveRefreshCompleted,
      }),
    ).toBe('Refreshing feeds');
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
    ).toBe('Syncing feeds');

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

  it('keeps station scope through deferred background tail for syncing indicator', () => {
    const activity = new FeedRefreshActivity();

    const releaseForeground = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50 },
    );
    const scopeToken = activity.getInteractiveRefreshScopeGeneration();

    releaseForeground();
    activity.markInteractiveRefreshDeferredTail(true, 44);
    activity.noteInteractiveRefreshBackgroundBatch(20);
    const releaseBackground = activity.beginQueuedFeeds(
      Array.from({ length: 20 }, (_, index) => `bg-${index + 1}`),
      'background',
    );

    const mid = activity.getSnapshot();
    expect(mid.interactiveRefreshScopeTotal).toBe(50);
    expect(mid.interactiveRefreshCompleted).toBe(6);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: mid.displayFeedCount,
        isBackgroundFeedRefreshing: mid.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: mid.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: mid.interactiveRefreshCompleted,
      }),
    ).toMatch(/Syncing 6\/50 feeds/);

    releaseBackground('bg-1');
    releaseBackground('bg-2');
    releaseBackground('bg-3');
    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(9);

    activity.clearInteractiveRefreshScope(scopeToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.clearInteractiveRefreshDeferredTail();
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('does not jump completed count when background batch is smaller than deferred tail', () => {
    const activity = new FeedRefreshActivity();

    const releaseForeground = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2'],
      'foreground',
      { scopeTotal: 50 },
    );
    releaseForeground();
    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(2);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.markInteractiveRefreshDeferredTail(true, 44);
    activity.noteInteractiveRefreshBackgroundBatch(20);
    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(2);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.beginQueuedFeeds(
      Array.from({ length: 20 }, (_, index) => `bg-${index + 1}`),
      'background',
    );
    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(2);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);
  });

  it('never formats a bare queue-depth count for the foreground cap', () => {
    for (const displayFeedCount of [1, 2, 3, 4, 5, 6]) {
      expect(
        formatFeedRefreshStatus({
          displayFeedCount,
          isBackgroundFeedRefreshing: false,
          interactiveRefreshScopeTotal: 0,
          interactiveRefreshCompleted: 0,
        }),
      ).toBe('Refreshing feeds');
    }
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

  it('native switch with empty queue shows Syncing feeds until first settlement', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds([], 'foreground', { scopeTotal: 59 });
    activity.markInteractiveRefreshDeferredTail(true, 59);

    const before = activity.getSnapshot();
    expect(before.interactiveRefreshScopeTotal).toBe(59);
    expect(before.interactiveRefreshCompleted).toBe(0);
    expect(before.displayFeedCount).toBe(0);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: before.displayFeedCount,
        isBackgroundFeedRefreshing: before.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: before.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: before.interactiveRefreshCompleted,
      }),
    ).toBe('Syncing feeds');

    activity.recordInteractiveRefreshFeedSettled('feed-1');
    activity.recordInteractiveRefreshFeedSettled('feed-2');
    activity.recordInteractiveRefreshFeedSettled('feed-1');

    const mid = activity.getSnapshot();
    expect(mid.interactiveRefreshCompleted).toBe(2);
    expect(
      formatFeedRefreshStatus({
        displayFeedCount: mid.displayFeedCount,
        isBackgroundFeedRefreshing: mid.isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal: mid.interactiveRefreshScopeTotal,
        interactiveRefreshCompleted: mid.interactiveRefreshCompleted,
      }),
    ).toBe('Refreshing 2/59 feeds');
  });

  it('recordInteractiveRefreshFeedSettled is idempotent per feed within a scope', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['fg-1'], 'foreground', { scopeTotal: 3 });
    activity.recordInteractiveRefreshFeedSettled('feed-a');
    activity.recordInteractiveRefreshFeedSettled('feed-a');
    activity.recordInteractiveRefreshFeedSettled('feed-b');

    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(2);
  });
});
