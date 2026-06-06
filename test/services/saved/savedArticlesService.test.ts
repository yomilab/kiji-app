import { beforeEach, describe, expect, it, vi } from "vitest";

import { savedArticlesService } from "@/services/saved/savedArticlesService";
import { savedArticlesManager } from "@/services/articles/savedArticlesManager";
import { savedArticlesSyncEventBus } from "@/services/saved/sync/savedArticlesSyncEventBus";
import * as articleStore from "@/stores/articleStore";
import type { Article } from "@/types/article";

vi.mock("@/stores/articleStore", () => ({
  getByHash: vi.fn(),
}));

vi.mock("@/services/articles/savedArticlesManager", () => ({
  savedArticlesManager: {
    saveArticle: vi.fn(),
    unsaveArticle: vi.fn(),
    getAllSavedArticles: vi.fn(),
    querySavedArticles: vi.fn(),
    findSavedArticle: vi.fn(),
    updateLastReadAt: vi.fn(),
  },
}));

vi.mock("@/services/saved/sync/savedArticlesSyncEventBus", () => ({
  savedArticlesSyncEventBus: {
    publish: vi.fn(),
  },
}));

const makeArticle = (overrides: Partial<Article> = {}): Article => ({
  hash: "hash-1",
  title: "Saved title",
  description: "Saved description",
  content: "Saved content",
  link: "https://example.com/post",
  fetchedDate: "2026-02-15T10:00:00.000Z",
  feedId: "saved",
  feedUrl: "https://example.com/post",
  read: true,
  starred: false,
  saved: true,
  ...overrides,
});

describe("SavedArticlesService.enrichSavedViewArticlesMeta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates feed-linked saved rows from SQLite article metadata", async () => {
    vi.mocked(articleStore.getByHash).mockResolvedValue(
      makeArticle({
        hash: "hash-1",
        feedId: "feed-1",
        feedUrl: "https://feed.one/rss",
        feedTitle: "Feed One",
        feedFavicon: "data:image/png;base64,feedone",
        publishedDate: "2026-02-14T09:30:00.000Z",
        previewImage: "https://cdn.example.com/preview.jpg",
      }),
    );

    const savedItem = makeArticle({
      hash: "hash-1",
      feedId: "feed-1",
      feedUrl: "https://feed.one/rss",
      isFeedLinked: true,
      publishedDate: undefined,
      previewImage: undefined,
      feedTitle: undefined,
      feedFavicon: undefined,
    });

    const [enriched] = await savedArticlesService.enrichSavedViewArticlesMeta([savedItem]);

    expect(enriched.feedTitle).toBe("Feed One");
    expect(enriched.publishedDate).toBe("2026-02-14T09:30:00.000Z");
    expect(enriched.previewImage).toBe("https://cdn.example.com/preview.jpg");
  });

  it("does not hydrate metadata for non-linked saved rows", async () => {
    vi.mocked(articleStore.getByHash).mockResolvedValue(null);

    const savedItem = makeArticle({
      hash: "external-hash",
      feedId: "saved",
      feedUrl: "https://example.com/external",
      isFeedLinked: false,
    });

    const [enriched] = await savedArticlesService.enrichSavedViewArticlesMeta([savedItem]);

    expect(enriched.feedTitle).toBeUndefined();
    expect(articleStore.getByHash).not.toHaveBeenCalled();
  });
});

describe("SavedArticlesService sync events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes folder-sync events after save", async () => {
    vi.mocked(savedArticlesManager.saveArticle).mockResolvedValue({
      id: "saved-1",
      articleHash: "hash-1",
      title: "Saved title",
      description: "",
      content: "",
      savedDate: "2026-02-15T10:00:00.000Z",
      feedId: "feed-1",
      feedUrl: "https://example.com/feed.xml",
      highlights: [],
    });

    await savedArticlesService.saveArticle(makeArticle());

    expect(savedArticlesSyncEventBus.publish).toHaveBeenCalledWith({
      type: "saved",
      savedArticleId: "saved-1",
      title: "Saved title",
    });
  });

  it("publishes folder-sync events after unsave", async () => {
    vi.mocked(savedArticlesManager.unsaveArticle).mockResolvedValue(undefined);

    await savedArticlesService.unsaveArticle("saved-1", "Saved title");

    expect(savedArticlesSyncEventBus.publish).toHaveBeenCalledWith({
      type: "unsaved",
      savedArticleId: "saved-1",
      title: "Saved title",
    });
  });
});
