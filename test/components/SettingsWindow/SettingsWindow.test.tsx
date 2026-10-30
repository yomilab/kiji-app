import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsWindow } from "@/components/SettingsWindow/SettingsWindow";
import { logger } from "@/services/logger";
import { settingsManager } from "@/services/settings";
import { FontStack } from "@/services/settings/fontFamilies";

const defaultReadingLayout = {
  enabled: false,
  fontSize: 18,
  fontWeight: 500,
  lineSpacing: 1.8,
  characterSpacing: 0,
  wordSpacing: 0,
  maxWidth: 720,
  justifyText: false,
};

const themeValue = {
  fontFamilies: {
    uiFont: "System",
    articleTitleFont: "System",
    articleContentFont: "System",
    articleNonAsciiFont: FontStack.CJK_SYSTEM_DEFAULT,
  },
  updateFontFamilies: vi.fn().mockResolvedValue(undefined),
  readingLayout: {
    ...defaultReadingLayout,
    enabled: true,
  },
  updateReadingLayout: vi.fn(),
};

themeValue.updateReadingLayout.mockImplementation(async (patch) => {
  themeValue.readingLayout = {
    ...themeValue.readingLayout,
    ...patch,
  };
});

vi.mock("@/services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    exportDiagnostics: vi.fn().mockResolvedValue({
      canceled: false,
      filePath: "/tmp/feedone-error-report.zip",
    }),
  },
}));

