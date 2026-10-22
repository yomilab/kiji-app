/**
 * Keep the reading position while the article text size changes: remember the
 * block at the top of the scroll viewport (and how far into it the reader is),
 * then scroll so the same spot sits at the top after the reflow.
 */

const MAX_ANCHOR_DEPTH = 12;

const hasDirectText = (element: Element): boolean => {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) return true;
  }
  return false;
};

/**
 * Deepest text block under `container` that is visible at viewport y `top`
 * (the first block whose bottom edge is below it). Null when nothing in the
 * container reaches that line, e.g. the reader is still above the body.
 */
export const findReadingAnchorElement = (container: Element, top: number): Element | null => {
  let parent: Element = container;
  let anchor: Element | null = null;

  for (let depth = 0; depth < MAX_ANCHOR_DEPTH; depth += 1) {
    let hit: Element | null = null;
    let hitRect: DOMRect | null = null;
    for (const child of Array.from(parent.children)) {
      const rect = child.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.bottom > top) {
        hit = child;
        hitRect = rect;
        break;
      }
    }
    if (!hit || !hitRect) break;
    anchor = hit;
    if (hitRect.top >= top || hit.children.length === 0 || hasDirectText(hit)) break;
    parent = hit;
  }

  return anchor;
};

export interface ReadingAnchor {
  element: Element;
  /** How far the viewport top is into the element, 0 (its top) to 1 (its bottom). */
  fraction: number;
}

export const captureReadingAnchor = (
  scrollElement: HTMLElement,
  findAnchor: (top: number) => Element | null,
): ReadingAnchor | null => {
  if (scrollElement.scrollTop <= 0) return null;
  const top = scrollElement.getBoundingClientRect().top;
  const element = findAnchor(top);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const fraction = rect.height > 0 ? Math.min(1, Math.max(0, (top - rect.top) / rect.height)) : 0;
  return { element, fraction };
};

export const restoreReadingAnchor = (scrollElement: HTMLElement, anchor: ReadingAnchor | null): void => {
  if (!anchor || !anchor.element.isConnected) return;
  const top = scrollElement.getBoundingClientRect().top;
  const rect = anchor.element.getBoundingClientRect();
  const delta = rect.top + (anchor.fraction * rect.height) - top;
  if (Math.abs(delta) >= 0.5) {
    scrollElement.scrollTop += delta;
  }
};
