import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFetchHtmlSafe = vi.fn();

describe("readerModeService", () => {
  beforeEach(() => {
    mockFetchHtmlSafe.mockReset();
    Object.defineProperty(window, "kijiAPI", {
      configurable: true,
      value: { fetchHtmlSafe: mockFetchHtmlSafe },
    });
  });

  describe("fetchAndParse", () => {
    it("successfully fetches and parses valid HTML article", async () => {
      const mockHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Article</title>
          </head>
          <body>
            <article>
              <h1>Test Article</h1>
              <p>This is a test article with some content.</p>
              <p>It has multiple paragraphs.</p>
            </article>
          </body>
        </html>
      `;

      mockFetchHtmlSafe.mockResolvedValue({ html: mockHTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/article");

      expect(result.success).toBe(true);
      expect(result.content).toBeDefined();
      expect(result.content?.title).toBe("Test Article");
      expect(result.content?.content).toContain("test article");
      expect(mockFetchHtmlSafe).toHaveBeenCalledWith("https://example.com/article");
    });

    it("returns cached result on second fetch", async () => {
      const mockHTML = `
        <!DOCTYPE html>
        <html>
          <body>
            <article>
              <h1>Cached Article</h1>
              <p>Content here.</p>
            </article>
          </body>
        </html>
      `;

      mockFetchHtmlSafe.mockResolvedValue({ html: mockHTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result1 = await readerModeService.fetchAndParse("https://example.com/cached");
      const result2 = await readerModeService.fetchAndParse("https://example.com/cached");

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(mockFetchHtmlSafe).toHaveBeenCalledTimes(1);
      expect(result1.content).toEqual(result2.content);
    });

    it("handles fetch errors", async () => {
      mockFetchHtmlSafe.mockRejectedValue(new Error("Network error"));

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/error");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error");
    });

    it("handles HTTP status errors", async () => {
      mockFetchHtmlSafe.mockRejectedValue(new Error("HTTP 404"));

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/missing");

      expect(result.success).toBe(false);
      expect(result.error).toBe("Error 404");
    });

    const structuredError = (code: string, httpStatus?: number) =>
      new Error(JSON.stringify({ code, message: "Request failed.", httpStatus }));

    const ARTICLE_HTML = `<html><body><article><h1>Title</h1>${"<p>Some readable article text that goes on for a while.</p>".repeat(8)}</article></body></html>`;

    it.each([
      [403, "blocked"],
      [401, "blocked"],
      [404, "not-found"],
      [410, "not-found"],
      [500, "unreachable"],
    ])("classifies a site answering HTTP %i as %s without retrying", async (status, failure) => {
      mockFetchHtmlSafe.mockRejectedValue(structuredError("FEED_HTTP_STATUS", status));

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse(`https://example.com/status-${status}`);

      expect(result.success).toBe(false);
      expect(result.failure).toBe(failure);
      expect(result.error).toBe(`Error ${status}`);
      expect(mockFetchHtmlSafe).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["FEED_NETWORK_TIMEOUT", undefined],
      ["FEED_NETWORK_CONNECT", undefined],
      ["FEED_HTTP_STATUS", 503],
    ])("retries %s %s once and returns the article", async (code, status) => {
      mockFetchHtmlSafe.mockRejectedValueOnce(structuredError(code, status));
      mockFetchHtmlSafe.mockResolvedValueOnce({ html: ARTICLE_HTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/flaky");

      expect(result.success).toBe(true);
      expect(mockFetchHtmlSafe).toHaveBeenCalledTimes(2);
    });

    it("reports a site as unreachable when the retry fails too", async () => {
      mockFetchHtmlSafe.mockRejectedValue(structuredError("FEED_NETWORK_TIMEOUT"));

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/down");

      expect(result.success).toBe(false);
      expect(result.failure).toBe("unreachable");
      expect(mockFetchHtmlSafe).toHaveBeenCalledTimes(2);
    });

    it("reports a page with no article text as unreadable", async () => {
      mockFetchHtmlSafe.mockResolvedValue({ html: "", resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/empty");

      expect(result.success).toBe(false);
      expect(result.failure).toBe("unreadable");
    });

    it("handles invalid HTML", async () => {
      mockFetchHtmlSafe.mockResolvedValue({ html: "<invalid><unclosed>", resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/invalid");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("sanitizes HTML (removes scripts)", async () => {
      const mockHTML = `
        <!DOCTYPE html>
        <html>
          <body>
            <article>
              <h1>Article with Scripts</h1>
              <p>Safe content</p>
              <script>alert('malicious');</script>
              <p onclick="alert('bad')">Clickable</p>
            </article>
          </body>
        </html>
      `;

      mockFetchHtmlSafe.mockResolvedValue({ html: mockHTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/scripts");

      expect(result.success).toBe(true);
      expect(result.content?.content).not.toContain("<script>");
      expect(result.content?.content).not.toContain("onclick=");
    });

    it("detects PDF resource type without parsing body content", async () => {
      mockFetchHtmlSafe.mockResolvedValue({
        resourceType: "pdf",
        contentType: "application/pdf",
      });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/doc.pdf");

      expect(result.success).toBe(true);
      expect(result.resourceType).toBe("pdf");
      expect(result.content).toBeUndefined();
    });

    it("handles unsupported content types", async () => {
      mockFetchHtmlSafe.mockResolvedValue({
        resourceType: "unsupported",
        contentType: "application/zip",
      });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const result = await readerModeService.fetchAndParse("https://example.com/archive.zip");

      expect(result.success).toBe(false);
      expect(result.resourceType).toBe("unsupported");
    });
  });

  describe("getCached", () => {
    it("returns null for uncached URL", async () => {
      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      const cached = readerModeService.getCached("https://example.com/uncached");
      expect(cached).toBeNull();
    });

    it("returns cached content for cached URL", async () => {
      const mockHTML = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>Test Article Title</title>
          </head>
          <body>
            <article>
              <h1>Test Article Title</h1>
              <p>Content</p>
            </article>
          </body>
        </html>
      `;

      mockFetchHtmlSafe.mockResolvedValue({ html: mockHTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      await readerModeService.fetchAndParse("https://example.com/test");
      const cached = readerModeService.getCached("https://example.com/test");

      expect(cached).not.toBeNull();
      expect(cached?.title).toBe("Test Article Title");
    });
  });

  describe("clearCache", () => {
    it("clears all cached entries", async () => {
      const mockHTML = `
        <!DOCTYPE html>
        <html>
          <body>
            <article>
              <h1>Test</h1>
              <p>Content</p>
            </article>
          </body>
        </html>
      `;

      mockFetchHtmlSafe.mockResolvedValue({ html: mockHTML, resourceType: "html" });

      const { readerModeService } = await import("@/services/articles/readerModeService");
      readerModeService.clearCache();

      await readerModeService.fetchAndParse("https://example.com/1");
      await readerModeService.fetchAndParse("https://example.com/2");

      expect(readerModeService.getCached("https://example.com/1")).not.toBeNull();

      readerModeService.clearCache();

      expect(readerModeService.getCached("https://example.com/1")).toBeNull();
      expect(readerModeService.getCached("https://example.com/2")).toBeNull();
    });
  });
});
