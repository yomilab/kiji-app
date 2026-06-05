import { useCallback, useEffect, useState, type RefObject } from 'react';
import {
  isArticleListSearchShortcut,
  isCloseOnEscapeShortcut,
  keybindingService,
} from '@/services/shortcuts/shortcutService';

interface UseArticleListSearchOptions {
  articleListRef: RefObject<HTMLDivElement>;
  totalFeeds: number;
}

const ARTICLE_LIST_SEARCH_DEBOUNCE_MS = 500;

export const useArticleListSearch = ({
  articleListRef,
  totalFeeds,
}: UseArticleListSearchOptions) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, ARTICLE_LIST_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  const clearSearchText = useCallback(() => {
    setSearchQuery('');
    setDebouncedSearchQuery('');
  }, []);

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((previous) => {
      if (previous) {
        clearSearchText();
      }
      return !previous;
    });
  }, [clearSearchText]);

  const handleCloseSearch = useCallback(() => {
    setIsSearchOpen(false);
    clearSearchText();
  }, [clearSearchText]);

  // Cmd/Ctrl+F opens search, Esc closes and clears search filter.
  useEffect(() => {
    return keybindingService.register({
      type: 'keydown',
      priority: 18,
      handler: (event: KeyboardEvent) => {
        if (isArticleListSearchShortcut(event)) {
          event.preventDefault();
          if (totalFeeds === 0) return;

          setIsSearchOpen(true);

          requestAnimationFrame(() => {
            const input = articleListRef.current?.querySelector('.article-list-search-input') as HTMLInputElement | null;
            input?.focus();
            input?.select();
          });
          return;
        }

        if (isCloseOnEscapeShortcut(event) && isSearchOpen) {
          event.preventDefault();
          setIsSearchOpen(false);
          clearSearchText();
        }
      },
    });
  }, [isSearchOpen, totalFeeds, articleListRef, clearSearchText]);

  return {
    searchQuery,
    debouncedSearchQuery,
    isSearchOpen,
    handleSearchChange,
    handleToggleSearch,
    handleCloseSearch,
  };
};
