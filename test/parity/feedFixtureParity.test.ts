import { describe, expect, it } from "vitest";
import { parseFeed } from "@/services/feeds/feedsFetcher";
import { parseOpmlEntries } from "@/services/feeds/opmlImportService";
import { parityFixturesAreAvailable, readParityFixture } from "./parityFixtures";

const describeWithFixtures = parityFixturesAreAvailable() ? describe : describe.skip;

describeWithFixtures("Feed fixture parity", () => {
  it("parses simon.xml Atom summary/content", () => {
    const simonXml = readParityFixture("simon.xml");
    const items = parseFeed(simonXml, "https://simonwillison.net/atom/everything/");

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toBe("Introducing Claude Sonnet 4.6");
    expect(items[0].content).toContain("Sonnet 4.6 is out today");
    expect(items[0].summary).toContain("Sonnet 4.6 is out today");
  });

  it("keeps image enclosure metadata from feedwithimage.xml", () => {
    const feedXml = readParityFixture("feedwithimage.xml");
    const items = parseFeed(feedXml, "https://toyokeizai.net/list/feed/rss");
    const imageUrl =
      "https://tk.ismcdn.jp/mwimgs/4/0/1200w/img_404b091d5672eb558b1d82a7c2617876779430.jpg?nextgen=false";

    expect(items).toHaveLength(1);
    expect(items[0].previewImage).toBe(imageUrl);
    expect(items[0].thumbnail?.url).toBe(imageUrl);
    expect(items[0].images).toContain(imageUrl);
    expect(items[0].enclosures).toEqual([
      {
        url: imageUrl,
        type: "image/jpeg",
        length: 127667,
        duration: undefined,
      },
    ]);
  });

  it("parses caminodetexas.xml RSS entries with stable links and titles", () => {
    const feedXml = readParityFixture("caminodetexas.xml");
    const items = parseFeed(feedXml, "https://caminodetexas.substack.com/feed");

    expect(items.length).toBeGreaterThan(0);
    expect(items[0].link).toMatch(/^https:\/\/caminodetexas\.substack\.com\/p\//);
    expect(items[0].title.length).toBeGreaterThan(0);
    expect(items[0].feedId).toBe("https://caminodetexas.substack.com/feed");
  });

  it("parses Feeds.opml and keeps parent group as station", () => {
    const opmlText = readParityFixture("Feeds.opml");
    const entries = parseOpmlEntries(opmlText);

    expect(entries.length).toBeGreaterThan(0);

    const simonEntry = entries.find((entry) => entry.url === "https://simonwillison.net/atom/everything/");
    expect(simonEntry).toEqual(
      expect.objectContaining({
        title: "Simon Willison's Weblog",
        station: "* ☕️ Daily",
      }),
    );
  });
});

describe("Parity fixture availability", () => {
  it("documents when bundled parity fixtures are missing", () => {
    if (parityFixturesAreAvailable()) {
      expect(parityFixturesAreAvailable()).toBe(true);
      return;
    }

    expect(parityFixturesAreAvailable()).toBe(false);
  });
});
