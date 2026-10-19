import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { AssistantStatus } from "@/lib/tauriClient/assistant";

const baseStatus = (): AssistantStatus => ({
  settings: {
    enabled: false,
    shareCurrentArticle: true,
    sharedStations: null,
    includeUnstationedFeeds: true,
    shareSavedArticles: true,
    shareNotesAndHighlights: false,
    allowChanges: false,
    httpEnabled: false,
    httpPort: 47615,
  },
  local: { state: "off" },
  http: { state: "off" },
  clients: [],
});

const { assistant, clipboardWrite, saveFile, confirmDialog, backgroundModeGet } = vi.hoisted(() => ({
  backgroundModeGet: vi.fn(),
  assistant: {
    getStatus: vi.fn(),
    updateSettings: vi.fn(),
    resetAccess: vi.fn(),
    getClientSetup: vi.fn(),
    openClientLink: vi.fn(),
    writeExtension: vi.fn(),
  },
  clipboardWrite: vi.fn(),
  saveFile: vi.fn(),
  confirmDialog: vi.fn(),
}));

vi.mock("@/lib/tauriClient", () => ({
  tauriClient: {
    assistant,
    feeds: {
      tags: {
        list: vi.fn().mockResolvedValue([
          { name: "Tech", emoji: "💻", color: null, createdAt: "", sortOrder: 0 },
          { name: "Health", emoji: null, color: null, createdAt: "", sortOrder: 1 },
        ]),
      },
    },
    system: { clipboard: { writeText: (request: { text: string }) => clipboardWrite(request) } },
    shell: {
      dialog: { saveFile: (request: unknown) => saveFile(request) },
      confirmDialog: (request: unknown) => confirmDialog(request),
      backgroundMode: { get: () => backgroundModeGet() },
    },
  },
}));

