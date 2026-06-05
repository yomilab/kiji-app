import type { Article } from '@/types/article';

/**
 * Build a stable signature for fields that affect article row rendering.
 * This keeps memo comparators concise while preserving update correctness.
 */
export const getArticleListRowSignature = (article: Article): string => {
  return [
    article.hash,
    article.title,
    article.description,
    article.read ? '1' : '0',
    article.feedTitle ?? '',
    article.feedFavicon ?? '',
    article.feedFaviconHasTransparency ? '1' : '0',
    article.feedFaviconBgLight ?? '',
    article.feedFaviconBgDark ?? '',
    article.publishedDate ?? '',
    article.previewImage ?? '',
  ].join('|');
};
