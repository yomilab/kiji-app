import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(process.cwd(), 'src/components/MainArea/ArticleList.css'), 'utf8');

const rule = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`Missing ${selector}`);
  return match[1];
};

describe('article list edge gutter contract', () => {
  it('defines a non-zero edge gutter and a column width that subtracts it on both sides', () => {
    const root = rule('.article-list');
    expect(root).toMatch(/--article-list-edge-gutter:\s*[1-9]\d*px;/);
    expect(root).toContain(
      '--article-list-column-width: calc(100% - var(--article-list-edge-gutter) * 2);',
    );
  });

  it('insets the header title and article rows from the list edges when narrow', () => {
    for (const selector of ['.article-list-title-content', '.article-list-item-content']) {
      const body = rule(selector);
      expect(body).toContain('width: var(--article-list-column-width);');
      expect(body).toContain('max-width: var(--max-article-width);');
      expect(body).not.toMatch(/(^|\s)width:\s*100%;/);
    }
  });
});
