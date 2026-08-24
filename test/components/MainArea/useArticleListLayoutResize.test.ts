import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';
import { useArticleListLayoutResize } from '@/components/MainArea/hooks/useArticleListLayoutResize';
import { LAYOUT_COLUMN_RESIZING_CLASS, endLayoutColumnResize } from '@/services/ui/layoutColumnResize';

vi.mock('@/services/settings', () => ({
  settingsManager: {
    getArticleListWidth: vi.fn().mockResolvedValue(350),
    setArticleListWidth: vi.fn().mockResolvedValue(undefined),
  },
}));

const createMouseEvent = (button = 0) => ({
  button,
  preventDefault: vi.fn(),
  stopPropagation: vi.fn(),
});

describe('useArticleListLayoutResize', () => {
  const articleListRef = { current: document.createElement('div') } as RefObject<HTMLDivElement>;

  beforeEach(() => {
    endLayoutColumnResize();
  });

  afterEach(() => {
    endLayoutColumnResize();
  });

  it('locks text selection when the 3-column list border is dragged', () => {
    const { result } = renderHook(() => useArticleListLayoutResize({
      articleListRef,
      layout: '3-column',
    }));
    const event = createMouseEvent(0);

    act(() => {
      result.current.handleBorderMouseDown(event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.isDragging).toBe(true);
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(true);
  });

  it('does not lock selection in 2-column layout where the list handle is hidden', () => {
    const { result } = renderHook(() => useArticleListLayoutResize({
      articleListRef,
      layout: '2-column',
    }));
    const event = createMouseEvent(0);

    act(() => {
      result.current.handleBorderMouseDown(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(result.current.isDragging).toBe(false);
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(false);
  });

  it('releases the lock on mouseup after a 3-column drag', () => {
    const { result } = renderHook(() => useArticleListLayoutResize({
      articleListRef,
      layout: '3-column',
    }));

    act(() => {
      result.current.handleBorderMouseDown(createMouseEvent(0));
    });
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(true);

    act(() => {
      document.dispatchEvent(new MouseEvent('mouseup'));
    });

    expect(result.current.isDragging).toBe(false);
    expect(document.body.classList.contains(LAYOUT_COLUMN_RESIZING_CLASS)).toBe(false);
  });
});
