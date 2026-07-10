import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  applyFontFamiliesToRoot,
  applyReadingLayoutToRoot,
  type FontFamilySettings,
  type ReadingLayoutSettings,
} from "@/services/settings/styleVariables";

function resolveRendererWindowType(search: string): "main" | "settings" | "article" | "update" {
  const windowType = new URLSearchParams(search).get("window");
  if (windowType === "settings" || windowType === "article" || windowType === "update") {
    return windowType;
  }
  return "main";
}

describe("UI layout parity (21b)", () => {
  beforeEach(() => {
    document.documentElement.style.cssText = "";
  });

  afterEach(() => {
    document.documentElement.style.cssText = "";
  });

  it("maps renderer window query params to desktop window branches", () => {
    expect(resolveRendererWindowType("")).toBe("main");
    expect(resolveRendererWindowType("?window=settings")).toBe("settings");
    expect(resolveRendererWindowType("?window=article")).toBe("article");
    expect(resolveRendererWindowType("?window=update")).toBe("update");
    expect(resolveRendererWindowType("?window=article&foo=1")).toBe("article");
  });

  it("applies reading layout CSS variables to the document root", () => {
    const layout: ReadingLayoutSettings = {
      enabled: true,
      fontSize: 20,
      fontWeight: 600,
      lineSpacing: 1.9,
      characterSpacing: 5,
      wordSpacing: 10,
      maxWidth: 680,
      justifyText: true,
    };

    applyReadingLayoutToRoot(layout);

    expect(document.documentElement.style.getPropertyValue("--article-content-font-size")).toBe("20px");
    expect(document.documentElement.style.getPropertyValue("--article-content-font-weight")).toBe("600");
    expect(document.documentElement.style.getPropertyValue("--article-content-line-height")).toBe("1.9");
    expect(document.documentElement.style.getPropertyValue("--max-article-content-width")).toBe("680px");
    expect(document.documentElement.style.getPropertyValue("--article-content-text-align")).toBe("justify");
  });

  it("applies font-family CSS variables to the document root", () => {
    const fonts: FontFamilySettings = {
      uiFont: "Aktiv Grotesk",
      articleTitleFont: "Georgia",
      articleContentFont: "Golos Text",
      articleNonAsciiFont: "PingFang SC",
    };

    applyFontFamiliesToRoot(fonts);

    expect(document.documentElement.style.getPropertyValue("--font-family-ui")).toBe("Aktiv Grotesk");
    expect(document.documentElement.style.getPropertyValue("--font-family-article-title")).toBe("Georgia");
    expect(document.documentElement.style.getPropertyValue("--font-family-article-content")).toBe("Golos Text");
    expect(document.documentElement.style.getPropertyValue("--font-family-article-no-ascii")).toBe("PingFang SC");
  });

  it("ships shared theme CSS variables used by main, settings, and article windows", () => {
    const themeCss = readFileSync(join(process.cwd(), "src/styles/theme.css"), "utf8");

    expect(themeCss).toContain("--theme-text-primary");
    expect(themeCss).toContain("--theme-article-bg");
    expect(themeCss).toContain("--theme-primary-color");
    expect(themeCss).toContain("--font-family-ui");
    expect(themeCss).toContain('html[data-os="windows"]');
    expect(themeCss).toContain("rgba(247, 246, 244, 0.82)");
    expect(themeCss).toContain("rgba(30, 30, 32, 0.88)");
  });
});
