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
    field: "publishedDate" | "fetchedDate";
    order: "asc" | "desc";
  };
  searchText?: string;
  limit?: number;
  offset?: number;
  cursor?: {
    effectiveDate: string;
    hash: string;
  };
  includeTotal?: boolean;
}

export interface ArticleQueryResult {
  articles: Article[];
  total: number;
}
