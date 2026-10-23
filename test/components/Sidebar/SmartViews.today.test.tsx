import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

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

afterEach(() => {
  cleanup();
  queryMock.mockReset();
});

describe('SmartViews Today row', () => {
  it('renders Today after Unread with no count, like the other Library views', async () => {
    queryMock.mockResolvedValue({ articles: [], total: 7 });
    const { container } = render(<SmartViews />);

    const today = await screen.findByRole('button', { name: 'Today' });
    const ids = Array.from(container.querySelectorAll('[data-smart-view-id]'))
      .map((row) => row.getAttribute('data-smart-view-id'));
    expect(ids).toEqual(['saved', 'unread', 'today', 'all']);

    const todayRow = container.querySelector('[data-smart-view-id="today"]');
    expect(todayRow?.classList.contains('is-selected')).toBe(true);
    expect(today.textContent).toBe('Today');
    expect(todayRow?.querySelector('svg[data-glyph="today"]')).not.toBeNull();

    // No count badge, and the sidebar never queries for one.
    await waitFor(() => {
      expect(container.querySelector('[data-section="smart-view-unread-count"]')).toBeNull();
    });
    expect(queryMock).not.toHaveBeenCalled();
  });
});
