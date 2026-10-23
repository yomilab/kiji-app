import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { createRef } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Article } from '@/types/article';
import { findSeriousAxeViolations } from '../../helpers/axe';

const virtualWindow = vi.hoisted(() => ({ start: 0, end: Infinity }));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: { updateReadStatus: vi.fn(async () => undefined) },
}));
vi.mock('@/stores/articleStore', () => ({ syncFeedCountsBatch: vi.fn(async () => []) }));
vi.mock('@/services/ui/feedLibraryMutationBus', () => ({
  feedLibraryMutationBus: { publishFeedsCountsUpdated: vi.fn() },
}));
vi.mock('@/services/ui/appToastService', () => ({ appToastService: { show: vi.fn(), clear: vi.fn() } }));
vi.mock('@/components/common/FeedLineLoader', () => ({ FeedLineLoader: () => null }));

// Mount only rows [start, end): what the real virtualizer does while scrolled.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, getItemKey }: { count: number; getItemKey: (index: number) => string }) => {
    const from = Math.min(virtualWindow.start, count);
    const to = Math.min(virtualWindow.end, count);
    return {
      getTotalSize: () => count * 112,
      getVirtualItems: () => Array.from({ length: to - from }, (_, offset) => {
        const index = from + offset;
        return { key: getItemKey(index), index, start: index * 112, end: (index + 1) * 112 };
      }),
      scrollToIndex: vi.fn(),
      measureElement: vi.fn(),
    };
  },
}));

import { ArticleListVirtualScrollPane } from '@/components/MainArea/ArticleListVirtualScrollPane';
import { ArticleListScrollOffsetProvider } from '@/components/MainArea/hooks/articleListScrollOffsetContext';

const makeArticle = (index: number, read = true): Article => ({
  hash: `h${index}`,
  title: `Article ${index}`,
  description: '',
  content: '',
  fetchedDate: '2026-10-01T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  feedTitle: 'Test Feed',
  read,
  starred: false,
  saved: false,
});

const ARTICLES = Array.from({ length: 20 }, (_, index) => makeArticle(index, index !== 15));

type PaneProps = React.ComponentProps<typeof ArticleListVirtualScrollPane>;

function paneProps(overrides: Partial<PaneProps> = {}): PaneProps {
  return {
    articleListRef: createRef<HTMLDivElement>(),
    sourceKey: 'feed:1',
    navigationNonce: 0,
    sourceLabel: 'Test Feed',
    variant: 'common',
    filteredArticles: ARTICLES,
    articlesTotalCount: 20,
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
    selectArticle: vi.fn(),
    loadMoreArticles: vi.fn(async () => undefined),
    selectedSmartView: null,
    updateArticleInList: vi.fn(),
    syncArticleListViewport: vi.fn(),
    ...overrides,
  };
}

function renderPane(overrides: Partial<PaneProps> = {}) {
  const props = paneProps(overrides);
  const tree = (next: PaneProps) => (
    <ArticleListScrollOffsetProvider>
      <div ref={next.articleListRef}>
        <ArticleListVirtualScrollPane {...next} />
      </div>
    </ArticleListScrollOffsetProvider>
  );
  const view = render(tree(props));
  return {
    ...view,
    props,
    update: (changes: Partial<PaneProps>) => view.rerender(tree({ ...props, ...changes })),
  };
}

const row = (hash: string) => document.querySelector<HTMLElement>(`.article-list-item[data-entity-id="${hash}"]`)!;

const nextFrame = () => act(async () => {
  await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
});

const flush = () => act(async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
});

const keyDown = (target: EventTarget, key: string) => {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
};

describe('article list for VoiceOver and keyboard', () => {
  beforeEach(() => {
    virtualWindow.start = 0;
    virtualWindow.end = Infinity;
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('is a labelled listbox with no serious axe violations', async () => {
    const { container } = renderPane({ activeArticleHash: 'h2' });
    expect(screen.getByRole('listbox', { name: 'Test Feed articles' })).toBeTruthy();
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });

  it('keeps aria-posinset / aria-setsize true to the whole list when only a window is mounted', () => {
    virtualWindow.start = 10;
    virtualWindow.end = 13;
    renderPane();
    const options = screen.getAllByRole('option');
    expect(options.map((option) => option.getAttribute('aria-posinset'))).toEqual(['11', '12', '13']);
    expect(options.every((option) => option.getAttribute('aria-setsize') === '20')).toBe(true);
  });

  it('reports an unknown size while more pages can load', () => {
    renderPane({ articlesTotalKnown: false, pageWasFull: true });
    expect(screen.getAllByRole('option')[0].getAttribute('aria-setsize')).toBe('-1');
  });

  it('has exactly one Tab stop, on the selected row', () => {
    renderPane({ activeArticleHash: 'h3' });
    const tabbable = screen.getAllByRole('option').filter((option) => option.tabIndex === 0);
    expect(tabbable).toEqual([row('h3')]);
  });

  it('returns focus to the article row when the reader closes', async () => {
    const { update } = renderPane({ activeArticleHash: 'h4', articleViewOverlayPhase: 'open' });
    expect(document.activeElement).toBe(document.body);

    update({ activeArticleHash: 'h4', articleViewOverlayPhase: 'closing' });
    update({ activeArticleHash: null, articleViewOverlayPhase: 'closed' });
    await nextFrame();

    expect(document.activeElement).toBe(row('h4'));
  });

  it('does not steal focus from elsewhere when the reader closes', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const { update } = renderPane({ activeArticleHash: 'h4', articleViewOverlayPhase: 'open' });
    outside.focus();

    update({ activeArticleHash: 'h4', articleViewOverlayPhase: 'closed' });
    await nextFrame();
    expect(document.activeElement).toBe(outside);
  });

  it('j / k carry focus along when a row has focus', () => {
    renderPane({ activeArticleHash: 'h1' });
    act(() => row('h1').focus());
    keyDown(row('h1'), 'j');
    expect(document.activeElement).toBe(row('h2'));
    keyDown(row('h2'), 'k');
    keyDown(row('h1'), 'k');
    expect(document.activeElement).toBe(row('h0'));
  });
});
