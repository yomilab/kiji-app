import React, { useCallback, useEffect, useRef, useState } from 'react';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import SearchIcon from '@mui/icons-material/Search';
import { useFeedCollectionActions, useFeedNavigation, useFeedUI } from '@/contexts/FeedContext';
import { canMarkSourceRead, type MarkReadOlderThanDays } from '@/services/articles/markReadScope';
import { TOOLTIPS } from '@/config/tooltips';
import { SHORTCUT_LABELS, withShortcutHint } from '@/services/shortcuts/shortcutService';
import { savedArticlesIOService } from '@/services/saved/savedArticlesIOService';
import { DropdownMenu } from '@/components/common/DropdownMenu/DropdownMenu';
import { useWindowChromeDragDismiss } from '@/hooks/useWindowChromeDragDismiss';
import { TAURI_DRAG_REGION_FALSE } from '@/services/ui/windowChromeDragRegion';
import './ArticleListWidgets.css';
import { shortcutKeyGroups } from '@/components/SettingsWindow/settingsControls';

interface ArticleListWidgetsProps {
  onToggleSearch: () => void;
  isSavedView?: boolean;
}

/** SF Symbols–style "checkmark.circle" (regular weight, currentColor). */
const MarkReadGlyph: React.FC = () => (
  <svg
    width="1em"
    height="1em"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    style={{ fontSize: 'var(--widget-button-icon-size)', flexShrink: 0 }}
  >
    <circle cx="12" cy="12" r="8.6" />
    <path d="M8.2 12.3l2.6 2.6 5-5.6" />
  </svg>
);

const MARK_READ_ITEMS: ReadonlyArray<{ id: string; label: string; olderThanDays?: MarkReadOlderThanDays; hint?: string }> = [
  { id: 'all', label: 'Mark All as Read', hint: SHORTCUT_LABELS.MARK_ALL_READ },
  { id: 'day', label: 'Mark Older Than a Day as Read', olderThanDays: 1 },
  { id: 'week', label: 'Mark Older Than a Week as Read', olderThanDays: 7 },
];

/** Menu-style shortcut text: "⌘⇧K" on macOS, "Ctrl+Shift+K" elsewhere. */
const formatMenuShortcut = (label: string): string => shortcutKeyGroups(label)
  .map((keys) => keys.join(keys.some((key) => /^[⌘⇧⌃⌥]$/.test(key)) ? '' : '+'))
  .join(' / ');

/** Mark All as Read / Older Than… for the list on screen (hidden in Saved and Read). */
const MarkReadMenu: React.FC = () => {
  const { selectedFeedId, selectedTag, selectedSmartView } = useFeedNavigation();
  const { markCurrentSourceRead } = useFeedCollectionActions();
  const containerRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);
  useWindowChromeDragDismiss(close);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      close();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [close, isOpen]);

  const source = selectedFeedId
    ? { type: 'feed' as const, feedId: selectedFeedId }
    : selectedTag
      ? { type: 'tag' as const, tagName: selectedTag }
      : selectedSmartView
        ? { type: 'smart' as const, viewType: selectedSmartView }
        : null;
  if (!canMarkSourceRead(source)) return null;

  return (
    <div ref={containerRef} className="article-list-widgets-menu">
      <button
        className="button is-text is-small article-view-action-button article-list-widget-button"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={TOOLTIPS.articleList.markRead}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={TOOLTIPS.articleList.markRead}
        data-widget="mark-read"
      >
        <MarkReadGlyph />
      </button>
      <DropdownMenu isOpen={isOpen} onRequestClose={close} className="article-list-mark-read-menu">
        {MARK_READ_ITEMS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="dropdown-menu-item article-list-mark-read-item"
            data-mark-read={item.id}
            onClick={(event) => {
              event.stopPropagation();
              close();
              void markCurrentSourceRead(item.olderThanDays ? { olderThanDays: item.olderThanDays } : undefined);
            }}
          >
            <span>{item.label}</span>
            {item.hint && <span className="article-list-mark-read-hint">{formatMenuShortcut(item.hint)}</span>}
          </button>
        ))}
      </DropdownMenu>
    </div>
  );
};

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

  useWindowChromeDragDismiss(closeMenu);

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
    <div
      className="article-list-widgets"
      data-section="article-list-widgets"
      data-tauri-drag-region={TAURI_DRAG_REGION_FALSE}
    >
      <div className="article-list-widgets-buttons has-no-drag">
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

        {!isSavedView && <MarkReadMenu />}

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
