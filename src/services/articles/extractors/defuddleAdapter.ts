import { parseHTML } from 'linkedom';
import Defuddle from 'defuddle';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';
import {
  type ContentParserAdapter,
  type ExtractedArticleContent,
  countWordsInHtml,
  extractHostname,
} from './types';

/**
 * Adapter wrapping Defuddle (modern Readability successor used by Obsidian
 * Web Clipper). We construct a linkedom Document so Defuddle has a real DOM
 * and the result mirrors the other adapters.
 */
export const defuddleAdapter: ContentParserAdapter = {
  id: 'defuddle',
  async extract(url: string, html: string): Promise<ExtractedArticleContent | null> {
    const { document } = parseHTML(html);
    const instance = new Defuddle(document as unknown as Document, { url });
    const result = instance.parse();
    if (!result || !result.content) return null;

    const domain = result.domain || extractHostname(url);
    const wordCount = result.wordCount && result.wordCount > 0
      ? result.wordCount
      : countWordsInHtml(result.content);

    return {
      title: result.title || null,
      author: result.author || null,
      datePublished: normalizePublishedDate(result.published || undefined) || null,
      siteName: result.site || domain,
      excerpt: result.description || null,
      content: result.content,
      leadImageUrl: result.image || null,
      url,
      domain,
      wordCount,
    };
  },
};
