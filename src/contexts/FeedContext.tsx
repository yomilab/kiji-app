import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as articleStore from "../stores/articleStore";
import * as feedStore from "../stores/feedStore";
import { feedsManager } from "../services/feeds/feedsManager";
import { feedLibraryMutationBus } from "../services/ui/feedLibraryMutationBus";
import type { Feed } from "../services/feeds/types";
import type { Article } from "../types/article";
import type { ArticleQuery } from "../types/articleQuery";

export interface FeedContextValue {
  feeds: Feed[];
  articles: Article[];
  loading: boolean;
  error: string | null;
  selectedFeedId: string | null;
  searchText: string;
  reloadFeeds: () => Promise<void>;
  selectFeed: (feedId: string | null) => Promise<void>;
  queryArticles: (query?: Partial<ArticleQuery>) => Promise<void>;
  refreshFeed: (feedId: string, options?: { force?: boolean }) => Promise<void>;
  markArticleRead: (hash: string, read: boolean) => Promise<void>;
  toggleArticleStarred: (hash: string) => Promise<boolean>;
  updateArticleSaved: (hash: string, saved: boolean, savedArticleId?: string) => Promise<void>;
  setSearchText: (value: string) => void;
}

const FeedContext = createContext<FeedContextValue | null>(null);

export function FeedProvider({ children }: { children: ReactNode }) {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const requestIdRef = useRef(0);

  const reloadFeeds = useCallback(async () => {
    setFeeds(await feedStore.getAll());
  }, []);

  const queryArticles = useCallback(async (query: Partial<ArticleQuery> = {}) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoading(true);
    setError(null);

    try {
      const result = await articleStore.query({
        feedIds: selectedFeedId ? [selectedFeedId] : query.feedIds,
        searchText: searchText || query.searchText,
        sort: query.sort ?? { field: "publishedDate", order: "desc" },
        limit: query.limit ?? 100,
        includeTotal: query.includeTotal ?? true,
        ...query,
      });
      if (requestIdRef.current === requestId) {
        setArticles(result.articles);
      }
    } catch (errorValue) {
      if (requestIdRef.current === requestId) {
        setError(errorValue instanceof Error ? errorValue.message : String(errorValue));
      }
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [searchText, selectedFeedId]);

  const selectFeed = useCallback(async (feedId: string | null) => {
    setSelectedFeedId(feedId);
  }, []);

  const refreshFeed = useCallback(async (feedId: string, options?: { force?: boolean }) => {
    const result = await feedsManager.refreshFeed(feedId, options);
    feedLibraryMutationBus.publish({
      type: "articles-refreshed",
      feedId,
      insertedCount: result.insertedCount,
    });
    await reloadFeeds();
  }, [reloadFeeds]);

  const markArticleRead = useCallback(async (hash: string, read: boolean) => {
    await articleStore.markRead(hash, read);
    feedLibraryMutationBus.publish({ type: "article-read-updated", hash, read });
    setArticles((current) =>
      current.map((article) => article.hash === hash ? { ...article, read } : article),
    );
  }, []);

  const toggleArticleStarred = useCallback(async (hash: string) => {
    const starred = await articleStore.toggleStarred(hash);
    feedLibraryMutationBus.publish({ type: "article-starred-updated", hash, starred });
    setArticles((current) =>
      current.map((article) => article.hash === hash ? { ...article, starred } : article),
    );
    return starred;
  }, []);

  const updateArticleSaved = useCallback(async (
    hash: string,
    saved: boolean,
    savedArticleId?: string,
  ) => {
    await articleStore.updateSavedStatus(hash, saved, savedArticleId);
    feedLibraryMutationBus.publish({ type: "article-saved-updated", hash, saved, savedArticleId });
    setArticles((current) =>
      current.map((article) =>
        article.hash === hash ? { ...article, saved, savedArticleId } : article,
      ),
    );
  }, []);

  useEffect(() => {
    void reloadFeeds();
  }, [reloadFeeds]);

  useEffect(() => {
    void queryArticles();
  }, [queryArticles]);

  const value = useMemo<FeedContextValue>(() => ({
    feeds,
    articles,
    loading,
    error,
    selectedFeedId,
    searchText,
    reloadFeeds,
    selectFeed,
    queryArticles,
    refreshFeed,
    markArticleRead,
    toggleArticleStarred,
    updateArticleSaved,
    setSearchText,
  }), [
    articles,
    error,
    feeds,
    loading,
    markArticleRead,
    queryArticles,
    refreshFeed,
    reloadFeeds,
    searchText,
    selectFeed,
    selectedFeedId,
    toggleArticleStarred,
    updateArticleSaved,
  ]);

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

export function useFeedContext(): FeedContextValue {
  const value = useContext(FeedContext);
  if (!value) {
    throw new Error("useFeedContext must be used inside FeedProvider");
  }
  return value;
}
