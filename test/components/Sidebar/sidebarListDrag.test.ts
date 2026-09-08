import { describe, expect, it, vi } from 'vitest';
import {
  abortSidebarListDrag,
  armSidebarClickSuppress,
  encodeSidebarDragPayload,
  isSidebarRowDragIgnored,
  mergePartialReorder,
  parseSidebarDragPayload,
  registerSidebarDragAbort,
  reorderIds,
  unregisterSidebarDragAbort,
} from '@/components/Sidebar/sidebarListDrag';

describe('sidebarListDrag', () => {
  it('reorders ids before or after the drop target', () => {
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('keeps uncached membership ids in their relative slots', () => {
    expect(mergePartialReorder(['a', 'hidden', 'b', 'c'], ['b', 'a', 'c'])).toEqual([
      'b',
      'hidden',
      'a',
      'c',
    ]);
  });

  it('encodes list identity so another list can reject the drop', () => {
    const payload = encodeSidebarDragPayload({ group: 'nested', listKey: 'Daily', id: 'feed-a' });
    expect(parseSidebarDragPayload(payload)).toEqual({
      group: 'nested',
      listKey: 'Daily',
      id: 'feed-a',
    });
    expect(parseSidebarDragPayload(payload)?.listKey).not.toBe('Tech');
  });

  it('round-trips a station name that contains a colon as listKey mismatch, not parse-null', () => {
    const payload = encodeSidebarDragPayload({
      group: 'nested',
      listKey: 'Tech:News',
      id: 'feed-a',
    });
    const parsed = parseSidebarDragPayload(payload);
    expect(parsed).toEqual({
      group: 'nested',
      listKey: 'Tech:News',
      id: 'feed-a',
    });
    expect(parsed?.listKey === 'Tech').toBe(false);
  });

  it('does not start a row drag from edit/action chrome', () => {
    const button = document.createElement('button');
    const stack = document.createElement('div');
    stack.className = 'button-stack';
    stack.append(button);
    document.body.append(stack);
    expect(isSidebarRowDragIgnored(button)).toBe(true);
    expect(isSidebarRowDragIgnored(document.body)).toBe(false);
    stack.remove();
  });

  it('swallows only the click that follows a drag', () => {
    const select = vi.fn();
    document.addEventListener('click', select);
    armSidebarClickSuppress();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select).not.toHaveBeenCalled();
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select).toHaveBeenCalledTimes(1);
    document.removeEventListener('click', select);
  });

  it('shares one window listener set across every registered list', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const first = vi.fn();
    const second = vi.fn();

    registerSidebarDragAbort(first);
    registerSidebarDragAbort(second);
    const blurRegistrations = addSpy.mock.calls.filter(([type]) => type === 'blur');
    expect(blurRegistrations).toHaveLength(1);

    window.dispatchEvent(new Event('blur'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    unregisterSidebarDragAbort(first);
    expect(removeSpy.mock.calls.filter(([type]) => type === 'blur')).toHaveLength(0);
    unregisterSidebarDragAbort(second);
    expect(removeSpy.mock.calls.filter(([type]) => type === 'blur')).toHaveLength(1);

    window.dispatchEvent(new Event('blur'));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);

    abortSidebarListDrag();
    expect(first).toHaveBeenCalledTimes(1);

    addSpy.mockRestore();
    removeSpy.mockRestore();
  });
});
