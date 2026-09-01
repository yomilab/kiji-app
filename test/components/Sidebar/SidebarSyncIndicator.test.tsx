import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { SidebarSyncIndicator } from '@/components/Sidebar/SidebarSyncIndicator';

const collectionArticles = vi.hoisted(() => ({ articles: [] as Array<{ hash: string }> }));
const navigation = vi.hoisted(() => ({ selectedSmartView: 'saved' as string | null }));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedCollectionArticles: () => collectionArticles,
  useFeedNavigation: () => navigation,
}));

const idleProps = {
  sidebarIndicatorText: null,
  exportProgressText: null,
  displayFeedCount: 0,
  isBackgroundFeedRefreshing: false,
  interactiveRefreshScopeTotal: 0,
  interactiveRefreshCompleted: 0,
  isAnyFeedRefreshing: false,
  stationRefreshInProgress: false,
  showSyncing: false,
  lastSyncTime: null,
};

describe('SidebarSyncIndicator Saved-empty chrome', () => {
  afterEach(() => {
    cleanup();
    collectionArticles.articles = [];
    navigation.selectedSmartView = 'saved';
  });

  it('keeps No feeds above Saved-empty No articles when the library is empty', () => {
    const { container } = render(
      <SidebarSyncIndicator {...idleProps} totalFeeds={0} />,
    );

    expect(container.querySelector('[data-component="sync-indicator"]')?.textContent).toBe('No feeds');
  });

  it('shows No articles when Saved is selected, the list is empty, and feeds exist', () => {
    const { container } = render(
      <SidebarSyncIndicator {...idleProps} totalFeeds={1} />,
    );

    expect(container.querySelector('[data-component="sync-indicator"]')?.textContent).toBe('No articles');
  });
});
