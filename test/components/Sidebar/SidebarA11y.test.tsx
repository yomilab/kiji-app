import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { findSeriousAxeViolations } from '../../helpers/axe';

const mocks = vi.hoisted(() => ({
  selectSmartView: vi.fn(),
  selectFeed: vi.fn(async () => undefined),
  selectedSmartView: 'today' as string | null,
  selectedFeedId: null as string | null,
  getAllFeedMetadataCached: vi.fn(),
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    selectedSmartView: mocks.selectedSmartView,
    selectSmartView: mocks.selectSmartView,
    selectedFeedId: mocks.selectedFeedId,
    selectFeed: mocks.selectFeed,
    clearFeedSelection: vi.fn(),
    openFeedEditView: vi.fn(),
  }),
  useFeedUIActions: () => ({ refreshTotalFeeds: vi.fn().mockResolvedValue(undefined) }),
  useFeedFaviconRefreshed: () => null,
}));

vi.mock('@/services/settings', () => ({
  settingsManager: {
    getSmartViews: async () => [
      { id: 'unread', visible: true, sortOrder: 0 },
      { id: 'today', visible: true, sortOrder: 1 },
      { id: 'all', visible: true, sortOrder: 2 },
    ],
  },
}));
vi.mock('@/services/storage/storageFactory', () => ({ storage: { get: async () => null } }));
vi.mock('@/services/ui/openManageFeedsWindow', () => ({ openManageFeedsWindow: vi.fn() }));
vi.mock('@/stores/articleStore', () => ({ query: vi.fn(async () => ({ articles: [], total: 12 })) }));
vi.mock('@/services/feeds/feedMetadataCache', () => ({
  getAllFeedMetadataCached: mocks.getAllFeedMetadataCached,
}));
vi.mock('@/components/Sidebar/AddFeedModal', () => ({ AddFeedModal: () => null }));
vi.mock('@/components/Sidebar/TagEditModal', () => ({ TagEditModal: () => null }));

import { SmartViews } from '@/components/Sidebar/SmartViews';
import { FeedList } from '@/components/Sidebar/FeedList';
import { handleSidebarNavKeyDown } from '@/components/Sidebar/sidebarKeyboardNav';

afterEach(() => {
  cleanup();
  mocks.selectedSmartView = 'today';
  mocks.selectedFeedId = null;
});

const renderLibrary = () => render(
  <nav
    aria-label="Sources"
    onKeyDown={(event) => {
      handleSidebarNavKeyDown(event, event.currentTarget);
    }}
  >
    <SmartViews />
  </nav>,
);

describe('sidebar source list', () => {
  it('Library rows have names, unread counts and aria-current, with no serious axe violations', async () => {
    const { container } = renderLibrary();
    const today = await screen.findByRole('button', { name: 'Today, 12 unread' });
    expect(today.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: 'Unread' }).getAttribute('aria-current')).toBeNull();
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });

  it('is one Tab stop; arrows move between rows; Enter and Space select', async () => {
    renderLibrary();
    const today = await screen.findByRole('button', { name: 'Today, 12 unread' });
    const unread = screen.getByRole('button', { name: 'Unread' });
    const all = screen.getByRole('button', { name: 'All Items' });
    expect([unread, today, all].map((row) => row.tabIndex)).toEqual([-1, 0, -1]);

    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all);
    fireEvent.keyDown(all, { key: 'Home' });
    expect(document.activeElement).toBe(unread);
    fireEvent.keyDown(unread, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(unread);

    fireEvent.keyDown(unread, { key: 'Enter' });
    expect(mocks.selectSmartView).toHaveBeenLastCalledWith('unread');
    fireEvent.keyDown(unread, { key: 'End' });
    fireEvent.keyDown(all, { key: ' ' });
    expect(mocks.selectSmartView).toHaveBeenLastCalledWith('all');
  });

  it('the first Library row is the Tab stop when no view is selected', async () => {
    mocks.selectedSmartView = null;
    renderLibrary();
    const unread = await screen.findByRole('button', { name: 'Unread' });
    expect(unread.tabIndex).toBe(0);
  });

  it('feed rows announce title and unread count once (favicon is decorative)', async () => {
    mocks.selectedFeedId = 'feed-a';
    mocks.getAllFeedMetadataCached.mockResolvedValue([
      { id: 'feed-a', title: 'Alpha', url: 'https://a.example/feed', tags: [], unreadCount: 3 },
      { id: 'feed-b', title: 'Beta', url: 'https://b.example/feed', tags: [], unreadCount: 0 },
    ]);
    const { container } = render(<FeedList showAddModal={false} onCloseAddModal={vi.fn()} />);
    const alpha = await screen.findByRole('button', { name: 'Alpha, 3 unread' });
    expect(alpha.getAttribute('aria-current')).toBe('page');
    expect(alpha.tabIndex).toBe(0);
    const beta = screen.getByRole('button', { name: 'Beta' });
    expect(beta.tabIndex).toBe(-1);
    await waitFor(async () => {
      expect(await findSeriousAxeViolations(container)).toEqual([]);
    });
  });
});
