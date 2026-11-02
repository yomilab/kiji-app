import type { MouseEvent as ReactMouseEvent } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { notifyWindowChromeDragDismiss } from './windowChromeDragDismiss';
import { startWindowDrag } from './windowDrag';

/**
 * Our own drag-region attribute, with the same values as Tauri 2.11's `data-tauri-drag-region`.
 * Tauri's injected `drag.js` starts the drag through the async `startDragging`, which macOS 27
 * ignores, so the strips use this attribute and `installWindowDragRegions` instead.
 */
export const WINDOW_DRAG_REGION_ATTR = 'data-window-drag-region';
export const WINDOW_DRAG_REGION_DEEP = 'deep';
export const WINDOW_DRAG_REGION_FALSE = 'false';

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
 * Same walk as Tauri `drag.js` `isDragRegion`, on our attribute.
 * `"false"` blocks that node and the rest of the path; `"deep"` starts a window drag
 * from descendants; clickable tags without an explicit attr block drag.
 */
export const isWindowDragRegion = (event: Event): boolean => {
  const composedPath = typeof event.composedPath === 'function' ? event.composedPath() : [];

  for (const node of composedPath) {
    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const attr = node.getAttribute(WINDOW_DRAG_REGION_ATTR);

    if (isClickableElement(node) && attr === null) {
      return false;
    }
    if (attr === null) {
      continue;
    }
    if (attr === WINDOW_DRAG_REGION_FALSE) {
      return false;
    }
    if (attr === WINDOW_DRAG_REGION_DEEP) {
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
 * The drag listener's `stopImmediatePropagation` would otherwise leave Saved ⋮ /
 * Windows File/Edit open. Does not start dragging and does not preventDefault.
 */
export const handleWindowChromeDragMouseDown = (
  event: ReactMouseEvent,
  options: { closeSearch: boolean },
): void => {
  if (event.button !== 0) {
    return;
  }
  if (!isWindowDragRegion(event.nativeEvent)) {
    return;
  }
  notifyWindowChromeDragDismiss(options);
};

/**
 * Document listener that replaces Tauri's injected `drag.js` for our drag regions: same
 * mouse-down rules, drag through `startWindowDrag`, double-click maximize (on mouse-up on
 * macOS, cancelled if the mouse moved, as the system does). Returns the uninstall function.
 */
export const installWindowDragRegions = (os: string): (() => void) => {
  const isMac = os === 'macos';
  let initialX = 0;
  let initialY = 0;

  const onMouseDown = (event: MouseEvent): void => {
    if (event.button !== 0 || (event.detail !== 1 && event.detail !== 2) || !isWindowDragRegion(event)) {
      return;
    }
    if (isMac && event.detail === 2) {
      initialX = event.clientX;
      initialY = event.clientY;
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.detail === 2) {
      void getCurrentWindow().toggleMaximize();
      return;
    }
    startWindowDrag();
  };

  const onMouseUp = (event: MouseEvent): void => {
    if (
      event.button === 0
      && event.detail === 2
      && event.clientX === initialX
      && event.clientY === initialY
      && isWindowDragRegion(event)
    ) {
      void getCurrentWindow().toggleMaximize();
    }
  };

  document.addEventListener('mousedown', onMouseDown);
  if (isMac) {
    document.addEventListener('mouseup', onMouseUp);
  }
  return () => {
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
  };
};
