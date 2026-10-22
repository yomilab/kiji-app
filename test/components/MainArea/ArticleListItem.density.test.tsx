import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ArticleListItem } from '@/components/MainArea/ArticleListItem';
import type { Article } from '@/types/article';

const FAVICON = 'data:image/png;base64,iVBORw0KGgo=';
const PREVIEW = 'https://example.com/preview.jpg';

const makeArticle = (overrides: Partial<Article> = {}): Article => ({
  hash: 'hash-1',
  title: 'A title',
  description: 'A description',
  content: '',
  link: 'https://example.com/a',
  fetchedDate: '2026-10-22T08:00:00.000Z',
  publishedDate: '2026-10-22T08:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  feedTitle: 'Example Feed',
  feedFavicon: FAVICON,
  read: false,
  starred: false,
  saved: false,
  previewImage: PREVIEW,
  ...overrides,
} as Article);

const renderItem = (props: Partial<Parameters<typeof ArticleListItem>[0]> = {}) => render(
  <ArticleListItem
    article={makeArticle()}
    isActive={false}
    isNew={false}
    newAnimationOrder={-1}
    enableLayoutAnimation={false}
    onSelect={vi.fn()}
    formatDateDisplay={() => ''}
    {...props}
  />,
);

/** Tag + class tree: pins Comfortable markup without depending on text or locale. */
const structure = (element: Element, depth = 0): string => {
  const line = `${'  '.repeat(depth)}${element.tagName.toLowerCase()}${element.getAttribute('class') ? `.${element.getAttribute('class')!.trim().split(/\s+/).join('.')}` : ''}`;
  return [line, ...[...element.children].map((child) => structure(child, depth + 1))].join('\n');
};

describe('ArticleListItem density', () => {
  it('keeps the Comfortable markup unchanged (default density)', () => {
    const { container } = renderItem();
    expect(structure(container.firstElementChild!)).toMatchInlineSnapshot(`
      "div.article-list-item.is-unread
        div.article-list-item-content
          div.article-list-item-source-wrapper
            div.article-list-item-source-left
              span.article-list-item-source-text
            span.article-list-item-date
          div.article-list-item-main
            div.article-list-item-text
              div.article-list-item-header
                span.article-list-favicon-container
                  img.article-list-favicon-img
                h3.article-list-item-title
              div.article-list-item-description
            div.article-list-item-preview-image.is-placeholder
              img.article-list-item-preview-image-content"
    `);
  });

  it('renders Compact as one line with favicon, title, source and time, and no preview image', () => {
    const { container } = renderItem({ density: 'compact', formatDateDisplay: () => 'yesterday' });
    const row = container.querySelector('.article-list-item')!;

    expect(row).toHaveClass('article-list-item--compact');
    expect(container.querySelector('.article-list-item-compact-row')).not.toBeNull();
    expect(container.querySelector('.article-list-item-description')).toBeNull();
    expect(container.querySelector('.article-list-item-preview-image')).toBeNull();
    // The only <img> is the inline favicon; nothing points at the preview URL.
    const images = [...container.querySelectorAll('img')];
    expect(images.map((image) => image.className)).toEqual(['article-list-favicon-img']);
    expect(container.innerHTML).not.toContain(PREVIEW);
    expect(row.textContent).toContain('A title');
    expect(row.textContent).toContain('Example Feed');
    expect(container.querySelector('.article-list-item-date')?.textContent).toBe('yesterday');
  });

  it('renders no <img> at all in Compact when the feed has no favicon', () => {
    const { container } = renderItem({
      density: 'compact',
      article: makeArticle({ feedFavicon: undefined }),
    });
    expect(container.querySelector('img')).toBeNull();
  });

  it('puts a large preview above the text in Large Images', () => {
    const { container } = renderItem({ density: 'large-images' });
    const content = container.querySelector('.article-list-item-content')!;

    expect(container.querySelector('.article-list-item')).toHaveClass('article-list-item--large-image');
    expect(content.firstElementChild).toHaveClass('article-list-item-preview-image', 'article-list-item-preview-image--large');
    expect(content.querySelector('.article-list-item-preview-image-content')).toHaveAttribute('src', PREVIEW);
    expect(content.querySelector('.article-list-item-main .article-list-item-preview-image')).toBeNull();
    expect(content.querySelector('.article-list-item-description')).not.toBeNull();
  });

  it('falls back to the Comfortable markup in Large Images when the row has no image', () => {
    const article = makeArticle({ previewImage: undefined });
    const comfortable = renderItem({ article });
    const comfortableStructure = structure(comfortable.container.firstElementChild!);
    comfortable.unmount();

    const { container } = renderItem({ article, density: 'large-images' });
    expect(container.querySelector('.article-list-item')).not.toHaveClass('article-list-item--large-image');
    expect(structure(container.firstElementChild!)).toBe(comfortableStructure);
  });

  it('re-renders a memoized row when only the density changes', () => {
    const article = makeArticle();
    const props = {
      article,
      isActive: false,
      isNew: false,
      newAnimationOrder: -1,
      enableLayoutAnimation: false,
      onSelect: vi.fn(),
      formatDateDisplay: () => '',
    };
    const { container, rerender } = render(<ArticleListItem {...props} density="comfortable" />);
    expect(container.querySelector('.article-list-item-preview-image')).not.toBeNull();

    rerender(<ArticleListItem {...props} density="compact" />);
    expect(container.querySelector('.article-list-item-preview-image')).toBeNull();
    expect(container.querySelector('.article-list-item--compact')).not.toBeNull();
  });
});
