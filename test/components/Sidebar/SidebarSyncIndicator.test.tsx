import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import {
  formatFeedRefreshStatus,
  SidebarSyncIndicator,
} from '@/components/Sidebar/SidebarSyncIndicator';

const collectionArticles = vi.hoisted(() => ({ articles: [] as Array<{ hash: string }> }));
const navigation = vi.hoisted(() => ({ selectedSmartView: 'saved' as string | null }));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedCollectionArticles: () => collectionArticles,
  useFeedNavigation: () => navigation,
}));

const idleProps = {
  sidebarIndicatorText: null as string | null,
  exportProgressText: null as string | null,
  displayFeedCount: 0,
  isBackgroundFeedRefreshing: false,
  interactiveRefreshScopeTotal: 0,
  interactiveRefreshCompleted: 0,
  isAnyFeedRefreshing: false,
  stationRefreshInProgress: false,
  showSyncing: false,
  lastSyncTime: null as Date | null,
};

const indicator = (container: HTMLElement) =>
  container.querySelector('[data-component="sync-indicator"]');

const copy = (container: HTMLElement) =>
  indicator(container)?.querySelector('.sync-indicator-text')?.textContent;

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

    expect(copy(container)).toBe('No feeds');
  });

  it('shows No articles when Saved is selected, the list is empty, and feeds exist', () => {
    const { container } = render(
      <SidebarSyncIndicator {...idleProps} totalFeeds={1} />,
    );

    expect(copy(container)).toBe('No articles');
  });

  it('shows composed refresh copy during live feed refresh', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        isAnyFeedRefreshing
        isBackgroundFeedRefreshing
        interactiveRefreshScopeTotal={12}
        interactiveRefreshCompleted={3}
      />,
    );

    const expected = formatFeedRefreshStatus({
      displayFeedCount: 0,
      isBackgroundFeedRefreshing: true,
      interactiveRefreshScopeTotal: 12,
      interactiveRefreshCompleted: 3,
    });
    expect(indicator(container)?.getAttribute('title')).toBe(expected);
    expect(copy(container)).toBe(expected);
    expect(indicator(container)?.querySelector('[data-slot="sync-indicator-loader"]')).toBeNull();
  });

  it('shows refresh copy for scope-only station refresh before the queue fills', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        stationRefreshInProgress
      />,
    );

    const expected = formatFeedRefreshStatus({
      displayFeedCount: 0,
      isBackgroundFeedRefreshing: false,
      interactiveRefreshScopeTotal: 0,
      interactiveRefreshCompleted: 0,
    });
    expect(copy(container)).toBe(expected);
    expect(indicator(container)?.querySelector('[data-slot="sync-indicator-loader"]')).toBeNull();
  });

  it('keeps Syncing feeds on the 500ms hold', () => {
    const { container } = render(
      <SidebarSyncIndicator {...idleProps} totalFeeds={12} showSyncing />,
    );

    expect(copy(container)).toBe('Syncing feeds');
  });

  it('lets overlay copy own the row even if refresh is live', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        isAnyFeedRefreshing
        sidebarIndicatorText="Importing…"
      />,
    );

    expect(copy(container)).toBe('Importing…');
  });

  it('lets export progress own the row even if refresh is live', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        isAnyFeedRefreshing
        exportProgressText="Exporting 3/10"
      />,
    );

    expect(copy(container)).toBe('Exporting 3/10');
  });

  it('shows idle last-sync copy when no overlay or refresh is live', () => {
    navigation.selectedSmartView = null;
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        lastSyncTime={new Date('2026-09-01T08:00:00')}
      />,
    );

    expect(copy(container)).toBe('Sep 1');
    expect(indicator(container)?.querySelector('[data-slot="sync-indicator-loader"]')).toBeNull();
  });
});
