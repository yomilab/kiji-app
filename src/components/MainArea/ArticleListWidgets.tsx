import React, { useCallback, useEffect, useRef, useState } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { useFeedUI } from '@/contexts/FeedContext';
import { TOOLTIPS } from '@/config/tooltips';
import { SHORTCUT_LABELS, withShortcutHint } from '@/services/shortcuts/shortcutService';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { DropdownMenu } from '@/components/common/DropdownMenu/DropdownMenu';
import './ArticleListWidgets.css';

interface ArticleListWidgetsProps {
  onToggleSearch: () => void;
  isSavedView?: boolean;
}

export const ArticleListWidgets: React.FC<ArticleListWidgetsProps> = ({
  onToggleSearch,
  isSavedView
}) => {
  const { totalFeeds } = useFeedUI();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const searchTooltip = totalFeeds === 0
    ? TOOLTIPS.articleList.searchDisabled
    : withShortcutHint(TOOLTIPS.articleList.search, SHORTCUT_LABELS.SEARCH_ARTICLES);

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

  const handleExport = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();
    await savedArticlesIOService.exportSavedArticles();
  }, [closeMenu]);

  const handleImportClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    closeMenu();
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await savedArticlesIOService.importSavedArticles(file);
      // Reset input
      e.target.value = '';
    }
  };

  return (
    <div className="article-list-widgets" data-section="article-list-widgets">
      <div className="article-list-widgets-buttons">
        <button
          className="button is-text is-small article-view-action-button article-list-search-button"
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          onClick={onToggleSearch}
          disabled={totalFeeds === 0}
          aria-label={searchTooltip}
          title={searchTooltip}
          data-widget="search"
        >
          <SearchIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
        </button>

        {isSavedView && (
          <div className="article-list-widgets-group">
            <input
              type="file"
              ref={fileInputRef}
              style={{ display: 'none' }}
              accept=".zip,.csv"
              onChange={handleFileChange}
            />
            <div ref={menuContainerRef} className="article-list-widgets-menu">
              <button
                className="button is-text is-small article-view-action-button article-list-widget-button"
                onClick={() => setIsMenuOpen((current) => !current)}
                aria-label="More saved article actions"
                title="More saved article actions"
                data-widget="saved-article-actions"
              >
                <MoreVertIcon sx={{ fontSize: 'var(--widget-button-icon-size)' }} />
              </button>
              <DropdownMenu isOpen={isMenuOpen} onRequestClose={closeMenu}>
                <button
                  className="dropdown-menu-item"
                  onClick={handleImportClick}
                >
                  Import articles
                </button>
                <button
                  className="dropdown-menu-item"
                  onClick={handleExport}
                >
                  Export articles
                </button>
              </DropdownMenu>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
