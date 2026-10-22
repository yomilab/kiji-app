import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { findSeriousAxeViolations } from '../../helpers/axe';
import type { Tag } from '@/types/tag';

vi.mock('@/services/tags/tagsManager', () => ({
  tagsManager: {
    getAllTags: vi.fn(async (): Promise<Tag[]> => [
      { name: 'Daily', feedIds: [], createdAt: '2026-01-01T00:00:00.000Z' },
      { name: 'Tech', feedIds: [], createdAt: '2026-01-01T00:00:00.000Z' },
    ]),
  },
}));
vi.mock('@/services/feeds/feedsManager', () => ({ feedsManager: { getFeedById: vi.fn() } }));
vi.mock('@/stores/feedStore', () => ({
  listSidebarSnapshot: vi.fn(() => new Promise(() => undefined)),
  getAll: vi.fn(),
  getById: vi.fn(),
}));
vi.mock('@/services/feeds/opmlWorkflowService', () => ({
  opmlWorkflowService: { scheduleMissingFaviconsAfterStationSelection: vi.fn() },
}));
vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({
    selectedTag: 'Tech',
    selectTag: vi.fn(),
    selectedFeedId: null,
    selectFeed: vi.fn(),
    openFeedEditView: vi.fn(),
    clearFeedSelection: vi.fn(),
  }),
  useFeedFaviconRefreshed: () => null,
}));

import { TagManager } from '@/components/Sidebar/TagManager';

afterEach(cleanup);

describe('station rows', () => {
  it('expose selection and fold state; Right / Left open and fold a station', async () => {
    const { container } = render(<TagManager />);
    const tech = await screen.findByRole('button', { name: 'Tech' });
    const daily = screen.getByRole('button', { name: 'Daily' });
    expect(tech.getAttribute('aria-current')).toBe('page');
    expect(tech.tabIndex).toBe(0);
    expect(daily.tabIndex).toBe(-1);
    expect(daily.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(daily, { key: 'ArrowRight' });
    expect(daily.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(daily, { key: 'ArrowLeft' });
    expect(daily.getAttribute('aria-expanded')).toBe('false');

    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });
});
