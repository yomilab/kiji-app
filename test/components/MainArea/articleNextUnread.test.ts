import { describe, expect, it, vi } from 'vitest';
import type { Article } from '@/types/article';
import {
  findNextUnreadArticleHash,
  resolveNextUnreadArticleHash,
} from '@/components/MainArea/articleNextUnread';

const rows = (spec: string): Array<Pick<Article, 'hash' | 'read'>> =>
  // "a b* c" → a unread, b read, c unread
  spec.split(' ').map((token) => ({ hash: token.replace('*', ''), read: token.endsWith('*') }));

describe('findNextUnreadArticleHash', () => {
  it('skips read rows after the current one', () => {
    expect(findNextUnreadArticleHash(rows('a b* c* d'), 'a')).toBe('d');
  });

  it('starts at the top with nothing selected', () => {
    expect(findNextUnreadArticleHash(rows('a* b c'), null)).toBe('b');
  });

  it('never returns the current article even if its row is still unread', () => {
    expect(findNextUnreadArticleHash(rows('a b*'), 'a')).toBeNull();
  });

  it('returns null at the end of the list', () => {
    expect(findNextUnreadArticleHash(rows('a b c*'), 'b')).toBeNull();
  });
});

describe('resolveNextUnreadArticleHash', () => {
  it('loads more pages until an unread row appears', async () => {
    let list = rows('a b*');
    const loadMore = vi.fn(async () => {
      list = loadMore.mock.calls.length === 1 ? [...list, ...rows('c*')] : [...list, ...rows('d')];
    });
    const result = await resolveNextUnreadArticleHash({
      fromHash: 'a',
      getArticles: () => list,
      hasMore: () => true,
      loadMore,
      waitForListChange: async () => {},
    });
    expect(result).toBe('d');
    expect(loadMore).toHaveBeenCalledTimes(2);
  });

  it('gives up when the list has no more pages', async () => {
    const loadMore = vi.fn(async () => {});
    const result = await resolveNextUnreadArticleHash({
      fromHash: 'a',
      getArticles: () => rows('a b*'),
      hasMore: () => false,
      loadMore,
      waitForListChange: async () => {},
    });
    expect(result).toBeNull();
    expect(loadMore).not.toHaveBeenCalled();
  });

  it('stops when loading more does not change the list', async () => {
    const list = rows('a b*');
    const loadMore = vi.fn(async () => {});
    const result = await resolveNextUnreadArticleHash({
      fromHash: 'a',
      getArticles: () => list,
      hasMore: () => true,
      loadMore,
      waitForListChange: async () => {},
    });
    expect(result).toBeNull();
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('caps how many pages it loads', async () => {
    let list = rows('a');
    const loadMore = vi.fn(async () => {
      list = [...list, { hash: `r${list.length}`, read: true }];
    });
    const result = await resolveNextUnreadArticleHash({
      fromHash: 'a',
      getArticles: () => list,
      hasMore: () => true,
      loadMore,
      waitForListChange: async () => {},
      maxLoadMorePages: 3,
    });
    expect(result).toBeNull();
    expect(loadMore).toHaveBeenCalledTimes(3);
  });
});
