import { describe, expect, it } from "vitest";
import { FontStack } from "@/services/settings/fontFamilies";
import {
  DEFAULT_READER_THEME,
  READER_THEMES,
  findReaderTheme,
  normalizeReaderTheme,
  resolveActiveReaderTheme,
  resolveThemedFontFamilies,
  resolveThemedReadingLayout,
} from "@/services/settings/readerThemes";
import { DEFAULT_SETTINGS } from "@/services/settings/types";
import {
  mergeUserSettings,
  toNativeAppSettings,
  toRendererPreferences,
} from "@/services/settings/storageModel";

const sepia = findReaderTheme("sepia")!;

describe("reader theme registry", () => {
  it("has unique ids and never shadows the default palette", () => {
    const ids = READER_THEMES.map((theme) => theme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(DEFAULT_READER_THEME);
  });

  it("does not ship the removed themes", () => {
    const ids = READER_THEMES.map((theme) => theme.id);
    expect(ids).not.toContain("bold");
    expect(ids).not.toContain("nord");
    expect(ids).not.toContain("dusk");
  });

  it("defaults to the built-in Yomi Reader palette", () => {
    expect(DEFAULT_SETTINGS.readerTheme).toBe("default");
  });
});

describe("normalizeReaderTheme", () => {
  it("keeps a known theme id", () => {
    expect(normalizeReaderTheme("sepia")).toBe("sepia");
    expect(normalizeReaderTheme("quiet")).toBe("quiet");
  });

  it("falls back to default for unknown, removed, or malformed values", () => {
    expect(normalizeReaderTheme(undefined)).toBe("default");
    expect(normalizeReaderTheme("bold")).toBe("default");
    expect(normalizeReaderTheme(42)).toBe("default");
  });

  describe("carrying over pre-pairing { light, dark } settings", () => {
    it("prefers the light-slot theme", () => {
      expect(normalizeReaderTheme(undefined, { light: "sepia", dark: "quiet" })).toBe("sepia");
    });

    it("uses the dark-slot theme when the light slot was default", () => {
      expect(normalizeReaderTheme(undefined, { light: "default", dark: "midnight" })).toBe("midnight");
    });

    it("skips a removed preset", () => {
      expect(normalizeReaderTheme(undefined, { light: "bold", dark: "oled-night" })).toBe("oled-night");
      expect(normalizeReaderTheme(undefined, { light: "bold", dark: "default" })).toBe("default");
    });

    it("ignores the old slots once a new value is stored", () => {
      expect(normalizeReaderTheme("paper", { light: "sepia", dark: "quiet" })).toBe("paper");
      expect(normalizeReaderTheme("default", { light: "sepia", dark: "quiet" })).toBe("default");
    });
  });
});

describe("resolveActiveReaderTheme", () => {
  it("returns the chosen theme for either scheme", () => {
    expect(resolveActiveReaderTheme("sepia")).toBe(sepia);
  });

  it("returns undefined for the default palette", () => {
    expect(resolveActiveReaderTheme("default")).toBeUndefined();
  });
});

describe("resolveThemedFontFamilies", () => {
  it("uses theme article fonts while the user is on the defaults", () => {
    const fonts = resolveThemedFontFamilies(DEFAULT_SETTINGS.fontFamilies, sepia);
    expect(fonts.articleTitleFont).toBe(sepia.titleFont);
    expect(fonts.articleContentFont).toBe(sepia.bodyFont);
    expect(fonts.uiFont).toBe(DEFAULT_SETTINGS.fontFamilies.uiFont);
    expect(fonts.articleNonAsciiFont).toBe(DEFAULT_SETTINGS.fontFamilies.articleNonAsciiFont);
  });

  it("keeps any article font the user picked, per role", () => {
    const fonts = resolveThemedFontFamilies(
      { ...DEFAULT_SETTINGS.fontFamilies, articleContentFont: FontStack.GEORGIA },
      sepia,
    );
    expect(fonts.articleTitleFont).toBe(sepia.titleFont);
    expect(fonts.articleContentFont).toBe(FontStack.GEORGIA);
  });

  it("returns the user fonts unchanged without a theme", () => {
    expect(resolveThemedFontFamilies(DEFAULT_SETTINGS.fontFamilies, undefined)).toBe(DEFAULT_SETTINGS.fontFamilies);
  });
});

describe("resolveThemedReadingLayout", () => {
  const defaults = DEFAULT_SETTINGS.readingLayout;

  it("applies theme weight and line height while custom layout is off", () => {
    const layout = resolveThemedReadingLayout(defaults, sepia, defaults);
    expect(layout.enabled).toBe(true);
    expect(layout.fontWeight).toBe(sepia.contentFontWeight);
    expect(layout.lineSpacing).toBe(sepia.contentLineHeight);
    expect(layout.fontSize).toBe(defaults.fontSize);
    expect(layout.maxWidth).toBe(defaults.maxWidth);
  });

  it("keeps a user's custom reading layout untouched", () => {
    const custom = { ...defaults, enabled: true, fontWeight: 300, lineSpacing: 2.1 };
    expect(resolveThemedReadingLayout(custom, sepia, defaults)).toBe(custom);
  });
});

describe("reader theme persistence", () => {
  it("stores the choice in renderer preferences, not native settings", () => {
    const settings = { ...DEFAULT_SETTINGS, readerTheme: "solarized" };
    const renderer = toRendererPreferences(settings);
    expect(renderer.readerTheme).toBe("solarized");
    expect(Object.keys(toNativeAppSettings(settings))).not.toContain("readerTheme");
    expect(mergeUserSettings(toNativeAppSettings(settings), renderer).readerTheme).toBe("solarized");
  });
});
