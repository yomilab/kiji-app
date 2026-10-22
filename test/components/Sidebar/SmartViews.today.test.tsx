import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';

const { queryMock, selectSmartView } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  selectSmartView: vi.fn(),
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({ selectedSmartView: 'today', selectSmartView }),
}));

vi.mock('@/services/settings', () => ({
  settingsManager: {
    // Saved prefs from before Today existed: normalization must add it after Unread.
    getSmartViews: async () => {
      const { mergeSmartViewSettings } = await import('@/services/settings/smartViewOrder');
      return mergeSmartViewSettings([
        { id: 'saved', visible: true, sortOrder: 0 },
        { id: 'unread', visible: true, sortOrder: 1 },
        { id: 'all', visible: true, sortOrder: 2 },
        { id: 'read', visible: false, sortOrder: 3 },
      ]);
    },
  },
}));

vi.mock('@/services/storage/storageFactory', () => ({
  storage: { get: async () => null },
}));

vi.mock('@/services/ui/openManageFeedsWindow', () => ({
  openManageFeedsWindow: vi.fn(),
}));

vi.mock('@/stores/articleStore', () => ({
  query: queryMock,
}));

import { SmartViews } from '@/components/Sidebar/SmartViews';
import { feedLibraryMutationBus } from '@/services/ui/feedLibraryMutationBus';
import { notifyArticleReadChanged } from '@/services/articles/articleReadSignal';

afterEach(() => {
  cleanup();
  queryMock.mockReset();
});

describe('SmartViews Today row', () => {
  it('renders Today after Unread with its unread count and refreshes after a refresh cycle', async () => {
    queryMock.mockResolvedValue({ articles: [], total: 7 });
    const { container } = render(<SmartViews />);

    await waitFor(() => {
      expect(container.querySelector('[data-smart-view-id="today"] [data-section="smart-view-unread-count"]')?.textContent)
        .toBe('7');
    });

    const ids = Array.from(container.querySelectorAll('[data-smart-view-id]'))
      .map((row) => row.getAttribute('data-smart-view-id'));
    expect(ids).toEqual(['saved', 'unread', 'today', 'all']);

    const todayRow = container.querySelector('[data-smart-view-id="today"]');
    expect(todayRow?.classList.contains('is-selected')).toBe(true);
    expect(todayRow?.textContent).toContain('Today');
    expect(todayRow?.querySelector('svg[data-glyph="today"]')).not.toBeNull();
    expect(queryMock).toHaveBeenCalledWith({ today: true, filter: { read: false }, limit: 0 });

    // A refresh cycle publishes feed counts; the window is re-evaluated natively.
    queryMock.mockResolvedValue({ articles: [], total: 9 });
    act(() => {
      feedLibraryMutationBus.publishFeedsCountsUpdated([{ feedId: 'f1', unreadCount: 3, articleCount: 5 }]);
    });
    await waitFor(() => {
      expect(container.querySelector('[data-smart-view-id="today"] [data-section="smart-view-unread-count"]')?.textContent)
        .toBe('9');
    });

    // Reading an article updates the count; zero hides the badge.
    queryMock.mockResolvedValue({ articles: [], total: 0 });
    act(() => {
      notifyArticleReadChanged();
    });
    await waitFor(() => {
      expect(container.querySelector('[data-smart-view-id="today"] [data-section="smart-view-unread-count"]')).toBeNull();
    });
    expect(container.querySelector('[data-smart-view-id="unread"] [data-section="smart-view-unread-count"]')).toBeNull();
  });
});
