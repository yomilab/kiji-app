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
import prismLightTheme from 'prismjs/themes/prism.css?raw';
import prismDarkTheme from 'prismjs/themes/prism-tomorrow.css?raw';
import liteYouTubeStyles from 'lite-youtube-embed/src/lite-yt-embed.css?raw';
import brokenImagePlaceholderSvg from '@/assets/icons/hide_image.svg?raw';
import { unwrapEmbeddedMediaAnchors, convertYouTubeIframesInContainer, repairNonImageMediaImages } from './mediaEmbedUtils';
import { classifyStandaloneMedia, collectLightboxImages, handleStandaloneMediaLoad } from './standaloneMediaLayout';
import {
  finalizeYouTubePlaceholders,
  resolveArticleContentClick,
  resolveLiteYoutubeWatchUrl,
} from './liteYoutubeActivation';
import '../AudioPlayer/FeedAudioPlayerElement';
import { findReadingAnchorElement } from './readingAnchor';

import { staticResourceService } from '@/services/system/staticResourceService';
import { wrapNonAsciiTextNodes } from '@/utils/nonAsciiTypography';

interface ArticleContentMetricsDetail {
  htmlChars: number;
  shadowElementCount: number;
  imageElementCount: number;
  mediaElementCount: number;
  linkElementCount: number;
  textChars: number;
}

// Normalize the bundled placeholder SVG once so every broken-image fallback
// inherits article text color without rebuilding or restyling the markup later.
const BROKEN_IMAGE_PLACEHOLDER_SVG = brokenImagePlaceholderSvg
  .replace(/<\?xml[\s\S]*?\?>/g, '')
  .replace(/<!DOCTYPE[\s\S]*?>/g, '')
  .replace(/fill="[^"]*"/g, 'fill="currentColor"')
  .replace(/<svg\b/, '<svg aria-hidden="true" focusable="false"')
  .trim();

/**
 * ArticleContentElement - Web Component with Shadow DOM for CSS isolation
 *
 * Provides true CSS boundary between article HTML content and app-level global styles.
 * Theme variables are inherited from parent via :host selector.
 */
class ArticleContentElement extends HTMLElement {
  private root: ShadowRoot;
  private lastContent = '';
  private prismThemeStyle: HTMLStyleElement;
  private themeObserver?: MutationObserver;
  private mediaEnhancementTimer: number | null = null;
  private mediaEnhancementToken = 0;

