import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  convertYouTubeIframesInContainer,
  promoteYouTubeMediaAnchors,
} from '@/components/common/ArticleContent/mediaEmbedUtils';
import { preprocessArticleViewHtml } from '@/services/articles/articleViewPreprocessTask';
import * as cheerio from 'cheerio';

const fixtureDir = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, '../../../fixtures', name), 'utf8');
}

const CHIPS_BASE_URL = 'https://chipsandcheese.com/p/an-interview-with-intels-kira-boyko';

describe('convertYouTubeIframesInContainer', () => {
  it('converts substack youtube-nocookie iframes to lite-youtube in live DOM', () => {
    document.body.innerHTML = loadFixture('chipsAndCheeseYouTubeEmbed.html');

    const converted = convertYouTubeIframesInContainer(document.body, CHIPS_BASE_URL);

    expect(converted).toBe(true);
    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('_6wmFnY9NZ4');
  });
});

describe('promoteYouTubeMediaAnchors', () => {
  it('leaves regular youtube text links alone', () => {
    const $ = cheerio.load('<a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Watch on YouTube</a>');
    promoteYouTubeMediaAnchors($);

    expect($('a').length).toBe(1);
    expect($('lite-youtube').length).toBe(0);
  });
});

describe('preprocessArticleViewHtml YouTube media anchors', () => {
  const parseHtml = (html: string): Document => new DOMParser().parseFromString(html, 'text/html');

  it('converts chipsandcheese substack youtube iframe markup to lite-youtube', () => {
    const result = preprocessArticleViewHtml({
      html: loadFixture('chipsAndCheeseYouTubeEmbed.html'),
      baseUrl: CHIPS_BASE_URL,
    });
    const doc = parseHtml(result.html);

    expect(doc.querySelector('iframe')).toBeNull();
    expect(doc.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('_6wmFnY9NZ4');
  });

  it('converts youtube iframe embeds to lite-youtube', () => {
    const result = preprocessArticleViewHtml({
      html: '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
    });
    const doc = parseHtml(result.html);

    expect(doc.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('dQw4w9WgXcQ');
    expect(doc.querySelector('iframe')).toBeNull();
  });

  it('unwraps lite-youtube from surrounding youtube watch links', () => {
    const result = preprocessArticleViewHtml({
      html: `
        <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
          <lite-youtube videoid="dQw4w9WgXcQ" playlabel="Play YouTube video"></lite-youtube>
        </a>
      `,
    });
    const doc = parseHtml(result.html);

    expect(doc.querySelector('a')).toBeNull();
    expect(doc.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('dQw4w9WgXcQ');
  });

  it('promotes youtube thumbnail links to lite-youtube', () => {
    const result = preprocessArticleViewHtml({
      html: `
        <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">
          <img src="https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg" alt="Video">
        </a>
      `,
    });
    const doc = parseHtml(result.html);

    expect(doc.querySelector('a')).toBeNull();
    expect(doc.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('dQw4w9WgXcQ');
    expect(doc.querySelector('img')).toBeNull();
  });
});
