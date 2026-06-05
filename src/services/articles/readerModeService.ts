import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { logger } from '../logger/logger';

// Enable file persistence for reader mode logs
logger.setPersistToFile(true);

export interface ReaderModeContent {
  title: string;
  byline?: string;
  content: string;
  textContent: string;
  length: number;
  excerpt: string;
  siteName?: string;
}

export interface ReaderModeResult {
  success: boolean;
  content?: ReaderModeContent;
  resourceType?: 'html' | 'pdf' | 'unsupported';
  error?: string;
}

class ReaderModeService {
  private cache: Map<string, ReaderModeContent> = new Map();
  private cacheBytes = 0;
  private maxCacheSize = 12;
  private maxCacheBytes = 8 * 1024 * 1024;

  private estimateContentBytes(content: ReaderModeContent): number {
    return (
      content.title.length
      + (content.byline?.length || 0)
      + content.content.length
      + content.textContent.length
      + content.excerpt.length
      + (content.siteName?.length || 0)
    ) * 2;
  }

  private formatReaderError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    const statusMatch = message.match(/\bHTTP\s+(\d{3})\b/i);
    if (statusMatch?.[1]) {
      return `Error ${statusMatch[1]}`;
    }
    return 'Error';
  }

  async fetchAndParse(url: string): Promise<ReaderModeResult> {
    try {
      // 1. Check cache first
      const cached = this.getCached(url);
      if (cached) {
        logger.debug('ReaderMode', 'Cache hit', { url });
        return { success: true, content: cached };
      }

      // 2. Fetch HTML using fetchHtmlSafe with Content-Type detection
      logger.info('ReaderMode', 'Fetching article', { url });

      if (!window.electronAPI?.fetchHtmlSafe) {
        logger.error('ReaderMode', 'fetchHtmlSafe not available', { url });
        return { success: false, error: 'Error' };
      }

      const fetchResult = await window.electronAPI.fetchHtmlSafe(url);

      // Handle non-HTML resource types
      if (fetchResult.resourceType === 'pdf') {
        logger.info('ReaderMode', 'PDF resource detected', { url });
        return { success: true, resourceType: 'pdf' };
      }

      if (fetchResult.resourceType === 'unsupported') {
        logger.info('ReaderMode', 'Unsupported content type', { url, contentType: fetchResult.contentType });
        return { success: false, resourceType: 'unsupported', error: 'Unsupported content type' };
      }

      const html = fetchResult.html;

      if (!html || typeof html !== 'string') {
        logger.error('ReaderMode', 'Failed to fetch article content', { url, reason: 'Empty or invalid response' });
        return {
          success: false,
          error: 'Error'
        };
      }

      // 3. Parse HTML with DOMParser
      const parser = new DOMParser();
      // Inject <base> tag to ensure relative URLs are resolved correctly against the source URL
      // instead of the app's own origin during parsing and Readability extraction.
      const htmlWithBase = html.includes('<head>') 
        ? html.replace('<head>', `<head><base href="${url}">`)
        : `<head><base href="${url}"></head>${html}`;
      const doc = parser.parseFromString(htmlWithBase, 'text/html');

      // Check for parsing errors
      const parserError = doc.querySelector('parsererror');
      if (parserError) {
        logger.error('ReaderMode', 'Invalid HTML format', { url, parserError: parserError.textContent });
        return {
          success: false,
          error: 'Error'
        };
      }

      // 4. Use Readability to extract content with keepClasses option
      const reader = new Readability(doc, {
        keepClasses: true
      });
      const article = reader.parse();

      if (!article) {
        logger.error('ReaderMode', 'Unable to extract article content', { url, reason: 'Readability returned null' });
        return {
          success: false,
          error: 'Error'
        };
      }

      // 5. Sanitize output HTML with DOMPurify
      const sanitizedContent = DOMPurify.sanitize(article.content ?? '', {
        ALLOWED_TAGS: [
          'p', 'br', 'strong', 'em', 'u', 'b', 'i', 's', 'strike',
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'ul', 'ol', 'li',
          'blockquote', 'pre', 'code',
          'a', 'img',
          'iframe', 'video', 'audio', 'source', 'track',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'div', 'span', 'article', 'section',
          'figure', 'figcaption'
        ],
        ALLOWED_ATTR: [
          'href', 'src', 'alt', 'title', 'class', 'id',
          'width', 'height', 'target', 'rel',
          'allow', 'allowfullscreen', 'frameborder', 'scrolling',
          'controls', 'poster', 'preload', 'playsinline', 'muted', 'loop', 'type'
        ],
        ALLOW_DATA_ATTR: false,
        RETURN_DOM: false,
        RETURN_DOM_FRAGMENT: false,
        RETURN_TRUSTED_TYPE: false
      });

      const readerContent: ReaderModeContent = {
        title: article.title ?? '',
        byline: article.byline || undefined,
        content: String(sanitizedContent ?? ''),
        textContent: article.textContent ?? '',
        length: article.length ?? 0,
        excerpt: article.excerpt ?? '',
        siteName: article.siteName || undefined
      };

      // 6. Cache result (LRU eviction)
      this.addToCache(url, readerContent);

      logger.info('ReaderMode', 'Successfully parsed article', { url, title: article.title, length: article.length });
      return { success: true, content: readerContent };

    } catch (error) {
      // Log the error for debugging
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('ReaderMode', 'Error fetching/parsing article', { url, error: errorMessage });

      return {
        success: false,
        error: this.formatReaderError(error)
      };
    }
  }

  getCached(url: string): ReaderModeContent | null {
    return this.cache.get(url) || null;
  }

  clearCache(): void {
    this.cache.clear();
    this.cacheBytes = 0;
    logger.debug('ReaderMode', 'Cache cleared');
  }

  private addToCache(url: string, content: ReaderModeContent): void {
    const existing = this.cache.get(url);
    if (existing) {
      this.cacheBytes -= this.estimateContentBytes(existing);
      this.cache.delete(url);
    }

    this.cache.set(url, content);
    this.cacheBytes += this.estimateContentBytes(content);

    // LRU eviction: keep both entry count and retained HTML bytes bounded.
    while (this.cache.size > this.maxCacheSize || this.cacheBytes > this.maxCacheBytes) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        const removed = this.cache.get(firstKey);
        if (removed) {
          this.cacheBytes -= this.estimateContentBytes(removed);
        }
        this.cache.delete(firstKey);
      }
    }
  }
}

export const readerModeService = new ReaderModeService();
