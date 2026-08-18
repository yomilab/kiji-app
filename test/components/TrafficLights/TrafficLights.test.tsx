import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { TrafficLights } from "@/components/TrafficLights/TrafficLights";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    close: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
  }),
}));

describe("TrafficLights", () => {
  afterEach(() => {
    cleanup();
    document.documentElement.removeAttribute("data-os");
  });

  it("does not render HTML traffic lights on macOS (native Overlay chrome)", () => {
    document.documentElement.setAttribute("data-os", "macos");
    const { container } = render(<TrafficLights />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByLabelText("Close window")).toBeNull();
  });

  it("renders Windows caption buttons on child windows", () => {
    document.documentElement.setAttribute("data-os", "windows");
    render(<TrafficLights />);
    expect(screen.getByLabelText("Minimize window")).toBeTruthy();
    expect(screen.getByLabelText("Close window")).toBeTruthy();
  });

  it("hides captions on the main window when hideOnInAppMenuBarOs is set", () => {
    document.documentElement.setAttribute("data-os", "windows");
    const { container } = render(<TrafficLights hideOnInAppMenuBarOs />);
    expect(container.firstChild).toBeNull();
  });
});
