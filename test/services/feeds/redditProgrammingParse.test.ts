import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { parseFeed } from "@/services/feeds/feedsFetcher";
import { parseFeedWithFeedsmith } from "@/services/feeds/feedsmithAdapter";
import { convertFeedItemsToArticles } from "@/services/articles/articleConverter";

const REDDIT_URL = "https://www.reddit.com/r/programming/.rss";
const FIXTURE_PATH = join(process.cwd(), "test/data/reddit-programming.atom.xml");

describe("reddit programming feed", () => {
  it("parses atom entries from reddit programming rss", () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    const items = parseFeed(raw, REDDIT_URL);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.title).toBeTruthy();
    expect(items[0]?.link).toMatch(/^https:\/\/www\.reddit\.com\//);
  });

  it("feedsmith adapter returns readable items for worker refresh path", () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    const items = parseFeedWithFeedsmith(raw, REDDIT_URL);
    const readable = items.filter((item) => item.title || item.link || item.enclosures?.length);
    expect(readable.length).toBeGreaterThan(0);
    expect(readable[0]?.title).toBeTruthy();
    expect(readable[0]?.link).toMatch(/^https:\/\/www\.reddit\.com\//);
  });

  it("converts parsed items to articles", async () => {
    const raw = readFileSync(FIXTURE_PATH, "utf8");
    const items = parseFeed(raw, REDDIT_URL);
    const articles = await convertFeedItemsToArticles(items.slice(0, 5), {
      feedId: "test-feed-id",
      feedUrl: REDDIT_URL,
      feedTitle: "programming",
    });
    expect(articles.length).toBeGreaterThan(0);
    expect(articles[0]?.title).toBeTruthy();
    expect(articles[0]?.hash).toBeTruthy();
  });
});
