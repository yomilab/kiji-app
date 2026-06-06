import { describe, expect, it, vi } from "vitest";
import {
  buildSemanticTargetPath,
  getRecentInteractionsForFreeze,
  getRendererFreezeSeverity,
  getSafeKeyboardMetadata,
  selectSuspectedInteraction,
  type RendererInteractionRecord,
} from "@/services/performance/interactionFreezeWatchdog";

vi.mock("@/services/logger", () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/services/performance/interactionPerformance", () => ({
  getActiveInteractionPerformanceRecords: vi.fn((): unknown[] => []),
  roundPerformanceValue: (value: number) => Number(value.toFixed(1)),
}));

const createRecord = (id: number, monotonicTimeMs: number): RendererInteractionRecord => ({
  id,
  eventType: "click",
  timestamp: `2026-05-28T00:00:0${id}.000Z`,
  monotonicTimeMs,
  targetPath: [],
});

describe("interactionFreezeWatchdog helpers", () => {
  it("classifies event-loop stalls by visible freeze severity", () => {
    expect(getRendererFreezeSeverity(499)).toBeNull();
    expect(getRendererFreezeSeverity(500)).toBe("stutter");
    expect(getRendererFreezeSeverity(1_000)).toBe("freeze");
    expect(getRendererFreezeSeverity(2_000)).toBe("beachball");
    expect(getRendererFreezeSeverity(5_000)).toBe("severe");
  });

  it("builds a semantic target path from data anchors without text content", () => {
    document.body.innerHTML = `
      <div data-section="sidebar" data-component="sidebar">
        <button data-action="select-feed" data-entity-id="feed-1" aria-label="Feed row">
          Private title
        </button>
      </div>
    `;

    const button = document.querySelector("button");
    const path = buildSemanticTargetPath(button);

    expect(path[0]).toEqual({
      tagName: "button",
      ariaLabel: "Feed row",
      data: {
        action: "select-feed",
        entityId: "feed-1",
      },
    });
    expect(path[1]).toEqual({
      tagName: "div",
      data: {
        section: "sidebar",
        component: "sidebar",
      },
    });
    expect(JSON.stringify(path)).not.toContain("Private title");
  });

  it("selects the interaction nearest the beginning of the stall", () => {
    const records = [
      createRecord(1, 6_000),
      createRecord(2, 7_300),
      createRecord(3, 8_050),
    ];
    const detectedAtMs = 10_000;
    const stallDurationMs = 2_000;

    const recent = getRecentInteractionsForFreeze(records, detectedAtMs, stallDurationMs);

    expect(recent.map((record) => record.id)).toEqual([1, 2, 3]);
    expect(selectSuspectedInteraction(recent, detectedAtMs, stallDurationMs)?.id).toBe(3);
  });

  it("redacts printable keyboard input while preserving shortcut/control context", () => {
    expect(getSafeKeyboardMetadata(new KeyboardEvent("keydown", { key: "x", code: "KeyX" }))).toEqual({
      key: "Printable",
    });
    expect(
      getSafeKeyboardMetadata(new KeyboardEvent("keydown", { key: "f", code: "KeyF", metaKey: true })),
    ).toEqual({
      key: "Shortcut",
      code: "KeyF",
    });
    expect(getSafeKeyboardMetadata(new KeyboardEvent("keydown", { key: "Escape", code: "Escape" }))).toEqual({
      key: "Escape",
      code: "Escape",
    });
  });
});
