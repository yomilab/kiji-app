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
  interactiveRefreshScopeKind: null as 'feed' | 'station' | null,
  interactiveRefreshScopeLabel: '',
  isAnyFeedRefreshing: false,
  stationRefreshInProgress: false,
  showSyncing: false,
  lastSyncTime: null as Date | null,
};

const indicator = (container: HTMLElement) =>
  container.querySelector('[data-component="sync-indicator"]');

const copy = (container: HTMLElement) =>
  indicator(container)?.querySelector('.sync-indicator-text')?.textContent;

const progressSlot = (container: HTMLElement) =>
  indicator(container)?.querySelector('[data-slot="sync-indicator-progress"]');

const oldLoaderSlot = (container: HTMLElement) =>
  indicator(container)?.querySelector('[data-slot="sync-indicator-loader"]');

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
    expect(expected).toMatch(/^(Refreshing|Syncing) \d+\/\d+/);
    expect(copy(container)).toBe('Syncing feeds');
    expect(indicator(container)?.getAttribute('title')).toBe('Syncing feeds');
    expect(indicator(container)?.getAttribute('title')).not.toMatch(/\d+\/\d+/);
    expect(oldLoaderSlot(container)).toBeNull();
    expect(progressSlot(container)).not.toBeNull();
    expect(progressSlot(container)?.getAttribute('role')).toBe('progressbar');
    expect(progressSlot(container)?.getAttribute('aria-valuenow')).toBe('25');
  });

  it('names a live station Syncing {station} and keeps the ring without painting x/N', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        isAnyFeedRefreshing
        interactiveRefreshScopeTotal={12}
        interactiveRefreshCompleted={3}
        interactiveRefreshScopeKind="station"
        interactiveRefreshScopeLabel="Daily"
      />,
    );

    expect(copy(container)).toBe('Syncing Daily');
    expect(indicator(container)?.getAttribute('title')).toBe('Syncing Daily');
    expect(indicator(container)?.getAttribute('title')).not.toMatch(/\d+\/\d+/);
    expect(progressSlot(container)?.getAttribute('aria-valuenow')).toBe('25');
  });

  it('names a live one-feed refresh Refreshing {title} without a ring', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        isAnyFeedRefreshing
        interactiveRefreshScopeKind="feed"
        interactiveRefreshScopeLabel="BBC"
      />,
    );

    expect(copy(container)).toBe('Refreshing BBC');
    expect(progressSlot(container)).toBeNull();
  });

  it('shows refresh copy for scope-only station refresh before the queue fills', () => {
    const { container } = render(
      <SidebarSyncIndicator
        {...idleProps}
        totalFeeds={12}
        stationRefreshInProgress
        interactiveRefreshScopeTotal={12}
        interactiveRefreshScopeKind="station"
        interactiveRefreshScopeLabel="Daily"
      />,
    );

    expect(copy(container)).toBe('Syncing Daily');
    expect(oldLoaderSlot(container)).toBeNull();
    expect(progressSlot(container)).toBeNull();
  });

  it('keeps Syncing feeds on the 500ms hold', () => {
    const { container } = render(
      <SidebarSyncIndicator {...idleProps} totalFeeds={12} showSyncing />,
    );

    expect(copy(container)).toBe('Syncing feeds');
    expect(progressSlot(container)).toBeNull();
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
    expect(progressSlot(container)).toBeNull();
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

    expect(copy(container)).toBe('Exporting');
    expect(progressSlot(container)).not.toBeNull();
    expect(progressSlot(container)?.getAttribute('aria-valuenow')).toBe('30');
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
    expect(oldLoaderSlot(container)).toBeNull();
    expect(progressSlot(container)).toBeNull();
  });
});
