import { buildYouTubeLiteParams, extractYouTubeEmbedTarget, type YouTubeEmbedTarget } from '@/utils/youtubeEmbed';

const EMBEDDED_MEDIA_SELECTOR = 'lite-youtube, iframe, video, audio, feed-audio-player, embed, object';
const YOUTUBE_INLINE_EMBED_PAGE = '/youtube-embed.html';
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,}$/;

export type ArticleContentClickResult =
  | { type: 'embedded-media' }
  | { type: 'youtube-anchor'; target: YouTubeEmbedTarget; link: HTMLAnchorElement }
  | { type: 'link'; href: string; link: HTMLAnchorElement }
  | { type: 'none' };

export function resolveArticleContentClick(target: HTMLElement): ArticleContentClickResult {
  if (target.closest(EMBEDDED_MEDIA_SELECTOR)) {
    return { type: 'embedded-media' };
  }

  const link = target.closest('a') as HTMLAnchorElement | null;
  if (!link?.href) {
    return { type: 'none' };
  }

  const youtubeTarget = extractYouTubeEmbedTarget(link.href);
  if (youtubeTarget) {
    return { type: 'youtube-anchor', target: youtubeTarget, link };
  }

  return { type: 'link', href: link.href, link };
}

function youtubePosterUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function buildYouTubeInlineEmbedPageUrl(
  videoId: string,
  options?: { startSeconds?: number; origin?: string },
): string {
  const origin = options?.origin
    ?? (typeof window !== 'undefined' ? window.location.origin : 'https://tauri.localhost');
  const params = new URLSearchParams({
    v: videoId,
    autoplay: '1',
  });

  if (options?.startSeconds && options.startSeconds > 0) {
    params.set('start', String(options.startSeconds));
  }

  return `${origin}${YOUTUBE_INLINE_EMBED_PAGE}?${params.toString()}`;
}

/** Poster + play button only — CSS from lite-yt-embed.css, no lite-yt-embed.js listeners. */
export function decorateYouTubePlaceholder(element: HTMLElement): void {
  const videoId = element.getAttribute('videoid')?.trim();
  if (!videoId) {
    return;
  }

  if (!element.style.backgroundImage) {
    element.style.backgroundImage = `url("${youtubePosterUrl(videoId)}")`;
  }

  if (element.querySelector('.lyt-playbtn, .lty-playbtn')) {
    return;
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lyt-playbtn';

  const label = document.createElement('span');
  label.className = 'lyt-visually-hidden';
  label.textContent = element.getAttribute('playlabel') || 'Play YouTube video';
  button.appendChild(label);
  element.appendChild(button);
}

export function createYouTubePlaceholderElement(options: {
  videoId: string;
  title?: string | null;
  startSeconds?: number;
}): HTMLElement {
  const element = document.createElement('lite-youtube');
  element.setAttribute('videoid', options.videoId);
  element.setAttribute('playlabel', 'Play YouTube video');

  const title = options.title?.trim() || 'YouTube video';
  element.setAttribute('title', title);
  element.setAttribute('aria-label', title);

  const params = buildYouTubeLiteParams(options.startSeconds);
  if (params) {
    element.setAttribute('params', params);
  }

  decorateYouTubePlaceholder(element);
  return element;
}

export function finalizeYouTubePlaceholders(container: Element): void {
  container.querySelectorAll('lite-youtube:not(.lyt-activated)').forEach((node) => {
    decorateYouTubePlaceholder(node as HTMLElement);
  });
}

/**
 * Swap poster for the bundled same-origin embed shell (see public/youtube-embed.html).
 * Avoids Tauri window guards intercepting direct youtube iframe navigations.
 */
export function activateLiteYoutubeInPlace(element: HTMLElement): boolean {
  if (element.classList.contains('lyt-activated')) {
    return false;
  }

  const videoId = element.getAttribute('videoid')?.trim();
  if (!videoId || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
    return false;
  }

  element.classList.add('lyt-activated');
  element.querySelector('.lyt-playbtn, .lty-playbtn')?.remove();

  const startRaw = new URLSearchParams(element.getAttribute('params') || '').get('start');
  const startSeconds = startRaw ? Number(startRaw) : undefined;

  const iframe = document.createElement('iframe');
  iframe.src = buildYouTubeInlineEmbedPageUrl(videoId, {
    startSeconds: Number.isFinite(startSeconds) ? startSeconds : undefined,
  });
  iframe.title = element.getAttribute('title') || element.getAttribute('aria-label') || 'YouTube video';
  iframe.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen';
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = 'strict-origin-when-cross-origin';
  iframe.setAttribute('loading', 'lazy');

  element.appendChild(iframe);
  iframe.focus();
  return true;
}
