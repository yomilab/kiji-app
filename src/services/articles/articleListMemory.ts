import type { Feed } from '@/services/feeds/types';
import type { Article } from '@/types/article';

type InternedFeedMetadata = Pick<
  Article,
  | 'feedUrl'
  | 'feedTitle'
  | 'feedFavicon'
  | 'feedFaviconHasTransparency'
  | 'feedFaviconBgLight'
  | 'feedFaviconBgDark'
  | 'feedImage'
>;

/** One entry per library feed is enough; cap above any realistic feed count. */
const MAX_INTERNED_FEED_METADATA_ENTRIES = 512;

const internedFeedMetadataById = new Map<string, InternedFeedMetadata>();

const rememberInternedFeedMetadata = (feedId: string, metadata: InternedFeedMetadata): InternedFeedMetadata => {
  internedFeedMetadataById.delete(feedId);
  internedFeedMetadataById.set(feedId, metadata);

  while (internedFeedMetadataById.size > MAX_INTERNED_FEED_METADATA_ENTRIES) {
    const oldestKey = internedFeedMetadataById.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    internedFeedMetadataById.delete(oldestKey);
  }

  return metadata;
};

const hasFeedMetadata = (article: Article): boolean => (
  article.feedUrl !== ''
  || article.feedTitle !== undefined
  || article.feedFavicon !== undefined
  || article.feedFaviconHasTransparency !== undefined
  || article.feedFaviconBgLight !== undefined
  || article.feedFaviconBgDark !== undefined
  || article.feedImage !== undefined
);

const toInternedFeedMetadata = (article: Article): InternedFeedMetadata => ({
  feedUrl: article.feedUrl,
  feedTitle: article.feedTitle,
  feedFavicon: article.feedFavicon,
  feedFaviconHasTransparency: article.feedFaviconHasTransparency,
  feedFaviconBgLight: article.feedFaviconBgLight,
  feedFaviconBgDark: article.feedFaviconBgDark,
  feedImage: article.feedImage,
});

const mergeInternedFeedMetadata = (
  existing: InternedFeedMetadata,
  incoming: InternedFeedMetadata,
): InternedFeedMetadata => ({
  feedUrl: incoming.feedUrl || existing.feedUrl,
  feedTitle: incoming.feedTitle ?? existing.feedTitle,
  feedFavicon: incoming.feedFavicon ?? existing.feedFavicon,
  feedFaviconHasTransparency: incoming.feedFaviconHasTransparency ?? existing.feedFaviconHasTransparency,
  feedFaviconBgLight: incoming.feedFaviconBgLight ?? existing.feedFaviconBgLight,
  feedFaviconBgDark: incoming.feedFaviconBgDark ?? existing.feedFaviconBgDark,
  feedImage: incoming.feedImage ?? existing.feedImage,
});

/**
 * Reuse one feed-metadata object per feed id so long infinite-scroll sessions do
 * not retain duplicate favicon/title strings on every article row.
 */
export function internArticleFeedMetadata(article: Article): Article {
  if (!hasFeedMetadata(article)) {
    return article;
  }

  const incoming = toInternedFeedMetadata(article);
  const existing = internedFeedMetadataById.get(article.feedId);
  const interned = existing ? mergeInternedFeedMetadata(existing, incoming) : incoming;
  const cached = rememberInternedFeedMetadata(article.feedId, interned);

  if (
    existing
    && cached.feedUrl === existing.feedUrl
    && cached.feedTitle === existing.feedTitle
    && cached.feedFavicon === existing.feedFavicon
    && cached.feedFaviconHasTransparency === existing.feedFaviconHasTransparency
    && cached.feedFaviconBgLight === existing.feedFaviconBgLight
    && cached.feedFaviconBgDark === existing.feedFaviconBgDark
    && cached.feedImage === existing.feedImage
  ) {
    return {
      ...article,
      ...existing,
    };
  }

  return {
    ...article,
    ...cached,
  };
}

/**
 * Drop metadata fields that article rows never render. Keep podcast/saved-link
 * fields needed when opening an article from the list.
 */
export function slimArticleForList(article: Article): Article {
  const {
    updatedDate: _updatedDate,
    summary: _summary,
    guid: _guid,
    thumbnail: _thumbnail,
    images: _images,
    categories: _categories,
    authors: _authors,
    savedDate: _savedDate,
    ...listArticle
  } = article;

  return listArticle;
}

export function prepareArticleForList(article: Article): Article {
  return slimArticleForList(internArticleFeedMetadata(article));
}

export function prepareArticlesForList(articles: Article[]): Article[] {
  if (articles.length === 0) {
    return articles;
  }

  const prepared: Article[] = new Array(articles.length);
  for (let index = 0; index < articles.length; index += 1) {
    prepared[index] = prepareArticleForList(articles[index]);
  }
  return prepared;
}

export function seedArticleFeedMetadataFromFeed(feed: Pick<
  Feed,
  | 'id'
  | 'url'
  | 'title'
  | 'favicon'
  | 'faviconHasTransparency'
  | 'faviconBgLight'
  | 'faviconBgDark'
  | 'image'
>): void {
  rememberInternedFeedMetadata(feed.id, {
    feedUrl: feed.url,
    feedTitle: feed.title,
    feedFavicon: feed.favicon,
    feedFaviconHasTransparency: feed.faviconHasTransparency,
    feedFaviconBgLight: feed.faviconBgLight,
    feedFaviconBgDark: feed.faviconBgDark,
    feedImage: feed.image,
  });
}

export function removeArticleFeedMetadata(feedId: string): void {
  internedFeedMetadataById.delete(feedId);
}

export function clearArticleListMemoryCaches(): void {
  internedFeedMetadataById.clear();
}

/** Test-only helper */
export function getInternedFeedMetadataCountForTests(): number {
  return internedFeedMetadataById.size;
}