vi.mock("@/services/settings", () => ({
  DEFAULT_SETTINGS: {
    contentParser: "defuddle",
    uiThemeVariant: "modern",
    readingLayout: {
      enabled: false,
      fontSize: 18,
      fontWeight: 500,
      lineSpacing: 1.8,
      characterSpacing: 0,
      wordSpacing: 0,
      maxWidth: 720,
      justifyText: false,
    },
  },
  UI_THEME_VARIANT_OPTIONS: [
    { value: "modern", label: "Modern" },
    { value: "classic", label: "Classic" },
  ],
  settingsManager: {
    getSettings: vi.fn().mockResolvedValue({
      readTrackingAlgorithm: "on-open",
      backgroundUpdate: "every-15m",
      savedArticlesSyncFolder: null,
      contentParser: "defuddle",
      uiThemeVariant: "modern",
    }),
    setReadTrackingAlgorithm: vi.fn().mockResolvedValue(undefined),
    setSavedArticlesSyncFolder: vi.fn().mockResolvedValue(undefined),
    setBackgroundUpdate: vi.fn().mockResolvedValue(undefined),
    setContentParser: vi.fn().mockResolvedValue(undefined),
    setUiThemeVariant: vi.fn().mockResolvedValue(undefined),
    setArticleListDensity: vi.fn().mockResolvedValue(undefined),
    setSurfaceFillOpacity: vi.fn().mockResolvedValue(undefined),
    setSurfaceFillOpacityNow: vi.fn(),
    saveSettings: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("@/contexts/ThemeContext", () => ({
  useTheme: () => themeValue,
}));

vi.mock("@/services/shortcuts/shortcutService", async () => {
  const actual = await vi.importActual<typeof import("@/services/shortcuts/shortcutService")>(
    "@/services/shortcuts/shortcutService",
  );
  return {
    ...actual,
    isCloseOnEscapeShortcut: vi.fn().mockReturnValue(false),
    keybindingService: {
      ...actual.keybindingService,
      register: vi.fn().mockReturnValue((): void => undefined),
    },
  };
});

function clickSidebarCategory(label: string): void {
  const nav = document.querySelector(".settings-sidebar nav");
  expect(nav).not.toBeNull();
  fireEvent.click(within(nav as HTMLElement).getByRole("button", { name: label }));
}

describe("SettingsWindow", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    themeValue.readingLayout = {
      ...defaultReadingLayout,
      enabled: true,
    };
    themeValue.updateFontFamilies.mockClear();
    themeValue.updateReadingLayout.mockClear();
    themeValue.updateReadingLayout.mockImplementation(async (patch) => {
      themeValue.readingLayout = {
        ...themeValue.readingLayout,
        ...patch,
      };
    });
    vi.mocked(logger.exportDiagnostics).mockResolvedValue({
      canceled: false,
      filePath: "/tmp/feedone-error-report.zip",
    });
    vi.mocked(settingsManager.getSettings).mockResolvedValue({
      readTrackingAlgorithm: "on-open",
      backgroundUpdate: "every-15m",
      savedArticlesSyncFolder: null,
      contentParser: "defuddle",
    });
    window.kijiAPI = {
      notifySettingsChanged: vi.fn().mockResolvedValue(undefined),
      pickSavedArticlesSyncFolder: vi.fn().mockResolvedValue({
        canceled: false,
        folderPath: "/tmp/saved-sync",
      }),
      getSystemAppIconState: vi.fn().mockResolvedValue({
        iconPath: null,
        previewDataUrl: null,
        hasCustomIcon: false,
        iconVariant: "light",
      }),
      setSystemAppIconVariant: vi.fn().mockResolvedValue({
        iconPath: null,
        previewDataUrl: null,
        hasCustomIcon: false,
        iconVariant: "light",
      }),
      windowClose: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.kijiAPI;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    document.documentElement.removeAttribute("data-os");
    document.documentElement.style.removeProperty("--app-surface-fill-alpha");
    document.documentElement.style.removeProperty("--app-reader-fill-alpha");
  });

  it("exports an error report and shows inline status", async () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Contact");
    fireEvent.click(screen.getByRole("button", { name: "Export Error Report" }));

    await waitFor(() => {
      expect(logger.exportDiagnostics).toHaveBeenCalled();
    });

    expect(await screen.findByText(/Error report saved to \/tmp\/feedone-error-report\.zip/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not wait for settings notification before updating saved article sync UI", async () => {
    // Native settings sync is covered in kijiDesktopApi.settings.test.ts.
    window.kijiAPI.notifySettingsChanged = vi.fn(
      () => new Promise<void>(() => undefined),
    ) as typeof window.kijiAPI.notifySettingsChanged;

    render(<SettingsWindow />);

    clickSidebarCategory("General");
    fireEvent.click(screen.getByRole("switch", { name: "Enable saved article sync" }));

    await waitFor(() => {
      expect(settingsManager.setSavedArticlesSyncFolder).toHaveBeenCalledWith("/tmp/saved-sync");
    });

    expect(await screen.findByText("/tmp/saved-sync")).toBeInTheDocument();
    expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("shows and saves the East Asian reading font setting", async () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Reading");
    const noAsciiRow = screen.getByText("East Asian text").closest(".settings-item");
    expect(noAsciiRow).not.toBeNull();
    expect(within(noAsciiRow as HTMLElement).getByRole("option", { name: "System Default" })).toBeInTheDocument();
    expect(within(noAsciiRow as HTMLElement).getByRole("option", { name: "PingFang SC (Chinese)" })).toBeInTheDocument();
    expect(within(noAsciiRow as HTMLElement).getByRole("option", { name: "Yu Gothic (Japanese)" })).toBeInTheDocument();
    expect(within(noAsciiRow as HTMLElement).getByRole("option", { name: "Malgun Gothic (Korean)" })).toBeInTheDocument();
    expect(within(noAsciiRow as HTMLElement).queryByRole("option", { name: "Roboto" })).toBeNull();

    fireEvent.change(within(noAsciiRow as HTMLElement).getByRole("combobox"), {
      target: { value: FontStack.PINGFANG_SC },
    });

    await waitFor(() => {
      expect(themeValue.updateFontFamilies).toHaveBeenCalledWith({ articleNonAsciiFont: FontStack.PINGFANG_SC });
    });
  });

  it("applies surface opacity while dragging and persists once on commit", async () => {
    document.documentElement.setAttribute("data-os", "windows");
    render(<SettingsWindow />);
    clickSidebarCategory("Appearance");

    const slider = await screen.findByRole("slider", { name: "Surface opacity" });
    expect(slider).toHaveValue("88");
    expect(settingsManager.setSurfaceFillOpacity).not.toHaveBeenCalled();

    fireEvent.input(slider, { target: { value: "70" } });
    expect(settingsManager.setSurfaceFillOpacityNow).not.toHaveBeenCalled();
    expect(window.kijiAPI.notifySettingsChanged).not.toHaveBeenCalled();
    expect(document.documentElement.style.getPropertyValue("--app-surface-fill-alpha")).toBe("0.7");

    fireEvent.pointerUp(slider);

    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledTimes(1);
    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledWith(0.7);
    await waitFor(() => {
      expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalledTimes(1);
    });
  });

  it("resets surface opacity by unsetting the stored key", async () => {
    document.documentElement.setAttribute("data-os", "windows");
    render(<SettingsWindow />);
    clickSidebarCategory("Appearance");

    expect(screen.getByText("Sidebar and Settings sidebar fill.")).toBeInTheDocument();
    expect(screen.queryByText(/The article list and in-app reader/)).toBeNull();

    const slider = await screen.findByRole("slider", { name: "Surface opacity" });
    fireEvent.input(slider, { target: { value: "70" } });
    expect(document.documentElement.style.getPropertyValue("--app-surface-fill-alpha")).toBe("0.7");

    fireEvent.click(screen.getByRole("button", { name: "Reset surface opacity" }));

    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledTimes(1);
    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledWith(undefined);
    expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalledTimes(1);
    expect(document.documentElement.style.getPropertyValue("--app-surface-fill-alpha")).toBe("");
    expect(slider).toHaveValue("88");

    cleanup();
    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledTimes(1);
  });

  it("flushes a dirty surface-opacity thumb when the settings window unmounts", async () => {
    render(<SettingsWindow />);
    clickSidebarCategory("Appearance");

    const slider = await screen.findByRole("slider", { name: "Surface opacity" });
    fireEvent.input(slider, { target: { value: "64" } });
    expect(settingsManager.setSurfaceFillOpacityNow).not.toHaveBeenCalled();

    cleanup();

    expect(settingsManager.setSurfaceFillOpacityNow).toHaveBeenCalledWith(0.64);
    expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalled();
  });

  it("offers Ripple, Ripple Dark, Light, Dark, Circle and Circle Dark app icons", async () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Appearance");

    const iconGroup = await screen.findByRole("group", { name: "Default app icon" });
    const labels = within(iconGroup).getAllByRole("button").map((button) => button.textContent);
    expect(labels).toEqual(["Ripple", "Ripple Dark", "Light", "Dark", "Circle", "Circle Dark"]);
    // The mocked stored state is "light", so Light stays selected.
    expect(within(iconGroup).getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(iconGroup).getByRole("button", { name: "Ripple Dark" }));

    await waitFor(() => {
      expect(window.kijiAPI.setSystemAppIconVariant).toHaveBeenCalledWith("ripple-dark");
    });

    fireEvent.click(within(iconGroup).getByRole("button", { name: "Circle Dark" }));

    await waitFor(() => {
      expect(window.kijiAPI.setSystemAppIconVariant).toHaveBeenCalledWith("circle-dark");
    });
  });

  it("places the Assistant tab between Shortcuts and Contact", () => {
    render(<SettingsWindow />);
    const nav = document.querySelector(".settings-sidebar nav") as HTMLElement;
    const labels = within(nav).getAllByRole("button").map((button) => button.textContent?.trim());
    expect(labels).toEqual(["General", "Appearance", "Reading", "Shortcuts", "Assistant", "Contact"]);
  });

  it("shows toggle feed view mode in shortcuts instead of refresh current view", () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Shortcuts");

    const articleSection = screen.getByText("Article").closest("section");

    expect(articleSection).not.toBeNull();
    expect(within(articleSection as HTMLElement).getByText("Toggle Feed View Mode")).toBeInTheDocument();
    expect(screen.getByText("I")).toBeInTheDocument();
    expect(screen.queryByText("Refresh Current View")).toBeNull();
  });

  it("keeps reading sliders on the same step after settings reload", async () => {
    const cases = [
      { label: "Font size", sliderValue: -1, expectedPatch: { fontSize: 17 } },
      { label: "Font weight", sliderValue: -1, expectedPatch: { fontWeight: 450 } },
      { label: "Line spacing", sliderValue: -1, expectedPatch: { lineSpacing: 1.75 } },
      { label: "Text width", sliderValue: -1, expectedPatch: { maxWidth: 710 } },
    ];

    for (const { label, sliderValue, expectedPatch } of cases) {
      themeValue.readingLayout = {
        ...defaultReadingLayout,
        enabled: true,
      };
      themeValue.updateReadingLayout.mockClear();

      const view = render(<SettingsWindow />);
      clickSidebarCategory("Reading");

      fireEvent.change(screen.getByRole("slider", { name: label }), {
        target: { value: String(sliderValue) },
      });

      await waitFor(() => {
        expect(themeValue.updateReadingLayout).toHaveBeenCalledWith(expectedPatch);
      });

      view.unmount();

      const reloadedView = render(<SettingsWindow />);
      clickSidebarCategory("Reading");

      expect(screen.getByRole("slider", { name: label })).toHaveValue(String(sliderValue));
      reloadedView.unmount();
    }
  });
  it("marks the active category and shows its title and subtitle in the pane header", () => {
    render(<SettingsWindow />);
    const nav = screen.getByRole("navigation", { name: "Settings" });

    expect(within(nav).getByRole("button", { name: "General" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 2, name: "General" })).toBeInTheDocument();

    clickSidebarCategory("Reading");

    expect(within(nav).getByRole("button", { name: "Reading" })).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("button", { name: "General" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { level: 2, name: "Reading" })).toBeInTheDocument();
    expect(screen.getByText("Fonts and layout for articles.")).toBeInTheDocument();
  });

  it("labels each select with its row title", async () => {
    render(<SettingsWindow />);

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: "Check for new articles" })).toHaveValue("every-15m");
    });
    expect(screen.getByRole("combobox", { name: "Article cleanup" })).toHaveValue("defuddle");

    clickSidebarCategory("Reading");
    expect(screen.getByRole("combobox", { name: "Titles" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Body text" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "East Asian text" })).toBeInTheDocument();
  });

  it("saves the background update interval from the General pane", async () => {
    render(<SettingsWindow />);

    const select = screen.getByRole("combobox", { name: "Check for new articles" });
    await waitFor(() => expect(select).toHaveValue("every-15m"));
    fireEvent.change(select, { target: { value: "every-1h" } });

    await waitFor(() => {
      expect(settingsManager.setBackgroundUpdate).toHaveBeenCalledWith("every-1h");
    });
    expect(select).toHaveValue("every-1h");
  });

  it("shows the synced folder with a Change button that picks a new folder", async () => {
    vi.mocked(settingsManager.getSettings).mockResolvedValue({
      readTrackingAlgorithm: "on-open",
      backgroundUpdate: "every-15m",
      savedArticlesSyncFolder: "/Users/me/Saved",
      contentParser: "defuddle",
    });
    render(<SettingsWindow />);

    expect(await screen.findByText("/Users/me/Saved")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable saved article sync" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Change…" }));

    await waitFor(() => {
      expect(window.kijiAPI.pickSavedArticlesSyncFolder).toHaveBeenCalledWith("/Users/me/Saved");
    });
    expect(await screen.findByText("/tmp/saved-sync")).toBeInTheDocument();
    expect(settingsManager.setSavedArticlesSyncFolder).toHaveBeenCalledWith("/tmp/saved-sync");
  });

  it("switches text alignment with the segmented control and disables it with the custom layout off", async () => {
    render(<SettingsWindow />);
    clickSidebarCategory("Reading");

    const alignment = screen.getByRole("group", { name: "Text alignment" });
    expect(within(alignment).getByRole("button", { name: "Left" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(alignment).getByRole("button", { name: "Justified" }));
    await waitFor(() => {
      expect(themeValue.updateReadingLayout).toHaveBeenCalledWith({ justifyText: true });
    });
    expect(within(alignment).getByRole("button", { name: "Justified" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("switch", { name: "Enable custom reading layout" }));
    await waitFor(() => {
      expect(themeValue.updateReadingLayout).toHaveBeenCalledWith({ enabled: false });
    });
    expect(within(alignment).getByRole("button", { name: "Left" })).toBeDisabled();
    expect(screen.getByRole("slider", { name: "Font size" })).toBeDisabled();
  });

  it("shows the saved article list density and saves a new one, then tells the main window", async () => {
    vi.mocked(settingsManager.getSettings).mockResolvedValue({
      backgroundUpdate: "every-15m",
      savedArticlesSyncFolder: null,
      contentParser: "defuddle",
      articleListDensity: "large-images",
    } as unknown as Awaited<ReturnType<typeof settingsManager.getSettings>>);
    render(<SettingsWindow />);
    clickSidebarCategory("Appearance");

    const density = screen.getByRole("group", { name: "Article list density" });
    await waitFor(() => {
      expect(within(density).getByRole("button", { name: "Large Images" })).toHaveAttribute("aria-pressed", "true");
    });

    fireEvent.click(within(density).getByRole("button", { name: "Compact" }));
    await waitFor(() => {
      expect(settingsManager.setArticleListDensity).toHaveBeenCalledWith("compact");
    });
    expect(within(density).getByRole("button", { name: "Compact" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalled();
    });
  });

  it("shows shortcuts as keycaps with macOS symbols", () => {
    document.documentElement.setAttribute("data-os", "macos");
    render(<SettingsWindow />);
    clickSidebarCategory("Shortcuts");

    const row = screen.getByText("Reset All Settings").closest(".shortcut-item") as HTMLElement;
    const keys = Array.from(row.querySelectorAll("kbd")).map((key) => key.textContent);
    expect(keys).toEqual(["⌘", "⇧", "R"]);
  });

  it("opens a support email from the Contact pane", async () => {
    window.kijiAPI.openExternal = vi.fn().mockResolvedValue(undefined) as typeof window.kijiAPI.openExternal;
    render(<SettingsWindow />);
    clickSidebarCategory("Contact");

    fireEvent.click(screen.getByRole("button", { name: /@/ }));

    await waitFor(() => {
      expect(window.kijiAPI.openExternal).toHaveBeenCalledWith(expect.stringMatching(/^mailto:.+\?subject=/));
    });
    expect(await screen.findByText("Opened your default email client.")).toBeInTheDocument();
  });

  it("keeps a dragged surface opacity when switching panes and back", async () => {
    render(<SettingsWindow />);
    clickSidebarCategory("Appearance");

    fireEvent.input(await screen.findByRole("slider", { name: "Surface opacity" }), { target: { value: "64" } });
    clickSidebarCategory("General");
    clickSidebarCategory("Appearance");

    expect(screen.getByRole("slider", { name: "Surface opacity" })).toHaveValue("64");
    expect(screen.getByText("64%")).toBeInTheDocument();
  });
  it("uses macOS-style line glyphs, never Material icons, in every pane", () => {
    render(<SettingsWindow />);
    const nav = screen.getByRole("navigation", { name: "Settings" });
    const navGlyphs = Array.from(nav.querySelectorAll("svg.settings-glyph")).map((svg) => svg.getAttribute("data-glyph"));
    expect(navGlyphs).toEqual(["gear", "appearance", "book", "keyboard", "sparkles", "envelope"]);

    for (const category of ["General", "Appearance", "Reading", "Shortcuts", "Assistant", "Contact"]) {
      clickSidebarCategory(category);
      expect(document.querySelector(".settings-window .MuiSvgIcon-root")).toBeNull();
    }
  });

});
