import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  notifyWindowChromeDragDismiss,
  subscribeWindowChromeDragDismiss,
} from '@/services/ui/windowChromeDragDismiss';
import {
  TAURI_DRAG_REGION_ATTR,
  TAURI_DRAG_REGION_DEEP,
  TAURI_DRAG_REGION_FALSE,
  handleWindowChromeDragMouseDown,
  isTauriWindowDragRegion,
} from '@/services/ui/windowChromeDragRegion';

const append = (parent: HTMLElement, tag: string): HTMLElement => {
  const node = document.createElement(tag);
  parent.appendChild(node);
  return node;
};

const dispatchMouseDown = (target: EventTarget, button = 0): MouseEvent => {
  const event = new MouseEvent('mousedown', { bubbles: true, button, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

describe('windowChromeDragRegion', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('treats empty chrome and title text inside deep as a drag region', () => {
    const section = append(document.body, 'div');
    section.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_DEEP);
    const title = append(section, 'h2');
    title.textContent = 'Daily';

    title.addEventListener('mousedown', (event) => {
      expect(isTauriWindowDragRegion(event)).toBe(true);
    });
    dispatchMouseDown(title);
  });

  it('blocks drag on BUTTON and INPUT even under deep', () => {
    const section = append(document.body, 'div');
    section.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_DEEP);
    const button = append(section, 'button');
    const input = append(section, 'input');

    button.addEventListener('mousedown', (event) => {
      expect(isTauriWindowDragRegion(event)).toBe(false);
    });
    input.addEventListener('mousedown', (event) => {
      expect(isTauriWindowDragRegion(event)).toBe(false);
    });
    dispatchMouseDown(button);
    dispatchMouseDown(input);
  });

  it('blocks drag on a false cluster including empty padding over the title', () => {
    const section = append(document.body, 'div');
    section.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_DEEP);
    const widgets = append(section, 'div');
    widgets.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_FALSE);
    const gap = append(widgets, 'span');

    gap.addEventListener('mousedown', (event) => {
      expect(isTauriWindowDragRegion(event)).toBe(false);
    });
    dispatchMouseDown(gap);
  });

  it('notifies dismiss without preventDefault when the hit is a drag surface', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWindowChromeDragDismiss(listener);
    const section = append(document.body, 'div');
    section.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_DEEP);
    const title = append(section, 'h2');

    title.addEventListener('mousedown', (event) => {
      const preventDefault = vi.spyOn(event, 'preventDefault');
      handleWindowChromeDragMouseDown(
        { button: event.button, nativeEvent: event } as never,
        { closeSearch: false },
      );
      expect(preventDefault).not.toHaveBeenCalled();
    });
    dispatchMouseDown(title);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ closeSearch: false });
    unsubscribe();
  });

  it('does not notify dismiss on a button or a non-left click', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWindowChromeDragDismiss(listener);
    const section = append(document.body, 'div');
    section.setAttribute(TAURI_DRAG_REGION_ATTR, TAURI_DRAG_REGION_DEEP);
    const button = append(section, 'button');

    button.addEventListener('mousedown', (event) => {
      handleWindowChromeDragMouseDown(
        { button: event.button, nativeEvent: event } as never,
        { closeSearch: true },
      );
    });
    dispatchMouseDown(button);

    const rightClick = new MouseEvent('mousedown', { bubbles: true, button: 2, cancelable: true });
    handleWindowChromeDragMouseDown(
      { button: 2, nativeEvent: rightClick } as never,
      { closeSearch: true },
    );

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

describe('windowChromeDragDismiss', () => {
  it('notifies every subscriber and unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubFirst = subscribeWindowChromeDragDismiss(first);
    const unsubSecond = subscribeWindowChromeDragDismiss(second);

    notifyWindowChromeDragDismiss({ closeSearch: true });
    unsubFirst();
    notifyWindowChromeDragDismiss({ closeSearch: false });

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith({ closeSearch: true });
    expect(second).toHaveBeenCalledTimes(2);
    unsubSecond();
  });
});
