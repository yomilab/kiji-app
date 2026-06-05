import React, { useEffect, useRef, type RefObject } from 'react';
import { isCloseOnEscapeShortcut, keybindingService } from '@/services/shortcuts/shortcutService';
import './ArticleListSearchInput.css';

interface ArticleListSearchInputProps {
  isOpen: boolean;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  onClose: () => void;
  placeholder?: string;
  ignoredOutsideClickRef?: RefObject<HTMLElement>;
}

export const ArticleListSearchInput: React.FC<ArticleListSearchInputProps> = ({
  isOpen,
  searchQuery,
  onSearchChange,
  onClose,
  placeholder = 'Search articles...',
  ignoredOutsideClickRef,
}) => {
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearchInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSearchChange(e.target.value);
  };

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (searchContainerRef.current?.contains(target)) {
        return;
      }
      if (ignoredOutsideClickRef?.current?.contains(target)) {
        return;
      }

      onClose();
    };

    // Add small delay to prevent immediate close when opening
    const timeoutId = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [ignoredOutsideClickRef, isOpen, onClose]);

  // Handle Esc key
  useEffect(() => {
    if (!isOpen) return;

    return keybindingService.register({
      type: 'keydown',
      priority: 22,
      handler: (e: KeyboardEvent) => {
        if (isCloseOnEscapeShortcut(e)) {
          onClose();
        }
      },
    });
  }, [isOpen, onClose]);

  // Keep keyboard shortcuts available after search closes by releasing the
  // hidden input's focus before shortcut handlers see the next key sequence.
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      return;
    }

    if (document.activeElement === inputRef.current) {
      inputRef.current?.blur();
    }
  }, [isOpen]);

  return (
    <div
      ref={searchContainerRef}
      className={`article-list-search-input-container ${isOpen ? 'is-open' : ''}`}
    >
      <input
        ref={inputRef}
        type="text"
        className="article-list-search-input"
        placeholder={placeholder}
        value={searchQuery}
        onChange={handleSearchInput}
      />
    </div>
  );
};
