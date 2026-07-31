import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteArticlesByFeeds: vi.fn(),
  query: vi.fn(),
  syncFeedCountsBatch: vi.fn(),
  publishFeedsCountsUpdated: vi.fn(),
}));

vi.mock('@/services/articles/articlesManager', () => ({
  articlesManager: {
    deleteArticlesByFeeds: mocks.deleteArticlesByFeeds,
  },
}));

vi.mock('@/stores/articleStore', () => ({
  query: mocks.query,
  syncFeedCountsBatch: mocks.syncFeedCountsBatch,
}));

vi.mock('@/services/ui/feedLibraryMutationBus', () => ({
  feedLibraryMutationBus: {
    publishFeedsCountsUpdated: mocks.publishFeedsCountsUpdated,
  },
}));

import {
  clearAllArticlesAcrossFeeds,
  countClearableArticles,
} from '@/services/articles/clearArticlesWorkflow';

describe('countClearableArticles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts unsaved articles via a zero-limit total-only query', async () => {
    mocks.query.mockResolvedValue({ articles: [], total: 201337 });

    await expect(countClearableArticles()).resolves.toBe(201337);
    expect(mocks.query).toHaveBeenCalledWith({ filter: { saved: false }, limit: 0 });
  });
});

describe('clearAllArticlesAcrossFeeds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs one batched delete and one batched count sync for all feeds', async () => {
    mocks.deleteArticlesByFeeds.mockResolvedValue(['h1', 'h2', 'h3']);
    mocks.syncFeedCountsBatch.mockResolvedValue([
      { feedId: 'f1', unreadCount: 0, articleCount: 2 },
      { feedId: 'f2', unreadCount: 1, articleCount: 5 },
    ]);

    await expect(clearAllArticlesAcrossFeeds(['f1', 'f2'])).resolves.toBe(3);

    expect(mocks.deleteArticlesByFeeds).toHaveBeenCalledTimes(1);
    expect(mocks.deleteArticlesByFeeds).toHaveBeenCalledWith(['f1', 'f2']);
    expect(mocks.syncFeedCountsBatch).toHaveBeenCalledTimes(1);
    expect(mocks.syncFeedCountsBatch).toHaveBeenCalledWith(['f1', 'f2']);
    expect(mocks.publishFeedsCountsUpdated).toHaveBeenCalledWith([
      { feedId: 'f1', unreadCount: 0, articleCount: 2 },
      { feedId: 'f2', unreadCount: 1, articleCount: 5 },
    ]);
  });

  it('skips the counts publish when no feeds were synced', async () => {
    mocks.deleteArticlesByFeeds.mockResolvedValue([]);
    mocks.syncFeedCountsBatch.mockResolvedValue([]);

    await expect(clearAllArticlesAcrossFeeds([])).resolves.toBe(0);
    expect(mocks.publishFeedsCountsUpdated).not.toHaveBeenCalled();
  });
});
