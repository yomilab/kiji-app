import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import {
  captureArticleListScrollAnchor,
  resolveArticleListAnchorScrollTop,
} from '@/components/MainArea/articleListDensityAnchor';
import { ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT } from '@/lib/articleListDensity';
import {
  ARTICLE_LIST_BOTTOM_SPACER_HEIGHT,
  ARTICLE_LIST_ESTIMATED_ROW_HEIGHT,
} from '@/components/MainArea/articleListLoadMore';
import type { Article } from '@/types/article';

const mockUseVirtualizer = vi.fn();

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (...args: unknown[]) => mockUseVirtualizer(...args),
}));

vi.mock('@/components/MainArea/hooks/useArticleListKeyboardNavigation', () => ({
  useArticleListKeyboardNavigation: vi.fn(),
}));

vi.mock('@/components/MainArea/ArticleListItem', () => ({
  ArticleListItem: ({ article, density }: { article: Article; density: string }) => (
    <div data-testid="row" data-density={density}>{article.title}</div>
  ),
}));

vi.mock('@/components/common/FeedLineLoader', () => ({
  FeedLineLoader: () => <div />,
}));

import { ArticleListVirtualScrollPane } from '@/components/MainArea/ArticleListVirtualScrollPane';
import { ArticleListScrollOffsetProvider } from '@/components/MainArea/hooks/articleListScrollOffsetContext';

describe('density scroll anchor helpers', () => {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({ index, start: index * 100, end: index * 100 + 100 }));

  it('anchors the top visible row by how far it is scrolled past', () => {
    const anchor = captureArticleListScrollAnchor(rows, 450, 300, -1);
    expect(anchor).toEqual({ index: 4, kind: 'ratio', ratio: 0.5 });
    expect(resolveArticleListAnchorScrollTop(anchor!, 120, 30)).toBe(135);
  });

  it('anchors a visible active row at its distance from the list top', () => {
    const anchor = captureArticleListScrollAnchor(rows, 450, 300, 6);
    expect(anchor).toEqual({ index: 6, kind: 'viewport', viewportOffset: 150 });
    expect(resolveArticleListAnchorScrollTop(anchor!, 1800, 260)).toBe(1650);
  });

  it('ignores an active row that is off screen and never returns a negative offset', () => {
    expect(captureArticleListScrollAnchor(rows, 450, 300, 1)).toMatchObject({ index: 4, kind: 'ratio' });
    const anchor = captureArticleListScrollAnchor(rows, 0, 300, 2)!;
    expect(resolveArticleListAnchorScrollTop(anchor, 60, 30)).toBe(0);
  });

  it('keeps the Comfortable first-pass row height unchanged', () => {
    expect(ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT.comfortable).toBe(ARTICLE_LIST_ESTIMATED_ROW_HEIGHT);
  });
});

