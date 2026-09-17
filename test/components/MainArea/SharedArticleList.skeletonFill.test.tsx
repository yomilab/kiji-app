import { afterEach, describe, it, expect, vi } from 'vitest';
import React, { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Article } from '@/types/article';
import { ARTICLE_LIST_SKELETON_ROW_COUNT } from '@/components/MainArea/ArticleListSkeleton';
import { ArticleListVirtualScrollPane } from '@/components/MainArea/ArticleListVirtualScrollPane';
import {
  ArticleListScrollOffsetProvider,
  useArticleListScrollOffset,
} from '@/components/MainArea/hooks/articleListScrollOffsetContext';

vi.mock('@/components/MainArea/hooks/useArticleListKeyboardNavigation', () => ({
  useArticleListKeyboardNavigation: vi.fn(),
}));

vi.mock('@/components/MainArea/ArticleListItem', () => ({
  ArticleListItem: ({ article }: { article: { title: string } }) => (
    <div data-testid="mock-article-row">{article.title}</div>
  ),
}));

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => <div data-testid="mock-feed-line-loader" />,
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 112,
    getVirtualItems: (): Array<{ key: string; index: number; start: number }> => [
      { key: 'hash-1', index: 0, start: 0 },
    ],
    scrollToIndex: vi.fn(),
    measureElement: vi.fn(),
  }),
}));

const makeArticle = (): Article => ({
  hash: 'hash-1',
  title: 'Article 1',
  description: '',
  content: '',
  fetchedDate: '2026-02-25T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  read: false,
  starred: false,
  saved: false,
});

function ScrollOffsetProbe() {
  const { hasListScrollOffset } = useArticleListScrollOffset();
  return <div data-testid="scroll-offset">{String(hasListScrollOffset)}</div>;
}

function renderPane(overrides: Partial<React.ComponentProps<typeof ArticleListVirtualScrollPane>> = {}) {
  const articleListRef = createRef<HTMLDivElement>();
  return render(
    <ArticleListScrollOffsetProvider>
      <ScrollOffsetProbe />
      <ArticleListVirtualScrollPane
        articleListRef={articleListRef}
        sourceKey="feed:1"
        navigationNonce={0}
        sourceLabel="Test Feed"
        variant="common"
        filteredArticles={[]}
        articlesTotalCount={0}
        articlesTotalKnown
        pageWasFull={false}
        activeArticleHash={null}
        articleViewOverlayPhase="closed"
        isInitialLoading
        isLoadingMoreArticles={false}
        isSearchActive={false}
        isSearchDebouncePending={false}
        debouncedSearchQuery=""
        isSavedView={false}
        newArticleHashes={new Set()}
        articleListScrollRequest={null}
        totalFeeds={1}
        selectArticle={vi.fn()}
        loadMoreArticles={vi.fn(async () => undefined)}
        syncArticleListViewport={vi.fn()}
        {...overrides}
      />
    </ArticleListScrollOffsetProvider>,
  );
}

