import type { Article } from "./article";

export interface ArticleQuery {
  feedIds?: string[];
  tagName?: string;
  filter?: {
    read?: boolean;
    starred?: boolean;
    saved?: boolean;
  };
  sort?: {
    field: "publishedDate" | "fetchedDate" | "lastReadAt";
    order: "asc" | "desc";
  };
  searchText?: string;
  searchEpoch?: string;
  limit?: number;
  offset?: number;
  cursor?: {
    /** Null means the last_read_at DESC NULL-tail keyset (hash only). */
    effectiveDate: string | null;
    hash: string;
  };
  includeTotal?: boolean;
  /** Today view: effective date within the last 24 hours, measured natively per query. */
  today?: boolean;
}

export interface ArticleQueryResult {
  articles: Article[];
  total: number;
  cancelled?: boolean;
}
