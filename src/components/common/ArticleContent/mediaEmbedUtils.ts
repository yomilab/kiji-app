import type { CheerioAPI } from 'cheerio';
import { createYouTubePlaceholderElement } from './liteYoutubeActivation';
import { buildYouTubeLiteParams, extractYouTubeEmbedTarget, resolveYouTubeWatchUrl } from '@/utils/youtubeEmbed';

const ALLOWED_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'player.vimeo.com',
]);

const YOUTUBE_SOURCE_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtube-nocookie.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
]);

const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;
const SCHEME_PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const SCHEMELESS_IFRAME_HOSTS = new Set([
  ...ALLOWED_IFRAME_HOSTS,
  ...YOUTUBE_SOURCE_HOSTS,
]);

function normalizeIframeCandidate(rawSrc: string): string {
  const trimmed = rawSrc.trim();
  if (trimmed.startsWith('//')) {
    return `https:${trimmed}`;
  }

  if (
    !trimmed
    || trimmed.startsWith('/')
    || trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || trimmed.startsWith('#')
    || trimmed.startsWith('?')
    || SCHEME_PREFIX_PATTERN.test(trimmed)
  ) {
    return trimmed;
  }

  const hostCandidate = trimmed.split(/[/?#]/, 1)[0]?.toLowerCase();
  if (hostCandidate && SCHEMELESS_IFRAME_HOSTS.has(hostCandidate)) {
    return `https://${trimmed}`;
  }

  return trimmed;
}

export interface NormalizedIframeResult {
  normalizedSrc?: string;
  fallbackUrl?: string;
}

export interface YouTubeEmbedInfo {
  videoId: string;
  params: string;
}

function parseTimeToSeconds(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = trimmed.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const total = (hours * 3600) + (minutes * 60) + seconds;
  return total > 0 ? total : null;
}

function extractYouTubeVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split('/').filter(Boolean);

  let videoId: string | null = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = parts[0] ?? null;
  } else if (parts[0] === 'watch') {
    videoId = url.searchParams.get('v');
  } else if (parts[0] === 'embed' || parts[0] === 'shorts' || parts[0] === 'live' || parts[0] === 'v') {
    videoId = parts[1] ?? null;
  }

  if (!videoId) return null;
  return YOUTUBE_ID_PATTERN.test(videoId) ? videoId : null;
}

function toYouTubeEmbedUrl(url: URL): URL | null {
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_SOURCE_HOSTS.has(host)) {
    return null;
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return null;
  }

  const embedUrl = new URL(`https://www.youtube.com/embed/${videoId}`);
  const start = parseTimeToSeconds(url.searchParams.get('start'))
    ?? parseTimeToSeconds(url.searchParams.get('t'));

  if (start && start > 0) {
    embedUrl.searchParams.set('start', String(start));
  }

  embedUrl.searchParams.set('autoplay', '0');
  return embedUrl;
}

export function sanitizeIframeAllowValue(allowValue: string | null): string | null {
  if (!allowValue) return null;

  const tokens = allowValue
    .split(';')
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return null;
  }

  const deduped = Array.from(new Set(tokens));
  return deduped.join('; ');
}

export function normalizeIframeEmbedSrc(rawSrc: string, baseUrl: string): NormalizedIframeResult {
  const candidate = normalizeIframeCandidate(rawSrc);

  try {
    const parsed = new URL(candidate, baseUrl);
    const host = parsed.hostname.toLowerCase();

    const normalizedYoutube = toYouTubeEmbedUrl(parsed);
    if (normalizedYoutube) {
      return { normalizedSrc: normalizedYoutube.toString() };
    }

    if (!ALLOWED_IFRAME_HOSTS.has(host)) {
      return { fallbackUrl: parsed.toString() };
    }

    parsed.searchParams.set('autoplay', '0');
    parsed.searchParams.set('auto_play', '0');

    return { normalizedSrc: parsed.toString() };
  } catch {
    return { fallbackUrl: candidate };
  }
}

export function getYouTubeEmbedInfo(src: string, baseUrl: string): YouTubeEmbedInfo | null {
  try {
    const parsed = new URL(src, baseUrl);
    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split('/').filter(Boolean);

    if (!(host === 'www.youtube.com' || host === 'youtube.com' || host === 'www.youtube-nocookie.com' || host === 'youtube-nocookie.com')) {
      return null;
    }
    if (parts[0] !== 'embed' || !parts[1]) {
      return null;
    }
    if (!YOUTUBE_ID_PATTERN.test(parts[1])) {
      return null;
    }

    const params = new URLSearchParams(parsed.search);
    params.delete('autoplay');

    return {
      videoId: parts[1],
      params: params.toString(),
    };
  } catch {
    return null;
  }
}

