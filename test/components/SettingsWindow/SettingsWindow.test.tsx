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
  settingsManager: {
    getSettings: vi.fn().mockResolvedValue({
      readTrackingAlgorithm: "on-open",
      backgroundUpdate: "every-15m",
      savedArticlesSyncFolder: null,
      contentParser: "defuddle",
    }),
    setReadTrackingAlgorithm: vi.fn().mockResolvedValue(undefined),
    setSavedArticlesSyncFolder: vi.fn().mockResolvedValue(undefined),
    setBackgroundUpdate: vi.fn().mockResolvedValue(undefined),
    setContentParser: vi.fn().mockResolvedValue(undefined),
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
        iconVariant: "dark",
      }),
      setSystemAppIconVariant: vi.fn().mockResolvedValue({
        iconPath: null,
        previewDataUrl: null,
        hasCustomIcon: false,
        iconVariant: "cosmos",
      }),
      windowClose: vi.fn().mockResolvedValue(undefined),
    } as unknown as typeof window.kijiAPI;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
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
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable saved article sync" }));

    await waitFor(() => {
      expect(settingsManager.setSavedArticlesSyncFolder).toHaveBeenCalledWith("/tmp/saved-sync");
    });

    expect(await screen.findByText("/tmp/saved-sync")).toBeInTheDocument();
    expect(window.kijiAPI.notifySettingsChanged).toHaveBeenCalledTimes(1);
  });

  it("shows and saves the no-ascii reading font setting", async () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Reading");
    const noAsciiRow = screen.getByText("No-ASCII Font").closest(".settings-item");
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

  it("shows Cosmos and Cosmos Dark as default app icon choices", async () => {
    render(<SettingsWindow />);

    clickSidebarCategory("Appearance");

    const iconGroup = await screen.findByRole("group", { name: "Default app icon" });
    expect(within(iconGroup).getByRole("button", { name: "Cosmos" })).toBeInTheDocument();
    expect(within(iconGroup).getByRole("button", { name: "Cosmos Dark" })).toBeInTheDocument();
    expect(within(iconGroup).getByRole("button", { name: "Sunset" })).toBeInTheDocument();

    fireEvent.click(within(iconGroup).getByRole("button", { name: "Cosmos" }));

    await waitFor(() => {
      expect(window.kijiAPI.setSystemAppIconVariant).toHaveBeenCalledWith("cosmos");
    });
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
      { label: "Font Size", sliderValue: -1, expectedPatch: { fontSize: 17 } },
      { label: "Font Weight", sliderValue: -1, expectedPatch: { fontWeight: 450 } },
      { label: "Line Spacing", sliderValue: -1, expectedPatch: { lineSpacing: 1.75 } },
      { label: "Max Width", sliderValue: -1, expectedPatch: { maxWidth: 710 } },
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
});
