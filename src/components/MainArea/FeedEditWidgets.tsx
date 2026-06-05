import React, { useCallback, useEffect, useRef, useState } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { TOOLTIPS } from '@/config/tooltips';
import { SHORTCUT_LABELS, withShortcutHint } from '@/services/shortcuts/shortcutService';
import { DropdownMenu } from '@/components/common/DropdownMenu/DropdownMenu';
import { ArticleListSearchInput } from './ArticleListSearchInput';
import './FeedEditWidgets.css';

interface FeedEditWidgetsProps {
  onToggleSearch: () => void;
  isSearchOpen: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onCloseSearch: () => void;
  onExportAllFeeds: () => void;
  onImportFeeds: () => void;
  isSearchDisabled?: boolean;
  disabled?: boolean;
}

export const FeedEditWidgets: React.FC<FeedEditWidgetsProps> = ({
  onToggleSearch,
  isSearchOpen,
  searchQuery,
  onSearchChange,
  onCloseSearch,
  onExportAllFeeds,
  onImportFeeds,
  isSearchDisabled = false,
  disabled = false,
}) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const searchTooltip = isSearchDisabled
    ? TOOLTIPS.feedEdit.searchDisabled
    : withShortcutHint(TOOLTIPS.feedEdit.search, SHORTCUT_LABELS.SEARCH_ARTICLES);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!isMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuContainerRef.current?.contains(event.target as Node)) return;
      closeMenu();
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [closeMenu, isMenuOpen]);

  const menuItems = [
    {
      label: 'Export feeds',
      onClick: () => {
        closeMenu();
        onExportAllFeeds();
      },
    },
    {
      label: 'Import feeds',
      onClick: () => {
        closeMenu();
        onImportFeeds();
      },
    },
  ];

  return (
    <div className="feed-edit-widgets" data-section="feed-edit-widgets">
      <ArticleListSearchInput
        isOpen={isSearchOpen}
        searchQuery={searchQuery}
        onSearchChange={onSearchChange}
        onClose={onCloseSearch}
        placeholder="Search feeds..."
      />
      <div className="feed-edit-widgets-buttons has-no-drag">
        <button
          className="button is-text is-small article-view-action-button feed-edit-search-button"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={onToggleSearch}
          disabled={isSearchDisabled}
          aria-label={searchTooltip}
          title={searchTooltip}
          data-widget="search"
        >
          <SearchIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
        </button>
        <div ref={menuContainerRef} className="feed-edit-widgets-menu">
          <button
            className="button is-text is-small article-view-action-button feed-edit-widget-button"
            onClick={() => setIsMenuOpen((current) => !current)}
            disabled={disabled}
            aria-label={TOOLTIPS.feedEdit.moreActions}
            title={TOOLTIPS.feedEdit.moreActions}
            data-widget="feed-actions"
          >
            <MoreVertIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
          </button>
          <DropdownMenu isOpen={isMenuOpen} onRequestClose={closeMenu}>
            {menuItems.map((item) => (
              <button
                key={item.label}
                className="dropdown-menu-item"
                onClick={item.onClick}
              >
                {item.label}
              </button>
            ))}
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};
