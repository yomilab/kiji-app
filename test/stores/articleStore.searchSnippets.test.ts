import { describe, expect, it, vi } from 'vitest';

const record = (hash: string) => ({
  hash,
  feedId: 'feed-1',
  title: `Title ${hash}`,
  description: 'Feed summary',
  content: '',
  link: null,
  author: null,
  publishedDate: '2026-10-20T08:00:00.000Z',
  fetchedDate: '2026-10-20T08:00:00.000Z',
  read: false,
  starred: false,
  saved: false,
  savedArticleId: null,
  lastReadAt: null,
  metadata: null,
  feedUrl: 'https://example.com/rss',
  feedTitle: 'Example',
  feedFavicon: null,
  feedFaviconHasTransparency: null,
  feedFaviconBgLight: null,
  feedFaviconBgDark: null,
  feedImage: null,
});

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@/lib/tauriClient', () => ({
  tauriClient: { articles: { query: queryMock } },
}));

import { query } from '@/stores/articleStore';

describe('articleStore.query search snippets', () => {
  it('attaches the article-text excerpt only to rows the search returned one for', async () => {
    queryMock.mockResolvedValueOnce({
      articles: [record('title-match'), record('body-match')],
      total: 0,
      hasMore: false,
      cancelled: false,
      searchSnippets: { 'body-match': '...the pelican lands on the pier...' },
    });

    const result = await query({ searchText: 'pelican', limit: 50 });

    expect(result.articles.map((article) => article.searchSnippet)).toEqual([
      undefined,
      '...the pelican lands on the pier...',
    ]);
    expect(result.articles[1].description).toBe('Feed summary');
  });

  it('leaves rows untouched when the response has no snippets', async () => {
    queryMock.mockResolvedValueOnce({
      articles: [record('plain')],
      total: 1,
      hasMore: false,
      cancelled: false,
    });

    const result = await query({ limit: 50 });

    expect(result.articles[0]).not.toHaveProperty('searchSnippet');
  });
});
