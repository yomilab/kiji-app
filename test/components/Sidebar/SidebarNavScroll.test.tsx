import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
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
  useFeedCollectionArticles: () => ({ articles: [] }),
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
    getSidebarSectionFold: async () => ({ libraryExpanded: true, stationsExpanded: true }),
    setSidebarWidth: vi.fn(),
    setSidebarSectionFold: vi.fn().mockResolvedValue(undefined),
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
    vi.restoreAllMocks();
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

    const libraryHeader = nav?.querySelector('[data-component="section-title"][data-section="library"]');
    const stationsHeader = nav?.querySelector('[data-component="section-title"][data-section="stations"]');
    expect(libraryHeader?.querySelector('[data-action="toggle-section"]')).not.toBeNull();
    expect(stationsHeader?.querySelector('[data-action="toggle-section"]')).not.toBeNull();

    const librarySection = nav?.querySelector('[data-component="sidebar-section"][data-section="library"]');
    const stationsSection = nav?.querySelector('[data-component="sidebar-section"][data-section="stations"]');
    expect(librarySection).not.toBeNull();
    expect(stationsSection).not.toBeNull();
    expect(librarySection?.contains(libraryHeader as Node)).toBe(true);
    expect(stationsSection?.contains(stationsHeader as Node)).toBe(true);
    expect(stationsSection?.contains(scrollBody as Node)).toBe(true);
  });

  it('hit-tests fold-chevron hover on the section title only', async () => {
    const { container } = render(<Sidebar />);

    await waitFor(() => {
      expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();
    });

    const nav = container.querySelector('[data-component="sidebar-nav"]') as HTMLElement;
    const stationsSection = container.querySelector(
      '[data-component="sidebar-section"][data-section="stations"]',
    ) as HTMLElement;
    const stationsTitle = container.querySelector(
      '[data-component="section-title"][data-section="stations"]',
    ) as HTMLElement;
    const stationsBody = container.querySelector(
      '[data-component="sidebar-section-body"][data-section="stations"]',
    ) as HTMLElement;

    document.elementFromPoint = () => stationsTitle;
    fireEvent.pointerMove(nav, { clientX: 20, clientY: 80 });
    expect(stationsSection.classList.contains('is-pointer-inside')).toBe(true);
    expect(stationsSection.getAttribute('data-pointer-inside')).toBe('true');

    document.elementFromPoint = () => stationsBody;
    fireEvent.pointerMove(nav, { clientX: 20, clientY: 160 });
    expect(stationsSection.classList.contains('is-pointer-inside')).toBe(false);
    expect(stationsSection.getAttribute('data-pointer-inside')).toBe('false');
  });

  it('clears section hover after fold when the pointer is no longer over the section', async () => {
    const { container } = render(<Sidebar />);

    await waitFor(() => {
      expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();
    });

    const nav = container.querySelector('[data-component="sidebar-nav"]') as HTMLElement;
    const stationsSection = container.querySelector(
      '[data-component="sidebar-section"][data-section="stations"]',
    ) as HTMLElement;
    const stationsToggle = container.querySelector(
      '[data-component="section-title"][data-section="stations"] [data-action="toggle-section"]',
    ) as HTMLButtonElement;

    document.elementFromPoint = () => stationsToggle;
    fireEvent.pointerMove(nav, { clientX: 20, clientY: 80 });
    expect(stationsSection.classList.contains('is-pointer-inside')).toBe(true);

    document.elementFromPoint = () => nav;
    fireEvent.click(stationsToggle, { clientX: 20, clientY: 80 });

    await waitFor(() => {
      expect(stationsSection.classList.contains('is-pointer-inside')).toBe(false);
    });
  });

  it('toggles Library and Stations subsections independently without unmounting them', async () => {
    const { container } = render(<Sidebar />);

    await waitFor(() => {
      expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();
    });

    const libraryBody = container.querySelector(
      '[data-component="sidebar-section-body"][data-section="library"]',
    );
    const stationsBody = container.querySelector(
      '[data-component="sidebar-section-body"][data-section="stations"]',
    );
    expect(libraryBody?.classList.contains('is-expanded')).toBe(true);
    expect(stationsBody?.classList.contains('is-expanded')).toBe(true);

    const libraryToggle = container.querySelector(
      '[data-component="section-title"][data-section="library"] [data-action="toggle-section"]',
    );
    fireEvent.click(libraryToggle as HTMLButtonElement);

    expect(libraryBody?.classList.contains('is-expanded')).toBe(false);
    expect(stationsBody?.classList.contains('is-expanded')).toBe(true);
    expect(container.querySelector('[data-component="smart-views"]')).not.toBeNull();
    expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();

    const stationsToggle = container.querySelector(
      '[data-component="section-title"][data-section="stations"] [data-action="toggle-section"]',
    );
    fireEvent.click(stationsToggle as HTMLButtonElement);

    expect(libraryBody?.classList.contains('is-expanded')).toBe(false);
    expect(stationsBody?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-component="stations"]')).not.toBeNull();
    expect(container.querySelector('[data-section="unstationed-feeds-group"]')).not.toBeNull();

    fireEvent.click(stationsToggle as HTMLButtonElement);
    expect(stationsBody?.classList.contains('is-expanded')).toBe(true);
    expect(container.querySelector('.sidebar-scroll-region')).toBe(
      container.querySelector('[data-component="sidebar-nav-body"]'),
    );
  });

  it('persists Library and Stations section fold to renderer settings', async () => {
    const { settingsManager } = await import('@/services/settings');
    const setFold = vi.mocked(settingsManager.setSidebarSectionFold);

    const { container } = render(<Sidebar />);

    await waitFor(() => {
      expect(container.querySelector('[data-component="sidebar-nav-body"]')).not.toBeNull();
    });

    const libraryToggle = container.querySelector(
      '[data-component="section-title"][data-section="library"] [data-action="toggle-section"]',
    );
    fireEvent.click(libraryToggle as HTMLButtonElement);

    await waitFor(() => {
      expect(setFold).toHaveBeenCalledWith({ libraryExpanded: false });
    });

    const stationsToggle = container.querySelector(
      '[data-component="section-title"][data-section="stations"] [data-action="toggle-section"]',
    );
    fireEvent.click(stationsToggle as HTMLButtonElement);

    await waitFor(() => {
      expect(setFold).toHaveBeenCalledWith({ stationsExpanded: false });
    });
  });
});
