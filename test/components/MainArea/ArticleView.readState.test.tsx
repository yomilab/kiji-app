import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Article } from '@/types/article';

const mocks = vi.hoisted(() => ({
  updateReadStatus: vi.fn(),
  updateArticleInList: vi.fn(),
  selectArticle: vi.fn(),
  loadMoreArticles: vi.fn(),
  requestCloseArticle: vi.fn(),
  completeArticleClose: vi.fn(),
  syncFeedCountsBatch: vi.fn(),
  publishFeedsCountsUpdated: vi.fn(),
  showToast: vi.fn(),
  ctx: {
    selectedSmartView: null as string | null,
    articles: [] as Article[],
    articlesTotalCount: 0,
    articlesTotalKnown: true,
    pageWasFull: false,
    activeArticleHash: null as string | null,
    articleOpenTrigger: 0,
    articleCloseRequest: 0,
    articleViewOverlayPhase: 'closed' as string,
  },
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'main' }),
}));

vi.mock('@/contexts/FeedContext', () => ({
  useFeedNavigation: () => ({ selectedSmartView: mocks.ctx.selectedSmartView }),
  useFeedCollectionArticles: () => ({
    articles: mocks.ctx.articles,
    articlesTotalCount: mocks.ctx.articlesTotalCount,
    articlesTotalKnown: mocks.ctx.articlesTotalKnown,
    pageWasFull: mocks.ctx.pageWasFull,
  }),
  useFeedCollectionActions: () => ({
    updateArticleInList: mocks.updateArticleInList,
    loadMoreArticles: mocks.loadMoreArticles,
  }),
  useFeedOverlay: () => ({
    activeArticleHash: mocks.ctx.activeArticleHash,
    articleOpenTrigger: mocks.ctx.articleOpenTrigger,
    articleCloseRequest: mocks.ctx.articleCloseRequest,
    articleViewOverlayPhase: mocks.ctx.articleViewOverlayPhase,
    selectArticle: mocks.selectArticle,
    requestCloseArticle: mocks.requestCloseArticle,
    completeArticleClose: mocks.completeArticleClose,
  }),
}));

