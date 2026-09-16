import type { MouseEvent as ReactMouseEvent } from 'react';
import { notifyWindowChromeDragDismiss } from './windowChromeDragDismiss';

/** Matches Tauri 2.11 injected `drag.js` (`data-tauri-drag-region`). */
export const TAURI_DRAG_REGION_ATTR = 'data-tauri-drag-region';
export const TAURI_DRAG_REGION_DEEP = 'deep';
export const TAURI_DRAG_REGION_FALSE = 'false';

const CLICKABLE_TAGS = new Set([
  'A',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'LABEL',
  'SUMMARY',
]);

const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
]);

const isClickableElement = (el: HTMLElement): boolean =>
  CLICKABLE_TAGS.has(el.tagName)
  || (el.hasAttribute('contenteditable') && el.getAttribute('contenteditable') !== 'false')
  || (el.hasAttribute('tabindex') && el.getAttribute('tabindex') !== '-1')
  || INTERACTIVE_ROLES.has(el.getAttribute('role') ?? '');

/**
 * Same walk as Tauri `drag.js` `isDragRegion`.
 * `"false"` blocks that node and the rest of the path; `"deep"` starts a window drag
 * from descendants; clickable tags without an explicit attr block drag.
 */
export const isTauriWindowDragRegion = (event: Event): boolean => {
  const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : [];

  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const attr = node.getAttribute(TAURI_DRAG_REGION_ATTR);

    if (isClickableElement(node) && attr === null) {
      return false;
    }
    if (attr === null) {
      continue;
    }
    if (attr === TAURI_DRAG_REGION_FALSE) {
      return false;
    }
    if (attr === TAURI_DRAG_REGION_DEEP) {
      return true;
    }
    if (attr === '' || attr === 'true') {
      return node === composedPath[0];
    }
  }

  return false;
};

/**
 * Target-phase dismiss for menus that listen on document bubble.
 * Tauri `drag.js` `stopImmediatePropagation` would otherwise leave Saved ⋮ /
 * Windows File/Edit open. Does not start dragging and does not preventDefault.
 */
export const handleWindowChromeDragMouseDown = (
  event: ReactMouseEvent,
  options: { closeSearch: boolean },
): void => {
  if (event.button !== 0) {
    return;
  }
  if (!isTauriWindowDragRegion(event.nativeEvent)) {
    return;
  }
  notifyWindowChromeDragDismiss(options);
};
