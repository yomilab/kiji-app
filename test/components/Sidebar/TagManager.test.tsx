import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TagManager } from '@/components/Sidebar/TagManager';
import { tagsManager } from '@/services/tags/tagsManager';
import { feedsManager } from '@/services/feeds/feedsManager';
import type { Feed } from '@/services/feeds/feedsManager';
import type { Tag } from '@/types/tag';

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    getAllTags: vi.fn(),
  },
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getFeedById: vi.fn(),
  },
}));

vi.mock('@/services/feeds/opmlWorkflowService', () => ({
  opmlWorkflowService: {
    scheduleMissingFaviconsAfterStationSelection: vi.fn(),
  },
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    selectedTag: null,
    selectTag: vi.fn(),
    selectedFeedId: null,
    selectFeed: vi.fn(),
    openFeedEditView: vi.fn(),
    clearFeedSelection: vi.fn(),
  }),
  useFeedFaviconRefreshed: () => null,
}));

const daily: Tag = {
  name: 'Daily',
  feedIds: ['feed-a', 'feed-b'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const tech: Tag = {
  name: 'Tech',
  feedIds: ['feed-c'],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const feedA: Feed = {
  id: 'feed-a',
  title: 'Alpha',
  url: 'https://alpha.example/feed',
  tags: ['Daily'],
};

const feedB: Feed = {
  id: 'feed-b',
  title: 'A very long feed title that should ellipsize instead of being hard-clipped by the sidebar scroller',
  url: 'https://beta.example/feed',
  tags: ['Daily'],
};

describe('TagManager nested station feeds', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders expanded feed items in flow under the station row', async () => {
    vi.mocked(tagsManager.getAllTags).mockResolvedValue([daily, tech]);
    vi.mocked(feedsManager.getFeedById).mockImplementation(async (id: string) => {
      if (id === 'feed-a') return feedA;
      if (id === 'feed-b') return feedB;
      return null;
    });

    const { container } = render(<TagManager />);

    await waitFor(() => {
      expect(screen.getByText('Daily')).toBeTruthy();
    });

    const dailyWrapper = container.querySelector('[data-station-name="Daily"]')
      ?.closest('.tag-item-wrapper');
    expect(dailyWrapper).not.toBeNull();
    expect(dailyWrapper?.classList.contains('is-expanded')).toBe(false);
    expect(container.querySelector('[data-component="station-feeds"]')?.children.length).toBe(0);

    const dailyRow = container.querySelector('[data-station-name="Daily"]');
    expect(dailyRow).not.toBeNull();
    const expandButton = dailyRow?.querySelector('[aria-label="Expand station"]');
    expect(expandButton).not.toBeNull();
    fireEvent.click(expandButton as HTMLElement);

    await waitFor(() => {
      expect(screen.getByText('Alpha')).toBeTruthy();
      expect(screen.getByText(feedB.title)).toBeTruthy();
    });

    expect(dailyWrapper?.classList.contains('is-expanded')).toBe(true);
    const feedsList = dailyWrapper?.querySelector('[data-component="station-feeds"]');
    expect(feedsList).not.toBeNull();
    expect(feedsList?.classList.contains('sidebar-scroll-region')).toBe(false);
    expect(feedsList?.classList.contains('station-feeds-list')).toBe(true);
    expect(dailyWrapper?.querySelector('.sidebar-scroll-region')).toBeNull();
    expect(feedsList?.querySelector('[data-entity-id="feed-a"]')).not.toBeNull();
    expect(feedsList?.querySelector('[data-entity-id="feed-b"]')).not.toBeNull();

    const longTitle = feedsList?.querySelector('[data-entity-id="feed-b"] .station-feed-item-title-text');
    expect(longTitle).not.toBeNull();
    expect(longTitle?.className).toBe('station-feed-item-title-text');
    expect(feedsList?.querySelector('[data-entity-id="feed-b"]')?.classList.contains('station-feed-item')).toBe(true);

    const techWrapper = container.querySelector('[data-station-name="Tech"]')
      ?.closest('.tag-item-wrapper');
    expect(techWrapper?.classList.contains('is-expanded')).toBe(false);
  });
});
