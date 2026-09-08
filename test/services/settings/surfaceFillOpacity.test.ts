import { afterEach, describe, expect, it } from "vitest";

import {
  SURFACE_FILL_ALPHA_VAR,
  READER_FILL_ALPHA_VAR,
  applySurfaceFillOpacityToRoot,
  beginSurfaceFillDrag,
  clampSurfaceFillOpacity,
  defaultSurfaceFillOpacityForOs,
  endSurfaceFillDrag,
  isSurfaceFillDragging,
  readerFillAlphaForOs,
} from "@/services/settings/surfaceFillOpacity";

describe("surfaceFillOpacity", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-os");
    document.documentElement.style.removeProperty(SURFACE_FILL_ALPHA_VAR);
    document.documentElement.style.removeProperty(READER_FILL_ALPHA_VAR);
    while (isSurfaceFillDragging()) {
      endSurfaceFillDrag();
    }
  });

  it("clamps to the limited range and rejects non-numbers", () => {
    expect(clampSurfaceFillOpacity(0)).toBe(0.4);
    expect(clampSurfaceFillOpacity(1)).toBe(0.96);
    expect(clampSurfaceFillOpacity(0.72)).toBe(0.72);
    expect(clampSurfaceFillOpacity(undefined)).toBeUndefined();
    expect(clampSurfaceFillOpacity("0.7")).toBeUndefined();
  });

  it("uses per-OS chrome defaults instead of one cross-OS literal", () => {
    expect(defaultSurfaceFillOpacityForOs("macos")).toBe(0.55);
    expect(defaultSurfaceFillOpacityForOs("windows")).toBe(0.88);
    expect(defaultSurfaceFillOpacityForOs("linux")).toBe(0.88);
    expect(readerFillAlphaForOs(0.88, "windows")).toBe(0.96);
    expect(readerFillAlphaForOs(0.55, "macos")).toBe(0.92);
  });

  it("only writes CSS vars when a stored value exists", () => {
    document.documentElement.setAttribute("data-os", "windows");
    applySurfaceFillOpacityToRoot(undefined);
    expect(document.documentElement.style.getPropertyValue(SURFACE_FILL_ALPHA_VAR)).toBe("");
    expect(document.documentElement.style.getPropertyValue(READER_FILL_ALPHA_VAR)).toBe("");

    applySurfaceFillOpacityToRoot(0.88);
    expect(document.documentElement.style.getPropertyValue(SURFACE_FILL_ALPHA_VAR)).toBe("0.88");
    expect(document.documentElement.style.getPropertyValue(READER_FILL_ALPHA_VAR)).toBe("0.96");

    applySurfaceFillOpacityToRoot(undefined);
    expect(document.documentElement.style.getPropertyValue(SURFACE_FILL_ALPHA_VAR)).toBe("");
    expect(document.documentElement.style.getPropertyValue(READER_FILL_ALPHA_VAR)).toBe("");
  });

  it("exposes a drag flag so ThemeContext can skip mid-drag reloads", () => {
    expect(isSurfaceFillDragging()).toBe(false);
    beginSurfaceFillDrag();
    expect(isSurfaceFillDragging()).toBe(true);
    endSurfaceFillDrag();
    expect(isSurfaceFillDragging()).toBe(false);
  });
});
