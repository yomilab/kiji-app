import * as cheerio from 'cheerio';
import Prism from 'prismjs';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-swift';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-markup-templating';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-kotlin';
import type {
  ArticleViewPreprocessTaskPayload,
  ArticleViewPreprocessTaskResult,
} from '@/services/tasks/helperTaskContracts';
import {
  getYouTubeEmbedInfo,
  normalizeIframeEmbedSrc,
  sanitizeIframeAllowValue,
} from '@/components/common/ArticleContent/mediaEmbedUtils';
import { staticResourceService } from '@/services/system/staticResourceService';
import { sanitizeArticleStylesWithCheerio } from '@/services/articles/articleStyleSanitizer';

const normalizeWorkerUrl = (value: string | null | undefined, baseUrl?: string): string | null => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = trimmed.startsWith('//') ? `https:${trimmed}` : trimmed;

  if (!baseUrl) {
    return candidate;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return candidate;
  }
};

const normalizeSrcset = (srcset: string, baseUrl?: string): string => srcset
  .split(',')
  .map((part) => {
    const trimmed = part.trim();
    if (!trimmed) return '';

    const parts = trimmed.split(/\s+/);
    const resolvedUrl = normalizeWorkerUrl(parts[0], baseUrl);
    const descriptor = parts.slice(1).join(' ');
    return descriptor ? `${resolvedUrl} ${descriptor}` : (resolvedUrl || '');
  })
  .filter(Boolean)
  .join(', ');

const detectCodeLanguage = (classCandidates: string): string => {
  const normalized = classCandidates.toLowerCase();

  if (normalized.includes('highlight-source-shell') || normalized.includes('language-shell') || normalized.includes('language-bash') || normalized.includes('language-terminal') || normalized.includes('language-sh')) return 'bash';
  if (normalized.includes('highlight-source-python') || normalized.includes('language-python') || normalized.includes('language-py')) return 'python';
  if (normalized.includes('highlight-source-typescript') || normalized.includes('language-typescript') || normalized.includes('language-ts')) return 'typescript';
  if (normalized.includes('highlight-source-tsx') || normalized.includes('language-tsx')) return 'tsx';
  if (normalized.includes('highlight-source-jsx') || normalized.includes('language-jsx')) return 'jsx';
  if (normalized.includes('highlight-source-javascript') || normalized.includes('language-javascript') || normalized.includes('language-js')) return 'javascript';
  if (normalized.includes('highlight-source-json') || normalized.includes('language-json')) return 'json';
  if (normalized.includes('highlight-source-sql') || normalized.includes('language-sql')) return 'sql';
  if (normalized.includes('highlight-source-yaml') || normalized.includes('language-yaml') || normalized.includes('language-yml')) return 'yaml';
  if (normalized.includes('highlight-text-html') || normalized.includes('language-html') || normalized.includes('language-markup')) return 'markup';
  if (normalized.includes('highlight-source-css') || normalized.includes('language-css')) return 'css';
  if (normalized.includes('highlight-source-markdown') || normalized.includes('language-markdown')) return 'markdown';
  if (normalized.includes('highlight-source-swift') || normalized.includes('language-swift')) return 'swift';
  if (normalized.includes('highlight-source-go') || normalized.includes('language-go')) return 'go';
  if (normalized.includes('highlight-source-rust') || normalized.includes('language-rust')) return 'rust';
  if (normalized.includes('highlight-source-c ') || (normalized.includes('language-c') && !normalized.includes('language-cpp') && !normalized.includes('language-c++'))) return 'c';
  if (normalized.includes('highlight-source-cpp') || normalized.includes('language-cpp') || normalized.includes('language-c++')) return 'cpp';
  if (normalized.includes('highlight-source-java') || normalized.includes('language-java')) return 'java';
  if (normalized.includes('highlight-source-ruby') || normalized.includes('language-ruby')) return 'ruby';
  if (normalized.includes('highlight-source-php') || normalized.includes('language-php')) return 'php';
  if (normalized.includes('highlight-source-kotlin') || normalized.includes('language-kotlin')) return 'kotlin';

  return 'none';
};

