import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ArchiveIcon from '@mui/icons-material/Archive';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import InventoryIcon from '@mui/icons-material/Inventory';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { DEFAULT_SMART_VIEW_DEFINITIONS, type SmartViewId } from '@/constants';
import { useFeedNavigation } from '@/contexts/FeedContext';
import { ButtonStack, type ButtonConfig } from '@/components/common/ButtonStack';
import { useSmartViewsPatchedMutation } from '@/hooks/useFeedLibraryMutation';
import { settingsManager } from '@/services/settings';
import { storage } from '@/services/storage/storageFactory';
import type { SmartViewSettings } from '@/services/settings/types';
import './SmartViews.css';

interface SmartView {
  id: SmartViewId;
  label: string;
  icon: React.ComponentType<{ sx?: { fontSize: string; fontWeight?: string } }>;
  emoji?: string;
}

const SMART_VIEW_ICONS: Record<SmartViewId, SmartView['icon']> = {
  saved: ArchiveIcon,
  unread: MarkEmailUnreadIcon,
  all: InventoryIcon,
};

const buildSmartViews = (
  smartViewSettings: SmartViewSettings[],
  emojis: Record<string, string>,
  previousViews: SmartView[] = []
): SmartView[] => {
  const previousViewsById = new Map(previousViews.map((view) => [view.id, view]));
  const definitionsById = new Map(DEFAULT_SMART_VIEW_DEFINITIONS.map((view) => [view.id, view]));

  return smartViewSettings
    .filter((view) => view.visible)
    .map((view) => {
      const previousView = previousViewsById.get(view.id);
      const nextEmoji = emojis[view.id];
      if (previousView && previousView.emoji === nextEmoji) {
        return previousView;
      }

      return {
        id: view.id,
        label: definitionsById.get(view.id)?.label ?? view.id,
        icon: SMART_VIEW_ICONS[view.id],
        emoji: nextEmoji,
      };
    });
};

interface SmartViewItemProps {
  view: SmartView;
  isSelected: boolean;
  onSelectView: (viewId: SmartViewId) => void;
  onOpenFeedEditView: (viewId: SmartViewId) => void;
}

const SmartViewItem = React.memo<SmartViewItemProps>(({
  view,
  isSelected,
  onSelectView,
  onOpenFeedEditView,
}) => {
  const Icon = view.icon;
  const buttons = useMemo<ButtonConfig[]>(() => [
    {
      id: 'edit',
      icon: EditOutlined,
      label: 'Edit view',
      onClick: (event: React.MouseEvent) => {
        event.stopPropagation();
        onOpenFeedEditView(view.id);
      },
    },
  ], [onOpenFeedEditView, view.id]);

  return (
    <li
      className={`smart-view-item ${isSelected ? 'is-selected' : ''}`}
      onClick={() => onSelectView(view.id)}
      data-section="smart-view-item"
      data-component="smart-view-item"
      data-action="select-smart-view"
      data-entity-id={view.id}
      data-smart-view-id={view.id}
    >
      <div className="smart-view-content">
        {view.emoji ? (
          <span className="smart-view-emoji">{view.emoji}</span>
        ) : (
          <span className="smart-view-icon">
            <Icon sx={{ fontSize: 'var(--smart-view-icon-size)', fontWeight: 'bold' }} />
          </span>
        )}
        <span className="smart-view-label" data-section="smart-view-name">
          {view.label}
        </span>
      </div>
      <ButtonStack
        buttons={buttons}
        direction="left"
        layoutMode="push"
        className="smart-view-buttons"
      />
    </li>
  );
});

export const SmartViews: React.FC = () => {
  const { selectedSmartView, selectSmartView, openFeedEditView } = useFeedNavigation();
  const [smartViews, setSmartViews] = useState<SmartView[]>([]);
  const smartViewsPatched = useSmartViewsPatchedMutation();
  const emojisRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const loadSmartViews = async () => {
      try {
        const [smartViewSettings, stored] = await Promise.all([
          settingsManager.getSmartViews(),
          storage.get('smart-views-emojis'),
        ]);
        const emojis: Record<string, string> = stored ? JSON.parse(stored) : {};
        emojisRef.current = emojis;
        setSmartViews((current) => buildSmartViews(smartViewSettings, emojis, current));
      } catch (error) {
        console.error('Error loading smart views:', error);
        setSmartViews(DEFAULT_SMART_VIEW_DEFINITIONS.map((view) => ({
          ...view,
          icon: SMART_VIEW_ICONS[view.id],
          emoji: emojisRef.current[view.id],
        })));
      }
    };

    void loadSmartViews();
  }, []);

  useEffect(() => {
    if (!smartViewsPatched) return;

    // Reuse existing row objects when order or visibility changes so unchanged
    // sidebar items keep their memoized render output.
    setSmartViews((current) => buildSmartViews(smartViewsPatched.smartViews, emojisRef.current, current));
  }, [smartViewsPatched]);

  const handleSmartViewClick = useCallback(async (viewId: SmartViewId) => {
    try {
      await selectSmartView(viewId);
    } catch (error) {
      console.error('Error selecting smart view:', error);
    }
  }, [selectSmartView]);

  const handleOpenFeedEditView = useCallback((viewId: SmartViewId) => {
    openFeedEditView({ kind: 'smart-view', id: viewId });
  }, [openFeedEditView]);

  return (
    <div className="smart-views" data-section="smart-views">
      <ul className="smart-views-list" data-section="smart-views-group">
        {smartViews.map((view) => (
          <SmartViewItem
            key={view.id}
            view={view}
            isSelected={selectedSmartView === view.id}
            onSelectView={handleSmartViewClick}
            onOpenFeedEditView={handleOpenFeedEditView}
          />
        ))}
      </ul>
    </div>
  );
};
