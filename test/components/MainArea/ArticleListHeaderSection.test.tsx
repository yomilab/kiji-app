import { afterEach, describe, it, expect, vi } from 'vitest';
import React, { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArticleListHeaderSection } from '@/components/MainArea/ArticleListHeaderSection';

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

const renderHeader = (isSavedView = true) => {
  const articleListRef = createRef<HTMLDivElement>();
  return render(
    <div ref={articleListRef}>
      <ArticleListHeaderSection
        variant={isSavedView ? 'saved' : 'common'}
        articleListRef={articleListRef}
        hasListScrollOffset={false}
        isInitialLoading={false}
        showSourceTitle
        selectedFeedTitle="Daily"
        subtitleText="3 Items"
        isSavedView={isSavedView}
        isSearchOpen={false}
        searchQuery=""
        onSearchChange={vi.fn()}
        onCloseSearch={vi.fn()}
        onToggleSearch={vi.fn()}
      />
    </div>,
  );
};

describe('ArticleListHeaderSection window chrome drag', () => {
  afterEach(() => {
    cleanup();
  });
  it('marks the title section as a Tauri deep drag region and widgets as false', () => {
    renderHeader();
    const section = document.querySelector('[data-section="article-list-title"]');
    const widgets = document.querySelector('[data-section="article-list-widgets"]');

    expect(section?.getAttribute('data-tauri-drag-region')).toBe('deep');
    expect(widgets?.getAttribute('data-tauri-drag-region')).toBe('false');
  });

  it('closes the Saved menu on empty-header mousedown but not on the ⋮ button', () => {
    renderHeader(true);
    fireEvent.click(screen.getByRole('button', { name: /more saved article actions/i }));
    expect(screen.getByRole('button', { name: /import articles/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: /more saved article actions/i }));
    expect(screen.getByRole('button', { name: /import articles/i })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('heading', { name: 'Daily' }));
    expect(screen.queryByRole('button', { name: /import articles/i })).not.toBeInTheDocument();
  });
});
