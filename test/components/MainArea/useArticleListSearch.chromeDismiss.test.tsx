import { describe, expect, it, vi } from 'vitest';
import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { useArticleListSearch } from '@/components/MainArea/hooks/useArticleListSearch';
import { handleWindowChromeDragMouseDown } from '@/services/ui/windowChromeDragRegion';

vi.mock('@/services/shortcuts/shortcutService', () => ({
  isArticleListSearchShortcut: () => false,
  isCloseOnEscapeShortcut: () => false,
  keybindingService: {
    register: () => () => {},
  },
}));

const Probe = () => {
  const articleListRef = useRef<HTMLDivElement>(null);
  const search = useArticleListSearch({ articleListRef, totalFeeds: 1 });

  return (
    <div>
      <span data-testid="search-open">{String(search.isSearchOpen)}</span>
      <button type="button" onClick={search.handleToggleSearch}>
        toggle-search
      </button>
      <div
        data-testid="list-header"
        data-tauri-drag-region="deep"
        onMouseDown={(event) => handleWindowChromeDragMouseDown(event, { closeSearch: false })}
      >
        list header
      </div>
      <div
        data-testid="article-header"
        data-tauri-drag-region="deep"
        onMouseDown={(event) => handleWindowChromeDragMouseDown(event, { closeSearch: true })}
      >
        article header
      </div>
    </div>
  );
};

describe('useArticleListSearch chrome drag dismiss', () => {
  it('closes search from the article chrome bar and keeps it open from the list header', () => {
    render(<Probe />);
    fireEvent.click(screen.getByText('toggle-search'));
    expect(screen.getByTestId('search-open').textContent).toBe('true');

    fireEvent.mouseDown(screen.getByTestId('list-header'));
    expect(screen.getByTestId('search-open').textContent).toBe('true');

    fireEvent.mouseDown(screen.getByTestId('article-header'));
    expect(screen.getByTestId('search-open').textContent).toBe('false');
  });
});
