import { useSyncExternalStore } from 'react';
import { feedRefreshActivity, type FeedRefreshActivitySnapshot } from '@/services/feeds/feedRefreshActivity';

const EMPTY_SNAPSHOT: FeedRefreshActivitySnapshot = {
  activeFeedCount: 0,
  queuedFeedCount: 0,
  displayFeedCount: 0,
  isAnyFeedRefreshing: false,
};

export const useFeedRefreshActivity = () =>
  useSyncExternalStore(
    feedRefreshActivity.subscribe,
    feedRefreshActivity.getSnapshot,
    () => EMPTY_SNAPSHOT
  );
