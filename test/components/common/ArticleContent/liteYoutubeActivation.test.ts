import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

import {
  activateLiteYoutubeInPlace,
  buildYouTubeInlineEmbedPageUrl,
  createYouTubePlaceholderElement,
  resolveArticleContentClick,
} from '@/components/common/ArticleContent/liteYoutubeActivation';
import { convertYouTubeIframesInContainer, unwrapEmbeddedMediaAnchors } from '@/components/common/ArticleContent/mediaEmbedUtils';
import {
  isYouTubeEmbedNavigationUrl,
  isYouTubeInlineEmbedPageUrl,
} from '@/utils/youtubeEmbed';

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const publicDir = join(fixtureDir, '../../../../public');
const CHIPS_BASE_URL = 'https://chipsandcheese.com/p/an-interview-with-intels-kira-boyko';

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, '../../../fixtures', name), 'utf8');
}

function finalizePreprocessedArticleContent(container: Element, baseUrl: string): void {
  unwrapEmbeddedMediaAnchors(container);
  convertYouTubeIframesInContainer(container, baseUrl);
}

describe('YouTube inline navigation policy', () => {
  it('detects direct youtube embed navigations that Tauri must allow in-webview', () => {
    expect(isYouTubeEmbedNavigationUrl('https://www.youtube-nocookie.com/embed/_6wmFnY9NZ4?autoplay=1')).toBe(true);
    expect(isYouTubeEmbedNavigationUrl('https://www.youtube.com/embed/_6wmFnY9NZ4?enablejsapi=1')).toBe(true);
    expect(isYouTubeEmbedNavigationUrl('https://www.youtube.com/watch?v=_6wmFnY9NZ4')).toBe(false);
  });

  it('builds same-origin inline embed shell urls instead of direct youtube iframe src', () => {
    const url = buildYouTubeInlineEmbedPageUrl('_6wmFnY9NZ4', {
      origin: 'https://tauri.localhost',
      startSeconds: 30,
    });

    expect(url).toBe('https://tauri.localhost/youtube-embed.html?v=_6wmFnY9NZ4&autoplay=1&start=30');
    expect(isYouTubeInlineEmbedPageUrl(url)).toBe(true);
    expect(isYouTubeEmbedNavigationUrl(url)).toBe(false);
  });
});

describe('resolveArticleContentClick', () => {
  it('treats lite-youtube clicks as embedded media', () => {
    document.body.innerHTML = `
      <lite-youtube videoid="abc123" playlabel="Play YouTube video">
        <button type="button">Play</button>
      </lite-youtube>
    `;

    const button = document.querySelector('button') as HTMLButtonElement;
    expect(resolveArticleContentClick(button)).toEqual({ type: 'embedded-media' });
  });

  it('treats iframe clicks as embedded media', () => {
    document.body.innerHTML = `
      <iframe src="https://www.youtube-nocookie.com/embed/abc123"></iframe>
    `;

    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    expect(resolveArticleContentClick(iframe)).toEqual({ type: 'embedded-media' });
  });

  it('promotes youtube watch links to inline player actions', () => {
    document.body.innerHTML = `
      <a href="https://www.youtube.com/watch?v=abc123">
        <img src="https://i.ytimg.com/vi/abc123/hqdefault.jpg" alt="Video">
      </a>
    `;

    const image = document.querySelector('img') as HTMLImageElement;
    const result = resolveArticleContentClick(image);
    expect(result.type).toBe('youtube-anchor');
    if (result.type === 'youtube-anchor') {
      expect(result.target.videoId).toBe('abc123');
    }
  });

  it('routes regular links through article-link-click', () => {
    document.body.innerHTML = '<a href="https://example.com/article">Read more</a>';

    const link = document.querySelector('a') as HTMLAnchorElement;
    const result = resolveArticleContentClick(link);
    expect(result.type).toBe('link');
    if (result.type === 'link') {
      expect(result.href).toContain('example.com/article');
    }
  });

  it('classifies chipsandcheese substack iframe markup as embedded media', () => {
    document.body.innerHTML = loadFixture('chipsAndCheeseYouTubeEmbed.html');
    const iframe = document.querySelector('.youtube-wrap iframe') as HTMLIFrameElement;

    expect(iframe).toBeTruthy();
    expect(resolveArticleContentClick(iframe).type).toBe('embedded-media');
  });
});

describe('activateLiteYoutubeInPlace', () => {
  it('loads the bundled youtube-embed shell for the Intel article video id', () => {
    document.body.innerHTML = `
      <lite-youtube videoid="_6wmFnY9NZ4" playlabel="Play YouTube video">
        <button type="button" class="lyt-playbtn">Play</button>
      </lite-youtube>
    `;

    const element = document.querySelector('lite-youtube') as HTMLElement;
    expect(activateLiteYoutubeInPlace(element)).toBe(true);

    const iframe = element.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.src).toContain('/youtube-embed.html?v=_6wmFnY9NZ4');
    expect(iframe.src).not.toContain('youtube-nocookie.com/embed');
    expect(iframe.src).not.toContain('enablejsapi=1');
    expect(iframe.referrerPolicy).toBe('strict-origin-when-cross-origin');
    expect(element.querySelector('.lyt-playbtn')).toBeNull();
  });

  it('is idempotent after first activation', () => {
    document.body.innerHTML = '<lite-youtube videoid="abc123"></lite-youtube>';
    const element = document.querySelector('lite-youtube') as HTMLElement;

    expect(activateLiteYoutubeInPlace(element)).toBe(true);
    expect(activateLiteYoutubeInPlace(element)).toBe(false);
    expect(element.querySelectorAll('iframe')).toHaveLength(1);
  });
});

