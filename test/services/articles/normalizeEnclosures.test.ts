import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENCLOSURE_MIME_TYPE,
  normalizeEnclosures,
} from "@/services/articles/normalizeEnclosures";
import { recordToArticle } from "@/stores/articleStore";
import type { ArticleRecord } from "@/lib/tauriClient/contracts";

describe("normalizeEnclosures", () => {
  it("defaults null and missing MIME types", () => {
    expect(
      normalizeEnclosures([
        { url: "https://example.com/episode.mp3", type: null },
        { url: "https://example.com/cover.jpg" },
      ]),
    ).toEqual([
      { url: "https://example.com/episode.mp3", type: DEFAULT_ENCLOSURE_MIME_TYPE },
      { url: "https://example.com/cover.jpg", type: DEFAULT_ENCLOSURE_MIME_TYPE },
    ]);
  });

  it("preserves explicit MIME types and numeric metadata", () => {
    expect(
      normalizeEnclosures([
        {
          url: "https://example.com/episode.mp3",
          type: "audio/mpeg",
          length: 1024,
          duration: 3600,
        },
      ]),
    ).toEqual([
      {
        url: "https://example.com/episode.mp3",
        type: "audio/mpeg",
        length: 1024,
        duration: 3600,
      },
    ]);
  });

  it("drops invalid rows", () => {
    expect(normalizeEnclosures([null, { type: "audio/mpeg" }, { url: "   " }])).toBeUndefined();
  });
});

describe("recordToArticle enclosure normalization", () => {
  it("repairs legacy metadata rows with null enclosure type on read", () => {
    const record: ArticleRecord = {
      hash: "hash-1",
      feedId: "feed-1",
      title: "Episode",
      description: "Description",
      content: "",
      link: null,
      author: null,
      publishedDate: null,
      fetchedDate: "2026-06-23T00:00:00.000Z",
      read: false,
      starred: false,
      saved: false,
      savedArticleId: null,
      lastReadAt: null,
      metadata: {
        enclosures: [{ url: "https://example.com/episode.mp3", type: null }],
      },
      feedUrl: "https://example.com/feed",
      feedTitle: null,
      feedFavicon: null,
      feedFaviconHasTransparency: null,
      feedFaviconBgLight: null,
      feedFaviconBgDark: null,
      feedImage: null,
    };

    expect(recordToArticle(record).enclosures).toEqual([
      { url: "https://example.com/episode.mp3", type: DEFAULT_ENCLOSURE_MIME_TYPE },
    ]);
  });
});