describe('article list skeleton fill', () => {
  afterEach(() => {
    cleanup();
  });
  it('fills the items scroller with a clipped surplus skeleton during initial loading', () => {
    const { container } = renderPane({ isInitialLoading: true });

    const scroller = container.querySelector('[data-section="article-list-items"]');
    expect(scroller).toHaveClass('article-list-items--skeleton');
    expect(container.querySelector('.article-list-skeleton-group')).toBeInTheDocument();
    expect(container.querySelectorAll('.skeleton-item')).toHaveLength(ARTICLE_LIST_SKELETON_ROW_COUNT);
    expect(ARTICLE_LIST_SKELETON_ROW_COUNT).toBe(32);
  });

  it('does not paint the list skeleton on an honest empty list', () => {
    const { container } = renderPane({ isInitialLoading: false, filteredArticles: [] });

    const scroller = container.querySelector('[data-section="article-list-items"]');
    expect(scroller).not.toHaveClass('article-list-items--skeleton');
    expect(container.querySelector('.article-list-skeleton-group')).not.toBeInTheDocument();
  });

  it('hides the load-more sibling while the skeleton is up', () => {
    const { container } = renderPane({ isInitialLoading: true, isLoadingMoreArticles: true });

    expect(container.querySelector('.article-list-load-more')).not.toBeInTheDocument();
  });

  it('does not compact-header from leftover scroll while the skeleton is up', () => {
    const { container } = renderPane({ isInitialLoading: true });

    const scroller = container.querySelector('[data-section="article-list-items"]');
    expect(scroller).toBeTruthy();
    Object.defineProperty(scroller, 'scrollTop', { value: 80, writable: true });
    fireEvent.scroll(scroller as Element);

    expect(screen.getByTestId('scroll-offset')).toHaveTextContent('false');
  });

  it('drops the skeleton clip class after rows publish', () => {
    const articleListRef = createRef<HTMLDivElement>();
    const { container, rerender } = render(
      <ArticleListScrollOffsetProvider>
        <ScrollOffsetProbe />
        <ArticleListVirtualScrollPane
          articleListRef={articleListRef}
          sourceKey="feed:1"
          navigationNonce={0}
          sourceLabel="Test Feed"
          variant="common"
          filteredArticles={[]}
          articlesTotalCount={0}
          articlesTotalKnown
          pageWasFull={false}
          activeArticleHash={null}
          articleViewOverlayPhase="closed"
          isInitialLoading
          isLoadingMoreArticles={false}
          isSearchActive={false}
          isSearchDebouncePending={false}
          debouncedSearchQuery=""
          isSavedView={false}
          newArticleHashes={new Set()}
          articleListScrollRequest={null}
          totalFeeds={1}
          selectArticle={vi.fn()}
          loadMoreArticles={vi.fn(async () => undefined)}
          syncArticleListViewport={vi.fn()}
        />
      </ArticleListScrollOffsetProvider>,
    );

    expect(container.querySelector('.article-list-items--skeleton')).toBeTruthy();

    rerender(
      <ArticleListScrollOffsetProvider>
        <ScrollOffsetProbe />
        <ArticleListVirtualScrollPane
          articleListRef={articleListRef}
          sourceKey="feed:1"
          navigationNonce={0}
          sourceLabel="Test Feed"
          variant="common"
          filteredArticles={[makeArticle()]}
          articlesTotalCount={1}
          articlesTotalKnown
          pageWasFull={false}
          activeArticleHash={null}
          articleViewOverlayPhase="closed"
          isInitialLoading={false}
          isLoadingMoreArticles={false}
          isSearchActive={false}
          isSearchDebouncePending={false}
          debouncedSearchQuery=""
          isSavedView={false}
          newArticleHashes={new Set()}
          articleListScrollRequest={null}
          totalFeeds={1}
          selectArticle={vi.fn()}
          loadMoreArticles={vi.fn(async () => undefined)}
          syncArticleListViewport={vi.fn()}
        />
      </ArticleListScrollOffsetProvider>,
    );

    const scroller = container.querySelector('[data-section="article-list-items"]');
    expect(scroller).not.toHaveClass('article-list-items--skeleton');
    expect(container.querySelector('.article-list-skeleton-group')).not.toBeInTheDocument();
    expect(screen.getByTestId('mock-article-row')).toBeInTheDocument();
  });

  it('clips the list skeleton to the items pane instead of 100vh', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/MainArea/ArticleList.css'), 'utf8');
    const groupBlock = css.match(/\.article-list-skeleton-group \{[\s\S]*?\n\}/);

    expect(groupBlock?.[0]).toMatch(/inset:\s*0;/);
    expect(groupBlock?.[0]).toMatch(/max-height:\s*100%;/);
    expect(css).not.toMatch(/\.article-list-skeleton-group[\s\S]{0,400}100vh/);
    expect(css).not.toMatch(/\.article-list-skeleton-group[\s\S]{0,600}black 60%/);
  });
});
