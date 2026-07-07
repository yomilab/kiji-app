import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const schedulerMocks = vi.hoisted(() => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  reconfigure: vi.fn(),
}));

vi.mock("@/services/scheduler/feedSchedulerService", () => ({
  feedScheduler: schedulerMocks,
}));

vi.mock("@/services/settings", () => ({
  settingsManager: {
    getSettings: vi.fn().mockResolvedValue({ backgroundUpdate: "every-15m" }),
  },
}));

vi.mock("@/services/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { useFeedSchedulerLifecycle } from "@/hooks/useAppEffects";

const Probe: React.FC = () => {
  useFeedSchedulerLifecycle();
  return null;
};

describe("useFeedSchedulerLifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState({}, "", "/");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(window, "kijiAPI", {
      configurable: true,
      value: {
        onSettingsChanged: vi.fn(() => vi.fn()),
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("starts and stops the scheduler for the main window", async () => {
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });

    expect(schedulerMocks.start).toHaveBeenCalledTimes(1);

    act(() => {
      root.unmount();
    });

    expect(schedulerMocks.stop).toHaveBeenCalledTimes(1);
  });

  it("skips the scheduler lifecycle for secondary windows", async () => {
    window.history.replaceState({}, "", "/?window=settings");

    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });

    expect(schedulerMocks.start).not.toHaveBeenCalled();

    act(() => {
      root.unmount();
    });

    expect(schedulerMocks.stop).not.toHaveBeenCalled();
  });
});
