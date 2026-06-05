export interface PodcastMetadata {
  author?: string;
  explicit?: boolean;
  type?: string;
  categories?: string[];
}

export interface Feed {
  id: string;
  title: string;
  url: string;
  createdAt?: Date;
  description?: string;
  lastFetched?: Date;
  lastFailedFetchAt?: Date;
  unreadCount?: number;
  tags: string[];
  articleCount?: number;
  favicon?: string;
  faviconHasTransparency?: boolean;
  faviconDominantColor?: string;
  faviconBgLight?: string;
  faviconBgDark?: string;
  faviconFetchFailed?: boolean;
  lastFaviconRefresh?: Date;
  emoji?: string;
  image?: string;
  categories?: string[];
  language?: string;
  isPodcast?: boolean;
  podcastMetadata?: PodcastMetadata;
  readerModeEnabled?: boolean;
  sortOrder?: number;
  updateFrequencyScore?: number;
  consecutiveFailures?: number;
  etag?: string;
  lastModifiedHeader?: string;
}