export const preprocessArticleViewHtml = (
  payload: ArticleViewPreprocessTaskPayload
): ArticleViewPreprocessTaskResult => {
  const $ = cheerio.load(payload.html);
  const baseUrl = payload.baseUrl;

  // Phase 2: re-apply style sanitization in preprocess output so the async
  // enhancement pass cannot reintroduce theme-breaking feed styles.
  sanitizeArticleStylesWithCheerio($);

  $('img[src]').each((_, element) => {
    const image = $(element);
    const src = image.attr('src');
    const originalSrc = image.attr('original-src');

    if (src) {
      if (originalSrc && src.includes('x-oss-process')) {
        image.attr('data-processed-src', src);
        image.attr('src', originalSrc);
      } else {
        image.attr('src', staticResourceService.cleanImageUrl(src));
      }
    }

    const normalizedSrc = normalizeWorkerUrl(image.attr('src'), baseUrl);
    if (normalizedSrc) {
      image.attr('src', normalizedSrc);
    }
  });

  $('img[srcset], source[srcset]').each((_, element) => {
    const current = $(element).attr('srcset');
    if (!current) return;
    $(element).attr('srcset', normalizeSrcset(current, baseUrl));
  });

  $('a[href], source[src], video[src], audio[src], iframe[src], embed[src], object[data], form[action]').each((_, element) => {
    const node = $(element);
    const attributeName = node.is('object') ? 'data' : (node.is('form') ? 'action' : 'src');
    const fallbackAttributeName = node.is('a') ? 'href' : attributeName;
    const current = node.attr(fallbackAttributeName);
    const normalized = normalizeWorkerUrl(current, baseUrl);
    if (normalized) {
      node.attr(fallbackAttributeName, normalized);
    }
  });

  $('video[poster]').each((_, element) => {
    const poster = $(element).attr('poster');
    const normalized = normalizeWorkerUrl(poster, baseUrl);
    if (normalized) {
      $(element).attr('poster', normalized);
    }
  });

  $('pre').each((_, element) => {
    const pre = $(element);
    let code = pre.children('code').first();

    if (code.length === 0) {
      const createdCode = $('<code></code>');
      createdCode.text(pre.text());
      pre.empty().append(createdCode);
      code = pre.children('code').first();
    } else {
      code.text(code.text());
    }

    const classCandidates = [
      code.attr('class') || '',
      pre.attr('class') || '',
      code.closest('[class*="highlight-source-"]').attr('class') || '',
    ].join(' ');
    const language = detectCodeLanguage(classCandidates);
    const normalizedLanguage = Prism.languages[language] ? language : 'none';
    const codeText = code.text();

    code.addClass(`language-${normalizedLanguage}`);
    pre.addClass(`language-${normalizedLanguage}`);

    if (normalizedLanguage !== 'none') {
      code.html(Prism.highlight(codeText, Prism.languages[normalizedLanguage], normalizedLanguage));
    } else {
      code.text(codeText);
    }
  });

  $('ul > li, ol > li').each((_, element) => {
    const item = $(element);
    const firstTag = item.children().first().prop('tagName');
    const startsWithImage = firstTag === 'IMG' || firstTag === 'PICTURE' || firstTag === 'FIGURE';
    const includesImage = item.find('img, picture, figure').length > 0;

    if (startsWithImage || includesImage) {
      item.addClass('no-list-marker');
    } else {
      item.removeClass('no-list-marker');
    }
  });

  $('video, audio').each((_, element) => {
    $(element).removeAttr('autoplay');
  });

  $('audio').each((_, element) => {
    const audio = $(element);
    const source = audio.attr('src') || audio.find('source').first().attr('src');
    if (!source) return;

    const player = $('<feed-audio-player></feed-audio-player>');
    player.attr('src', source);

    const title = audio.attr('title') || audio.attr('aria-label');
    if (title) {
      player.attr('title', title);
    }

    audio.replaceWith(player);
  });

  $('iframe').each((_, element) => {
    const iframe = $(element);
    const currentSrc = iframe.attr('src');
    if (!currentSrc) return;

    const sanitizedAllow = sanitizeIframeAllowValue(iframe.attr('allow') || null);
    if (sanitizedAllow) {
      iframe.attr('allow', sanitizedAllow);
    } else {
      iframe.removeAttr('allow');
    }

    iframe.attr('loading', 'lazy');

    const normalized = normalizeIframeEmbedSrc(currentSrc, baseUrl || 'https://localhost');
    if (!normalized.normalizedSrc) {
      const fallbackLink = $('<p><a target="_blank" rel="noopener noreferrer">Open embedded media in browser</a></p>');
      fallbackLink.find('a').attr('href', normalized.fallbackUrl || currentSrc);
      iframe.replaceWith(fallbackLink);
      return;
    }

    const ytEmbedInfo = getYouTubeEmbedInfo(normalized.normalizedSrc, baseUrl || 'https://localhost');
    if (ytEmbedInfo) {
      const liteYoutube = $('<lite-youtube playlabel="Play YouTube video"></lite-youtube>');
      liteYoutube.attr('videoid', ytEmbedInfo.videoId);

      const title = iframe.attr('title');
      if (title) {
        liteYoutube.attr('title', title);
        liteYoutube.attr('aria-label', title);
      } else {
        liteYoutube.attr('aria-label', 'YouTube video');
      }

      if (ytEmbedInfo.params) {
        liteYoutube.attr('params', ytEmbedInfo.params);
      }

      iframe.replaceWith(liteYoutube);
      return;
    }

    iframe.attr('src', normalized.normalizedSrc);
  });

  $('figure').each((_, element) => {
    const figure = $(element);
    if (figure.find('iframe, video, lite-youtube').length === 0) {
      return;
    }

    const style = [
      figure.attr('style'),
      'margin-left:0',
      'margin-right:0',
      'width:100%',
      'max-width:none',
      'box-sizing:border-box',
    ].filter(Boolean).join(';');

    figure.attr('style', style);
  });

  return {
    html: $('body').html() || $.root().html() || payload.html,
  };
};
