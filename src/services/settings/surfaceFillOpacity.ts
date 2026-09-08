let surfaceFillDragDepth = 0;

export function beginSurfaceFillDrag(): void {
  surfaceFillDragDepth += 1;
}

export function endSurfaceFillDrag(): void {
  surfaceFillDragDepth = Math.max(0, surfaceFillDragDepth - 1);
}

export function isSurfaceFillDragging(): boolean {
  return surfaceFillDragDepth > 0;
}

export const SURFACE_FILL_OPACITY_MIN = 0.4;
export const SURFACE_FILL_OPACITY_MAX = 0.96;
export const SURFACE_FILL_OPACITY_MACOS_DEFAULT = 0.55;
export const SURFACE_FILL_OPACITY_WINDOWS_DEFAULT = 0.88;
export const SURFACE_FILL_ALPHA_VAR = "--app-surface-fill-alpha";
export const READER_FILL_ALPHA_VAR = "--app-reader-fill-alpha";

const MACOS_READER_BIAS = 0.37;
const WINDOWS_READER_BIAS = 0.08;

export function clampSurfaceFillOpacity(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.min(
    SURFACE_FILL_OPACITY_MAX,
    Math.max(SURFACE_FILL_OPACITY_MIN, value),
  );
}

export function defaultSurfaceFillOpacityForOs(os: string | null | undefined): number {
  return os === "macos" ? SURFACE_FILL_OPACITY_MACOS_DEFAULT : SURFACE_FILL_OPACITY_WINDOWS_DEFAULT;
}

export function readerFillAlphaForOs(stored: number, os: string | null | undefined): number {
  const bias = os === "macos" ? MACOS_READER_BIAS : WINDOWS_READER_BIAS;
  return Math.min(SURFACE_FILL_OPACITY_MAX, stored + bias);
}

export function applySurfaceFillOpacityToRoot(value: number | undefined): void {
  if (typeof document === "undefined") {
    return;
  }

  const root = document.documentElement;
  const clamped = clampSurfaceFillOpacity(value);
  if (clamped === undefined) {
    root.style.removeProperty(SURFACE_FILL_ALPHA_VAR);
    root.style.removeProperty(READER_FILL_ALPHA_VAR);
    return;
  }

  const os = root.getAttribute("data-os");
  root.style.setProperty(SURFACE_FILL_ALPHA_VAR, String(clamped));
  root.style.setProperty(READER_FILL_ALPHA_VAR, String(readerFillAlphaForOs(clamped, os)));
}
