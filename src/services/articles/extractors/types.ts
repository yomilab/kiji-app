/**
 * Shared types for the pluggable content-parser system.
 *
 * Each adapter (defuddle / readability) takes a URL + raw HTML and returns
 * the same normalized shape so callers downstream do not have to branch on
 * which parser produced the result.
 */

export type ContentParser = 'defuddle' | 'readability';

export const CONTENT_PARSER_VALUES: readonly ContentParser[] = [
  'defuddle',
  'readability',
];

export const DEFAULT_CONTENT_PARSER: ContentParser = 'defuddle';

export const isContentParser = (value: unknown): value is ContentParser =>
  typeof value === 'string' && (CONTENT_PARSER_VALUES as readonly string[]).includes(value);

export interface ExtractedArticleContent {
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

export interface ContentParserAdapter {
  readonly id: ContentParser;
  extract(url: string, html: string): Promise<ExtractedArticleContent | null>;
}

export const extractHostname = (value: string): string | null => {
  try {
    return new URL(value).hostname || null;
  } catch {
    return null;
  }
};

// Strip HTML and decode the most common named entities.
// Decode &amp; *first* so double-encoded entities like "&amp;nbsp;" resolve correctly.
export const stripHtmlToText = (html: string): string => {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
};

export const countWordsInHtml = (html: string | null | undefined): number => {
  if (!html) return 0;
  const plainText = stripHtmlToText(html);
  if (!plainText) return 0;
  return plainText.split(/\s+/).filter(Boolean).length;
};
