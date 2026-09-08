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
    expect(themeCss).toContain("--app-surface-fill-alpha: 0.55");
    expect(themeCss).toContain("--app-surface-fill-alpha: 0.45");
    expect(themeCss).toContain("--app-surface-fill-alpha: 0.75");
    expect(themeCss).toContain("--app-surface-fill-alpha: 0.80");
    expect(themeCss).not.toContain("--app-surface-fill-alpha: 0.88");
    expect(themeCss).not.toContain("--app-surface-fill-alpha: 0.90");
    expect(themeCss).toContain("rgba(250, 250, 249, var(--app-surface-fill-alpha))");
    expect(themeCss).toContain("rgba(27, 27, 29, var(--app-surface-fill-alpha))");
    expect(themeCss).toContain("--theme-article-bg: rgba(250, 250, 249, 0.55)");
    expect(themeCss).toContain("--theme-article-bg: rgba(250, 250, 249, 0.88)");
    expect(themeCss).toContain("--theme-article-bg: rgba(27, 27, 29, 0.90)");
    expect(themeCss).not.toContain("--theme-article-bg: rgba(250, 250, 249, var(--app-surface-fill-alpha))");
  });

  it("keeps Windows/Linux AppMenuBar fills independent of sidebar alpha", () => {
    const menuCss = readFileSync(
      join(process.cwd(), "src/components/AppMenuBar/AppMenuBar.css"),
      "utf8",
    );
    const dropdownCss = readFileSync(
      join(process.cwd(), "src/components/common/DropdownMenu/DropdownMenu.css"),
      "utf8",
    );

    expect(menuCss).not.toContain("var(--theme-sidebar-bg)");
    expect(menuCss).toContain("rgba(250, 249, 247, 0.96)");
    expect(menuCss).toContain("rgba(27, 27, 29, 0.96)");
    expect(dropdownCss).toContain("rgba(255, 255, 255, 0.5)");
  });

  it("keeps Classic list solid and the embedded reader opaque over the deck", () => {
    const classicCss = readFileSync(join(process.cwd(), "src/styles/ui-theme-classic.css"), "utf8");
    const baseCss = readFileSync(join(process.cwd(), "src/styles/base.css"), "utf8");
    const articleViewCss = readFileSync(
      join(process.cwd(), "src/components/MainArea/ArticleView.css"),
      "utf8",
    );

    expect(classicCss).toContain("--theme-article-bg: #FAF9F7");
    expect(classicCss).toContain("--theme-article-view-bg: #1B1B1D");
    expect(classicCss).toContain('html[data-ui-theme="classic"] .article-view-embedded');
    expect(classicCss).not.toMatch(/html\[data-ui-theme="classic"\] \.article-view\s*\{/);
    expect(classicCss).not.toContain("var(--app-surface-fill-alpha)");
    expect(classicCss).not.toContain("var(--app-reader-fill-alpha)");

    expect(baseCss).toContain(".app-container.article-view-active .article-view-embedded");
    expect(baseCss).toContain("var(--theme-article-view-solid-bg)");

    expect(articleViewCss).toContain(".article-view:not(.article-view-embedded)");
    expect(articleViewCss).toContain(
      "html[data-os=\"windows\"] .article-view.article-view-embedded",
    );
    expect(articleViewCss).toContain(".app-container.article-view-active .article-view-embedded");
    expect(articleViewCss).toContain("transition: none");
  });

  it("settings content pane tokens follow data-theme light and dark", () => {
    const settingsCss = readFileSync(
      join(process.cwd(), "src/components/SettingsWindow/SettingsWindow.css"),
      "utf8",
    );

    expect(settingsCss).toContain("--settings-main-bg: #faf9f7");
    expect(settingsCss).toContain('[data-theme="dark"] .settings-window');
    expect(settingsCss).toContain("--settings-main-bg: #1b1b1d");
    expect(settingsCss).toContain("--settings-row-border");
    expect(settingsCss).toContain("--settings-select-chevron");
  });
});
