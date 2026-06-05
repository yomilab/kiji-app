export const FIXED_TIME_SCROLL_DURATION_MS = 260;

export const getScrollableBottom = (element: HTMLElement): number =>
  Math.max(0, element.scrollHeight - element.clientHeight);

const clampScrollTop = (element: HTMLElement, scrollTop: number): number =>
  Math.max(0, Math.min(getScrollableBottom(element), scrollTop));

const easeOutCubic = (progress: number): number =>
  1 - Math.pow(1 - progress, 3);

export function animateElementScrollTop(
  element: HTMLElement,
  targetScrollTop: number,
  durationMs = FIXED_TIME_SCROLL_DURATION_MS,
): () => void {
  const startScrollTop = element.scrollTop;
  const target = clampScrollTop(element, targetScrollTop);
  const distance = target - startScrollTop;

  if (durationMs <= 0 || Math.abs(distance) < 1) {
    element.scrollTop = target;
    return () => {};
  }

  let frameId: number | null = null;
  let cancelled = false;
  const startTime = performance.now();

  const step = (now: number) => {
    if (cancelled) return;

    const progress = Math.min(1, (now - startTime) / durationMs);
    element.scrollTop = startScrollTop + distance * easeOutCubic(progress);

    if (progress < 1) {
      frameId = requestAnimationFrame(step);
      return;
    }

    element.scrollTop = target;
    frameId = null;
  };

  frameId = requestAnimationFrame(step);

  return () => {
    cancelled = true;
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };
}
