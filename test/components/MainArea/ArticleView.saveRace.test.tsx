import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { Article } from '@/types/article';

const mocks = vi.hoisted(() => ({
  findSavedArticle: vi.fn(),
  saveArticle: vi.fn(),
  unsaveArticle: vi.fn(),
  updateSavedStatus: vi.fn(),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'article-test' }),
}));

vi.mock('@/services/saved/savedArticlesService', () => ({
  savedArticlesService: {
    findSavedArticle: mocks.findSavedArticle,
    saveArticle: mocks.saveArticle,
    unsaveArticle: mocks.unsaveArticle,
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: {
    updateSavedStatus: mocks.updateSavedStatus,
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
    updateReadStatus: vi.fn().mockResolvedValue(undefined),
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
}));

vi.mock('@/components/common/ArticleContent', () => ({
  ArticleContent: () => null,
  ArticleContentSkeleton: () => null,
}));

vi.mock('@/components/MainArea/ReaderTextSizeControl', () => ({
  ReaderTextSizeControl: () => null,
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
import {
  getRobustnessSnapshot,
  resetRobustnessMetricsForTests,
} from '@/services/diagnostics/robustnessMetrics';

const makeArticle = (hash: string): Article => ({
  hash,
  feedId: 'feed-1',
  title: `Title ${hash}`,
  link: `https://example.com/${hash}`,
  content: '<p>Body content long enough to be saveable as basic mode HTML.</p>',
  description: '',
  pubDate: '2026-01-01T00:00:00.000Z',
  read: false,
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
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });
};

const saveButtonAction = (container: HTMLElement) =>
  container.querySelector('[data-widget="save-article"]')?.getAttribute('data-action');

describe('ArticleView handleSaveArticle article-switch race', () => {
  beforeEach(() => {
    resetRobustnessMetricsForTests();
    mocks.findSavedArticle.mockResolvedValue(null);
    mocks.updateSavedStatus.mockResolvedValue(undefined);
    mocks.unsaveArticle.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('completes the save but does not mark the newly shown article as saved', async () => {
    const pendingSave = deferred<{ id: string }>();
    mocks.saveArticle.mockReturnValue(pendingSave.promise);
    const articleA = makeArticle('hash-a');
    const articleB = makeArticle('hash-b');

    const { container, rerender } = render(<ArticleView article={articleA} standalone />);
    await flush();
    expect(saveButtonAction(container)).toBe('save-article');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    });
    await flush();
    expect(mocks.saveArticle).toHaveBeenCalledTimes(1);
    expect(mocks.saveArticle.mock.calls[0][0].hash).toBe('hash-a');

    rerender(<ArticleView article={articleB} standalone />);
    await flush();
    expect(saveButtonAction(container)).toBe('save-article');

    await act(async () => {
      pendingSave.resolve({ id: 'saved-a' });
    });
    await flush();

    // Persistence for A still completed.
    expect(mocks.updateSavedStatus).toHaveBeenCalledWith('feed-1', 'hash-a', true, 'saved-a');
    // B's view must not flip to "saved" from A's late result.
    expect(saveButtonAction(container)).toBe('save-article');
    expect(getRobustnessSnapshot().counters['ui.saveRaceViewUpdateSkipped']).toBe(1);
  });

  it('still marks the article saved when it stays shown', async () => {
    mocks.saveArticle.mockResolvedValue({ id: 'saved-a' });
    const { container } = render(<ArticleView article={makeArticle('hash-a')} standalone />);
    await flush();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
    });
    await flush();

    expect(saveButtonAction(container)).toBe('unsave-article');
    expect(getRobustnessSnapshot().counters['ui.saveRaceViewUpdateSkipped']).toBeUndefined();
  });
});
