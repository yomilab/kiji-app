import { memo, useEffect } from 'react';
import type { RefObject } from 'react';
import {
  useFeedCollectionActions,
  useFeedCollectionArticles,
  useFeedCollectionLoading,
  useFeedNavigation,
} from '@/contexts/FeedContext';
import { ArticleListHeaderSection } from './ArticleListHeaderSection';
import { useArticleListScrollOffset } from './hooks/articleListScrollOffsetContext';

export interface ArticleListHeaderBranchProps {
  variant: 'common' | 'saved';
  articleListRef: RefObject<HTMLDivElement>;
  isSearchOpen: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
  onToggleSearch: () => void;
}

export const ArticleListHeaderBranch = memo(function ArticleListHeaderBranch({
  variant,
  articleListRef,
  isSearchOpen,
  searchQuery,
  onSearchChange,
  onCloseSearch,
  onToggleSearch,
}: ArticleListHeaderBranchProps) {
  const {
    selectedFeedTitle,
    selectedFeedId,
    selectedTag,
    selectedSmartView,
  } = useFeedNavigation();
  const { articles, articlesTotalCount } = useFeedCollectionArticles();
  const { isLoadingArticles, isSavedListLoading } = useFeedCollectionLoading();
  const { hasListScrollOffset } = useArticleListScrollOffset();

  const isSavedView = variant === 'saved';
  const isListLoading = isSavedView ? isSavedListLoading : isLoadingArticles;
  const isInitialLoading = isListLoading && articles.length === 0;

  return (
    <ArticleListHeaderSection
      variant={variant}
      articleListRef={articleListRef}
      hasListScrollOffset={hasListScrollOffset}
      isInitialLoading={isInitialLoading}
      showSourceTitle={!!(selectedFeedId || selectedTag || selectedSmartView)}
      selectedFeedTitle={selectedFeedTitle}
      subtitleText={`${articlesTotalCount} Items`}
      isSavedView={isSavedView}
      isSearchOpen={isSearchOpen}
      searchQuery={searchQuery}
      onSearchChange={onSearchChange}
      onCloseSearch={onCloseSearch}
      onToggleSearch={onToggleSearch}
    />
  );
});

export function ArticleListSearchSync({
  sourceKey,
  isSearchOpen,
  debouncedSearchQuery,
}: {
  sourceKey: string;
  isSearchOpen: boolean;
  debouncedSearchQuery: string;
}) {
  const { searchCurrentSource, clearArticleListSearch } = useFeedCollectionActions();

  useEffect(() => {
    const query = debouncedSearchQuery.trim();
    if (!isSearchOpen || !query) {
      void clearArticleListSearch();
      return;
    }

    void searchCurrentSource(query);
  }, [clearArticleListSearch, debouncedSearchQuery, isSearchOpen, searchCurrentSource, sourceKey]);

  return null;
}
