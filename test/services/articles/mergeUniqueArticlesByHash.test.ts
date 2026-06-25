import { describe, expect, it } from 'vitest';
import type { Article } from '@/types/article';
import { mergeUniqueArticlesByHash } from '@/services/articles/mergeUniqueArticlesByHash';

const createArticle = (hash: string): Article => ({
  hash,
  title: `Title ${hash}`,
  description: 'description',
  content: '',
  link: `https://example.com/${hash}`,
  publishedDate: '2026-01-01T00:00:00.000Z',
  fetchedDate: '2026-01-01T00:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/feed',
  read: false,
  starred: false,
  saved: false,
});

describe('mergeUniqueArticlesByHash', () => {
  it('returns the existing list when incoming is empty', () => {
    const existing = [createArticle('hash-1')];
    expect(mergeUniqueArticlesByHash(existing, [])).toBe(existing);
  });

  it('appends non-overlapping pages without mutating the existing array', () => {
    const existing = [createArticle('hash-1'), createArticle('hash-2')];
    const incoming = [createArticle('hash-3'), createArticle('hash-4')];
    const merged = mergeUniqueArticlesByHash(existing, incoming);

    expect(merged).toEqual([...existing, ...incoming]);
    expect(merged).not.toBe(existing);
    expect(existing).toHaveLength(2);
  });

  it('dedupes duplicate hashes inside the incoming page', () => {
    const existing = [createArticle('hash-1')];
    const incoming = [createArticle('hash-2'), createArticle('hash-2'), createArticle('hash-3')];
    const merged = mergeUniqueArticlesByHash(existing, incoming);

    expect(merged.map((article) => article.hash)).toEqual(['hash-1', 'hash-2', 'hash-3']);
  });

  it('skips incoming rows that already exist', () => {
    const existing = [createArticle('hash-1'), createArticle('hash-2')];
    const incoming = [createArticle('hash-2'), createArticle('hash-3')];
    const merged = mergeUniqueArticlesByHash(existing, incoming);

    expect(merged.map((article) => article.hash)).toEqual(['hash-1', 'hash-2', 'hash-3']);
  });

  it('returns the existing list when every incoming row overlaps', () => {
    const existing = [createArticle('hash-1'), createArticle('hash-2')];
    const incoming = [createArticle('hash-1'), createArticle('hash-2')];
    expect(mergeUniqueArticlesByHash(existing, incoming)).toBe(existing);
  });
});
