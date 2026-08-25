import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar/Sidebar';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));

vi.mock('@/components/Sidebar/TagManager', () => ({
  TagManager: () => <div data-component="stations" />,
}));

vi.mock('@/components/Sidebar/FeedList', () => ({
  FeedList: () => <ul data-section="unstationed-feeds-group" />,
}));

vi.mock('@/components/Sidebar/SmartViews', () => ({
  SmartViews: () => <div data-component="smart-views" />,
}));

vi.mock('@/components/Sidebar/SidebarWidgets', () => ({
  SidebarWidgets: () => <div data-component="sidebar-widgets" />,
}));

vi.mock('@/components/Sidebar/BottomWidget', () => ({
  BottomWidget: ({ children }: { children: React.ReactNode }) => (
    <div data-component="bottom-widget">{children}</div>
  ),
}));

vi.mock('@/components/Sidebar/SyncIndicator', () => ({
  SyncIndicator: () => <p data-component="sync-indicator" />,
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedCollection: () => ({ articles: [] }),
  useFeedNavigation: () => ({ selectedSmartView: null }),
  useFeedUI: () => ({ totalFeeds: 0, feedLibraryVersion: 0 }),
}));

vi.mock('@/hooks/useFeedRefreshActivity', () => ({
  useFeedRefreshActivity: () => ({
    displayFeedCount: 0,
    isAnyFeedRefreshing: false,
    isBackgroundFeedRefreshing: false,
    interactiveRefreshScopeTotal: 0,
    interactiveRefreshCompleted: 0,
  }),
}));

vi.mock('@/hooks/useUserMessageChannel', () => ({
  useUserMessageChannel: () => '',
}));

vi.mock('@/services/settings', () => ({
  settingsManager: {
    getSidebarWidth: async () => 300,
    getSidebarLibrary: async () => ({ title: 'Library', visible: true }),
    setSidebarWidth: vi.fn(),
  },
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getAllFeeds: async () => [],
  },
}));

vi.mock('@/services/shortcuts/shortcutService', () => ({
  isOpenAddFeedShortcut: () => false,
  keybindingService: {
    register: () => () => undefined,
  },
}));

describe('Sidebar nav scroll ownership', () => {
  afterEach(() => {
    cleanup();
  });

  it('scrolls stations plus unstationed feeds together under the Stations title', async () => {
    const { container } = render(<Sidebar />);

    await waitFor(() => {
      expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();
    });

    const nav = container.querySelector('[data-component="sidebar-nav"]');
    const scrollBody = container.querySelector('[data-component="sidebar-nav-body"]');
    expect(nav).not.toBeNull();
    expect(scrollBody).not.toBeNull();
    expect(scrollBody?.classList.contains('sidebar-scroll-region')).toBe(true);
    expect(scrollBody?.classList.contains('sidebar-nav-body')).toBe(true);

    const stationsTitle = Array.from(nav?.querySelectorAll('.section-title-text') ?? [])
      .find((node) => node.textContent === 'Stations');
    expect(stationsTitle).toBeTruthy();
    expect(scrollBody?.contains(stationsTitle as Node)).toBe(false);

    const libraryTitle = Array.from(nav?.querySelectorAll('.section-title-text') ?? [])
      .find((node) => node.textContent === 'Library');
    expect(libraryTitle).toBeTruthy();
    expect(scrollBody?.contains(libraryTitle as Node)).toBe(false);
    expect(scrollBody?.contains(container.querySelector('[data-component="smart-views"]') as Node)).toBe(false);

    expect(scrollBody?.querySelector('[data-component="stations"]')).not.toBeNull();
    expect(scrollBody?.querySelector('[data-section="unstationed-feeds-group"]')).not.toBeNull();

    const scrollRegions = container.querySelectorAll('.sidebar-scroll-region');
    expect(scrollRegions.length).toBe(1);
    expect(scrollRegions[0]).toBe(scrollBody);
  });
});