  constructor() {
    super();

    // Create closed shadow root for CSS isolation
    this.root = this.attachShadow({ mode: 'closed' });

    // Inject article-specific styles into shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      /* Article-content namespace variables resolved from app theme tokens. */
      :host {
        --ac-font-family: var(--article-content-font-family, var(--font-family-article-content, system-ui, -apple-system, 'PingFang SC', sans-serif));
        --ac-title-font-family: var(--ac-font-family);
        --ac-non-ascii-font-family: var(--font-family-article-no-ascii, var(--ac-font-family));
        --ac-text-color: var(--article-content-text-color, var(--theme-article-content-color, #2c3e50));
        --ac-accent-color: var(--article-content-accent-color, var(--system-accent-color, #3273dc));
        --ac-text-primary: var(--article-content-text-primary, var(--theme-text-primary, #363636));
        --ac-text-secondary: var(--article-content-text-secondary, var(--theme-text-secondary, #7a7a7a));
        --ac-code-bg-inline: var(--article-content-code-bg-inline, rgba(31, 36, 43, 0.1));
        --ac-code-bg-strong: var(--article-content-code-bg-strong, #1f242b);
        --ac-code-fg-strong: var(--article-content-code-fg-strong, #e8edf2);
      }

      .article-content-container {
        font-size: inherit;
        font-weight: var(--article-content-font-weight, 500);
        line-height: var(--article-content-line-height, 1.8);
        letter-spacing: var(--article-content-letter-spacing, 0em);
        word-spacing: var(--article-content-word-spacing, 0em);
        text-align: var(--article-content-text-align, left);
        color: var(--ac-text-color);
        font-family: var(--ac-font-family);
        max-width: 100%;
        margin: 0 auto;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
        text-rendering: optimizeLegibility;
      }

      .article-content-container p {
        margin: 0 0 1.25em 0;
      }

      .article-content-container h1,
      .article-content-container h2,
      .article-content-container h3,
      .article-content-container h4,
      .article-content-container h5,
      .article-content-container h6 {
        font-family: var(--ac-title-font-family);
      }

      .article-content-container h2,
      .article-content-container h3,
      .article-content-container h4 {
        margin: 1.5em 0 0.5em 0;
        line-height: 1.3;
      }

      .article-content-container h2 {
        letter-spacing: -0.02em;
        font-weight: 700;
      }

      .article-text-non-ascii {
        font-family: var(--ac-non-ascii-font-family);
      }

      .article-content-container img {
        max-width: 100%;
        height: auto;
        margin: 1.5em 0;
        border-radius: 8px;
      }

      .article-content-container figure:has(> img:only-child):not(.ac-media-bleed, .ac-media-natural, .ac-media-portrait),
      .article-content-container figure:has(> picture:only-child):not(.ac-media-bleed, .ac-media-natural, .ac-media-portrait),
      .article-content-container figure:has(> video:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> audio:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> feed-audio-player:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> iframe:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> lite-youtube:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> embed:only-child):not(.ac-media-bleed),
      .article-content-container figure:has(> object:only-child):not(.ac-media-bleed) {
        margin-left: 0 !important;
        margin-right: 0 !important;
        width: 100% !important;
        max-width: none !important;
      }

      .article-content-container figure:has(> img:only-child):not(.ac-media-bleed, .ac-media-natural, .ac-media-portrait) > img,
      .article-content-container figure:has(> picture:only-child):not(.ac-media-bleed, .ac-media-natural, .ac-media-portrait) > picture,
      .article-content-container figure:has(> video:only-child):not(.ac-media-bleed) > video,
      .article-content-container figure:has(> audio:only-child):not(.ac-media-bleed) > audio,
      .article-content-container figure:has(> feed-audio-player:only-child):not(.ac-media-bleed) > feed-audio-player,
      .article-content-container figure:has(> iframe:only-child):not(.ac-media-bleed) > iframe,
      .article-content-container figure:has(> lite-youtube:only-child):not(.ac-media-bleed) > lite-youtube,
      .article-content-container figure:has(> embed:only-child):not(.ac-media-bleed) > embed,
      .article-content-container figure:has(> object:only-child):not(.ac-media-bleed) > object {
        display: block;
        width: 100% !important;
        max-width: none !important;
        box-sizing: border-box;
      }

      /* Standalone images (own line): at least column width, growing up to the
         natural width and at most --article-media-bleed past each column edge.
         The host computes the bleed from the scroll width so a narrow window
         keeps an edge gap. Margins use the same % basis as width to stay centered. */
      .article-content-container .ac-media-bleed {
        --ac-bleed: var(--article-media-bleed, 0px);
        --ac-media-width: clamp(100%, var(--ac-natural-width, 100vw), calc(100% + 2 * var(--ac-bleed)));
        display: block;
        width: var(--ac-media-width) !important;
        max-width: none !important;
        height: auto;
        margin: 2em calc((100% - var(--ac-media-width)) / 2) !important;
        padding: 0 !important;
        box-sizing: border-box;
        text-align: left;
      }

      .article-content-container .ac-media-bleed img,
      .article-content-container .ac-media-bleed picture,
      .article-content-container .ac-media-bleed a {
        display: block;
        width: 100% !important;
        max-width: none !important;
        height: auto !important;
        margin: 0 !important;
      }

      .article-content-container .ac-media-bleed :is(iframe, video, lite-youtube) {
        margin: 0 !important;
      }

      /* Image-only blocks with 2+ images: bleed-width grid; crop to tidy cells
         (the lightbox shows each image uncropped). */
      .article-content-container .ac-media-gallery {
        --ac-bleed: var(--article-media-bleed, 0px);
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr));
        gap: 6px;
        width: calc(100% + 2 * var(--ac-bleed)) !important;
        max-width: none !important;
        margin: 2em calc(-1 * var(--ac-bleed)) !important;
        padding: 0 !important;
        box-sizing: border-box;
      }

      .article-content-container .ac-media-gallery > :not(figcaption) {
        display: block;
        min-width: 0;
        margin: 0 !important;
        width: auto !important;
        max-width: none !important;
      }

      .article-content-container .ac-media-gallery img {
        display: block;
        width: 100% !important;
        max-width: none !important;
        height: 100% !important;
        aspect-ratio: 3 / 2;
        object-fit: cover;
        margin: 0 !important;
        border-radius: 6px;
      }

      .article-content-container .ac-media-gallery > figcaption {
        grid-column: 1 / -1;
        padding-inline: var(--ac-bleed);
        margin: 0.4em 0 0;
        font-size: 0.82em;
        line-height: 1.45;
        text-align: center;
        color: var(--ac-text-secondary);
      }

      /* Top-level tables / code: widen into the bleed only as far as content needs,
         centered on the column. */
      .article-content-container > .ac-block-wide {
        box-sizing: border-box;
        width: max-content;
        min-width: 100%;
        max-width: calc(100% + 2 * var(--article-media-bleed, 0px));
        margin-left: 50%;
        transform: translateX(-50%);
      }

      .article-content-container > p.ac-lead {
        font-size: 1.12em;
        line-height: 1.6;
        color: var(--ac-text-primary);
      }

      /* Loading placeholder + fade-in for laid-out images. */
      .article-content-container img.ac-img-pending {
        background-color: color-mix(in srgb, var(--ac-text-color) 7%, transparent);
        min-height: 6em;
      }

      .article-content-container img.ac-img-pending:not([width]):not([height]) {
        aspect-ratio: 16 / 9;
      }

      .article-content-container .ac-media-gallery img.ac-img-pending:not([width]):not([height]) {
        aspect-ratio: 3 / 2;
      }

      .article-content-container img.ac-img-reveal {
        animation: ac-img-fade-in 0.28s ease-out;
      }

      @keyframes ac-img-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @media (prefers-reduced-motion: reduce) {
        .article-content-container img.ac-img-reveal { animation: none; }
      }

      /* Unlinked laid-out images open in the lightbox. */
      .article-content-container .ac-media-bleed img:not(a img),
      .article-content-container img.ac-media-bleed,
      .article-content-container .ac-media-natural img:not(a img),
      .article-content-container img.ac-media-natural,
      .article-content-container .ac-media-portrait img:not(a img),
      .article-content-container img.ac-media-portrait,
      .article-content-container .ac-media-gallery img:not(a img) {
        cursor: zoom-in;
      }

      .article-content-container .ac-media-natural,
      .article-content-container .ac-media-portrait {
        display: block;
        max-width: 100% !important;
        margin: 2em auto !important;
        text-align: center;
      }

      .article-content-container .ac-media-natural img,
      .article-content-container .ac-media-portrait img {
        display: block;
        max-width: 100%;
        height: auto;
        margin: 0 auto !important;
      }

      /* Tall images: never widened; capped by viewport height instead. */
      .article-content-container img.ac-media-portrait,
      .article-content-container .ac-media-portrait img {
        width: auto !important;
        max-height: 80vh;
        height: auto !important;
      }

      .article-content-container .ac-media-bleed > figcaption {
        padding-inline: var(--ac-bleed);
      }

      .article-content-container .ac-media-bleed > figcaption,
      .article-content-container .ac-media-natural > figcaption,
      .article-content-container .ac-media-portrait > figcaption {
        margin: 0.75em 0 0;
        font-size: 0.82em;
        line-height: 1.45;
        text-align: center;
        color: var(--ac-text-secondary);
      }

      .article-content-broken-image {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        padding: 0.5em 0;
        margin: 1.5em 0;
        border-radius: 8px;
        color: var(--ac-text-color);
      }

      .article-content-broken-image svg {
        width: 64px;
        height: 64px;
        fill: currentColor;
      }

      .article-content-container iframe,
      .article-content-container video {
        display: block;
        width: 100% !important;
        max-width: none !important;
        aspect-ratio: 16 / 9;
        margin: 1.5em 0;
        border: 0;
        border-radius: 8px;
        box-sizing: border-box;
      }

      .article-content-container lite-youtube {
        display: block;
        width: 100% !important;
        max-width: none !important;
        height: auto;
        aspect-ratio: auto;
        margin: 1.5em 0;
        border: 0;
        border-radius: 8px;
        overflow: hidden;
        box-sizing: border-box;
      }

      .article-content-container audio,
      .article-content-container feed-audio-player {
        width: 100%;
        margin: 1.5em 0;
      }

      .article-content-container lite-youtube::before {
        border-radius: 8px 8px 0 0;
      }

      .article-content-container lite-youtube::after {
        /* Keep a stable 16:9 block and avoid host-level aspect-ratio conflicts. */
        padding-bottom: 56.25%;
      }

      .article-content-container lite-youtube {
        cursor: pointer;
      }

      .article-content-container lite-youtube .lyt-external-hint {
        position: absolute;
        right: 12px;
        bottom: 12px;
        z-index: 2;
        padding: 4px 10px;
        border-radius: 999px;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 12px;
        font-weight: 500;
        line-height: 1.4;
        color: #fff;
        background-color: rgba(0, 0, 0, 0.6);
        pointer-events: none;
      }

      .article-content-container lite-youtube > iframe {
        margin: 0;
        width: 100%;
        height: 100%;
        aspect-ratio: auto;
        border-radius: 0;
      }

      .article-content-container a {
        color: var(--ac-accent-color) !important;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .article-content-container a:hover {
        text-decoration-thickness: 2px;
      }

      .article-content-container blockquote {
        margin: 1.5em 0;
        padding: 0.5em 0 0.5em 0.75em;
        border-left: 3px solid var(--ac-accent-color);
        color: var(--ac-text-secondary);
        font-style: italic;
        font-size: 0.92em;
        line-height: 1.45;
      }

      .article-content-container blockquote > * {
        max-width: 100%;
        min-width: 0;
      }

      .article-content-container blockquote > p:last-child {
        margin-bottom: 0;
      }

      .article-content-container table {
        border-collapse: collapse;
        display: block;
        overflow-x: auto;
      }

      .article-content-container td,
      .article-content-container th {
        padding: 0.35em 0.6em;
        vertical-align: top;
      }

      .article-content-container blockquote pre,
      .article-content-container blockquote table {
        max-width: 100%;
        overflow-x: auto;
      }

      .article-content-container blockquote code {
        overflow-wrap: anywhere;
        word-break: break-word;
      }

      .article-content-container code {
        background-color: var(--ac-code-bg-inline);
        color: var(--ac-text-primary);
        padding: 0.1em 0.35em;
        border-radius: 4px;
        font-size: 0.82em;
        line-height: 1.25;
      }

      .article-content-container pre {
        background-color: var(--ac-code-bg-strong);
        color: var(--ac-code-fg-strong);
        padding: 10px 12px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 16px 0;
        line-height: 1.3;
      }

      .article-content-container pre code {
        background-color: transparent;
        color: inherit;
        padding: 0;
        font-size: 0.76em;
        line-height: 1.2;
        white-space: pre;
        word-break: normal;
      }

      .article-content-container blockquote code {
        font-size: 0.78em;
      }

      .article-content-container blockquote pre code {
        font-size: 0.72em;
        line-height: 1.2;
      }

      .article-content-container ul,
      .article-content-container ol {
        margin: 1em 0;
        padding-left: 0;
        list-style: none;
      }

      .article-content-container ul > li,
      .article-content-container ol > li {
        display: block;
        margin-bottom: 0.5em;
      }

      .article-content-container ul > li::before {
        content: "•";
        float: left;
        width: 1em;
      }

      .article-content-container ol {
        counter-reset: list-counter;
      }

      .article-content-container ol > li {
        counter-increment: list-counter;
      }

      .article-content-container ol > li::before {
        content: counter(list-counter) ".";
        float: left;
        width: 1em;
      }

      .article-content-container ul > li.no-list-marker::before,
      .article-content-container ol > li.no-list-marker::before {
        content: none;
      }

      /* When list items contain block-level elements (used as layout),
         switch to block display so inner blocks stack vertically. */
      .article-content-container ul > li:has(> section, > div, > pre, > article, > figure, > blockquote, > table),
      .article-content-container ol > li:has(> section, > div, > pre, > article, > figure, > blockquote, > table) {
        display: block;
      }

      .article-content-container ul > li:has(> section, > div, > pre, > article, > figure, > blockquote, > table)::before,
      .article-content-container ol > li:has(> section, > div, > pre, > article, > figure, > blockquote, > table)::before {
        content: none;
      }

      /* Reset list styling inside blockquotes (do not use custom list layout/markers). */
      .article-content-container blockquote ul,
      .article-content-container blockquote ol {
        list-style: initial;
        padding-left: 1.25em;
        margin: 0.75em 0;
      }

      .article-content-container blockquote ol {
        counter-reset: none;
      }

      .article-content-container blockquote ul > li,
      .article-content-container blockquote ol > li {
        display: list-item;
        margin-bottom: 0.35em;
        counter-increment: none;
      }

      .article-content-container blockquote ul > li::before,
      .article-content-container blockquote ol > li::before {
        content: none;
      }

      ${liteYouTubeStyles}
    `;

    this.root.appendChild(style);

    const container = document.createElement('div');
    container.className = 'article-content-container';
    this.root.appendChild(container);

    // Keep Prism CSS after local styles so theme rules can win in cascade.
    this.prismThemeStyle = document.createElement('style');
    this.root.appendChild(this.prismThemeStyle);

    this.applyPrismTheme();
    this.observeThemeChanges();

    this.root.addEventListener('click', this.handleLinkClick.bind(this) as EventListener, true);
    this.root.addEventListener('contextmenu', this.handleArticleContentContextMenu.bind(this) as EventListener);
    this.root.addEventListener('error', this.handleImageLoadError.bind(this), true);
    this.root.addEventListener('load', this.handleMediaLoad.bind(this), true);
  }

  /**
   * Set article HTML content
   * @param html Sanitized HTML string
   */
  setContent(
    html: string,
    options?: { baseUrl?: string; deferMediaProcessingMs?: number; isPreprocessed?: boolean }
  ): void {
    if (html === this.lastContent) {
      return;
    }

    this.cancelPendingWork();

    const container = this.root.querySelector('.article-content-container');
    if (container) {
      container.innerHTML = html;
      this.lastContent = html;
      wrapNonAsciiTextNodes(container);
      repairNonImageMediaImages(container);

      classifyStandaloneMedia(container, container.clientWidth);

      if (options?.isPreprocessed) {
        unwrapEmbeddedMediaAnchors(container);
        convertYouTubeIframesInContainer(container, options?.baseUrl ?? window.location.href);
        finalizeYouTubePlaceholders(container);
        classifyStandaloneMedia(container, container.clientWidth);
        this.dispatchContentMetrics(container, html);
        return;
      }

      if (options?.baseUrl) {
        this.resolveRelativeUrls(container, options.baseUrl);
      }

      this.applySyntaxHighlighting(container);
      this.suppressListMarkersForImageItems(container);
      this.scheduleMediaEnhancements(container, options?.deferMediaProcessingMs ?? 0, options?.baseUrl);
      this.dispatchContentMetrics(container, html);
    }
  }

  /** Text block at viewport y `top`, used to keep the reading position across text size changes. */
  findReadingAnchor(top: number): Element | null {
    const container = this.root.querySelector('.article-content-container');
    return container ? findReadingAnchorElement(container, top) : null;
  }

  cancelPendingWork(): void {
    this.mediaEnhancementToken += 1;

    if (this.mediaEnhancementTimer !== null) {
      window.clearTimeout(this.mediaEnhancementTimer);
      this.mediaEnhancementTimer = null;
    }
  }

  private resolveRelativeUrls(container: Element, baseUrl: string): void {
    const resolve = (url: string | null): string | null => {
      if (!url) return null;

      // Handle common mis-resolution where browser/parser resolved relative URLs
      // against the app's own localhost or file origin during initial string parsing.
      if (url.startsWith(window.location.origin)) {
        const relativePart = url.substring(window.location.origin.length);
        try {
          return new URL(relativePart, baseUrl).href;
        } catch {
          // Fallback to absolute localhost if resolution fails
          return url;
        }
      }

      try {
        return new URL(url, baseUrl).href;
      } catch {
        return url;
      }
    };

    container.querySelectorAll('img[src]').forEach((img) => {
      const imageElement = img as HTMLImageElement;
      
      // 1. Process special image attributes like original-src first
      staticResourceService.processImageAttributes(imageElement);

      // 2. Resolve relative URL if needed
      const src = imageElement.getAttribute('src');
      const resolved = resolve(src);
      if (resolved && resolved !== src) imageElement.setAttribute('src', resolved);
    });

    container.querySelectorAll('img[srcset]').forEach((img) => {
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const resolved = srcset
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            if (!trimmed) return '';
            const parts = trimmed.split(/\s+/);
            const url = parts[0];
            const descriptor = parts.slice(1).join(' ');
            const resolvedUrl = resolve(url);
            return descriptor ? `${resolvedUrl} ${descriptor}` : resolvedUrl;
          })
          .filter(Boolean)
          .join(', ');
        img.setAttribute('srcset', resolved);
      }
    });

    container.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      const resolved = resolve(href);
      if (resolved && resolved !== href) a.setAttribute('href', resolved);
    });

    container.querySelectorAll('source[src]').forEach((source) => {
      const src = source.getAttribute('src');
      const resolved = resolve(src);
      if (resolved && resolved !== src) source.setAttribute('src', resolved);
    });

    container.querySelectorAll('source[srcset]').forEach((source) => {
      const srcset = source.getAttribute('srcset');
      if (srcset) {
        const resolved = srcset
          .split(',')
          .map((part) => {
            const trimmed = part.trim();
            if (!trimmed) return '';
            const parts = trimmed.split(/\s+/);
            const url = parts[0];
            const descriptor = parts.slice(1).join(' ');
            const resolvedUrl = resolve(url);
            return descriptor ? `${resolvedUrl} ${descriptor}` : resolvedUrl;
          })
          .filter(Boolean)
          .join(', ');
        source.setAttribute('srcset', resolved);
      }
    });

    container.querySelectorAll('video[src], audio[src], iframe[src], embed[src]').forEach((el) => {
      const src = el.getAttribute('src');
      const resolved = resolve(src);
      if (resolved && resolved !== src) el.setAttribute('src', resolved);
    });

    container.querySelectorAll('video[poster]').forEach((el) => {
      const poster = el.getAttribute('poster');
      const resolved = resolve(poster);
      if (resolved && resolved !== poster) el.setAttribute('poster', resolved);
    });

    container.querySelectorAll('object[data]').forEach((obj) => {
      const data = obj.getAttribute('data');
      const resolved = resolve(data);
      if (resolved && resolved !== data) obj.setAttribute('data', resolved);
    });

    container.querySelectorAll('form[action]').forEach((form) => {
      const action = form.getAttribute('action');
      const resolved = resolve(action);
      if (resolved && resolved !== action) form.setAttribute('action', resolved);
    });
  }

  private scheduleMediaEnhancements(container: Element, deferMs: number, baseUrl?: string): void {
    this.mediaEnhancementToken += 1;
    const token = this.mediaEnhancementToken;

    if (this.mediaEnhancementTimer !== null) {
      window.clearTimeout(this.mediaEnhancementTimer);
      this.mediaEnhancementTimer = null;
    }

    const runEnhancements = () => {
      if (token !== this.mediaEnhancementToken) {
        return;
      }
      unwrapEmbeddedMediaAnchors(container);
      this.disableMediaAutoplay(container, baseUrl);
      this.replaceAudioElements(container);
      this.normalizeMediaFigureWrappers(container);
      classifyStandaloneMedia(container, container.clientWidth);
      this.dispatchContentMetrics(container, this.lastContent);
      this.mediaEnhancementTimer = null;
    };

    if (deferMs > 0) {
      this.mediaEnhancementTimer = window.setTimeout(runEnhancements, deferMs);
      return;
    }

    runEnhancements();
  }

  private collectContentMetrics(container: Element, html: string): ArticleContentMetricsDetail {
    return {
      htmlChars: html.length,
      shadowElementCount: container.querySelectorAll('*').length,
      imageElementCount: container.querySelectorAll('img, picture, source[srcset], source[src]').length,
      mediaElementCount: container.querySelectorAll('img, picture, iframe, video, audio, feed-audio-player, lite-youtube, embed, object, source').length,
      linkElementCount: container.querySelectorAll('a[href]').length,
      textChars: (container.textContent ?? '').length,
    };
  }

  private dispatchContentMetrics(container: Element, html: string): void {
    this.dispatchEvent(new CustomEvent<ArticleContentMetricsDetail>('article-content-metrics', {
      detail: this.collectContentMetrics(container, html),
      bubbles: true,
      composed: true,
    }));
  }

  private replaceAudioElements(container: Element): void {
    container.querySelectorAll('audio').forEach((audio) => {
      const src = audio.getAttribute('src') || audio.querySelector('source')?.getAttribute('src');
      if (!src) return;

      const player = document.createElement('feed-audio-player');
      player.setAttribute('src', src);
      
      const title = audio.getAttribute('title') || audio.getAttribute('aria-label');
      if (title) {
        player.setAttribute('title', title);
      }

      audio.replaceWith(player);
    });
  }

  /**
   * Highlight code blocks with PrismJS inside the shadow-root content.
   */
  private applySyntaxHighlighting(container: Element): void {
    container.querySelectorAll('pre').forEach((preElement) => {
      const pre = preElement as HTMLElement;
      let code = pre.querySelector(':scope > code') as HTMLElement | null;

      // Some sources emit <pre> with nested spans/text but no <code>.
      // Normalize to <pre><code>...</code></pre> so Prism can highlight reliably.
      if (!code) {
        code = document.createElement('code');
        code.textContent = pre.textContent || '';
        pre.innerHTML = '';
        pre.appendChild(code);
      } else {
        // Drop pre-existing syntax spans/classes from third-party renderers.
        // Prism should operate on raw source text.
        code.textContent = code.textContent || '';
      }

      const explicitLanguageClass = Array.from(code.classList).find((cls) => cls.startsWith('language-'))
        || Array.from(pre?.classList ?? []).find((cls) => cls.startsWith('language-'));

      const language = explicitLanguageClass
        ? explicitLanguageClass.replace('language-', '')
        : this.detectCodeLanguage(code);

      const normalizedLanguage = Prism.languages[language] ? language : 'none';
      code.classList.add(`language-${normalizedLanguage}`);
      pre.classList.add(`language-${normalizedLanguage}`);

      Prism.highlightElement(code);
    });
  }

  private applyPrismTheme(): void {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    this.prismThemeStyle.textContent = currentTheme === 'dark' ? prismDarkTheme : prismLightTheme;
  }

  private observeThemeChanges(): void {
    this.themeObserver = new MutationObserver(() => this.applyPrismTheme());
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
  }

  private detectCodeLanguage(codeElement: HTMLElement): string {
    const classCandidates = [
      codeElement.className,
      codeElement.parentElement?.className || '',
      codeElement.closest('[class*="highlight-source-"]')?.className || '',
    ].join(' ').toLowerCase();

    if (classCandidates.includes('highlight-source-shell') || classCandidates.includes('language-shell') || classCandidates.includes('language-bash') || classCandidates.includes('language-terminal') || classCandidates.includes('language-sh')) return 'bash';
    if (classCandidates.includes('highlight-source-python') || classCandidates.includes('language-python') || classCandidates.includes('language-py')) return 'python';
    if (classCandidates.includes('highlight-source-typescript') || classCandidates.includes('language-typescript') || classCandidates.includes('language-ts')) return 'typescript';
    if (classCandidates.includes('highlight-source-tsx') || classCandidates.includes('language-tsx')) return 'tsx';
    if (classCandidates.includes('highlight-source-jsx') || classCandidates.includes('language-jsx')) return 'jsx';
    if (classCandidates.includes('highlight-source-javascript') || classCandidates.includes('language-javascript') || classCandidates.includes('language-js')) return 'javascript';
    if (classCandidates.includes('highlight-source-json') || classCandidates.includes('language-json')) return 'json';
    if (classCandidates.includes('highlight-source-sql') || classCandidates.includes('language-sql')) return 'sql';
    if (classCandidates.includes('highlight-source-yaml') || classCandidates.includes('language-yaml') || classCandidates.includes('language-yml')) return 'yaml';
    if (classCandidates.includes('highlight-text-html') || classCandidates.includes('language-html') || classCandidates.includes('language-markup')) return 'markup';
    if (classCandidates.includes('highlight-source-css') || classCandidates.includes('language-css')) return 'css';
    if (classCandidates.includes('highlight-source-markdown') || classCandidates.includes('language-markdown')) return 'markdown';
    if (classCandidates.includes('highlight-source-swift') || classCandidates.includes('language-swift')) return 'swift';
    if (classCandidates.includes('highlight-source-go') || classCandidates.includes('language-go')) return 'go';
    if (classCandidates.includes('highlight-source-rust') || classCandidates.includes('language-rust')) return 'rust';
    if (classCandidates.includes('highlight-source-c ') || (classCandidates.includes('language-c') && !classCandidates.includes('language-cpp') && !classCandidates.includes('language-c++'))) return 'c';
    if (classCandidates.includes('highlight-source-cpp') || classCandidates.includes('language-cpp') || classCandidates.includes('language-c++')) return 'cpp';
    if (classCandidates.includes('highlight-source-java') || classCandidates.includes('language-java')) return 'java';
    if (classCandidates.includes('highlight-source-ruby') || classCandidates.includes('language-ruby')) return 'ruby';
    if (classCandidates.includes('highlight-source-php') || classCandidates.includes('language-php')) return 'php';
    if (classCandidates.includes('highlight-source-kotlin') || classCandidates.includes('language-kotlin')) return 'kotlin';

    return 'none';
  }

  /**
   * Remove list markers for list items that start with or include an image.
   */
  private suppressListMarkersForImageItems(container: Element): void {
    container.querySelectorAll('ul > li, ol > li').forEach((listItem) => {
      const li = listItem as HTMLLIElement;
      const firstElement = li.firstElementChild;
      const startsWithImage = firstElement?.tagName === 'IMG'
        || firstElement?.tagName === 'PICTURE'
        || firstElement?.tagName === 'FIGURE';
      const includesImage = !!li.querySelector('img, picture, figure');

      if (startsWithImage || includesImage) {
        li.classList.add('no-list-marker');
      } else {
        li.classList.remove('no-list-marker');
      }
    });
  }

  /**
   * Force media embeds into non-autoplay mode for better reading UX.
   */
  private disableMediaAutoplay(container: Element, baseUrl?: string): void {
    container.querySelectorAll('video, audio').forEach((mediaElement) => {
      const media = mediaElement as HTMLMediaElement;
      const hadAutoplay = media.autoplay || media.hasAttribute('autoplay');
      media.removeAttribute('autoplay');
      media.autoplay = false;
      if (!media.paused && hadAutoplay) {
        media.pause();
      }
    });

    convertYouTubeIframesInContainer(container, baseUrl ?? window.location.href);
    finalizeYouTubePlaceholders(container);
  }

  private normalizeMediaFigureWrappers(container: Element): void {
    container.querySelectorAll('figure').forEach((figureElement) => {
      const figure = figureElement as HTMLElement;
      if (!figure.querySelector('iframe, video, lite-youtube')) {
        return;
      }

      // Many article sources inject fixed figure margins/widths inline.
      // Force embedded-media figures to align with the article content width.
      figure.style.marginLeft = '0';
      figure.style.marginRight = '0';
      figure.style.width = '100%';
      figure.style.maxWidth = 'none';
      figure.style.boxSizing = 'border-box';
    });
  }

  private handleMediaLoad(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) {
      return;
    }
    const container = this.root.querySelector('.article-content-container');
    handleStandaloneMediaLoad(target, container?.clientWidth ?? 0);
  }

  private handleImageLoadError(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLImageElement)) {
      return;
    }

    // 1. If we have a stored original-src from attributes and it's different from current src, try it.
    const originalSrcAttr = target.getAttribute('original-src');
    const currentSrc = target.src;

    // Check if we already tried the original-src to avoid infinite loops
    if (originalSrcAttr && currentSrc !== originalSrcAttr && !target.dataset.triedOriginal) {
      target.dataset.triedOriginal = 'true';
      target.src = originalSrcAttr;
      return;
    }

    // 2. If retry failed or no original-src, show broken image fallback
    const originalSrc = target.src;
    const replacementTarget = target.closest('picture') ?? target;
    replacementTarget.replaceWith(this.createBrokenImageFallback(originalSrc));
  }
  private createBrokenImageFallback(originalSrc?: string): HTMLElement {
    const fallback = document.createElement('div');
    fallback.className = 'article-content-broken-image';
    fallback.setAttribute('role', 'img');
    fallback.setAttribute('aria-label', 'Broken image');
    if (originalSrc) {
      fallback.dataset.originalSrc = originalSrc;
    }
    fallback.innerHTML = BROKEN_IMAGE_PLACEHOLDER_SVG;
    return fallback;
  }

  /**
   * Intercept right-clicks inside article content and dispatch a custom event so
   * the host can show the native context menu. Linked images expose link actions
   * only to avoid duplicate URL action groups.
   */
  private handleArticleContentContextMenu(event: MouseEvent): void {
    const target = event.target as HTMLElement;

    const link = target.closest('a[href]') as HTMLAnchorElement | null;
    if (link?.href) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchArticleContentContextMenu('link', link.href);
      return;
    }

    const brokenImage = target.closest('.article-content-broken-image') as HTMLElement | null;
    if (brokenImage?.dataset.originalSrc) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchArticleContentContextMenu('image', brokenImage.dataset.originalSrc);
      return;
    }

    const imageUrl = this.resolveImageContextUrl(target);
    if (imageUrl) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchArticleContentContextMenu('image', imageUrl);
    }
  }

  private resolveImageContextUrl(target: HTMLElement): string | null {
    const image = target.closest('img[src]') as HTMLImageElement | null;
    if (image?.src) {
      return image.currentSrc || image.src;
    }

    const picture = target.closest('picture');
    if (!picture) {
      return null;
    }

    const pictureImage = picture.querySelector('img[src]') as HTMLImageElement | null;
    if (!pictureImage?.src) {
      return null;
    }

    return pictureImage.currentSrc || pictureImage.src;
  }

  private dispatchArticleContentContextMenu(kind: 'link' | 'image', url: string): void {
    this.dispatchEvent(new CustomEvent('article-content-context-menu', {
      detail: { kind, url },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Intercept link clicks and dispatch custom event
   */
  private handleLinkClick(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (this.handleImageOpenClick(event, target)) {
      return;
    }

    const clickResult = resolveArticleContentClick(target);

    // YouTube opens on youtube.com instead of playing inline: tauri:// pages send no
    // HTTP Referer, so the embedded player fails with Error 153 (see resolveLiteYoutubeWatchUrl).
    if (clickResult.type === 'embedded-media') {
      event.preventDefault();
      event.stopPropagation();

      const liteYoutube = target.closest('lite-youtube') as HTMLElement | null;
      const watchUrl = liteYoutube ? resolveLiteYoutubeWatchUrl(liteYoutube) : null;
      if (watchUrl) {
        this.dispatchLinkClick(watchUrl);
      }
      return;
    }

    if (clickResult.type === 'youtube-anchor') {
      event.preventDefault();
      this.dispatchLinkClick(clickResult.link.href);
      return;
    }

    if (clickResult.type !== 'link') {
      return;
    }

    event.preventDefault();
    this.dispatchLinkClick(clickResult.href);
  }

  private dispatchLinkClick(href: string): void {
    this.dispatchEvent(new CustomEvent('article-link-click', {
      detail: { href },
      bubbles: true,
      composed: true,
    }));
  }

  /**
   * Unlinked standalone/gallery images open in the host lightbox. The event
   * carries every lightbox image in the article so the host can page through.
   */
  private handleImageOpenClick(event: MouseEvent, target: HTMLElement): boolean {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return false;
    }
    const image = target.closest('img');
    if (!(image instanceof HTMLImageElement)) {
      return false;
    }
    const container = this.root.querySelector('.article-content-container');
    if (!container) {
      return false;
    }
    const images = collectLightboxImages(container);
    const index = images.indexOf(image);
    if (index < 0) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent('article-image-open', {
      detail: {
        index,
        images: images.map((item) => ({
          src: item.currentSrc || item.src,
          alt: item.alt || item.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || '',
        })),
      },
      bubbles: true,
      composed: true,
    }));
    return true;
  }

  disconnectedCallback(): void {
    this.cancelPendingWork();
    this.themeObserver?.disconnect();
  }
}

if (!customElements.get('article-content')) {
  customElements.define('article-content', ArticleContentElement);
}

export default ArticleContentElement;
