import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Article } from '@/types/article';

const mocks = vi.hoisted(() => ({
  fetchAndParse: vi.fn(),
  getFeedById: vi.fn(),
  findSavedArticle: vi.fn(),
}));

vi.mock('@/components/MainArea/ReaderTextSizeControl', () => ({
  ReaderTextSizeControl: () => null,
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'article-test' }),
}));

vi.mock('@/services/saved/savedArticlesService', () => ({
  savedArticlesService: {
    findSavedArticle: mocks.findSavedArticle,
    saveArticle: vi.fn(),
    unsaveArticle: vi.fn(),
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: {
    updateSavedStatus: vi.fn(),
    updateLastReadAt: vi.fn().mockResolvedValue(undefined),
    updateReadStatus: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/feeds/feedsManager', () => ({
  feedsManager: {
    getFeedById: mocks.getFeedById,
    updateFeed: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/articles/readerModeService', () => ({
  readerModeService: { fetchAndParse: mocks.fetchAndParse },
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
  ArticleContent: ({ htmlContent }: { htmlContent: string }) => (
    <div data-testid="article-body" dangerouslySetInnerHTML={{ __html: htmlContent }} />
  ),
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

const article = {
  hash: 'hash-blocked',
  feedId: 'feed-blocked',
  feedTitle: 'Example Feed',
  title: 'A blocked article',
  link: 'https://example.com/blocked',
  content: '<p>The summary the feed shipped.</p>',
  description: '',
  publishedDate: '2026-10-31T08:00:00.000Z',
  read: true,
  saved: false,
  isFeedLinked: true,
} as unknown as Article;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
  });
};

const failedReaderResult = (failure: string) => ({ success: false, error: 'Error', failure });

describe('ArticleView when reader mode cannot load the article', () => {
  beforeEach(() => {
    mocks.findSavedArticle.mockResolvedValue(null);
    mocks.getFeedById.mockResolvedValue({ id: article.feedId, readerModeEnabled: true });
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: { ...window.kijiAPI, openExternal: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('shows the feed copy and a way out instead of a bare error when the site blocks the app', async () => {
    mocks.fetchAndParse.mockResolvedValue(failedReaderResult('blocked'));

    render(<ArticleView article={article} standalone />);
    await flush();

    expect((await screen.findByRole('status')).textContent).toContain('Showing the version from the feed.');
    expect(screen.getByTestId('article-body').textContent).toContain('The summary the feed shipped.');
    expect(screen.getByRole('button', { name: 'Open in Browser' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/\b403\b|Error/);
  });

  it('offers Try again on a connection failure and shows the article once it succeeds', async () => {
    mocks.fetchAndParse.mockResolvedValueOnce(failedReaderResult('unreachable'));
    mocks.fetchAndParse.mockResolvedValueOnce({
      success: true,
      content: {
        title: 'A blocked article',
        content: '<p>The full article from the site.</p>',
        textContent: 'The full article from the site.',
        length: 31,
        excerpt: '',
      },
    });

    render(<ArticleView article={article} standalone />);
    await flush();

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await flush();

    expect(mocks.fetchAndParse).toHaveBeenCalledTimes(2);
    // The failure notice animates out, so wait for it rather than checking right away.
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
      expect(screen.getByTestId('article-body').textContent).toContain('The full article from the site.');
    });
  });
});
