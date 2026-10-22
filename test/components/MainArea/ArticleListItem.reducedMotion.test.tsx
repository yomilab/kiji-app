import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Article } from '@/types/article';

// motion reads Reduce Motion once, on first use: switch it on before import.
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes('prefers-reduced-motion'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

import { ArticleListItem } from '@/components/MainArea/ArticleListItem';

const article = {
  hash: 'hash-new',
  title: 'Fresh',
  description: '',
  content: '',
  link: 'https://example.com/a',
  fetchedDate: '2026-10-22T08:00:00.000Z',
  publishedDate: '2026-10-22T08:00:00.000Z',
  feedId: 'feed-1',
  feedUrl: 'https://example.com/rss.xml',
  feedTitle: 'Example Feed',
  read: false,
  starred: false,
  saved: false,
} as Article;

afterEach(cleanup);

describe('Reduce Motion', () => {
  it('new rows appear in place instead of the staggered fade-in', () => {
    const { container } = render(
      <ArticleListItem
        article={article}
        isActive={false}
        isNew
        newAnimationOrder={3}
        enableLayoutAnimation={false}
        onSelect={vi.fn()}
        formatDateDisplay={() => ''}
      />,
    );
    const content = container.querySelector<HTMLElement>('.article-list-item-content')!;
    // Without Reduce Motion the row mounts at opacity 0.05 and fades up after a delay.
    expect(content.style.opacity).not.toBe('0.05');
  });

  it('the app shell honours the system setting for script and CSS animations', () => {
    const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
    expect(app).toMatch(/<MotionConfig reducedMotion="user">/);
    const base = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
    expect(base).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?transition-duration: 0\.01ms !important;/);
  });
});
