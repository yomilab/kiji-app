import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const readSrc = (relativePath: string): string =>
  readFileSync(join(process.cwd(), relativePath), 'utf8');

describe('window chrome drag-region contract', () => {
  it('marks both list headers and the article chrome bar as deep drag regions', () => {
    const header = readSrc('src/components/MainArea/ArticleListHeaderSection.tsx');
    const shared = readSrc('src/components/MainArea/SharedArticleList.tsx');
    const articleView = readSrc('src/components/MainArea/ArticleView.tsx');

    expect(header).toContain('data-window-drag-region={WINDOW_DRAG_REGION_DEEP}');
    expect(shared).toContain('data-window-drag-region={WINDOW_DRAG_REGION_DEEP}');
    expect(articleView).toContain('data-window-drag-region={WINDOW_DRAG_REGION_DEEP}');
    expect(articleView).toContain("data-component=\"article-header-bar\"");
    expect(articleView).not.toMatch(/data-component="article-meta-header"[\s\S]{0,200}data-window-drag-region/);
  });

  it('opts widget and article-action clusters out of the drag walk', () => {
    const widgets = readSrc('src/components/MainArea/ArticleListWidgets.tsx');
    const articleView = readSrc('src/components/MainArea/ArticleView.tsx');

    expect(widgets).toContain('data-window-drag-region={WINDOW_DRAG_REGION_FALSE}');
    expect(articleView).toContain('data-window-drag-region={WINDOW_DRAG_REGION_FALSE}');
  });

  it('does not use CSS -webkit-app-region drag on the article chrome bar', () => {
    const css = readSrc('src/components/MainArea/ArticleView.css');
    const barBlock = css.match(/\.article-view-header-bar \{[\s\S]*?\n\}/);

    expect(barBlock?.[0]).toBeDefined();
    expect(barBlock?.[0]).not.toContain('-webkit-app-region: drag');
    expect(css).toMatch(/\.article-view-header-bar \{[\s\S]*?padding-left: 20px;/);
  });

  it('treats the list title section as non-selectable chrome', () => {
    const css = readSrc('src/components/MainArea/ArticleList.css');
    expect(css).toMatch(/\.article-list-title-section \{[\s\S]*?user-select: none;/);
  });
});
