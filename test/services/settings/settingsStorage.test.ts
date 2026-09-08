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
    expect(renderer.sidebarSectionFold).toEqual(DEFAULT_SETTINGS.sidebarSectionFold);
    expect(renderer.smartViews).toEqual(DEFAULT_SETTINGS.smartViews);
    expect(renderer.uiThemeVariant).toBe(DEFAULT_SETTINGS.uiThemeVariant);
    expect(renderer.surfaceFillOpacity).toBeUndefined();
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS))).not.toContain("fontFamilies");
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS))).not.toContain("uiThemeVariant");
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS))).not.toContain("surfaceFillOpacity");
    expect(Object.keys(toNativeAppSettings(DEFAULT_SETTINGS))).not.toContain("sidebarSectionFold");
  });

  it("merges native settings with renderer preferences for UI consumption", () => {
    const merged = mergeUserSettings(DEFAULT_NATIVE_SETTINGS, toRendererPreferences(DEFAULT_SETTINGS));

    expect(merged.theme).toBe(DEFAULT_NATIVE_SETTINGS.theme);
    expect(merged.fontFamilies).toEqual(DEFAULT_SETTINGS.fontFamilies);
    expect(merged.savedArticlesSyncFolder).toBe(DEFAULT_NATIVE_SETTINGS.savedArticlesSyncFolder);
    expect(merged.uiThemeVariant).toBe(DEFAULT_SETTINGS.uiThemeVariant);
    expect(merged.surfaceFillOpacity).toBeUndefined();
  });

  it("keeps an unset surface fill out of renderer JSON and clamps stored values", () => {
    expect(toRendererPreferences(DEFAULT_SETTINGS).surfaceFillOpacity).toBeUndefined();

    const withFill = toRendererPreferences({
      ...DEFAULT_SETTINGS,
      surfaceFillOpacity: 0.72,
    });
    expect(withFill.surfaceFillOpacity).toBe(0.72);
    expect(Object.keys(toNativeAppSettings({
      ...DEFAULT_SETTINGS,
      surfaceFillOpacity: 0.72,
    }))).not.toContain("surfaceFillOpacity");

    const merged = mergeUserSettings(DEFAULT_NATIVE_SETTINGS, withFill);
    expect(merged.surfaceFillOpacity).toBe(0.72);
  });

  it("stores window position in native settings and falls back to legacy renderer windowPosition", () => {
    const nativeWithPosition = {
      ...DEFAULT_NATIVE_SETTINGS,
      windowSize: {
        width: 900,
        height: 700,
        x: 40,
        y: 60,
      },
    };

    expect(toNativeAppSettings({
      ...DEFAULT_SETTINGS,
      windowSize: {
        width: 900,
        height: 700,
        x: 40,
        y: 60,
      },
    }).windowSize).toEqual({
      width: 900,
      height: 700,
      x: 40,
      y: 60,
    });

    const mergedFromNative = mergeUserSettings(nativeWithPosition, toRendererPreferences(DEFAULT_SETTINGS));
    expect(mergedFromNative.windowSize).toEqual({
      width: 900,
      height: 700,
      x: 40,
      y: 60,
    });

    const mergedFromRendererFallback = mergeUserSettings(
      DEFAULT_NATIVE_SETTINGS,
      {
        ...toRendererPreferences(DEFAULT_SETTINGS),
        windowPosition: { x: 12, y: 34 },
      },
    );
    expect(mergedFromRendererFallback.windowSize).toEqual({
      width: 800,
      height: 600,
      x: 12,
      y: 34,
    });
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
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  it("writes native fields to Rust when only __TAURI_INTERNALS__ is present", async () => {
    vi.unstubAllEnvs();
    const updateMock = vi.fn().mockResolvedValue({
      ...DEFAULT_NATIVE_SETTINGS,
      backgroundUpdate: "every-30m",
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

    await settingsManager.setBackgroundUpdate("every-30m");

    expect(updateMock).toHaveBeenCalledWith({ backgroundUpdate: "every-30m" });
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

  it("does not persist a default surface fill when the key is absent", async () => {
    vi.doMock("@/lib/tauriClient", () => ({
      tauriClient: {
        settings: {
          get: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
          update: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
        },
      },
    }));

    const { settingsManager } = await import("@/services/settings/settingsManager");
    await settingsManager.setUiThemeVariant("classic");

    const rendererRaw = localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer);
    expect(rendererRaw).toBeTruthy();
    expect(JSON.parse(rendererRaw as string).surfaceFillOpacity).toBeUndefined();
    expect(await settingsManager.getSurfaceFillOpacity()).toBeUndefined();
  });

  it("clamps surface fill opacity and keeps it out of native settings", async () => {
    const updateMock = vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS);
    vi.doMock("@/lib/tauriClient", () => ({
      tauriClient: {
        settings: {
          get: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
          update: updateMock,
        },
      },
    }));

    const { settingsManager } = await import("@/services/settings/settingsManager");
    await settingsManager.setSurfaceFillOpacity(0.12);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer) as string).surfaceFillOpacity).toBe(0.4);

    await settingsManager.setSurfaceFillOpacity(1);

    const first = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer) as string);
    expect(first.surfaceFillOpacity).toBe(0.96);
    expect(updateMock).not.toHaveBeenCalled();

    const settings = await settingsManager.getSettings();
    expect(settings.surfaceFillOpacity).toBe(0.96);
    expect(Object.keys(toNativeAppSettings(settings))).not.toContain("surfaceFillOpacity");
  });

  it("writes surface fill synchronously so a dying settings webview can flush", async () => {
    vi.doMock("@/lib/tauriClient", () => ({
      tauriClient: {
        settings: {
          get: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
          update: vi.fn().mockResolvedValue(DEFAULT_NATIVE_SETTINGS),
        },
      },
    }));

    const { settingsManager } = await import("@/services/settings/settingsManager");
    settingsManager.setSurfaceFillOpacityNow(0.64);

    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer) as string).surfaceFillOpacity).toBe(0.64);

    settingsManager.setSurfaceFillOpacityNow(undefined);
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEYS.renderer) as string).surfaceFillOpacity).toBeUndefined();
  });
});
