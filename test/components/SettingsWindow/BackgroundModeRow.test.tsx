import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { backgroundMode } = vi.hoisted(() => ({
  backgroundMode: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("@/lib/tauriClient", () => ({ tauriClient: { shell: { backgroundMode } } }));
vi.mock("@/services/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { BackgroundModeRow } from "@/components/SettingsWindow/BackgroundModeRow";

const toggle = () => screen.findByRole("switch", { name: "Keep KiJi running when you close the window" });

describe("BackgroundModeRow", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("explains the Dock on macOS and saves the toggle", async () => {
    backgroundMode.get.mockResolvedValue({ enabled: true, platform: "macos", trayReady: false });
    backgroundMode.set.mockResolvedValue({ enabled: false, platform: "macos", trayReady: false });
    render(<BackgroundModeRow />);
    expect(((await toggle()) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/stays in the Dock/)).toBeTruthy();
    fireEvent.click(await toggle());
    await waitFor(() => expect(backgroundMode.set).toHaveBeenCalledWith(false));
    await waitFor(async () => expect(((await toggle()) as HTMLInputElement).checked).toBe(false));
  });

  it("mentions the tray on Windows and warns when no tray icon is possible", async () => {
    backgroundMode.get.mockResolvedValue({ enabled: false, platform: "linux", trayReady: false });
    backgroundMode.set.mockResolvedValue({ enabled: true, platform: "linux", trayReady: false });
    render(<BackgroundModeRow />);
    expect(await screen.findByText(/system tray/)).toBeTruthy();
    fireEvent.click(await toggle());
    expect(await screen.findByText(/closing the window still quits KiJi/)).toBeTruthy();
  });

  it("shows plain words when saving fails", async () => {
    backgroundMode.get.mockResolvedValue({ enabled: false, platform: "windows", trayReady: false });
    backgroundMode.set.mockRejectedValue("tray: failed to create icon (0x80004005)");
    render(<BackgroundModeRow />);
    expect(await screen.findByText(/notification area/)).toBeTruthy();
    fireEvent.click(await toggle());
    expect(await screen.findByText("Couldn't change this setting. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/0x80004005/)).toBeNull();
  });
});
