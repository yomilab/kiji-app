import { describe, expect, it } from "vitest";
import {
  isExpectedFeedCommandFailure,
  parseStructuredCommandError,
} from "@/lib/tauriClient/commandError";

describe("commandError", () => {
  it("parses structured feed HTTP errors from invoke failures", () => {
    const parsed = parseStructuredCommandError(new Error(JSON.stringify({
      code: "FEED_HTTP_STATUS",
      message: "HTTP request failed with status 404 Not Found.",
      httpStatus: 404,
    })));

    expect(parsed).toEqual({
      code: "FEED_HTTP_STATUS",
      message: "HTTP request failed with status 404 Not Found.",
      httpStatus: 404,
    });
  });

  it("returns null for legacy plain-string invoke errors", () => {
    expect(parseStructuredCommandError(new Error("HTTP request failed with status 404."))).toBeNull();
  });

  it("treats structured 404 feed failures as expected", () => {
    const error = new Error(JSON.stringify({
      code: "FEED_HTTP_STATUS",
      message: "HTTP request failed with status 404 Not Found.",
      httpStatus: 404,
    }));

    expect(isExpectedFeedCommandFailure("feeds_fetch_with_cache", error)).toBe(true);
    expect(isExpectedFeedCommandFailure("articles_query", error)).toBe(false);
  });

  it("treats structured network timeouts as expected feed failures", () => {
    const error = new Error(JSON.stringify({
      code: "FEED_NETWORK_TIMEOUT",
      message: "Failed to fetch URL: operation timed out",
    }));

    expect(isExpectedFeedCommandFailure("feeds_fetch", error)).toBe(true);
  });

  it("keeps unexpected 500 feed failures at error severity", () => {
    const error = new Error(JSON.stringify({
      code: "FEED_HTTP_STATUS",
      message: "HTTP request failed with status 500 Internal Server Error.",
      httpStatus: 500,
    }));

    expect(isExpectedFeedCommandFailure("feeds_fetch_with_cache", error)).toBe(false);
  });
});
