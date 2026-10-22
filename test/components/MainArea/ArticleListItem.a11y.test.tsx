import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ArticleListItem } from '@/components/MainArea/ArticleListItem';
import { ARTICLE_LIST_DENSITY_OPTIONS, type ArticleListDensity } from '@/lib/articleListDensity';
import type { Article } from '@/types/article';
import { findSeriousAxeViolations } from '../../helpers/axe';

const FAVICON = 'data:image/png;base64,iVBORw0KGgo=';

const makeArticle = (overrides: Partial<Article> = {}): Article => ({
  hash: 'hash-1',
  title: 'Rust 2026 ships',
  description: 'A description',
  content: '',
  link: 'https://example.com/a',
  fetchedDate: '2026-10-20T08:00:00.000Z',
  publishedDate: '2026-10-20T08:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  feedTitle: 'Example Feed',
  feedFavicon: FAVICON,
  read: false,
  starred: false,
  saved: false,
  previewImage: 'https://example.com/preview.jpg',
  ...overrides,
} as Article);

const DENSITIES = ARTICLE_LIST_DENSITY_OPTIONS.map((option) => option.value);

const renderRows = (density: ArticleListDensity, onSelect = vi.fn()) => render(
  <div role="listbox" aria-label="Articles">
    <ArticleListItem
      article={makeArticle()}
      isActive
      isNew={false}
      newAnimationOrder={-1}
      enableLayoutAnimation={false}
      density={density}
      posInSet={1}
      setSize={-1}
      isTabStop
      onSelect={onSelect}
      formatDateDisplay={() => 'Oct 20'}
    />
    <ArticleListItem
      article={makeArticle({ hash: 'hash-2', title: 'Second', read: true, previewImage: undefined })}
      isActive={false}
      isNew={false}
      newAnimationOrder={-1}
      enableLayoutAnimation={false}
      density={density}
      posInSet={2}
      setSize={-1}
      onSelect={onSelect}
      formatDateDisplay={() => 'Oct 20'}
    />
  </div>,
);

afterEach(cleanup);

describe('ArticleListItem accessibility', () => {
  it.each(DENSITIES)('has no serious axe violations in %s density', async (density) => {
    const { container } = renderRows(density);
    expect(await findSeriousAxeViolations(container)).toEqual([]);
  });

  it('exposes title, source, date and read state as one option name', () => {
    renderRows('comfortable');
    const unread = screen.getByRole('option', { name: 'Unread, Rust 2026 ships, Example Feed, Oct 20' });
    const read = screen.getByRole('option', { name: 'Second, Example Feed, Oct 20' });
    expect(unread.getAttribute('aria-selected')).toBe('true');
    expect(read.getAttribute('aria-selected')).toBe('false');
  });

  it('carries its list position and keeps a single Tab stop', () => {
    renderRows('compact');
    const [first, second] = screen.getAllByRole('option');
    expect(first.getAttribute('aria-posinset')).toBe('1');
    expect(second.getAttribute('aria-posinset')).toBe('2');
    expect(first.getAttribute('aria-setsize')).toBe('-1');
    expect(first.tabIndex).toBe(0);
    expect(second.tabIndex).toBe(-1);
  });

  it('opens the row with Enter', () => {
    const onSelect = vi.fn();
    renderRows('comfortable', onSelect);
    fireEvent.keyDown(screen.getAllByRole('option')[1], { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith('hash-2');
  });

  it('does not announce read state in Saved (no read state)', () => {
    render(
      <ArticleListItem
        article={makeArticle()}
        isActive={false}
        isNew={false}
        newAnimationOrder={-1}
        readStateMode="none"
        onSelect={vi.fn()}
        formatDateDisplay={() => ''}
      />,
    );
    expect(screen.getByRole('option').getAttribute('aria-label')).toMatch(/^Rust 2026 ships, Example Feed, today /);
  });
});
