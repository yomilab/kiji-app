import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const base = readFileSync(join(process.cwd(), 'src/styles/base.css'), 'utf8');
const theme = readFileSync(join(process.cwd(), 'src/styles/theme.css'), 'utf8');
const articleList = readFileSync(join(process.cwd(), 'src/components/MainArea/ArticleList.css'), 'utf8');

describe('keyboard focus ring contract', () => {
  it('no longer removes the outline for keyboard focus app-wide', () => {
    expect(base).not.toMatch(/:focus,\s*:focus-visible\s*\{\s*outline:\s*none;/);
  });

  it('draws an accent ring for keyboard focus, never on script-focused containers', () => {
    expect(theme).toMatch(/--focus-ring-color:\s*color-mix\(in srgb, var\(--system-accent-color\)/);
    expect(base).toMatch(/:where\(:focus-visible:not\(\[tabindex="-1"\]\)[^{]*\)\s*\{\s*outline: 2px solid var\(--focus-ring-color\);/);
  });

  it('rings article rows, sidebar rows and reader buttons that reset their own outline', () => {
    for (const selector of [
      '.smart-view-item:has(> .smart-view-content:focus-visible)',
      '.tag-item:has(> .tag-item-content:focus-visible)',
      '.feed-list-item:has(> .feed-list-item-content:focus-visible)',
      '.station-feed-item:has(> .station-feed-item-content:focus-visible)',
      '.article-view-back-button.button.is-text.is-small:focus-visible',
      '.notification-toast-action:focus-visible',
    ]) {
      expect(base).toContain(selector);
    }
    // After the row's own :focus rule, which would otherwise win.
    expect(articleList.indexOf('.article-list-item:focus-visible > .article-list-item-content {'))
      .toBeGreaterThan(articleList.indexOf('.article-list-item:focus .article-list-item-content {'));
    expect(articleList).toMatch(/\.article-list-item:focus-visible > \.article-list-item-content \{\s*outline: 2px solid var\(--focus-ring-color\);/);
  });
});
