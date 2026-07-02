import { memo, type RefObject } from 'react';
import { ArticleListWidgets } from './ArticleListWidgets';
import { ArticleListSearchInput } from './ArticleListSearchInput';
import { ArticleListHeaderSkeleton } from './ArticleListSkeleton';

export interface ArticleListHeaderSectionProps {
  variant: 'common' | 'saved';
  articleListRef: RefObject<HTMLDivElement>;
  hasListScrollOffset: boolean;
  isInitialLoading: boolean;
  showSourceTitle: boolean;
  selectedFeedTitle: string | null;
  subtitleText: string;
  isSavedView: boolean;
  isSearchOpen: boolean;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  onCloseSearch: () => void;
  onToggleSearch: () => void;
}

export const ArticleListHeaderSection = memo(function ArticleListHeaderSection({
  articleListRef,
  hasListScrollOffset,
  isInitialLoading,
  showSourceTitle,
  selectedFeedTitle,
  subtitleText,
  isSavedView,
  isSearchOpen,
  searchQuery,
  onSearchChange,
  onCloseSearch,
  onToggleSearch,
}: ArticleListHeaderSectionProps) {
  const titleSectionClassName = `article-list-title-section ${hasListScrollOffset ? 'article-list-title-section-scrolled' : ''}`;

  return (
    <div className={titleSectionClassName} data-section="article-list-title">
      <ArticleListWidgets
        onToggleSearch={onToggleSearch}
        isSavedView={isSavedView}
      />
      <div className="article-list-title-content">
        <ArticleListSearchInput
          isOpen={isSearchOpen}
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onClose={onCloseSearch}
          ignoredOutsideClickRef={articleListRef}
        />
        {isInitialLoading ? (
          <ArticleListHeaderSkeleton />
        ) : (
          showSourceTitle && (
            <>
              <h2 className="article-list-title">{selectedFeedTitle}</h2>
              <p className="article-list-subtitle">{subtitleText}</p>
            </>
          )
        )}
      </div>
    </div>
  );
});
