import { readabilityAdapter } from './extractors/readabilityAdapter';
import { defuddleAdapter } from './extractors/defuddleAdapter';
import {
  type ContentParser,
  type ContentParserAdapter,
  type ExtractedArticleContent,
  DEFAULT_CONTENT_PARSER,
  isContentParser,
} from './extractors/types';

export type { ExtractedArticleContent } from './extractors/types';
export { type ContentParser, DEFAULT_CONTENT_PARSER, CONTENT_PARSER_VALUES } from './extractors/types';

const ADAPTERS: Record<ContentParser, ContentParserAdapter> = {
  defuddle: defuddleAdapter,
  readability: readabilityAdapter,
};

const resolveAdapter = (parser: ContentParser | undefined): ContentParserAdapter => {
  if (parser && isContentParser(parser)) {
    return ADAPTERS[parser];
  }
  return ADAPTERS[DEFAULT_CONTENT_PARSER];
};

const otherAdapter = (primary: ContentParserAdapter): ContentParserAdapter =>
  primary.id === 'defuddle' ? readabilityAdapter : defuddleAdapter;

/**
 * Extract structured article content from raw HTML using the user's preferred parser.
 *
 * The optional `parser` argument lets the caller route to a specific adapter; when
 * omitted we fall back to the default parser. If the chosen adapter throws or
 * returns no content we transparently retry with the other adapter once so a
 * single-adapter regression cannot break article fetching for the user.
 */
export const extractArticleContentFromHtml = async (
  url: string,
  html: string,
  parser?: ContentParser
): Promise<ExtractedArticleContent | null> => {
  const primary = resolveAdapter(parser);

  try {
    const result = await primary.extract(url, html);
    if (result && result.content) {
      return result;
    }
  } catch (error) {
    console.warn(`[articleExtraction] ${primary.id} adapter failed; trying alternate adapter`, error);
  }

  // Try the other registered adapter once before giving up.
  const fallback = otherAdapter(primary);
  try {
    return await fallback.extract(url, html);
  } catch (error) {
    console.warn(`[articleExtraction] ${fallback.id} fallback failed`, error);
    return null;
  }
};
