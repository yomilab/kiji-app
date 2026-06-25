import { memo, useMemo } from 'react';
import {
  useFeedCollectionArticles,
  useFeedCollectionLoading,
  useFeedNavigation,
} from '@/contexts/FeedContext';
import { ArticleListFetchLoader } from './ArticleListFetchLoader';
import { useFetchIndicatorState } from './hooks/useFetchIndicatorState';
import { useSourceSwitchGrace } from './hooks/useSourceSwitchGrace';

export interface ArticleListFetchIndicatorProps {
  variant: 'common' | 'saved';
}

export const ArticleListFetchIndicator = memo(function ArticleListFetchIndicator({
  variant,
}: ArticleListFetchIndicatorProps) {
  const {
    selectedFeedId,
    selectedTag,
    selectedSmartView,
  } = useFeedNavigation();
  const { articles } = useFeedCollectionArticles();
  const {
    isLoadingArticles,
    isSavedListLoading,
    isGlobalLoadingIndicatorActive,
  } = useFeedCollectionLoading();

  const isSavedView = variant === 'saved';
  const showFetchIndicator = !isSavedView;
  const isListLoading = isSavedView ? isSavedListLoading : isLoadingArticles;
  const isInitialLoading = isListLoading && articles.length === 0;

  const sourceKey = useMemo(() => {
    if (selectedFeedId) return `feed:${selectedFeedId}`;
    if (selectedTag) return `tag:${selectedTag}`;
    if (selectedSmartView) return `smart:${selectedSmartView}`;
    return 'none';
  }, [selectedFeedId, selectedTag, selectedSmartView]);

  const { isFetchIndicatorVisible, applySourceSwitchGrace } = useFetchIndicatorState({
    enabled: showFetchIndicator,
    isActive: isGlobalLoadingIndicatorActive,
    sourceKey,
  });

  useSourceSwitchGrace({
    sourceKey,
    enabled: showFetchIndicator,
    applySourceSwitchGrace,
  });

  const shouldShow = isInitialLoading || (showFetchIndicator && isFetchIndicatorVisible);
  const label = isInitialLoading ? 'Loading articles' : 'Fetching latest articles';

  return (
    <ArticleListFetchLoader
      shouldShow={shouldShow}
      label={label}
    />
  );
});