vi.mock("@/services/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { AssistantSettings, COPIED_RESET_MS } from "@/components/SettingsWindow/AssistantSettings";

const clientRow = (id: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-client="${id}"]`);
  if (!row) throw new Error(`No row for ${id}`);
  return row;
};

describe("AssistantSettings", () => {
  beforeEach(() => {
    assistant.getStatus.mockResolvedValue(baseStatus());
    assistant.updateSettings.mockImplementation(async (patch) => {
      const status = baseStatus();
      status.settings = { ...status.settings, ...patch };
      if (status.settings.enabled) status.local = { state: "ready" };
      return status;
    });
    assistant.getClientSetup.mockResolvedValue({
      client: "claude-code",
      text: "claude mcp add --scope user kiji -- '/Applications/KiJi.app/Contents/MacOS/kiji-app' --mcp",
      hint: "Run this once in Terminal.",
      hasInstallLink: false,
    });
    clipboardWrite.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("starts with access off and turns it on", async () => {
    render(<AssistantSettings />);
    const toggle = await screen.findByLabelText("Let assistants read your KiJi library");
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() => expect(assistant.updateSettings).toHaveBeenCalledWith({ enabled: true }));
    expect(await screen.findByText("Ready. Assistants can connect while KiJi is open.")).toBeTruthy();
  });

  it("keeps changes off by default and only allows them once access is on", async () => {
    render(<AssistantSettings />);
    const changes = (await screen.findByLabelText("Allow assistants to make changes")) as HTMLInputElement;
    expect(changes.checked).toBe(false);
    expect(changes.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Let assistants read your KiJi library"));
    await waitFor(() => expect((screen.getByLabelText("Allow assistants to make changes") as HTMLInputElement).disabled).toBe(false));
    assistant.updateSettings.mockClear();
    fireEvent.click(screen.getByLabelText("Allow assistants to make changes"));
    await waitFor(() => expect(assistant.updateSettings).toHaveBeenCalledWith({ allowChanges: true }));
  });

  it("switches to chosen stations and saves the picked list", async () => {
    render(<AssistantSettings />);
    const select = await screen.findByDisplayValue("All stations");
    fireEvent.change(select, { target: { value: "chosen" } });
    await waitFor(() =>
      expect(assistant.updateSettings).toHaveBeenCalledWith({ sharedStations: ["Tech", "Health"] }),
    );
    const health = await screen.findByLabelText(/Health/);
    fireEvent.click(health);
    await waitFor(() => expect(assistant.updateSettings).toHaveBeenLastCalledWith({ sharedStations: ["Tech"] }));
  });

  it("switches back to all stations with a null list", async () => {
    const chosen = baseStatus();
    chosen.settings.sharedStations = ["Tech"];
    assistant.getStatus.mockResolvedValue(chosen);
    render(<AssistantSettings />);
    const select = await screen.findByDisplayValue("Only stations I choose");
    fireEvent.change(select, { target: { value: "all" } });
    await waitFor(() => expect(assistant.updateSettings).toHaveBeenCalledWith({ sharedStations: null }));
  });

  it("shows plain words, never raw errors, when something fails", async () => {
    assistant.updateSettings.mockRejectedValueOnce("Failed to lock the assistant settings.");
    assistant.getClientSetup.mockRejectedValueOnce("Unknown assistant app `x`.");
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByLabelText("Share saved articles"));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeTruthy();
    fireEvent.click((await screen.findAllByRole("button", { name: "Copy Command" }))[0]);
    await waitFor(() => expect(screen.getAllByText("Something went wrong. Please try again.").length).toBe(2));
    expect(screen.queryByText(/Failed to lock/)).toBeNull();
    expect(screen.queryByText(/Unknown assistant app/)).toBeNull();
  });

  it("copies the Claude Code command and shows the hint", async () => {
    render(<AssistantSettings />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Copy Command" }))[0]);
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalled());
    expect(assistant.getClientSetup).toHaveBeenCalledWith("claude-code");
    expect(clipboardWrite.mock.calls[0][0].text).toContain("--mcp");
    expect(await screen.findByText("Copied. Paste it in Terminal and press Return.")).toBeTruthy();
  });

  it("shows Copied in the row, then goes back to the label", async () => {
    render(<AssistantSettings />);
    await screen.findAllByRole("button", { name: "Copy Command" });
    vi.useFakeTimers();
    try {
      const row = clientRow("claude-code");
      await act(async () => {
        fireEvent.click(within(row).getByRole("button", { name: "Copy Command" }));
      });
      expect(within(row).getByRole("button", { name: "Copied" })).toBeTruthy();
      // Only the row that was copied changes.
      expect(within(clientRow("command")).getByRole("button", { name: "Copy Command" })).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(COPIED_RESET_MS + 10);
      });
      expect(within(row).queryByRole("button", { name: "Copied" })).toBeNull();
      expect(within(row).getByRole("button", { name: "Copy Command" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("copies from the secondary button on rows with another main action", async () => {
    assistant.getClientSetup.mockResolvedValueOnce({
      client: "cursor",
      text: "{}",
      hint: "Or add this to ~/.cursor/mcp.json.",
      hasInstallLink: true,
    });
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Copy setup for Cursor" }));
    await waitFor(() => expect(assistant.getClientSetup).toHaveBeenCalledWith("cursor"));
    expect(await screen.findByRole("button", { name: "Copied setup for Cursor" })).toBeTruthy();
    const row = clientRow("cursor");
    expect(within(row).getByRole("status").textContent).toBe("Copied. Paste it into Cursor's tool settings.");
    // The app's own hint may name files; it never shows.
    expect(screen.queryByText(/mcp\.json/)).toBeNull();
  });

  it("opens Cursor and VS Code from their main buttons", async () => {
    assistant.openClientLink.mockResolvedValue(undefined);
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Cursor" }));
    await waitFor(() => expect(assistant.openClientLink).toHaveBeenCalledWith("cursor"));
    expect(within(clientRow("cursor")).getByRole("status").textContent).toMatch(/Opening Cursor/);
    fireEvent.click(screen.getByRole("button", { name: "Add to VS Code" }));
    await waitFor(() => expect(assistant.openClientLink).toHaveBeenCalledWith("vscode"));
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("explains a failed open in plain words", async () => {
    assistant.openClientLink.mockRejectedValue("Failed to launch cursor://anysphere.cursor-deeplink/mcp/install");
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Add to Cursor" }));
    expect(await screen.findByText("Couldn't open Cursor. Is it installed? You can copy the setup instead.")).toBeTruthy();
    expect(screen.queryByText(/cursor:\/\//)).toBeNull();
  });

  it("shows a hint while access is off and keeps the buttons usable", async () => {
    render(<AssistantSettings />);
    expect(await screen.findByText(/Access is off\. Turn it on above/)).toBeTruthy();
    const download = screen.getByRole("button", { name: "Download Extension" }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("Let assistants read your KiJi library"));
    expect(await screen.findByText("Pick the app you use. KiJi needs to be open with access turned on.")).toBeTruthy();
  });

  it("saves the Claude Desktop extension where the user picks", async () => {
    saveFile.mockResolvedValue({ canceled: false, filePath: "/Users/me/Downloads/KiJi.mcpb" });
    assistant.writeExtension.mockResolvedValue(undefined);
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Extension" }));
    await waitFor(() => expect(assistant.writeExtension).toHaveBeenCalledWith("/Users/me/Downloads/KiJi.mcpb"));
    expect(await screen.findByText(/Double-click KiJi.mcpb/)).toBeTruthy();
    expect(within(clientRow("claude-desktop")).getByRole("status").textContent).toMatch(/Double-click/);
  });

  it("does nothing when the save dialog is canceled", async () => {
    saveFile.mockResolvedValue({ canceled: true });
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Extension" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(assistant.writeExtension).not.toHaveBeenCalled();
    expect(within(clientRow("claude-desktop")).getByRole("status").textContent).toBe("");
  });

  it("explains a failed extension save without the raw error", async () => {
    saveFile.mockResolvedValue({ canceled: false, filePath: "/Volumes/ro/KiJi.mcpb" });
    assistant.writeExtension.mockRejectedValue("Permission denied (os error 13)");
    render(<AssistantSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Download Extension" }));
    expect(await screen.findByText("Couldn't save the extension. Try another folder.")).toBeTruthy();
    expect(screen.queryByText(/os error/)).toBeNull();
  });

  it("resets access only after confirmation", async () => {
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    assistant.resetAccess.mockResolvedValue(baseStatus());
    render(<AssistantSettings />);
    const button = await screen.findByRole("button", { name: "Reset Access" });
    fireEvent.click(button);
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(assistant.resetAccess).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(assistant.resetAccess).toHaveBeenCalledTimes(1));
  });

  it("lists connected assistants", async () => {
    const status = baseStatus();
    status.settings.enabled = true;
    status.local = { state: "ready" };
    status.clients = [
      { name: "Claude Code", transport: "local", connectedAt: "2026-10-19T01:00:00.000Z", lastAction: "list_articles" },
    ];
    assistant.getStatus.mockResolvedValue(status);
    render(<AssistantSettings />);
    // One row under "Connect an Assistant", one under "Connected Assistants".
    expect(await screen.findAllByText("Claude Code")).toHaveLength(2);
    expect(await screen.findByText(/listed articles/)).toBeTruthy();
  });
  it("tells the user to keep KiJi running when closing the window would quit it", async () => {
    const status = baseStatus();
    status.settings.enabled = true;
    status.local = { state: "ready" };
    assistant.getStatus.mockResolvedValue(status);
    backgroundModeGet.mockResolvedValue({ enabled: false, platform: "windows", trayReady: false });
    render(<AssistantSettings />);
    expect(await screen.findByText(/Assistants can reach KiJi only while it's running/)).toBeTruthy();
  });

  it("hides that hint when KiJi keeps running in the background", async () => {
    const status = baseStatus();
    status.settings.enabled = true;
    status.local = { state: "ready" };
    assistant.getStatus.mockResolvedValue(status);
    backgroundModeGet.mockResolvedValue({ enabled: true, platform: "macos", trayReady: false });
    render(<AssistantSettings />);
    expect(await screen.findByText("Ready. Assistants can connect while KiJi is open.")).toBeTruthy();
    await waitFor(() => expect(backgroundModeGet).toHaveBeenCalled());
    expect(screen.queryByText(/only while it's running/)).toBeNull();
  });
});