describe('article-content capture click guard', () => {
  it('prevents lite-youtube default handler and mounts the inline shell iframe', () => {
    document.body.innerHTML = `
      <div id="host">
        <lite-youtube videoid="_6wmFnY9NZ4">
          <button type="button" class="lyt-playbtn">Play</button>
        </lite-youtube>
      </div>
    `;

    const host = document.getElementById('host') as HTMLElement;
    const liteYoutube = host.querySelector('lite-youtube') as HTMLElement;
    const defaultHandler = vi.fn();
    liteYoutube.addEventListener('click', defaultHandler);

    host.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('lite-youtube')) {
        event.preventDefault();
        event.stopPropagation();
        activateLiteYoutubeInPlace(liteYoutube);
      }
    }, true);

    liteYoutube.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(defaultHandler).not.toHaveBeenCalled();
    expect(liteYoutube.querySelector('iframe')?.getAttribute('src')).toContain('/youtube-embed.html?v=_6wmFnY9NZ4');
  });
});

describe('preprocessed article YouTube inline flow', () => {
  it('converts substack iframe markup before click handling', () => {
    document.body.innerHTML = loadFixture('chipsAndCheeseYouTubeEmbed.html');
    finalizePreprocessedArticleContent(document.body, CHIPS_BASE_URL);

    expect(document.querySelector('iframe')).toBeNull();
    expect(document.querySelector('lite-youtube')?.getAttribute('videoid')).toBe('_6wmFnY9NZ4');
  });

  it('does not route converted lite-youtube clicks to external link handlers', () => {
    document.body.innerHTML = loadFixture('chipsAndCheeseYouTubeEmbed.html');
    finalizePreprocessedArticleContent(document.body, CHIPS_BASE_URL);

    const liteYoutube = document.querySelector('lite-youtube') as HTMLElement;
    const externalLinkHandler = vi.fn();

    const clickResult = resolveArticleContentClick(liteYoutube);
    if (clickResult.type === 'link') {
      externalLinkHandler(clickResult.href);
    }

    expect(clickResult.type).toBe('embedded-media');
    expect(externalLinkHandler).not.toHaveBeenCalled();
  });

  it('mounts inline playback target for thumbnail-only watch links', () => {
    document.body.innerHTML = `
      <a href="https://www.youtube.com/watch?v=_6wmFnY9NZ4">
        <img src="https://i.ytimg.com/vi/_6wmFnY9NZ4/hqdefault.jpg" alt="Video">
      </a>
    `;
    finalizePreprocessedArticleContent(document.body, CHIPS_BASE_URL);

    const image = document.querySelector('img') as HTMLImageElement;
    const clickResult = resolveArticleContentClick(image);

    expect(clickResult.type).toBe('youtube-anchor');
    if (clickResult.type === 'youtube-anchor') {
      expect(clickResult.target.videoId).toBe('_6wmFnY9NZ4');
    }
  });

  it('uses inline shell urls after iframe conversion for substack markup', () => {
    document.body.innerHTML = loadFixture('chipsAndCheeseYouTubeEmbed.html');
    convertYouTubeIframesInContainer(document.body, CHIPS_BASE_URL);

    const liteYoutube = document.querySelector('lite-youtube') as HTMLElement;
    expect(liteYoutube?.getAttribute('videoid')).toBe('_6wmFnY9NZ4');
    expect(resolveArticleContentClick(liteYoutube).type).toBe('embedded-media');

    activateLiteYoutubeInPlace(liteYoutube);
    expect(liteYoutube.querySelector('iframe')?.src).toContain('/youtube-embed.html?v=_6wmFnY9NZ4');
  });
});

describe('createYouTubePlaceholderElement', () => {
  it('adds poster and play button without lite-yt-embed.js', () => {
    const element = createYouTubePlaceholderElement({ videoId: 'abc123', title: 'Demo' });

    expect(element.getAttribute('videoid')).toBe('abc123');
    expect(element.querySelector('.lyt-playbtn')).toBeTruthy();
    expect(element.style.backgroundImage).toContain('i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('youtube-embed shell page', () => {
  it('creates a nocookie player iframe from the video id query param', () => {
    const html = readFileSync(join(publicDir, 'youtube-embed.html'), 'utf8');
    expect(html).toContain('youtube-nocookie.com/embed/');
    expect(html).toContain("params.get('v')");
    expect(html).toContain('referrerPolicy');
  });
});
