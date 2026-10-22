import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArticleListWidgets } from '@/components/MainArea/ArticleListWidgets';

const feedContextMock = vi.hoisted(() => ({
  navigation: {
    selectedFeedId: 'feed-1' as string | null,
    selectedTag: null as string | null,
    selectedSmartView: null as string | null,
  },
  markCurrentSourceRead: vi.fn(async () => {}),
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedUI: () => ({
    totalFeeds: 1,
  }),
  useFeedNavigation: () => feedContextMock.navigation,
  useFeedCollectionActions: () => ({ markCurrentSourceRead: feedContextMock.markCurrentSourceRead }),
}));

vi.mock('@/services/saved/savedArticlesIOService', () => ({
  savedArticlesIOService: {
    exportSavedArticles: vi.fn(),
    importSavedArticles: vi.fn(),
  },
}));

describe('ArticleListWidgets', () => {
  afterEach(() => {
    cleanup();
  });

  it('lets the search button click toggle search without being treated as an outside click', () => {
    const onToggleSearch = vi.fn();
    const documentMouseDown = vi.fn();
    document.addEventListener('mousedown', documentMouseDown);

    try {
      render(<ArticleListWidgets onToggleSearch={onToggleSearch} />);
      const searchButton = screen.getByRole('button', { name: /search/i });

      fireEvent.mouseDown(searchButton);
      fireEvent.click(searchButton);

      expect(documentMouseDown).not.toHaveBeenCalled();
      expect(onToggleSearch).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('mousedown', documentMouseDown);
    }
  });

  describe('mark as read control', () => {
    beforeEach(() => {
      feedContextMock.navigation = { selectedFeedId: 'feed-1', selectedTag: null, selectedSmartView: null };
      feedContextMock.markCurrentSourceRead.mockClear();
    });

    it('opens a menu with Mark All and Older Than choices that act on the current list', () => {
      render(<ArticleListWidgets onToggleSearch={vi.fn()} />);
      const button = screen.getByRole('button', { name: 'Mark as read' });
      expect(screen.queryByRole('menuitem', { name: /Mark All as Read/ })).toBeNull();

      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
      expect(items).toEqual([
        'Mark All as ReadCmd + Shift + K',
        'Mark Older Than a Day as Read',
        'Mark Older Than a Week as Read',
      ]);

      fireEvent.click(screen.getByRole('menuitem', { name: /Mark All as Read/ }));
      expect(feedContextMock.markCurrentSourceRead).toHaveBeenLastCalledWith(undefined);
      expect(screen.queryByRole('menuitem')).toBeNull();

      fireEvent.click(button);
      fireEvent.click(screen.getByRole('menuitem', { name: 'Mark Older Than a Week as Read' }));
      expect(feedContextMock.markCurrentSourceRead).toHaveBeenLastCalledWith({ olderThanDays: 7 });
    });

    it('is offered for stations and All/Unread but not Saved or Read', () => {
      const cases: Array<[typeof feedContextMock.navigation, boolean | undefined, boolean]> = [
        [{ selectedFeedId: null, selectedTag: 'Tech', selectedSmartView: null }, false, true],
        [{ selectedFeedId: null, selectedTag: null, selectedSmartView: 'unread' }, false, true],
        [{ selectedFeedId: null, selectedTag: null, selectedSmartView: 'all' }, false, true],
        [{ selectedFeedId: null, selectedTag: null, selectedSmartView: 'read' }, false, false],
        [{ selectedFeedId: null, selectedTag: null, selectedSmartView: 'saved' }, true, false],
      ];
      for (const [navigation, isSavedView, expected] of cases) {
        feedContextMock.navigation = navigation;
        const { unmount } = render(<ArticleListWidgets onToggleSearch={vi.fn()} isSavedView={isSavedView} />);
        expect(screen.queryByRole('button', { name: 'Mark as read' }) !== null).toBe(expected);
        unmount();
      }
    });
  });
});
