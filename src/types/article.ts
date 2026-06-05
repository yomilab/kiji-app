export interface MediaThumbnail {
  url: string;
  width?: number;
  height?: number;
}

export interface Enclosure {
  url: string;
  type: string;
  length?: number;
  duration?: number;
}

export interface Author {
  name: string;
  email?: string;
  uri?: string;
}

export interface Article {
  hash: string;
  title: string;
  description: string;
  content: string;
  link?: string;
  author?: string;
  publishedDate?: string;
  fetchedDate: string;
  feedId: string;
  feedUrl: string;
  feedTitle?: string;
  feedFavicon?: string;
  feedFaviconHasTransparency?: boolean;
  feedFaviconBgLight?: string;
  feedFaviconBgDark?: string;
  feedImage?: string;
  read: boolean;
  lastReadAt?: string;
  starred: boolean;
  saved: boolean;
  savedArticleId?: string;
  savedDate?: string;
  isFeedLinked?: boolean;
  updatedDate?: string;
  summary?: string;
  guid?: string;
  previewImage?: string;
  thumbnail?: MediaThumbnail;
  images?: string[];
  enclosures?: Enclosure[];
  categories?: string[];
  authors?: Author[];
  duration?: number;
  episodeNumber?: number;
  seasonNumber?: number;
}

export interface ArticleHighlight {
  id: string;
  text: string;
  color?: string;
  note?: string;
  createdDate: string;
}

export interface SavedArticle {
  id: string;
  articleHash: string;
  title: string;
  description: string;
  content: string;
  link?: string;
  author?: string;
  publishedDate?: string;
  savedDate: string;
  lastReadAt?: string;
  feedId: string;
  feedUrl: string;
  feedTitle?: string;
  feedFavicon?: string;
  feedFaviconHasTransparency?: boolean;
  feedFaviconBgLight?: string;
  feedFaviconBgDark?: string;
  previewImage?: string;
  enclosures?: Enclosure[];
  duration?: number;
  episodeNumber?: number;
  seasonNumber?: number;
  highlights: ArticleHighlight[];
  notes?: string;
}
