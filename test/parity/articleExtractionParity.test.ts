/**
 * Article extraction parity coverage for shared feed/HTML fixtures.
 * for reader-mode extraction parity (todo 21b).
 */
import { describe, it, expect, vi } from "vitest";
import {
  extractArticleContentFromHtml,
  CONTENT_PARSER_VALUES,
} from "@/services/articles/articleExtractionService";
import { readabilityAdapter } from "@/services/articles/extractors/readabilityAdapter";
import { defuddleAdapter } from "@/services/articles/extractors/defuddleAdapter";
import { stripHtmlToText, countWordsInHtml } from "@/services/articles/extractors/types";

const FIXTURE_URL = "https://example.com/posts/hello-world";

const FIXTURE_HTML = `
<!doctype html>
<html lang="en">
  <head>
    <title>Hello World - Example Blog</title>
    <meta name="author" content="Jane Doe" />
    <meta property="og:image" content="https://cdn.example.com/hero.jpg" />
    <meta property="og:site_name" content="Example Blog" />
    <meta property="article:published_time" content="2025-04-01T10:30:00Z" />
    <meta property="og:description" content="A simple greeting article." />
  </head>
  <body>
    <header><nav>Site nav and ads</nav></header>
    <article>
      <h1>Hello World</h1>
      <p class="byline">By Jane Doe on April 1, 2025</p>
      <p>This is a fairly long paragraph that explains the greeting in
        considerable detail so the article extraction libraries actually score
        the main content area instead of treating it as boilerplate. We need
        enough words for Readability to consider this readerable.</p>
      <p>A second paragraph with additional commentary that also helps push the
        word count up well above the minimum thresholds used by the parsers.
        Lorem ipsum dolor sit amet consectetur adipiscing elit.</p>
      <p>And a third paragraph about cats, dogs, and other domestic animals so
        that the heuristics latch onto a clearly content-shaped block.</p>
    </article>
    <footer>Footer with social links and copyright</footer>
  </body>
</html>
`;

describe("stripHtmlToText", () => {
  it("decodes double-encoded entities by handling &amp; first", () => {
    expect(stripHtmlToText("Hello&amp;nbsp;world")).toBe("Hello world");
    expect(stripHtmlToText("&amp;quot;quoted&amp;quot;")).toBe('"quoted"');
    expect(stripHtmlToText("A &amp; B")).toBe("A & B");
  });

  it("strips tags and collapses whitespace", () => {
    expect(stripHtmlToText("<p>Hi</p>   <p>there</p>")).toBe("Hi there");
    expect(stripHtmlToText("<script>bad()</script><p>safe</p>")).toBe("safe");
  });

  it("counts words ignoring HTML", () => {
    expect(countWordsInHtml("<p>one two three</p>")).toBe(3);
    expect(countWordsInHtml(null)).toBe(0);
    expect(countWordsInHtml("")).toBe(0);
  });
});

describe("content parser adapters", () => {
  const expectArticleShape = (result: Awaited<ReturnType<typeof readabilityAdapter.extract>>) => {
    expect(result).not.toBeNull();
    if (!result) {
      return;
    }
    expect(typeof result.url).toBe("string");
    expect(result.content).toBeTruthy();
    expect(result.content!.length).toBeGreaterThan(50);
    expect(result.wordCount).toBeGreaterThan(10);
    expect(result.domain).toBe("example.com");
  };

  it("readability adapter extracts content", async () => {
    const result = await readabilityAdapter.extract(FIXTURE_URL, FIXTURE_HTML);
    expectArticleShape(result);
    expect(result?.title).toMatch(/Hello World/i);
  });

  it("defuddle adapter extracts content", async () => {
    const result = await defuddleAdapter.extract(FIXTURE_URL, FIXTURE_HTML);
    expectArticleShape(result);
  });
});

describe("extractArticleContentFromHtml dispatcher", () => {
  it("exposes the two supported parser ids", () => {
    expect(CONTENT_PARSER_VALUES).toEqual(["defuddle", "readability"]);
  });

  it("routes to the requested parser", async () => {
    const readabilitySpy = vi.spyOn(readabilityAdapter, "extract");
    const defuddleSpy = vi.spyOn(defuddleAdapter, "extract");

    try {
      await extractArticleContentFromHtml(FIXTURE_URL, FIXTURE_HTML, "readability");
      expect(readabilitySpy).toHaveBeenCalledTimes(1);

      await extractArticleContentFromHtml(FIXTURE_URL, FIXTURE_HTML, "defuddle");
      expect(defuddleSpy).toHaveBeenCalledTimes(1);
    } finally {
      readabilitySpy.mockRestore();
      defuddleSpy.mockRestore();
    }
  });

  it("uses the default parser (defuddle) when none is specified", async () => {
    const defuddleSpy = vi.spyOn(defuddleAdapter, "extract");
    try {
      await extractArticleContentFromHtml(FIXTURE_URL, FIXTURE_HTML);
      expect(defuddleSpy).toHaveBeenCalledTimes(1);
    } finally {
      defuddleSpy.mockRestore();
    }
  });

  it("falls back to readability if defuddle throws", async () => {
    const defuddleSpy = vi.spyOn(defuddleAdapter, "extract").mockRejectedValueOnce(new Error("boom"));
    const readabilitySpy = vi.spyOn(readabilityAdapter, "extract");

    try {
      const result = await extractArticleContentFromHtml(FIXTURE_URL, FIXTURE_HTML, "defuddle");
      expect(defuddleSpy).toHaveBeenCalledTimes(1);
      expect(readabilitySpy).toHaveBeenCalledTimes(1);
      expect(result).not.toBeNull();
    } finally {
      defuddleSpy.mockRestore();
      readabilitySpy.mockRestore();
    }
  });
});
