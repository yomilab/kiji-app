import React from 'react';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import { useFeedCollection, useFeedNavigation } from '@/contexts/FeedContext';
import { useFetchIndicatorState } from '@/components/MainArea/hooks/useFetchIndicatorState';
import { TOOLTIPS } from '@/config/tooltips';
import { useFeedRefreshActivity } from '@/hooks/useFeedRefreshActivity';
import { SHORTCUT_LABELS, withShortcutHint } from '@/services/shortcuts/shortcutService';
import './SidebarWidgets.css';

interface SidebarWidgetsProps {
  onAddFeed: () => void;
}

export const SidebarWidgets: React.FC<SidebarWidgetsProps> = ({ onAddFeed }) => {
  const { refreshFeed } = useFeedCollection();
  const {
    selectedFeedId,
    selectedTag,
    selectedSmartView,
  } = useFeedNavigation();
  const { isAnyFeedRefreshing } = useFeedRefreshActivity();
  const { isFetchIndicatorVisible } = useFetchIndicatorState({
    enabled: true,
    isActive: isAnyFeedRefreshing,
  });

  const handleRefresh = async () => {
    if (selectedFeedId || selectedTag || selectedSmartView) {
      await refreshFeed();
    }
  };

  const refreshTooltip = withShortcutHint(TOOLTIPS.sidebar.refresh, SHORTCUT_LABELS.REFRESH_FEED);
  const addFeedTooltip = withShortcutHint(TOOLTIPS.sidebar.addFeed, SHORTCUT_LABELS.ADD_FEED);
  const hasRefreshableSelection = Boolean(selectedFeedId || selectedTag || selectedSmartView);

  return (
    <div className="is-flex is-gap-1 is-align-items-center" data-section="sidebar-widgets">
      <button
        className="button is-text is-small has-no-drag"
        onClick={handleRefresh}
        aria-label={refreshTooltip}
        title={refreshTooltip}
        disabled={!hasRefreshableSelection}
        data-widget="refresh"
      >
        <span className={`icon ${isAnyFeedRefreshing || isFetchIndicatorVisible ? 'is-spinning' : ''}`}>
          <RefreshIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
        </span>
      </button>
      <button
        className="button is-text is-small has-no-drag"
        onClick={onAddFeed}
        aria-label={addFeedTooltip}
        title={addFeedTooltip}
        data-widget="add-feed"
      >
        <span className="icon">
          <AddIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
        </span>
      </button>
    </div>
  );
};
