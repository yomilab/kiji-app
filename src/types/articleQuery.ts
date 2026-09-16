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
  limit?: number;
  offset?: number;
  cursor?: {
    /** Null means the last_read_at DESC NULL-tail keyset (hash only). */
    effectiveDate: string | null;
    hash: string;
  };
  includeTotal?: boolean;
}

export interface ArticleQueryResult {
  articles: Article[];
  total: number;
}
