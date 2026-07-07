/**
 * Article Parser Service
 *
 * Uses the main-process article extractor (via IPC) to extract article metadata and content from URLs.
 * Provides rich metadata extraction including title, author, publish date, etc.
 */

import { settingsManager } from '@/services/settings';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';

export interface PostlightResult {
  title: string | null;
  author: string | null;
  datePublished: string | null;
  siteName: string | null;
  excerpt: string | null;
  content: string | null;
  leadImageUrl: string | null;
  url: string;
  domain: string | null;
  wordCount: number;
}

export interface PostlightParseResult {
  success: boolean;
  content?: PostlightResult;
  error?: string;
}

class PostlightParserService {
  /**
     * Parse URL using the shared article extractor (via IPC to main process)
     * Extracts title, author, publish date, and clean content using the user's preferred parser
     */
  async parseUrl(url: string): Promise<PostlightParseResult> {
    try {
      console.log('[Postlight] Parsing URL:', url);

      // Desktop article parsing requires the native API shim.
      if (!window.kijiAPI?.parseArticle) {
        return {
          success: false,
          error: 'Article parsing not available outside the desktop app',
        };
      }

      // Read the user's preferred parser so the main process knows which adapter to use.
      // We swallow read failures so a settings glitch never blocks article parsing.
      let parser: string | undefined;
      try {
        const settings = await settingsManager.getSettings();
        parser = settings.contentParser;
      } catch (error) {
        console.warn('[Postlight] Failed to read content parser preference; using default', error);
      }

      // Call IPC handler in main process (where the extractor runs)
      const result = await window.kijiAPI.parseArticle(url, parser);

      if (!result.success || !result.content) {
        return {
          success: false,
          error: result.error || 'Failed to parse article',
        };
      }

      const normalizedContent = {
        ...result.content,
        datePublished: normalizePublishedDate(result.content.datePublished || undefined) || null,
      };

      console.log('[Postlight] ✓ Parsed successfully:', {
        title: result.content.title,
        author: result.content.author,
        date: normalizedContent.datePublished,
        domain: result.content.domain,
      });

      return {
        success: true,
        content: normalizedContent,
      };
    } catch (error) {
      console.error('[Postlight] Parse error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}

// Export singleton instance
export const postlightParserService = new PostlightParserService();
