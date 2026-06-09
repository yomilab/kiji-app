import { useSyncExternalStore } from 'react';
import { feedRefreshActivity, type FeedRefreshActivitySnapshot } from '@/services/feeds/feedRefreshActivity';

const EMPTY_SNAPSHOT: FeedRefreshActivitySnapshot = {
  activeFeedCount: 0,
  queuedFeedCount: 0,
  foregroundQueuedFeedCount: 0,
  backgroundQueuedFeedCount: 0,
  displayFeedCount: 0,
  isAnyFeedRefreshing: false,
  isForegroundFeedRefreshing: false,
  isBackgroundFeedRefreshing: false,
};

export const useFeedRefreshActivity = () =>
  useSyncExternalStore(
    feedRefreshActivity.subscribe,
    feedRefreshActivity.getSnapshot,
    () => EMPTY_SNAPSHOT
  );
