import { describe, expect, it } from 'vitest';
import { FeedRefreshActivity } from '@/services/feeds/feedRefreshActivity';
import { formatFeedRefreshStatus } from '@/components/Sidebar/Sidebar';

const statusFrom = (activity: FeedRefreshActivity) => {
  const snapshot = activity.getSnapshot();
  return formatFeedRefreshStatus({
    displayFeedCount: snapshot.displayFeedCount,
    isBackgroundFeedRefreshing: snapshot.isBackgroundFeedRefreshing,
    interactiveRefreshScopeTotal: snapshot.interactiveRefreshScopeTotal,
    interactiveRefreshCompleted: snapshot.interactiveRefreshCompleted,
    interactiveRefreshScopeKind: snapshot.interactiveRefreshScopeKind,
    interactiveRefreshScopeLabel: snapshot.interactiveRefreshScopeLabel,
  });
};

describe('selection switch indicator', () => {
  it('never shows queue depth when scope is missing (avoids exposing foreground cap)', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(['bg-1', 'bg-2', 'bg-3'], 'background');
    activity.beginQueuedFeeds(['fg-1'], 'foreground');

    const snapshot = activity.getSnapshot();
    expect(snapshot.displayFeedCount).toBe(1);
    expect(statusFrom(activity)).toBe('Syncing feeds');
  });

  it('shows Syncing x/N {station} against the station scope, not the foreground cap', () => {
    const activity = new FeedRefreshActivity();

    const release = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50, scopeKind: 'station', scopeLabel: 'Daily' },
    );
    const scopeToken = activity.getInteractiveRefreshScopeGeneration();

    const before = activity.getSnapshot();
    expect(before.interactiveRefreshScopeTotal).toBe(50);
    expect(before.interactiveRefreshCompleted).toBe(0);
    expect(statusFrom(activity)).toBe('Syncing Daily');

    release('fg-1');
    release('fg-2');
    release('fg-3');
    const mid = activity.getSnapshot();
    expect(mid.interactiveRefreshCompleted).toBe(3);
    expect(statusFrom(activity)).toBe('Syncing 3/50 Daily');

    activity.clearInteractiveRefreshScope(scopeToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('keeps station scope through deferred background tail for syncing indicator', () => {
    const activity = new FeedRefreshActivity();

    const releaseForeground = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50, scopeKind: 'station', scopeLabel: 'Daily' },
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
    expect(statusFrom(activity)).toBe('Syncing 6/50 Daily');

    releaseBackground('bg-1');
    releaseBackground('bg-2');
    releaseBackground('bg-3');
    expect(activity.getSnapshot().interactiveRefreshCompleted).toBe(9);

    activity.clearInteractiveRefreshScope(scopeToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.clearInteractiveRefreshDeferredTail(scopeToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('does not jump completed count when background batch is smaller than deferred tail', () => {
    const activity = new FeedRefreshActivity();

    const releaseForeground = activity.beginQueuedFeeds(
      ['fg-1', 'fg-2'],
      'foreground',
      { scopeTotal: 50, scopeKind: 'station', scopeLabel: 'Daily' },
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
      ).toBe('Syncing feeds');
    }
  });

  it('never shows the foreground cap when scope is missing but multiple feeds are queued', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
    );

    expect(statusFrom(activity)).toBe('Syncing feeds');
  });

  it('shows Syncing feeds for unstamped background library work', () => {
    const activity = new FeedRefreshActivity();
    activity.beginQueuedFeeds(['bg-1', 'bg-2'], 'background');
    expect(statusFrom(activity)).toBe('Syncing feeds');
  });

  it('names a one-feed station Syncing {station}, not Refreshing {feed}', () => {
    const activity = new FeedRefreshActivity();
    activity.beginQueuedFeeds(['only'], 'foreground', {
      scopeTotal: 1,
      scopeKind: 'station',
      scopeLabel: 'Solo',
    });
    expect(statusFrom(activity)).toBe('Syncing Solo');
  });

  it('names a single feed Refreshing {title} without x/N', () => {
    const activity = new FeedRefreshActivity();
    const release = activity.beginQueuedFeeds(['feed-1'], 'foreground', {
      scopeKind: 'feed',
      scopeLabel: 'BBC',
    });
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
    expect(statusFrom(activity)).toBe('Refreshing BBC');
    release();
    expect(activity.getSnapshot().interactiveRefreshScopeKind).toBeNull();
    expect(statusFrom(activity)).toBe('Syncing feeds');
  });

  it('releaseAllForegroundQueued clears a feed stamp even when scopeTotal is 0', () => {
    const activity = new FeedRefreshActivity();
    activity.beginQueuedFeeds(['feed-1'], 'foreground', {
      scopeKind: 'feed',
      scopeLabel: 'BBC',
    });
    activity.releaseAllForegroundQueued();
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      interactiveRefreshScopeKind: null,
      interactiveRefreshScopeLabel: '',
    });
  });

  it('releaseAllForegroundQueued clears interactive switch scope', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50, scopeKind: 'station', scopeLabel: 'Daily' },
    );
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(50);

    activity.releaseAllForegroundQueued();
    expect(activity.getSnapshot()).toMatchObject({
      foregroundQueuedFeedCount: 0,
      interactiveRefreshScopeTotal: 0,
      interactiveRefreshCompleted: 0,
      interactiveRefreshScopeKind: null,
    });
  });

  it('a stale switch clear does not clobber a newer switch scope (rapid hopping)', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 50, scopeKind: 'station', scopeLabel: 'Alpha' },
    );
    const oldToken = activity.getInteractiveRefreshScopeGeneration();

    activity.beginQueuedFeeds(
      ['fg-1', 'fg-2', 'fg-3', 'fg-4', 'fg-5', 'fg-6'],
      'foreground',
      { scopeTotal: 30, scopeKind: 'station', scopeLabel: 'Beta' },
    );
    const newToken = activity.getInteractiveRefreshScopeGeneration();
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(30);
    expect(statusFrom(activity)).toBe('Syncing Beta');

    activity.clearInteractiveRefreshScope(oldToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(30);
    expect(statusFrom(activity)).toBe('Syncing Beta');

    activity.clearInteractiveRefreshScope(newToken);
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(0);
  });

  it('deferred-tail clear of an older generation does not wipe a newer station stamp', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds([], 'foreground', {
      scopeTotal: 50,
      scopeKind: 'station',
      scopeLabel: 'Alpha',
    });
    const oldToken = activity.getInteractiveRefreshScopeGeneration();
    activity.markInteractiveRefreshDeferredTail(true, 50);

    activity.beginQueuedFeeds([], 'foreground', {
      scopeTotal: 30,
      scopeKind: 'station',
      scopeLabel: 'Beta',
    });
    activity.markInteractiveRefreshDeferredTail(true, 30);

    activity.clearInteractiveRefreshDeferredTail(oldToken);
    expect(statusFrom(activity)).toBe('Syncing Beta');
    expect(activity.getSnapshot().interactiveRefreshScopeTotal).toBe(30);
  });

  it('native START without options does not wipe a station stamp', () => {
    const activity = new FeedRefreshActivity();
    activity.beginQueuedFeeds([], 'foreground', {
      scopeTotal: 12,
      scopeKind: 'station',
      scopeLabel: 'Daily',
    });
    activity.markInteractiveRefreshDeferredTail(true, 12);
    activity.beginQueuedFeeds(['n-1', 'n-2'], 'background');
    expect(statusFrom(activity)).toBe('Syncing Daily');
    expect(activity.getSnapshot().interactiveRefreshScopeKind).toBe('station');
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

  it('native switch with empty queue shows Syncing {station} before first settlement', () => {
    const activity = new FeedRefreshActivity();

    activity.beginQueuedFeeds([], 'foreground', {
      scopeTotal: 59,
      scopeKind: 'station',
      scopeLabel: 'Daily',
    });
    activity.markInteractiveRefreshDeferredTail(true, 59);

    const before = activity.getSnapshot();
    expect(before.interactiveRefreshScopeTotal).toBe(59);
    expect(before.interactiveRefreshCompleted).toBe(0);
    expect(before.displayFeedCount).toBe(0);
    expect(statusFrom(activity)).toBe('Syncing Daily');

    activity.recordInteractiveRefreshFeedSettled('feed-1');
    activity.recordInteractiveRefreshFeedSettled('feed-2');
    activity.recordInteractiveRefreshFeedSettled('feed-1');

    const mid = activity.getSnapshot();
    expect(mid.interactiveRefreshCompleted).toBe(2);
    expect(statusFrom(activity)).toBe('Syncing 2/59 Daily');
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