vi.mock('@/services/saved/savedArticlesService', () => ({
  savedArticlesService: {
    findSavedArticle: vi.fn().mockResolvedValue(null),
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: {
    updateSavedStatus: vi.fn().mockResolvedValue(undefined),
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
    updateReadStatus: mocks.updateReadStatus,
  },
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getFeedById: vi.fn().mockResolvedValue(null),
    updateFeed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/articles/readerModeService', () => ({
  readerModeService: {
    fetchAndParse: vi.fn().mockResolvedValue({ success: false, resourceType: 'html', content: null }),
  },
}));

vi.mock('@/services/articles/postlightParserService', () => ({
  postlightParserService: { parseUrl: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/services/favicons/faviconFetcher', () => ({
  faviconFetcher: { fetchFavicon: vi.fn().mockResolvedValue(null) },
}));

vi.mock('@/stores/articleStore', () => ({
  getContent: vi.fn().mockResolvedValue(null),
  getSavedContent: vi.fn().mockResolvedValue(null),
  syncFeedCountsBatch: mocks.syncFeedCountsBatch,
}));

vi.mock('@/services/ui/feedLibraryMutationBus', () => ({
  feedLibraryMutationBus: { publishFeedsCountsUpdated: mocks.publishFeedsCountsUpdated },
}));

vi.mock('@/services/ui/appToastService', () => ({
  appToastService: { show: mocks.showToast, clear: vi.fn() },
}));

vi.mock('@/components/common/ArticleContent', () => ({
  ArticleContent: () => null,
  ArticleContentSkeleton: () => null,
}));

vi.mock('@/components/common/ArticlePdf', () => ({
  ArticlePdfViewer: () => null,
}));

vi.mock('@/hooks/useE2eArticleViewProbes', () => ({
  useE2eArticleViewProbes: () => ({ onPdfFirstPageRendered: vi.fn() }),
}));

vi.mock('@/components/MainArea/hooks/useArticleViewPerformanceMetrics', () => ({
  useArticleViewPerformanceMetrics: () => ({ handleArticleViewProfilerRender: vi.fn() }),
}));

import { ArticleView } from '@/components/MainArea/ArticleView';
import { ArticleImageLightbox } from '@/components/MainArea/ArticleImageLightbox';

const makeArticle = (hash: string, read = false): Article => ({
  hash,
  feedId: 'feed-1',
  title: `Title ${hash}`,
  link: `https://example.com/${hash}`,
  content: '<p>Body</p>',
  description: '',
  read,
  saved: false,
  isFeedLinked: true,
} as unknown as Article);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

const press = (key: string, init: KeyboardEventInit = {}) => {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
};

const setScrollMetrics = (container: HTMLElement, metrics: { scrollTop: number; clientHeight: number; scrollHeight: number }) => {
  const scroller = container.querySelector<HTMLElement>('[data-component="article-scroll-container"]');
  if (!scroller) throw new Error('scroll container missing');
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(scroller, 'scrollTop', { configurable: true, writable: true, value: metrics.scrollTop });
  return scroller;
};

/** Opens `hash` the way FeedContext does: active hash + open trigger, then phase open. */
const openArticle = async (rerender: (ui: React.ReactElement) => void, hash: string) => {
  mocks.ctx.activeArticleHash = hash;
  mocks.ctx.articleOpenTrigger += 1;
  mocks.ctx.articleViewOverlayPhase = 'open';
  rerender(<ArticleView deckOpen />);
  await flush();
};

const closeArticle = async (rerender: (ui: React.ReactElement) => void) => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  mocks.ctx.articleCloseRequest += 1;
  mocks.ctx.articleViewOverlayPhase = 'closing';
  rerender(<ArticleView deckOpen />);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  vi.useRealTimers();
  await flush();
};

const lastRowUpdateFor = (hash: string) => {
  const calls = mocks.updateArticleInList.mock.calls.filter((call) => call[0] === hash);
  return calls[calls.length - 1]?.[1];
};

describe('ArticleView read state and Space reading flow', () => {
  let layer: HTMLDivElement;

  beforeEach(() => {
    Object.assign(mocks.ctx, {
      selectedSmartView: null,
      articles: [makeArticle('a'), makeArticle('b', true), makeArticle('c')],
      articlesTotalCount: 3,
      articlesTotalKnown: true,
      pageWasFull: false,
      activeArticleHash: null,
      articleOpenTrigger: 0,
      articleCloseRequest: 0,
      articleViewOverlayPhase: 'closed',
    });
    mocks.updateReadStatus.mockReset().mockResolvedValue(undefined);
    mocks.updateArticleInList.mockReset();
    mocks.selectArticle.mockReset();
    mocks.loadMoreArticles.mockReset().mockResolvedValue(undefined);
    mocks.syncFeedCountsBatch.mockReset().mockResolvedValue([{ feedId: 'feed-1', unreadCount: 2, articleCount: 3 }]);
    mocks.publishFeedsCountsUpdated.mockReset();
    mocks.showToast.mockReset();
    // The article shortcut layer is active while the embedded view is open.
    layer = document.createElement('div');
    layer.className = 'app-container article-view-active';
    document.body.appendChild(layer);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('marks the open article unread with m, and closing keeps it unread', async () => {
    const { rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    expect(mocks.updateReadStatus).toHaveBeenCalledWith('feed-1', 'a', true);

    press('m');
    await flush();
    expect(mocks.updateReadStatus).toHaveBeenLastCalledWith('feed-1', 'a', false);
    // Row stays put while open; nothing applied yet.
    expect(lastRowUpdateFor('a')).toBeUndefined();

    await closeArticle(rerender);
    expect(lastRowUpdateFor('a')).toMatchObject({ read: false });
    // No later write flipped it back to read.
    expect(mocks.updateReadStatus).toHaveBeenLastCalledWith('feed-1', 'a', false);
  });

  it('publishes fresh feed counts after m', async () => {
    const { rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    press('m');
    await flush();
    expect(mocks.syncFeedCountsBatch).toHaveBeenCalledWith(['feed-1']);
    expect(mocks.publishFeedsCountsUpdated).toHaveBeenCalledWith([
      { feedId: 'feed-1', unreadCount: 2, articleCount: 3 },
    ]);
  });

  it('keeps the unread choice when m lands before the automatic mark finishes', async () => {
    const pendingOpenMark = deferred<void>();
    mocks.updateReadStatus.mockReturnValueOnce(pendingOpenMark.promise);
    const { rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');

    press('m');
    await flush();
    // m waits for the in-flight automatic write so its own write is last.
    expect(mocks.updateReadStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingOpenMark.resolve();
    });
    await flush();
    expect(mocks.updateReadStatus).toHaveBeenLastCalledWith('feed-1', 'a', false);

    await closeArticle(rerender);
    expect(lastRowUpdateFor('a')).toMatchObject({ read: false });
  });

  it('m twice returns the article to read', async () => {
    const { rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    press('m');
    await flush();
    press('m');
    await flush();
    expect(mocks.updateReadStatus).toHaveBeenLastCalledWith('feed-1', 'a', true);
    await closeArticle(rerender);
    expect(lastRowUpdateFor('a')).toMatchObject({ read: true });
  });

  it('Space scrolls a page when the article is not at the bottom', async () => {
    const { container, rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    setScrollMetrics(container, { scrollTop: 0, clientHeight: 500, scrollHeight: 3000 });

    press(' ');
    await flush();
    expect(mocks.selectArticle).not.toHaveBeenCalled();
  });

  it('Space at the bottom opens the next unread article, skipping read ones', async () => {
    const { container, rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    setScrollMetrics(container, { scrollTop: 2500, clientHeight: 500, scrollHeight: 3000 });

    press(' ');
    await flush();
    expect(mocks.selectArticle).toHaveBeenCalledWith('c');
    expect(mocks.showToast).not.toHaveBeenCalled();
  });

  it('Space at the end of the list loads more before giving up', async () => {
    mocks.ctx.articles = [makeArticle('a'), makeArticle('b', true)];
    mocks.ctx.articlesTotalCount = 4;
    const { container, rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    mocks.loadMoreArticles.mockImplementation(async () => {
      mocks.ctx.articles = [...mocks.ctx.articles, makeArticle('x', true), makeArticle('y')];
      rerender(<ArticleView deckOpen />);
    });
    setScrollMetrics(container, { scrollTop: 2500, clientHeight: 500, scrollHeight: 3000 });

    press(' ');
    await flush();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(mocks.loadMoreArticles).toHaveBeenCalledTimes(1);
    expect(mocks.selectArticle).toHaveBeenCalledWith('y');
  });

  it('Space with no unread article left stays open and shows a hint', async () => {
    mocks.ctx.articles = [makeArticle('a'), makeArticle('b', true)];
    mocks.ctx.articlesTotalCount = 2;
    const { container, rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    setScrollMetrics(container, { scrollTop: 2500, clientHeight: 500, scrollHeight: 3000 });

    press(' ');
    await flush();
    expect(mocks.selectArticle).not.toHaveBeenCalled();
    expect(mocks.requestCloseArticle).not.toHaveBeenCalled();
    expect(mocks.showToast).toHaveBeenCalledWith('No more unread articles', expect.any(Number));
  });

  it('Space still closes the image viewer instead of paging the article', async () => {
    const { container, rerender } = render(<ArticleView deckOpen />);
    await openArticle(rerender, 'a');
    setScrollMetrics(container, { scrollTop: 2500, clientHeight: 500, scrollHeight: 3000 });
    const onClose = vi.fn();
    render(
      <ArticleImageLightbox
        detail={{ index: 0, images: [{ src: 'https://example.com/i.png', alt: '' }] } as never}
        onClose={onClose}
      />,
    );

    press(' ');
    await flush();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.selectArticle).not.toHaveBeenCalled();
  });
});
