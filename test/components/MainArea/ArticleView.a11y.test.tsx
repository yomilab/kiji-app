import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { findSeriousAxeViolations } from '../../helpers/axe';
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
  hash: 'hash-a',
  feedId: 'feed-1',
  feedTitle: 'Example Feed',
  author: 'Ada',
  title: 'Accessible readers',
  link: 'https://example.com/a',
  content: '<p>Body content long enough to be saveable as basic mode HTML.</p>',
  description: '',
  publishedDate: '2026-10-20T08:00:00.000Z',
  read: false,
  saved: false,
  isFeedLinked: true,
} as unknown as Article;

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await Promise.resolve();
    }
  });
};

describe('ArticleView header and actions accessibility', () => {
  beforeEach(() => {
    mocks.findSavedArticle.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<ArticleView article={article} standalone />);
    await flush();
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });

  it('is a named region whose icon-only actions all have names', async () => {
    render(<ArticleView article={article} standalone />);
    await flush();
    expect(screen.getByRole('region', { name: 'Article' })).toBeTruthy();
    const actions = document.querySelector('[data-component="article-actions"]')!;
    const buttons = Array.from(actions.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label')?.trim()).toBeTruthy();
    }
  });

  it('the title block is announced by the article title, not only "Open in Browser"', async () => {
    render(<ArticleView article={article} standalone />);
    await flush();
    const titleButton = document.querySelector('[data-action="open-in-browser"]')!;
    expect(titleButton.getAttribute('aria-label')).toMatch(/^Accessible readers, /);
  });
});
