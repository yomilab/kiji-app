import { memo, useCallback } from 'react';
import type { RefObject } from 'react';
import {
  useFeedCollectionActions,
  useFeedCollectionArticles,
  useFeedCollectionLoading,
  useFeedNavigation,
  useFeedOverlay,
  useFeedUI,
} from '@/contexts/FeedContext';
import { ArticleListVirtualScrollPane } from './ArticleListVirtualScrollPane';
import { useTransientNewArticleHashes } from './hooks/useTransientNewArticleHashes';

export interface ArticleListScrollBranchProps {
  variant: 'common' | 'saved';
  articleListRef: RefObject<HTMLDivElement>;
  isSearchOpen: boolean;
  searchQuery: string;
  debouncedSearchQuery: string;
}

export const ArticleListScrollBranch = memo(function ArticleListScrollBranch({
  variant,
  articleListRef,
  isSearchOpen,
  searchQuery,
  debouncedSearchQuery,
}: ArticleListScrollBranchProps) {
  const {
    selectedFeedTitle,
    selectedFeedId,
    selectedTag,
    selectedSmartView,
    navigationNonce,
  } = useFeedNavigation();
  const {
    articles,
    articlesTotalCount,
    newArticleHashes: contextNewArticleHashes,
    articleListScrollRequest,
  } = useFeedCollectionArticles();
  const {
    isLoadingArticles,
    isLoadingMoreArticles,
    isSavedListLoading,
  } = useFeedCollectionLoading();
  const {
    loadMoreArticles,
    syncArticleListViewport,
  } = useFeedCollectionActions();
  const {
    activeArticleHash,
    selectArticle,
    articleViewOverlayPhase,
  } = useFeedOverlay();
  const { totalFeeds } = useFeedUI();

  const isSavedView = variant === 'saved';
  const isListLoading = isSavedView ? isSavedListLoading : isLoadingArticles;
  const isInitialLoading = isListLoading && articles.length === 0;
  const newArticleHashes = useTransientNewArticleHashes(isSavedView, contextNewArticleHashes);
  const isSearchActive = isSearchOpen && searchQuery.trim().length > 0;
  const isSearchDebouncePending = searchQuery.trim() !== debouncedSearchQuery.trim();

  const sourceKey = selectedFeedId
    ? `feed:${selectedFeedId}`
    : selectedTag
      ? `tag:${selectedTag}`
      : selectedSmartView
        ? `smart:${selectedSmartView}`
        : 'none';

  const handleLoadMoreArticles = useCallback(
    (options: { showLoadingIndicator: boolean; priority: 'prefetch' | 'urgent' }) => loadMoreArticles(options),
    [loadMoreArticles],
  );

  return (
    <ArticleListVirtualScrollPane
      articleListRef={articleListRef}
      sourceKey={sourceKey}
      navigationNonce={navigationNonce}
      sourceLabel={selectedFeedTitle}
      variant={variant}
      filteredArticles={articles}
      articlesTotalCount={articlesTotalCount}
      activeArticleHash={activeArticleHash}
      articleViewOverlayPhase={articleViewOverlayPhase}
      isInitialLoading={isInitialLoading}
      isLoadingMoreArticles={isLoadingMoreArticles}
      isSearchActive={isSearchActive}
      isSearchDebouncePending={isSearchDebouncePending}
      debouncedSearchQuery={debouncedSearchQuery}
      isSavedView={isSavedView}
      newArticleHashes={newArticleHashes}
      articleListScrollRequest={articleListScrollRequest}
      totalFeeds={totalFeeds}
      selectArticle={selectArticle}
      loadMoreArticles={handleLoadMoreArticles}
      syncArticleListViewport={syncArticleListViewport}
    />
  );
});
