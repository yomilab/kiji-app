import { useCallback, useEffect, useRef, useState } from 'react';

const FETCH_INDICATOR_MIN_VISIBLE_MS = 450;
const FETCH_INDICATOR_HIDE_DEBOUNCE_MS = 140;
const FETCH_INDICATOR_SWITCH_GRACE_MS = 800;
// Keep in sync with the header compacting transition in ArticleList.css.
const HEADER_COMPACT_TRANSITION_MS = 40;
// Small lag so the spinner starts after the header animation fully settles.
const FETCH_INDICATOR_POST_HEADER_DELAY_MS = 50;
const FETCH_INDICATOR_SHOW_DELAY_MS = HEADER_COMPACT_TRANSITION_MS + FETCH_INDICATOR_POST_HEADER_DELAY_MS;

interface UseFetchIndicatorStateOptions {
  enabled: boolean;
  isActive: boolean;
  sourceKey?: string;
}

export const useFetchIndicatorState = ({
  enabled,
  isActive,
  sourceKey = 'none',
}: UseFetchIndicatorStateOptions) => {
  const [isFetchIndicatorVisible, setIsFetchIndicatorVisible] = useState(false);
  const isFetchIndicatorVisibleRef = useRef(false);
  const fetchIndicatorStartedAtRef = useRef<number>(0);
  const fetchIndicatorHideTimerRef = useRef<number | null>(null);
  const fetchIndicatorShowTimerRef = useRef<number | null>(null);
  const fetchIndicatorSwitchGraceUntilRef = useRef<number>(0);

  const setFetchIndicatorVisible = useCallback((visible: boolean) => {
    isFetchIndicatorVisibleRef.current = visible;
    setIsFetchIndicatorVisible(visible);
  }, []);

  const clearHideTimer = useCallback(() => {
    if (fetchIndicatorHideTimerRef.current !== null) {
      clearTimeout(fetchIndicatorHideTimerRef.current);
      fetchIndicatorHideTimerRef.current = null;
    }
  }, []);

  const clearShowTimer = useCallback(() => {
    if (fetchIndicatorShowTimerRef.current !== null) {
      clearTimeout(fetchIndicatorShowTimerRef.current);
      fetchIndicatorShowTimerRef.current = null;
    }
  }, []);

  const scheduleFetchIndicatorShow = useCallback(() => {
    if (!enabled) return;

    clearShowTimer();

    fetchIndicatorShowTimerRef.current = window.setTimeout(() => {
      fetchIndicatorStartedAtRef.current = Date.now();
      setFetchIndicatorVisible(true);
      fetchIndicatorShowTimerRef.current = null;
    }, FETCH_INDICATOR_SHOW_DELAY_MS);
  }, [enabled, clearShowTimer, setFetchIndicatorVisible]);

  const applySourceSwitchGrace = useCallback(() => {
    if (!enabled) return;

    fetchIndicatorSwitchGraceUntilRef.current = Date.now() + FETCH_INDICATOR_SWITCH_GRACE_MS;
    clearHideTimer();
    scheduleFetchIndicatorShow();
  }, [enabled, clearHideTimer, scheduleFetchIndicatorShow]);

  useEffect(() => {
    if (!enabled) {
      clearHideTimer();
      clearShowTimer();
      setFetchIndicatorVisible(false);
      return;
    }

    if (isActive) {
      clearHideTimer();
      if (!isFetchIndicatorVisibleRef.current) {
        scheduleFetchIndicatorShow();
      }
      return;
    }

    clearShowTimer();

    const elapsed = Date.now() - fetchIndicatorStartedAtRef.current;
    const remainingMinVisible = Math.max(0, FETCH_INDICATOR_MIN_VISIBLE_MS - elapsed);
    const remainingSwitchGrace = Math.max(0, fetchIndicatorSwitchGraceUntilRef.current - Date.now());
    const hideDelay = Math.max(remainingMinVisible, FETCH_INDICATOR_HIDE_DEBOUNCE_MS, remainingSwitchGrace);

    fetchIndicatorHideTimerRef.current = window.setTimeout(() => {
      setFetchIndicatorVisible(false);
      fetchIndicatorHideTimerRef.current = null;
    }, hideDelay);

    return () => {
      clearHideTimer();
    };
  }, [
    enabled,
    isActive,
    sourceKey,
    clearHideTimer,
    clearShowTimer,
    scheduleFetchIndicatorShow,
    setFetchIndicatorVisible,
  ]);

  useEffect(() => {
    return () => {
      clearHideTimer();
      clearShowTimer();
    };
  }, [clearHideTimer, clearShowTimer]);

  return {
    isFetchIndicatorVisible,
    applySourceSwitchGrace,
  };
};
