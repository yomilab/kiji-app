import { useEffect, useRef, useState } from 'react';
import { useFeedsCountsUpdatedMutation } from '@/hooks/useFeedLibraryMutation';
import { subscribeArticleReadChanged } from '@/services/articles/articleReadSignal';
import * as articleStore from '@/stores/articleStore';

/**
 * Unread count for the Today row. The 24-hour window is resolved natively on every query,
 * so re-querying after refresh cycles (feed counts published) and read changes keeps it
 * current without a timer. Overlapping triggers coalesce into one follow-up query.
 */
export const useTodayUnreadCount = (enabled: boolean): number | null => {
  const [count, setCount] = useState<number | null>(null);
  const feedsCountsUpdated = useFeedsCountsUpdatedMutation();
  const stateRef = useRef({ inFlight: false, dirty: false, alive: true });
  const requestRef = useRef<() => void>(() => {});

  requestRef.current = () => {
    const state = stateRef.current;
    if (!enabled || !state.alive) return;
    if (state.inFlight) {
      state.dirty = true;
      return;
    }
    state.inFlight = true;
    state.dirty = false;
    void articleStore.query({ today: true, filter: { read: false }, limit: 0 })
      .then((result) => {
        if (state.alive) setCount(result.total);
      })
      .catch((error) => {
        console.error('Error counting Today articles:', error);
      })
      .finally(() => {
        state.inFlight = false;
        if (state.dirty) requestRef.current();
      });
  };

  useEffect(() => {
    const state = stateRef.current;
    state.alive = true;
    return () => {
      state.alive = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setCount(null);
      return undefined;
    }
    requestRef.current();
    return subscribeArticleReadChanged(() => requestRef.current());
  }, [enabled]);

  useEffect(() => {
    if (feedsCountsUpdated) requestRef.current();
  }, [feedsCountsUpdated]);

  return enabled ? count : null;
};
