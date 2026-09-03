import React, { useMemo } from 'react';
import { SyncIndicator } from './SyncIndicator';
import { useFeedCollectionArticles, useFeedNavigation } from '@/contexts/FeedContext';
import { sidebarIndicatorOngoing } from '@/services/ui/sidebarIndicatorText';

export interface FeedRefreshStatusInput {
  displayFeedCount: number;
  isBackgroundFeedRefreshing: boolean;
  interactiveRefreshScopeTotal: number;
  interactiveRefreshCompleted: number;
}

export const formatFeedRefreshStatus = (input: FeedRefreshStatusInput): string => {
  // User-visible progress always uses the station scope (x/N). Never format
  // queue depth (`displayFeedCount`) — it mirrors the internal foreground cap.
  const stationScopeProgress = input.interactiveRefreshScopeTotal > 1
    ? {
        completed: input.interactiveRefreshCompleted,
        total: input.interactiveRefreshScopeTotal,
      }
    : undefined;

  if (input.isBackgroundFeedRefreshing) {
    if (stationScopeProgress) {
      if (stationScopeProgress.completed === 0) {
        return sidebarIndicatorOngoing('syncing', undefined, { subject: 'feeds' });
      }
      return sidebarIndicatorOngoing('syncing', stationScopeProgress);
    }
    return sidebarIndicatorOngoing('syncing', undefined, { subject: 'all' });
  }

  if (stationScopeProgress) {
    if (stationScopeProgress.completed === 0) {
      return sidebarIndicatorOngoing('syncing', undefined, { subject: 'feeds' });
    }
    return sidebarIndicatorOngoing('refreshing', stationScopeProgress);
  }

  return sidebarIndicatorOngoing('refreshing', undefined, { subject: 'feeds' });
};

const formatSyncTime = (date: Date | null): string => {
  if (!date) return '';

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dateAtMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateAtMidnight.getTime() === today.getTime()) {
    return `Today ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface SidebarSyncIndicatorProps {
  sidebarIndicatorText: string | null;
  exportProgressText: string | null;
  displayFeedCount: number;
  isBackgroundFeedRefreshing: boolean;
  interactiveRefreshScopeTotal: number;
  interactiveRefreshCompleted: number;
  isAnyFeedRefreshing: boolean;
  stationRefreshInProgress: boolean;
  showSyncing: boolean;
  totalFeeds: number;
  lastSyncTime: Date | null;
}

export const SidebarSyncIndicator: React.FC<SidebarSyncIndicatorProps> = ({
  sidebarIndicatorText,
  exportProgressText,
  displayFeedCount,
  isBackgroundFeedRefreshing,
  interactiveRefreshScopeTotal,
  interactiveRefreshCompleted,
  isAnyFeedRefreshing,
  stationRefreshInProgress,
  showSyncing,
  totalFeeds,
  lastSyncTime,
}) => {
  const { articles } = useFeedCollectionArticles();
  const { selectedSmartView } = useFeedNavigation();

  const syncText = useMemo(() => {
    if (sidebarIndicatorText) {
      return sidebarIndicatorText;
    }

    if (exportProgressText) {
      return exportProgressText;
    }

    if (isAnyFeedRefreshing || stationRefreshInProgress) {
      return formatFeedRefreshStatus({
        displayFeedCount,
        isBackgroundFeedRefreshing,
        interactiveRefreshScopeTotal,
        interactiveRefreshCompleted,
      });
    }

    if (showSyncing) {
      return sidebarIndicatorOngoing('syncing');
    }

    if (totalFeeds === 0) {
      return 'No feeds';
    }

    if (selectedSmartView === 'saved' && articles.length === 0) {
      return 'No articles';
    }

    return formatSyncTime(lastSyncTime);
  }, [
    articles.length,
    exportProgressText,
    displayFeedCount,
    isBackgroundFeedRefreshing,
    isAnyFeedRefreshing,
    interactiveRefreshCompleted,
    interactiveRefreshScopeTotal,
    lastSyncTime,
    selectedSmartView,
    showSyncing,
    sidebarIndicatorText,
    stationRefreshInProgress,
    totalFeeds,
  ]);

  return <SyncIndicator text={syncText} />;
};
