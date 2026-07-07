import { describe, expect, it } from "vitest";
import { convertFeedItemsToArticles } from "@/services/articles/articleConverter";
import { parseFeed } from "@/services/feeds/feedsFetcher";
import {
  collectPublishDateFieldsFromElement,
  collectPublishDateFieldsFromObject,
  isBlockedDateFieldName,
  matchPublishedDate,
  matchPublishedDateFromElement,
  scorePublishDateField,
} from "@/services/feeds/publishDateMatcher";

const JVNS_STYLE_ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Julia Evans</title>
  <link href="https://jvns.ca/atom.xml" rel="self"/>
  <updated>2026-05-15T00:00:00+00:00</updated>
  <entry>
    <title>Moving away from Tailwind</title>
    <link href="https://jvns.ca/blog/2026/05/15/moving-away-from-tailwind/"/>
    <updated>2026-05-15T00:00:00+00:00</updated>
    <id>https://jvns.ca/blog/2026/05/15/moving-away-from-tailwind/</id>
    <content type="html"><![CDATA[<p>Hello!</p>]]></content>
  </entry>
  <entry>
    <title>CSS colour palettes</title>
    <link href="https://jvns.ca/blog/2026/05/04/css-colour-palettes/"/>
    <updated>2026-05-04T00:00:00+00:00</updated>
    <id>https://jvns.ca/blog/2026/05/04/css-colour-palettes/</id>
    <content type="html"><![CDATA[<p>Colours!</p>]]></content>
  </entry>
</feed>`;

describe("publishDateMatcher", () => {
  it("scores publish keywords and blocks duration-like field names", () => {
    expect(scorePublishDateField("published")).toBeGreaterThan(scorePublishDateField("updated")!);
    expect(scorePublishDateField("post-date")).toBeGreaterThan(0);
    expect(scorePublishDateField("itunes:duration")).toBeNull();
    expect(isBlockedDateFieldName("readingTime")).toBe(true);
  });

  it("collects keyword-matched fields from parsed objects", () => {
    const candidates = collectPublishDateFieldsFromObject({
      title: "Example",
      metadata: {
        postDate: "2022-03-10T08:00:00Z",
      },
      itunes: {
        duration: "42:00",
      },
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        fieldName: "postDate",
        value: "2022-03-10T08:00:00Z",
      }),
    ]);
    expect(candidates.some((candidate) => candidate.fieldName === "duration")).toBe(false);
  });

  it("matches publish dates from non-standard XML child elements", () => {
    const rssXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Custom date field</title>
      <link>https://example.com/custom-date</link>
      <guid>https://example.com/custom-date</guid>
      <postDate>2021-11-03T16:20:00Z</postDate>
    </item>
  </channel>
</rss>`;

    const xmlDoc = new DOMParser().parseFromString(rssXml, "text/xml");
    const item = xmlDoc.querySelector("item")!;

    expect(collectPublishDateFieldsFromElement(item).map((candidate) => candidate.fieldName)).toContain("postDate");
    expect(matchPublishedDateFromElement(item)).toBe("2021-11-03T16:20:00.000Z");
  });

  it("prefers explicit candidates before keyword-matched object fields", () => {
    expect(
      matchPublishedDate({
        explicit: ["2024-02-01T00:00:00Z"],
        source: {
          customPublishDate: "2020-01-01T00:00:00Z",
        },
      }),
    ).toBe("2024-02-01T00:00:00.000Z");
  });
});

describe("feed date parsing", () => {
  it("uses atom:updated when atom:published is absent (jvns.ca Hugo feeds)", () => {
    const items = parseFeed(JVNS_STYLE_ATOM, "https://jvns.ca/atom.xml");

    expect(items).toHaveLength(2);
    expect(items[0].publishedDate).toBe("2026-05-15T00:00:00.000Z");
    expect(items[0].updatedDate).toBe("2026-05-15T00:00:00.000Z");
    expect(items[1].publishedDate).toBe("2026-05-04T00:00:00.000Z");
    expect(items[1].updatedDate).toBe("2026-05-04T00:00:00.000Z");
  });

  it("prefers atom:published over atom:updated when both are present", () => {
    const atomXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Both dates</title>
    <link href="https://example.com/post"/>
    <published>2024-01-10T12:00:00Z</published>
    <updated>2024-06-01T12:00:00Z</updated>
    <id>https://example.com/post</id>
    <content type="html">Body</content>
  </entry>
</feed>`;

    const [item] = parseFeed(atomXml, "https://example.com/atom.xml");

    expect(item.publishedDate).toBe("2024-01-10T12:00:00.000Z");
    expect(item.updatedDate).toBe("2024-06-01T12:00:00.000Z");
  });

  it("falls back through RSS date fields", () => {
    const rssXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>DC date only</title>
      <link>https://example.com/dc-date</link>
      <dc:date>2023-08-20T08:30:00Z</dc:date>
    </item>
  </channel>
</rss>`;

    const [item] = parseFeed(rssXml, "https://example.com/rss.xml");

    expect(item.publishedDate).toBe("2023-08-20T08:30:00.000Z");
  });

  it("enriches feedsmith items from non-standard XML date fields", () => {
    const rssXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Custom publish field</title>
      <link>https://example.com/custom-publish-field</link>
      <guid>https://example.com/custom-publish-field</guid>
      <blog:post-date xmlns:blog="https://example.com/ns">2019-07-18T10:15:00Z</blog:post-date>
    </item>
  </channel>
</rss>`;

    const [item] = parseFeed(rssXml, "https://example.com/rss.xml");

    expect(item.publishedDate).toBe("2019-07-18T10:15:00.000Z");
  });

  it("does not stamp fetch time when feed items only expose updated dates", async () => {
    const items = parseFeed(JVNS_STYLE_ATOM, "https://jvns.ca/atom.xml");
    const fetchTime = new Date("2026-06-15T12:00:00.000Z");
    const articles = await convertFeedItemsToArticles(items, {
      feedId: "jvns-feed",
      feedUrl: "https://jvns.ca/atom.xml",
      fetchTime,
    });

    expect(articles[0].publishedDate).toBe("2026-05-15T00:00:00.000Z");
    expect(articles[1].publishedDate).toBe("2026-05-04T00:00:00.000Z");
    expect(articles[0].publishedDate).not.toBe(articles[0].fetchedDate);
  });
});
