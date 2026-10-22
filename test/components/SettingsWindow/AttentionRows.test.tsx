import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { attention } = vi.hoisted(() => ({
  attention: { get: vi.fn(), set: vi.fn() },
}));

vi.mock("@/lib/tauriClient", () => ({ tauriClient: { shell: { attention } } }));
vi.mock("@/services/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { AttentionRows } from "@/components/SettingsWindow/AttentionRows";

const status = (overrides: Record<string, boolean> = {}) => ({
  showUnreadBadge: true,
  notifyNewArticles: false,
  badgeSupported: true,
  notificationsBlocked: false,
  ...overrides,
});

const badgeSwitch = () => screen.findByRole("switch", { name: "Show unread count on app icon" });
const notifySwitch = () => screen.findByRole("switch", { name: "Notify me about new articles" });

describe("AttentionRows", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the badge on and notifications off by default, and saves the badge toggle", async () => {
    attention.get.mockResolvedValue(status());
    attention.set.mockResolvedValue(status({ showUnreadBadge: false }));
    render(<AttentionRows />);
    expect(((await badgeSwitch()) as HTMLInputElement).checked).toBe(true);
    expect(((await notifySwitch()) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(await badgeSwitch());
    await waitFor(() => expect(attention.set).toHaveBeenCalledWith({ showUnreadBadge: false }));
    await waitFor(async () => expect(((await badgeSwitch()) as HTMLInputElement).checked).toBe(false));
  });

  it("turns notifications on only through the native call that asks the system", async () => {
    attention.get.mockResolvedValue(status());
    attention.set.mockResolvedValue(status({ notifyNewArticles: true }));
    render(<AttentionRows />);
    fireEvent.click(await notifySwitch());
    await waitFor(() => expect(attention.set).toHaveBeenCalledWith({ notifyNewArticles: true }));
    await waitFor(async () => expect(((await notifySwitch()) as HTMLInputElement).checked).toBe(true));
  });

  it("explains in plain words when the system blocks notifications", async () => {
    attention.get.mockResolvedValue(status());
    attention.set.mockResolvedValue(status({ notificationsBlocked: true }));
    render(<AttentionRows />);
    fireEvent.click(await notifySwitch());
    expect(await screen.findByText(/turned off for KiJi in your system settings/)).toBeTruthy();
    expect(((await notifySwitch()) as HTMLInputElement).checked).toBe(false);
  });

  it("hides the badge row where the icon can't show a count (Windows)", async () => {
    attention.get.mockResolvedValue(status({ badgeSupported: false }));
    render(<AttentionRows />);
    await notifySwitch();
    expect(screen.queryByRole("switch", { name: "Show unread count on app icon" })).toBeNull();
  });

  it("shows plain words when saving fails", async () => {
    attention.get.mockResolvedValue(status());
    attention.set.mockRejectedValue("settings: write failed (EACCES)");
    render(<AttentionRows />);
    fireEvent.click(await badgeSwitch());
    expect(await screen.findByText("Couldn't change this setting. Please try again.")).toBeTruthy();
    expect(screen.queryByText(/EACCES/)).toBeNull();
  });
});
