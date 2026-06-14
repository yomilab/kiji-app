import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { FeedProvider, useFeedNavigation, useFeedCollection, useFeedOverlay } from '@/contexts/FeedContext';
import * as feedStore from '@/stores/feedStore';
import * as articleStore from '@/stores/articleStore';
import { feedsFetcher } from '@/services/feeds/feedsFetcher';

// Mock dependencies
vi.mock('@/stores/feedStore');
vi.mock('@/stores/articleStore');
vi.mock('@/services/feeds/feedsFetcher');
vi.mock('@/services/logger');
vi.mock('@/services/favicons/faviconRefreshService');

const TestComponent = () => {
  const { selectedFeedId, selectFeed, openFeedEditView, isFeedEditView } = useFeedNavigation();
  const { articles, isLoadingArticles } = useFeedCollection();
  const { selectArticle, requestCloseArticle, completeArticleClose, articleViewOverlayPhase, isArticleClosing } = useFeedOverlay();

  return (
    <div>
      <div data-testid="selected-feed-id">{selectedFeedId}</div>
      <div data-testid="is-feed-edit-view">{isFeedEditView.toString()}</div>
      <div data-testid="article-count">{articles.length}</div>
      <div data-testid="is-loading">{isLoadingArticles.toString()}</div>
      <div data-testid="overlay-phase">{articleViewOverlayPhase}</div>
      <div data-testid="is-article-closing">{isArticleClosing.toString()}</div>
      <button data-testid="select-feed-a" onClick={() => selectFeed('feed-a', 'url-a', 'Title A')}>Select A</button>
      <button data-testid="open-edit" onClick={() => openFeedEditView()}>Open Edit</button>
      <button data-testid="open-article" onClick={() => selectArticle('article-1')}>Open Article</button>
      <button
        data-testid="shortcut-open-edit"
        onClick={() => {
          requestCloseArticle();
          openFeedEditView();
        }}
      >
        Shortcut Open Edit
      </button>
      <button data-testid="complete-close" onClick={() => completeArticleClose()}>Complete Close</button>
    </div>
  );
};

describe('FeedContext FeedEditView transition', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (feedStore.getCount as vi.Mock).mockResolvedValue(1);
    (feedStore.getById as vi.Mock).mockResolvedValue({ id: 'feed-a', url: 'url-a', title: 'Title A' });
    (articleStore.query as vi.Mock).mockResolvedValue({ articles: [{ hash: '1', title: 'Art 1' }], total: 1 });
    (articleStore.syncFeedCountsBatch as vi.Mock).mockResolvedValue([]);
    (feedsFetcher.fetchFeed as vi.Mock).mockResolvedValue({ items: [] });
  });

  it('should reload articles when returning from FeedEditView to the same feed', async () => {
    const { getByTestId } = render(
      <FeedProvider>
        <TestComponent />
      </FeedProvider>
    );

    // 1. Initial state
    await waitFor(() => expect(getByTestId('article-count').textContent).toBe('0'));

    // 2. Select Feed A
    await act(async () => {
      getByTestId('select-feed-a').click();
    });

    await waitFor(() => expect(getByTestId('selected-feed-id').textContent).toBe('feed-a'));
    await waitFor(() => expect(getByTestId('article-count').textContent).toBe('1'));

    // 3. Open Feed Edit View
    await act(async () => {
      getByTestId('open-edit').click();
    });

    await waitFor(() => expect(getByTestId('is-feed-edit-view').textContent).toBe('true'));
    await waitFor(() => expect(getByTestId('article-count').textContent).toBe('0'));
    await waitFor(() => expect(getByTestId('selected-feed-id').textContent).toBe(''));

    // 4. Select Feed A again
    await act(async () => {
      getByTestId('select-feed-a').click();
    });

    await waitFor(() => expect(getByTestId('is-feed-edit-view').textContent).toBe('false'));
    await waitFor(() => expect(getByTestId('selected-feed-id').textContent).toBe('feed-a'));
    
    // This is where it used to fail (stayed at 0)
    await waitFor(() => expect(getByTestId('article-count').textContent).toBe('1'), { timeout: 3000 });
  });

  it('closes the article overlay lifecycle when feed edit opens from an article', async () => {
    const { getByTestId } = render(
      <FeedProvider>
        <TestComponent />
      </FeedProvider>
    );

    await act(async () => {
      (document.querySelector('[data-testid="open-article"]') as HTMLButtonElement).click();
    });

    await act(async () => {
      (document.querySelector('[data-testid="shortcut-open-edit"]') as HTMLButtonElement).click();
    });

    await waitFor(() => expect(getByTestId('is-feed-edit-view').textContent).toBe('true'));
    await waitFor(() => expect(getByTestId('overlay-phase').textContent).toBe('closing'));
    await waitFor(() => expect(getByTestId('is-article-closing').textContent).toBe('true'));

    await act(async () => {
      getByTestId('complete-close').click();
    });

    await waitFor(() => expect(getByTestId('overlay-phase').textContent).toBe('closed'));
    await waitFor(() => expect(getByTestId('is-article-closing').textContent).toBe('false'));
  });
});
