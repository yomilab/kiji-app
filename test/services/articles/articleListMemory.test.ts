import { describe, expect, it, beforeEach } from 'vitest';
import type { Article } from '@/types/article';
import {
  clearArticleListMemoryCaches,
  getInternedFeedMetadataCountForTests,
  internArticleFeedMetadata,
  prepareArticleForList,
  slimArticleForList,
} from '@/services/articles/articleListMemory';

const baseArticle = (overrides: Partial<Article> = {}): Article => ({
  hash: 'hash-1',
  title: 'Title',
  description: 'Description',
  content: '',
  fetchedDate: '2026-06-11T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/feed',
  feedTitle: 'Example Feed',
  feedFavicon: 'data:image/png;base64,abc',
  read: false,
  starred: false,
  saved: false,
  ...overrides,
});

describe('articleListMemory', () => {
  beforeEach(() => {
    clearArticleListMemoryCaches();
  });

  it('reuses interned feed metadata across list rows', () => {
    const first = internArticleFeedMetadata(baseArticle());
    const second = internArticleFeedMetadata(baseArticle({ hash: 'hash-2', title: 'Other title' }));

    expect(first.feedFavicon).toBe(second.feedFavicon);
    expect(first.feedTitle).toBe(second.feedTitle);
    expect(getInternedFeedMetadataCountForTests()).toBe(1);
  });

  it('drops list-only metadata fields but keeps article-open fields', () => {
    const slimmed = slimArticleForList(baseArticle({
      enclosures: [{ url: 'https://example.com/audio.mp3', type: 'audio/mpeg' }],
      images: ['https://example.com/image.jpg'],
      summary: 'summary',
      guid: 'guid',
      isFeedLinked: true,
      duration: 120,
    }));

    expect(slimmed.enclosures).toHaveLength(1);
    expect(slimmed.isFeedLinked).toBe(true);
    expect(slimmed.duration).toBe(120);
    expect(slimmed.images).toBeUndefined();
    expect(slimmed.summary).toBeUndefined();
    expect(slimmed.guid).toBeUndefined();
    expect(slimmed.title).toBe('Title');
  });

  it('prepares list rows with interning and slimming', () => {
    const prepared = prepareArticleForList(baseArticle({
      enclosures: [{ url: 'https://example.com/audio.mp3', type: 'audio/mpeg' }],
    }));

    expect(prepared.enclosures).toHaveLength(1);
    expect(getInternedFeedMetadataCountForTests()).toBe(1);
  });
});