export function promoteYouTubeMediaAnchors($: CheerioAPI): void {
  $('a').each((_, element) => {
    const anchor = $(element);
    const embeddedMedia = anchor.children('lite-youtube, iframe').first();
    if (
      embeddedMedia.length === 1
      && anchor.children().length === 1
      && anchor.text().trim() === ''
    ) {
      anchor.replaceWith(embeddedMedia);
    }
  });

  $('a[href]').each((_, element) => {
    const anchor = $(element);
    if (anchor.find('lite-youtube, iframe').length > 0) {
      return;
    }

    const href = anchor.attr('href');
    if (!href) {
      return;
    }

    const target = extractYouTubeEmbedTarget(href);
    if (!target) {
      return;
    }

    const hasThumbnail = anchor.find('img, picture').length > 0;
    const meaningfulText = anchor
      .clone()
      .children('img, picture, br, svg')
      .remove()
      .end()
      .text()
      .trim();

    if (!hasThumbnail && meaningfulText.length > 0) {
      return;
    }

    const liteYoutube = $('<lite-youtube playlabel="Play YouTube video"></lite-youtube>');
    liteYoutube.attr('videoid', target.videoId);
    liteYoutube.attr('aria-label', 'YouTube video');

    const params = buildYouTubeLiteParams(target.startSeconds);
    if (params) {
      liteYoutube.attr('params', params);
    }

    anchor.replaceWith(liteYoutube);
  });
}

function createLiteYoutubeElementFromIframe(
  videoId: string,
  params: string,
  sourceIframe: Element,
): HTMLElement {
  const startSeconds = (() => {
    if (!params) return undefined;
    const raw = new URLSearchParams(params).get('start');
    return raw ? Number(raw) : undefined;
  })();

  return createYouTubePlaceholderElement({
    videoId,
    title: sourceIframe.getAttribute('title') || sourceIframe.getAttribute('aria-label'),
    startSeconds: Number.isFinite(startSeconds) ? startSeconds : undefined,
  });
}

function createIframeFallbackLink(url: string): HTMLElement {
  const wrapper = document.createElement('p');
  const link = document.createElement('a');
  link.href = resolveYouTubeWatchUrl(url) ?? url;
  link.textContent = 'Open video in browser';
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  wrapper.appendChild(link);
  return wrapper;
}

export function convertYouTubeIframesInContainer(container: Element, baseUrl: string): boolean {
  let converted = false;

  Array.from(container.querySelectorAll('iframe')).forEach((iframeElement) => {
    const currentSrc = iframeElement.getAttribute('src');
    if (!currentSrc) {
      return;
    }

    const allowAttr = iframeElement.getAttribute('allow');
    const sanitizedAllow = sanitizeIframeAllowValue(allowAttr);
    if (sanitizedAllow) {
      iframeElement.setAttribute('allow', sanitizedAllow);
    } else {
      iframeElement.removeAttribute('allow');
    }

    iframeElement.setAttribute('loading', 'lazy');
    iframeElement.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

    const normalized = normalizeIframeEmbedSrc(currentSrc, baseUrl);
    if (!normalized.normalizedSrc) {
      iframeElement.replaceWith(createIframeFallbackLink(normalized.fallbackUrl ?? currentSrc));
      converted = true;
      return;
    }

    const ytEmbedInfo = getYouTubeEmbedInfo(normalized.normalizedSrc, baseUrl);
    if (ytEmbedInfo) {
      iframeElement.replaceWith(createLiteYoutubeElementFromIframe(
        ytEmbedInfo.videoId,
        ytEmbedInfo.params,
        iframeElement,
      ));
      converted = true;
      return;
    }

    iframeElement.setAttribute('src', normalized.normalizedSrc);
  });

  return converted;
}

export function unwrapEmbeddedMediaAnchors(container: Element): void {
  container.querySelectorAll('a').forEach((anchorElement) => {
    const anchor = anchorElement as HTMLAnchorElement;
    const embeddedMedia = anchor.querySelector(':scope > lite-youtube, :scope > iframe');
    if (
      !embeddedMedia
      || anchor.childElementCount !== 1
      || anchor.textContent?.trim()
    ) {
      return;
    }

    anchor.replaceWith(embeddedMedia);
  });
}
