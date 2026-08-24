import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LAYOUT_COLUMN_RESIZING_CLASS,
  beginLayoutColumnResize,
  endLayoutColumnResize,
} from '@/services/ui/layoutColumnResize';

const createMouseEvent = (button = 0) => ({
  button,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

describe('layoutColumnResize', () => {
  afterEach(() => {
    endLayoutColumnResize();
    window.getSelection()?.removeAllRanges();
  });

  it('locks native text selection on left-button resize start', () => {
    const holder = document.createElement('p');
    holder.textContent = 'Feed title';
    document.body.appendChild(holder);
    const range = document.createRange();
    range.selectNodeContents(holder);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const event = createMouseEvent(0);
    expect(beginLayoutColumnResize(event, 'sidebar')).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(true);
    expect(window.getSelection()?.rangeCount ?? 0).toBe(0);

    const selectStart = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(true);

    holder.remove();
  });

  it('ignores non-left mouse buttons so context-click does not start a resize lock', () => {
    const event = createMouseEvent(2);
    expect(beginLayoutColumnResize(event, 'sidebar')).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(false);
  });

  it('releases the lock on mouse-up so later text selection works', () => {
    const start = createMouseEvent(0);
    beginLayoutColumnResize(start, 'sidebar');
    endLayoutColumnResize('sidebar');

    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(false);

    const selectStart = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(false);
  });

  it('does not release another column’s in-flight resize when a sibling unmounts', () => {
    beginLayoutColumnResize(createMouseEvent(0), 'sidebar');
    endLayoutColumnResize('article-list');

    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(true);

    const selectStart = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(selectStart);
    expect(selectStart.defaultPrevented).toBe(true);
  });

  it('is idempotent when begin or end runs more than once', () => {
    const first = createMouseEvent(0);
    const second = createMouseEvent(0);
    expect(beginLayoutColumnResize(first, 'sidebar')).toBe(true);
    expect(beginLayoutColumnResize(second, 'sidebar')).toBe(true);
    endLayoutColumnResize('sidebar');
    endLayoutColumnResize('sidebar');
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(false);
  });
});
