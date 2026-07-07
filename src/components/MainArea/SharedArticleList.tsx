import React, { useMemo, useRef } from 'react';
import {
  useFeedCollectionArticles,
  useFeedNavigation,
  useFeedUI,
} from '@/contexts/FeedContext';
import { LayoutType } from '@/services/settings/types';
import { ArticleListSearchInput } from './ArticleListSearchInput';
import { ArticleListWidgets } from './ArticleListWidgets';
import { ArticleListHeaderBranch, ArticleListSearchSync } from './ArticleListHeaderBranch';
import { ArticleListScrollBranch } from './ArticleListScrollBranch';
import { ArticleListScrollOffsetProvider } from './hooks/articleListScrollOffsetContext';
import { useArticleListSearch } from './hooks/useArticleListSearch';
import { useArticleListLayoutResize } from './hooks/useArticleListLayoutResize';
import './ArticleList.css';

interface SharedArticleListProps {
  layout?: LayoutType;
  variant: 'common' | 'saved';
}

export const SharedArticleList: React.FC<SharedArticleListProps> = ({ layout = '2-column', variant }) => {
  const { selectedFeedId, selectedTag, selectedSmartView } = useFeedNavigation();
  const { articles } = useFeedCollectionArticles();
  const { error, totalFeeds } = useFeedUI();

  const articleListRef = useRef<HTMLDivElement>(null);
  const {
    searchQuery,
    debouncedSearchQuery,
    isSearchOpen,
    handleSearchChange,
    handleToggleSearch,
    handleCloseSearch,
  } = useArticleListSearch({
    articleListRef,
    totalFeeds,
  });

  const {
    isDragging,
    widthStyle,
    showResizeHandle,
    handleBorderMouseDown,
  } = useArticleListLayoutResize({
    articleListRef,
    layout,
  });

  const isSavedView = variant === 'saved';
  const sourceKey = useMemo(() => {
    if (selectedFeedId) return `feed:${selectedFeedId}`;
    if (selectedTag) return `tag:${selectedTag}`;
    if (selectedSmartView) return `smart:${selectedSmartView}`;
    return 'none';
  }, [selectedFeedId, selectedTag, selectedSmartView]);

  const showBlockingError = !!error && articles.length === 0;

  if (showBlockingError) {
    return (
      <div ref={articleListRef} className="article-list" style={widthStyle}>
        {showResizeHandle && (
          <div className={`article-list-resize-handle ${isDragging ? 'is-dragging' : ''}`} onMouseDown={handleBorderMouseDown} />
        )}
        <div className="article-list-title-section" data-section="article-list-title">
          <ArticleListWidgets
            onToggleSearch={handleToggleSearch}
            isSavedView={isSavedView}
          />
          <div className="article-list-title-content">
            <ArticleListSearchInput
              isOpen={isSearchOpen}
              searchQuery={searchQuery}
              onSearchChange={handleSearchChange}
              onClose={handleCloseSearch}
              ignoredOutsideClickRef={articleListRef}
            />
          </div>
        </div>
        <div className="article-list-error">
          <p className="theme-text-danger">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <ArticleListScrollOffsetProvider>
      <div ref={articleListRef} className="article-list" style={widthStyle}>
        {showResizeHandle && (
          <div className={`article-list-resize-handle ${isDragging ? 'is-dragging' : ''}`} onMouseDown={handleBorderMouseDown} />
        )}
        <ArticleListSearchSync
          sourceKey={sourceKey}
          isSearchOpen={isSearchOpen}
          debouncedSearchQuery={debouncedSearchQuery}
        />
        <ArticleListHeaderBranch
          variant={variant}
          articleListRef={articleListRef}
          isSearchOpen={isSearchOpen}
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          onCloseSearch={handleCloseSearch}
          onToggleSearch={handleToggleSearch}
        />
        <ArticleListScrollBranch
          variant={variant}
          articleListRef={articleListRef}
          isSearchOpen={isSearchOpen}
          searchQuery={searchQuery}
          debouncedSearchQuery={debouncedSearchQuery}
        />
      </div>
    </ArticleListScrollOffsetProvider>
  );
};
