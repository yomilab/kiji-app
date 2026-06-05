import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';
import {
  type ContentParserAdapter,
  type ExtractedArticleContent,
  countWordsInHtml,
  extractHostname,
} from './types';

// Pull a meta-tag value by name or property. Returns the first non-empty match.
const readMeta = (doc: Document, keys: string[]): string | null => {
  for (const key of keys) {
    const selectors = [
      `meta[property="${key}"]`,
      `meta[name="${key}"]`,
      `meta[itemprop="${key}"]`,
    ];
    for (const sel of selectors) {
      const el = doc.querySelector(sel);
      const content = el?.getAttribute('content');
      if (content && content.trim()) return content.trim();
    }
  }
  return null;
};

// Pull the first <img> src out of an HTML fragment for lead-image fallback.
const firstImageSrc = (html: string | null | undefined): string | null => {
  if (!html) return null;
  const match = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
  return match ? match[1] : null;
};

const resolveAbsolute = (raw: string | null, baseUrl: string): string | null => {
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return raw;
  }
};

/**
 * Adapter wrapping Mozilla Readability (the engine behind Firefox Reader View).
 * Readability requires a real Document, so we build one with linkedom.
 * Metadata that Readability does not surface (lead image, site name fallbacks)
 * is filled in from <meta> tags so the result mirrors the other adapters.
 */
export const readabilityAdapter: ContentParserAdapter = {
  id: 'readability',
  async extract(url: string, html: string): Promise<ExtractedArticleContent | null> {
    const { document } = parseHTML(html);

    // linkedom's Document is structurally compatible with Readability's expectations.
    const reader = new Readability(document as unknown as Document);
    const article = reader.parse();
    if (!article) return null;

    const domain = extractHostname(url);
    const ogImage = readMeta(document as unknown as Document, [
      'og:image',
      'twitter:image',
      'twitter:image:src',
    ]);
    const siteName = article.siteName
      || readMeta(document as unknown as Document, ['og:site_name', 'application-name'])
      || domain;
    const datePublished = article.publishedTime
      || readMeta(document as unknown as Document, [
        'article:published_time',
        'datePublished',
        'date',
      ]);
    const leadImageUrl = resolveAbsolute(
      ogImage || firstImageSrc(article.content),
      url,
    );

    return {
      title: article.title || null,
      author: article.byline || null,
      datePublished: normalizePublishedDate(datePublished || undefined) || null,
      siteName: siteName || null,
      excerpt: article.excerpt || null,
      content: article.content || null,
      leadImageUrl,
      url,
      domain,
      wordCount: countWordsInHtml(article.content),
    };
  },
};
