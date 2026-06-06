import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS as DEFAULT_NATIVE_SETTINGS } from "@/lib/settings";
import { DEFAULT_SETTINGS } from "@/services/settings/types";
import {
  mergeUserSettings,
  SETTINGS_STORAGE_KEYS,
  toNativeAppSettings,
  toRendererPreferences,
} from "@/services/settings/storageModel";

describe("settings storage model", () => {
  it("maps native app settings fields documented in architecture-tauri-app.md", () => {
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS)).sort()).toEqual([
      "articleListWidth",
      "backgroundUpdate",
      "contentParser",
      "layout",
      "savedArticlesSyncFolder",
      "sidebarWidth",
      "theme",
      "windowSize",
    ]);
  });

  it("keeps renderer-only preferences out of native settings", () => {
    const renderer = toRendererPreferences(DEFAULT_SETTINGS);

    expect(renderer.fontFamilies).toEqual(DEFAULT_SETTINGS.fontFamilies);
    expect(renderer.readingLayout).toEqual(DEFAULT_SETTINGS.readingLayout);
    expect(renderer.sidebarLibrary).toEqual(DEFAULT_SETTINGS.sidebarLibrary);
    expect(renderer.smartViews).toEqual(DEFAULT_SETTINGS.smartViews);
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS))).not.toContain("fontFamilies");
  });

  it("merges native settings with renderer preferences for UI consumption", () => {
    const merged = mergeUserSettings(DEFAULT_NATIVE_SETTINGS, toRendererPreferences(DEFAULT_SETTINGS));

    expect(merged.theme).toBe(DEFAULT_NATIVE_SETTINGS.theme);
    expect(merged.fontFamilies).toEqual(DEFAULT_SETTINGS.fontFamilies);
    expect(merged.savedArticlesSyncFolder).toBe(DEFAULT_NATIVE_SETTINGS.savedArticlesSyncFolder);
  });

  it("uses dedicated storage keys for renderer preferences and legacy migration", () => {
    expect(SETTINGS_STORAGE_KEYS.renderer).toBe("user-settings-ui");
    expect(SETTINGS_STORAGE_KEYS.legacy).toBe("user-settings");
  });
});

describe("settingsManager storage boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
    vi.stubEnv("TAURI_ENV_PLATFORM", "macos");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("writes native fields to Rust and renderer fields to localStorage", async () => {
    const updateMock = vi.fn().mockResolvedValue({
      ...DEFAULT_NATIVE_SETTINGS,
      savedArticlesSyncFolder: "/Users/m/Sync/Notes/daily/kiji",
    });

    vi.doMock("@/lib/tauriClient", () => ({
      tauriClient: {
        settings: {
          get: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
          update: updateMock,
        },
      },
    }));

    const { settingsManager } = await import("@/services/settings/settingsManager");

    await settingsManager.setSavedArticlesSyncFolder("/Users/m/Sync/Notes/daily/kiji");
    await settingsManager.setFontFamilies({ uiFont: "Custom UI Font" });

    expect(updateMock).toHaveBeenCalledWith({
      savedArticlesSyncFolder: "/Users/m/Sync/Notes/daily/kiji",
    });

    const rendererRaw = localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer);
    expect(rendererRaw).toContain("Custom UI Font");
    expect(localStorage.getItem(SETTINGS_STORAGE_KEYS.legacy)).toBeNull();
  });

  it("migrates legacy user-settings blob into native + renderer stores", async () => {
    let nativeSettings = { ...DEFAULT_NATIVE_SETTINGS };
    const updateMock = vi.fn(async (patch: Partial<typeof DEFAULT_NATIVE_SETTINGS>) => {
      nativeSettings = {
        ...nativeSettings,
        ...patch,
        windowSize: {
          ...nativeSettings.windowSize,
          ...(patch.windowSize ?? {}),
        },
      };
      return nativeSettings;
    });

    vi.doMock("@/lib/tauriClient", () => ({
      tauriClient: {
        settings: {
          get: vi.fn(async () => nativeSettings),
          update: updateMock,
        },
      },
    }));

    localStorage.setItem(
      SETTINGS_STORAGE_KEYS.legacy,
      JSON.stringify({
        ...DEFAULT_SETTINGS,
        savedArticlesSyncFolder: "/Users/m/Sync/Notes/daily/kiji",
      }),
    );

    const { settingsManager } = await import("@/services/settings/settingsManager");
    const settings = await settingsManager.initialize();

    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        savedArticlesSyncFolder: "/Users/m/Sync/Notes/daily/kiji",
      }),
    );
    expect(settings.savedArticlesSyncFolder).toBe("/Users/m/Sync/Notes/daily/kiji");
    expect(localStorage.getItem(SETTINGS_STORAGE_KEYS.legacy)).toBeNull();
    expect(localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer)).toContain("uiFont");
  });
});
