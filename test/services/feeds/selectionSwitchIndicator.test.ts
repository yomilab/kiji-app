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
    expect(formatFeedRefreshStatus(activity.getSnapshot().displayFeedCount, false)).toMatch(/1/);
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
