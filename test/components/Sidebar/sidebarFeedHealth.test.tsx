import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Feed } from '@/services/feeds/feedsManager';
import type { Tag } from '@/types/tag';

const mocks = vi.hoisted(() => ({
  getAllFeedMetadataCached: vi.fn(),
  openManageFeedsWindow: vi.fn(async () => {}),
  getAllTags: vi.fn(),
}));

vi.mock('@/services/feeds/feedMetadataCache', () => ({
  getAllFeedMetadataCached: mocks.getAllFeedMetadataCached,
}));
vi.mock('@/services/ui/openManageFeedsWindow', () => ({
  openManageFeedsWindow: mocks.openManageFeedsWindow,
}));
vi.mock('@/services/tags/tagsManager', () => ({ tagsManager: { getAllTags: mocks.getAllTags } }));
vi.mock('@/services/feeds/feedsManager', () => ({ feedsManager: { getFeedById: vi.fn(async () => null) } }));
vi.mock('@/stores/feedStore', () => ({ listSidebarSnapshot: vi.fn() }));
vi.mock('@/services/feeds/opmlWorkflowService', () => ({
  opmlWorkflowService: { scheduleMissingFaviconsAfterStationSelection: vi.fn() },
}));
vi.mock('@/services/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    selectedFeedId: null,
    selectedTag: null,
    selectFeed: vi.fn().mockResolvedValue(undefined),
    selectTag: vi.fn(),
    clearFeedSelection: vi.fn(),
  }),
  useFeedUIActions: () => ({ refreshTotalFeeds: vi.fn().mockResolvedValue(undefined) }),
  useFeedFaviconRefreshed: () => null,
}));
vi.mock('@/components/Sidebar/AddFeedModal', () => ({ AddFeedModal: () => null }));
vi.mock('@/components/Sidebar/TagEditModal', () => ({ TagEditModal: () => null }));

import { FeedList } from '@/components/Sidebar/FeedList';
import { TagManager } from '@/components/Sidebar/TagManager';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { resetFeedHealthSyncForTests, seedFeedHealth } from '@/services/feeds/feedHealthSync';

const DAY = 24 * 60 * 60 * 1000;

const feed = (id: string, overrides: Partial<Feed> = {}): Feed => ({
  id,
  title: `Feed ${id}`,
  url: `https://example.com/${id}.xml`,
  tags: [],
  consecutiveFailures: 0,
  lastFetched: new Date(Date.now() - 60 * 1000),
  ...overrides,
});

const failingHealth = () => ({
  consecutiveFailures: 4,
  lastFetchedMs: Date.now() - 2 * DAY - 60 * 60 * 1000,
  lastFailedFetchAtMs: Date.now(),
});

const marker = () => document.querySelector('[data-component="feed-health-marker"]');

describe('sidebar "can’t update" marker', () => {
  beforeEach(() => {
    resetFeedHealthSyncForTests();
    feedLibraryMutationBus.resetForTests();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('shows on a failing feed row with a plain-language tooltip and reveals it in Manage Feeds', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([
      feed('ok'),
      feed('broken', { consecutiveFailures: 3, lastFetched: new Date(Date.now() - 2 * DAY - 60 * 60 * 1000) }),
    ]);
    render(<FeedList showAddModal={false} onCloseAddModal={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Feed broken')).toBeTruthy());

    const button = screen.getByRole('button', { name: /show in manage feeds/i });
    expect(button.getAttribute('title')).toContain('KiJi couldn’t update this feed for 2 days.');
    expect(button.closest('[data-entity-id]')?.getAttribute('data-entity-id')).toBe('broken');
    expect(document.querySelectorAll('[data-component="feed-health-marker"]')).toHaveLength(1);

    fireEvent.click(button);
    expect(mocks.openManageFeedsWindow).toHaveBeenCalledWith({ kind: 'feed', id: 'broken' });
  });

  it('appears and clears live when a refresh publishes new health', async () => {
    mocks.getAllFeedMetadataCached.mockResolvedValue([feed('a')]);
    render(<FeedList showAddModal={false} onCloseAddModal={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Feed a')).toBeTruthy());
    expect(marker()).toBeNull();

    act(() => {
      feedLibraryMutationBus.publishFeedsCountsUpdated([{
        feedId: 'a', unreadCount: 0, articleCount: 0, health: failingHealth(),
      }]);
    });
    expect(marker()?.getAttribute('title')).toContain('for 2 days');

    act(() => {
      feedLibraryMutationBus.publishFeedsCountsUpdated([{
        feedId: 'a',
        unreadCount: 0,
        articleCount: 0,
        health: { consecutiveFailures: 0, lastFetchedMs: Date.now(), lastFailedFetchAtMs: null },
      }]);
    });
    expect(marker()).toBeNull();
  });

  it('hints on a collapsed station when one of its feeds can’t update', async () => {
    const station: Tag = { name: 'News', feedIds: ['n1', 'n2'], createdAt: '2026-01-01T00:00:00.000Z' };
    const quiet: Tag = { name: 'Quiet', feedIds: ['q1'], createdAt: '2026-01-01T00:00:00.000Z' };
    mocks.getAllTags.mockResolvedValue([station, quiet]);
    render(<TagManager />);
    await waitFor(() => expect(screen.getByText('News')).toBeTruthy());
    expect(marker()).toBeNull();

    act(() => {
      seedFeedHealth([
        feed('n1', { tags: ['News'] }),
        feed('n2', { tags: ['News'], consecutiveFailures: 2 }),
        feed('q1', { tags: ['Quiet'] }),
      ]);
    });

    const hint = screen.getByRole('button', { name: /show in manage feeds/i });
    expect(hint.getAttribute('title')).toContain('KiJi couldn’t update 1 feed in this station.');
    expect(hint.closest('[data-station-name]')?.getAttribute('data-station-name')).toBe('News');

    fireEvent.click(hint);
    expect(mocks.openManageFeedsWindow).toHaveBeenCalledWith({ kind: 'feed', id: 'n2' });
  });
});