describe('ArticleListVirtualScrollPane density change', () => {
  const ROW_COUNT = 20;
  const articles = Array.from({ length: ROW_COUNT }, (_, index) => ({
    hash: `hash-${index}`,
    title: `Article ${index}`,
    description: '',
    content: '',
    fetchedDate: '2026-10-22T00:00:00.000Z',
    feedId: 'feed-1',
    feedUrl: 'https://example.com/rss.xml',
    read: false,
    starred: false,
    saved: false,
  })) as unknown as Article[];

  /** Rows are 100px until measure(), then 30px (Comfortable -> Compact). */
  const makeVirtualizer = () => {
    let rowSize = 100;
    const items = () => Array.from({ length: ROW_COUNT }, (_, index) => ({
      key: `hash-${index}`,
      index,
      start: index * rowSize,
      end: index * rowSize + rowSize,
      size: rowSize,
      lane: 0,
    }));
    const adjustDuringMeasure: unknown[] = [];
    const virtualizer = {
      shouldAdjustScrollPositionOnItemSizeChange: undefined as unknown,
      getVirtualItems: () => items().slice(3, 9),
      getTotalSize: () => ROW_COUNT * rowSize,
      get measurementsCache() {
        return items();
      },
      getOffsetForIndex: (index: number) => [index * rowSize, 'start'],
      measure: vi.fn(() => {
        rowSize = 30;
      }),
      measureElement: vi.fn(() => {
        const adjust = virtualizer.shouldAdjustScrollPositionOnItemSizeChange;
        adjustDuringMeasure.push(typeof adjust === 'function' ? adjust() : adjust);
      }),
      scrollToIndex: vi.fn(),
      scrollToOffset: vi.fn(),
    };
    return { virtualizer, adjustDuringMeasure };
  };

  const baseProps = (): ComponentProps<typeof ArticleListVirtualScrollPane> => ({
    articleListRef: { current: null },
    sourceKey: 'feed:feed-1',
    navigationNonce: 0,
    sourceLabel: 'Feed',
    variant: 'common',
    filteredArticles: articles,
    articlesTotalCount: ROW_COUNT,
    articlesTotalKnown: true,
    pageWasFull: false,
    activeArticleHash: null,
    articleViewOverlayPhase: 'closed',
    isInitialLoading: false,
    isLoadingMoreArticles: false,
    isSearchActive: false,
    isSearchDebouncePending: false,
    searchStatus: 'idle',
    debouncedSearchQuery: '',
    isSavedView: false,
    newArticleHashes: new Set(),
    articleListScrollRequest: null,
    totalFeeds: 1,
    density: 'comfortable',
    selectArticle: vi.fn(),
    loadMoreArticles: vi.fn().mockResolvedValue(undefined),
    syncArticleListViewport: vi.fn(),
  });

  const renderPane = (props: ComponentProps<typeof ArticleListVirtualScrollPane>) => render(
    <ArticleListScrollOffsetProvider>
      <ArticleListVirtualScrollPane {...props} />
    </ArticleListScrollOffsetProvider>,
  );

  const placeScroller = (container: HTMLElement, scrollTop: number) => {
    const list = container.querySelector('.article-list-items') as HTMLDivElement;
    Object.defineProperties(list, {
      scrollTop: { value: scrollTop, configurable: true, writable: true },
      clientHeight: { value: 300, configurable: true },
    });
    return list;
  };

  beforeEach(() => {
    mockUseVirtualizer.mockReset();
  });

  it('re-measures every mounted row and keeps the top row anchored', () => {
    const { virtualizer, adjustDuringMeasure } = makeVirtualizer();
    mockUseVirtualizer.mockReturnValue(virtualizer);
    const props = baseProps();
    const { container, rerender, getAllByTestId } = renderPane(props);
    placeScroller(container, 450);
    // Ignore the ref-callback measurements from the first mount.
    virtualizer.measureElement.mockClear();
    adjustDuringMeasure.length = 0;

    rerender(
      <ArticleListScrollOffsetProvider>
        <ArticleListVirtualScrollPane {...props} density="compact" />
      </ArticleListScrollOffsetProvider>,
    );

    expect(virtualizer.measure).toHaveBeenCalledTimes(1);
    expect(virtualizer.measureElement).toHaveBeenCalledTimes(getAllByTestId('row').length);
    expect(adjustDuringMeasure.every((value) => value === false)).toBe(true);
    expect(virtualizer.shouldAdjustScrollPositionOnItemSizeChange).toBeUndefined();
    // Row 4 was half scrolled past (start 400, size 100); now start 120, size 30.
    expect(virtualizer.scrollToOffset).toHaveBeenCalledWith(135);
    expect(getAllByTestId('row')[0]).toHaveAttribute('data-density', 'compact');
    const spacer = container.querySelector('.article-list-virtual-spacer') as HTMLDivElement;
    // Sized before scrolling so the new offset is not clamped to the old height.
    expect(spacer.style.height).toBe(`${ROW_COUNT * 30 + ARTICLE_LIST_BOTTOM_SPACER_HEIGHT}px`);
  });

  it('keeps a visible active row at the same place on screen', () => {
    const { virtualizer } = makeVirtualizer();
    mockUseVirtualizer.mockReturnValue(virtualizer);
    const props = { ...baseProps(), activeArticleHash: 'hash-6' };
    const { container, rerender } = renderPane(props);
    placeScroller(container, 450);

    rerender(
      <ArticleListScrollOffsetProvider>
        <ArticleListVirtualScrollPane {...props} density="compact" />
      </ArticleListScrollOffsetProvider>,
    );

    // Row 6 sat 150px below the list top (600 - 450); its new start is 180.
    expect(virtualizer.scrollToOffset).toHaveBeenCalledWith(30);
  });

  it('does not re-measure when the density stays the same', () => {
    const { virtualizer } = makeVirtualizer();
    mockUseVirtualizer.mockReturnValue(virtualizer);
    const props = baseProps();
    const { rerender } = renderPane(props);

    rerender(
      <ArticleListScrollOffsetProvider>
        <ArticleListVirtualScrollPane {...props} activeArticleHash="hash-5" />
      </ArticleListScrollOffsetProvider>,
    );

    expect(virtualizer.measure).not.toHaveBeenCalled();
    expect(virtualizer.scrollToOffset).not.toHaveBeenCalled();
  });

  it('uses the density row estimate, and only image rows get the tall estimate in Large Images', () => {
    const { virtualizer } = makeVirtualizer();
    mockUseVirtualizer.mockReturnValue(virtualizer);
    const withImage = articles.map((article, index) => (
      index === 0 ? { ...article, previewImage: 'https://example.com/a.jpg' } : article
    ));
    renderPane({ ...baseProps(), filteredArticles: withImage, density: 'large-images' });
    const { estimateSize } = mockUseVirtualizer.mock.calls.at(-1)![0] as { estimateSize: (index: number) => number };
    expect(estimateSize(0)).toBe(ARTICLE_LIST_DENSITY_ESTIMATED_ROW_HEIGHT['large-images']);
    expect(estimateSize(1)).toBe(ARTICLE_LIST_ESTIMATED_ROW_HEIGHT);
  });
});
