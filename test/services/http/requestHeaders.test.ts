import { describe, expect, it } from "vitest";
import {
  buildAcceptLanguageFromLocales,
  buildDefaultHeaders,
  resolveBrowserAcceptLanguage,
  sanitizeRequestHeaders,
} from "@/services/http/requestHeaders";

describe("requestHeaders", () => {
  it("orders the primary locale first with base language and wildcard", () => {
    const header = buildAcceptLanguageFromLocales(["zh-CN", "en-US"]);
    expect(header.startsWith("zh-CN,")).toBe(true);
    expect(header).toContain("zh;q=0.9");
    expect(header).toContain("en-US;q=0.8");
    expect(header).toContain("ja-JP;q=");
    expect(header.endsWith("*;q=0.1")).toBe(true);
  });

  it("falls back to broad language list when no locales are available", () => {
    const header = buildAcceptLanguageFromLocales([]);
    expect(header.startsWith("en-US,")).toBe(true);
    expect(header).toContain("ja-JP;q=");
    expect(header).toContain("fr-FR;q=");
    expect(header.endsWith("*;q=0.1")).toBe(true);
  });

  it("buildDefaultHeaders uses runtime Accept-Language resolution", () => {
    const header = buildDefaultHeaders()["Accept-Language"];
    expect(header).toBe(resolveBrowserAcceptLanguage());
    expect(header.endsWith("*;q=0.1")).toBe(true);
  });

  it("sanitizeRequestHeaders backfills Accept-Language when missing", () => {
    const headers = sanitizeRequestHeaders("https://example.com/article", {});
    expect(headers["Accept-Language"]).toBe(resolveBrowserAcceptLanguage());
  });
});
