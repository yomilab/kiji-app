import React, { useMemo } from 'react';
import { SyncIndicator } from './SyncIndicator';
import { useFeedCollectionArticles, useFeedNavigation } from '@/contexts/FeedContext';
import { sidebarIndicatorOngoing } from '@/services/ui/sidebarIndicatorText';
import type { InteractiveRefreshScopeKind } from '@/services/feeds/feedRefreshActivity';

export interface FeedRefreshStatusInput {
  displayFeedCount: number;
  isBackgroundFeedRefreshing: boolean;
  interactiveRefreshScopeTotal: number;
  interactiveRefreshCompleted: number;
  interactiveRefreshScopeKind?: InteractiveRefreshScopeKind | null;
  interactiveRefreshScopeLabel?: string;
}

export const formatFeedRefreshStatus = (input: FeedRefreshStatusInput): string => {
  // Never format queue depth (`displayFeedCount`) — it mirrors the internal cap.
  void input.displayFeedCount;
  const label = input.interactiveRefreshScopeLabel?.trim() ?? '';
  const kind = input.interactiveRefreshScopeKind ?? null;
  const total = input.interactiveRefreshScopeTotal;
  const completed = input.interactiveRefreshCompleted;

  if (kind === 'station' && label) {
    if (total > 1 && completed > 0) {
      return sidebarIndicatorOngoing('syncing', { completed, total }, { itemName: label });
    }
    return sidebarIndicatorOngoing('syncing', undefined, { itemName: label });
  }

  if (kind === 'feed' && label) {
    return sidebarIndicatorOngoing('refreshing', undefined, { itemName: label });
  }

  if (total > 1 && completed > 0) {
    return sidebarIndicatorOngoing('syncing', { completed, total }, { subject: 'feeds' });
  }

  if (total > 1 && completed === 0) {
    return sidebarIndicatorOngoing('syncing', undefined, { subject: 'feeds' });
  }

  if (input.isBackgroundFeedRefreshing) {
    return sidebarIndicatorOngoing('syncing', undefined, { subject: 'feeds' });
  }

  return sidebarIndicatorOngoing('syncing', undefined, { subject: 'feeds' });
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
  interactiveRefreshScopeKind: InteractiveRefreshScopeKind | null;
  interactiveRefreshScopeLabel: string;
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
  interactiveRefreshScopeKind,
  interactiveRefreshScopeLabel,
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
        interactiveRefreshScopeKind,
        interactiveRefreshScopeLabel,
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
    interactiveRefreshScopeKind,
    interactiveRefreshScopeLabel,
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
