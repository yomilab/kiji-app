import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const articleView = readFileSync(join(process.cwd(), 'src/components/MainArea/ArticleView.css'), 'utf8');
const player = readFileSync(join(process.cwd(), 'src/components/common/AudioPlayer/FeedAudioPlayerElement.ts'), 'utf8');

describe('episode player width while the article loads', () => {
  it('fills the column inside the shrink-wrapping loading state', () => {
    // These two together collapse the section to the width of its content...
    expect(articleView).toMatch(/\.reader-loading \{[^}]*align-items: flex-start;/);
    expect(player).toMatch(/:host \{[^}]*container-type: inline-size;/);
    // ...so the section has to set its own width.
    expect(articleView).toMatch(/\.article-view-audio \{[^}]*width: 100%;/);
  });
});
