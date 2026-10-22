import { afterEach, describe, expect, it, vi } from 'vitest';
import type React from 'react';
import { act, renderHook } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('@/services/ui/appToastService', () => ({ appToastService: { show: mocks.show } }));

import { SIDEBAR_REORDER_FAILED_TOAST, useSidebarReorder } from '@/components/Sidebar/useSidebarReorder';
import { LIBRARY_REORDER_SUPERSEDED } from '@/services/feeds/libraryReorderQueue';

const dragEvent = (clientY = 100): React.DragEvent => {
  const data = new Map<string, string>();
  const element = document.createElement('li');
  return {
    preventDefault: vi.fn(),
    target: element,
    currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 20 }) },
    clientY,
    nativeEvent: { offsetX: 0, offsetY: 0 },
    dataTransfer: {
      effectAllowed: 'move',
      setData: (type: string, value: string) => data.set(type, value),
      getData: (type: string) => data.get(type) ?? '',
      setDragImage: vi.fn(),
    },
  } as unknown as React.DragEvent;
};

const setup = (persist: () => Promise<void>) => {
  const onReorder = vi.fn();
  const onRollback = vi.fn();
  const hook = renderHook(() => useSidebarReorder({
    group: 'unstationed',
    listKey: 'unstationed',
    items: ['a', 'b', 'c'],
    getId: (id) => id,
    persist,
    onReorder,
    onRollback,
  }));
  return { hook, onReorder, onRollback };
};

const dragAOntoC = async (hook: ReturnType<typeof setup>['hook']) => {
  const start = dragEvent();
  hook.result.current.onDragStart('a', start);
  hook.result.current.onDragOver('c', start);
  await act(async () => {
    await hook.result.current.onDrop('c', start);
  });
};

describe('sidebar drag reorder failure', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('snaps the row back and shows the plain-language toast when saving fails', async () => {
    const { hook, onReorder, onRollback } = setup(async () => {
      throw new Error('database is locked');
    });

    await dragAOntoC(hook);

    expect(onReorder).toHaveBeenCalledWith(['b', 'c', 'a']);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(mocks.show).toHaveBeenCalledWith(SIDEBAR_REORDER_FAILED_TOAST);
    expect(SIDEBAR_REORDER_FAILED_TOAST).not.toMatch(/database|error|sql/i);
  });

  it('stays quiet when a newer drag replaced this one', async () => {
    const { hook, onRollback } = setup(async () => {
      throw new Error(LIBRARY_REORDER_SUPERSEDED);
    });

    await dragAOntoC(hook);

    expect(onRollback).not.toHaveBeenCalled();
    expect(mocks.show).not.toHaveBeenCalled();
  });
});
