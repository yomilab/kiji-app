import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("native traffic-light visibility", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
    delete (window as Window & { kijiAPI?: unknown }).kijiAPI;
    document.documentElement.removeAttribute("data-os");
  });

  it("invokes AppKit hide/show on macOS and skips other platforms", async () => {
    const { installKijiDesktopApi } = await import("@/services/tauri/kijiDesktopApi");
    installKijiDesktopApi();

    document.documentElement.setAttribute("data-os", "windows");
    await window.kijiAPI.hideTrafficLights();
    await window.kijiAPI.showTrafficLights();
    expect(invokeMock).not.toHaveBeenCalled();

    document.documentElement.setAttribute("data-os", "macos");
    await window.kijiAPI.hideTrafficLights();
    await window.kijiAPI.showTrafficLights();

    expect(invokeMock).toHaveBeenCalledWith("shell_window_set_traffic_lights_visible", {
      visible: false,
    });
    expect(invokeMock).toHaveBeenCalledWith("shell_window_set_traffic_lights_visible", {
      visible: true,
    });
  });

  it("hides lights when the embedded article overlay opens and restores after close", () => {
    const source = readFileSync(
      join(process.cwd(), "src/components/MainArea/ArticleView.tsx"),
      "utf8",
    );

    expect(source).toMatch(/void window\.kijiAPI\.hideTrafficLights\(\)/);
    expect(source).toMatch(/void window\.kijiAPI\.showTrafficLights\(\)/);
  });

  it("keeps the article back-button inset at the default 20px (lights hide instead of padding around them)", () => {
    const css = readFileSync(
      join(process.cwd(), "src/components/MainArea/ArticleView.css"),
      "utf8",
    );

    expect(css).toMatch(/\.article-view-header-bar \{[\s\S]*?padding-left: 20px;/);
    expect(css).not.toContain("padding-left: 78px");
  });

  it("re-applies Overlay trafficLightPosition after hide/show so AppKit cannot keep the default slot", () => {
    const rust = readFileSync(
      join(process.cwd(), "src-tauri/src/shell/window.rs"),
      "utf8",
    );
    const macosConf = readFileSync(
      join(process.cwd(), "src-tauri/tauri.macos.conf.json"),
      "utf8",
    );

    expect(rust).toContain("inset_macos_traffic_lights");
    expect(rust).toContain("schedule_macos_traffic_light_inset");
    expect(rust).toMatch(/Duration::from_millis\(80\)/);
    expect(macosConf).toMatch(/"label": "main"[\s\S]*?"x": 16[\s\S]*?"y": 22/);
    expect(macosConf).toMatch(/"label": "settings"[\s\S]*?"x": 16[\s\S]*?"y": 20/);
  });
});
