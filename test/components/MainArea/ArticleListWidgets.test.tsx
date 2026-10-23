import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ArticleListWidgets } from '@/components/MainArea/ArticleListWidgets';

vi.mock('@/contexts/FeedContext', () => ({
  useFeedUI: () => ({
    totalFeeds: 1,
  }),
}));

vi.mock('@/services/saved/savedArticlesIOService', () => ({
  savedArticlesIOService: {
    exportSavedArticles: vi.fn(),
    importSavedArticles: vi.fn(),
  },
}));

describe('ArticleListWidgets', () => {
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
});
