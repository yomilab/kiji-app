import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppMenuCommand } from '@/types/appMenu';

vi.mock('@/services/scheduler/feedSchedulerService', () => ({
  feedScheduler: { start: vi.fn(), stop: vi.fn(), reconfigure: vi.fn() },
}));

vi.mock('@/services/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { useAppShortcuts } from '@/hooks/useAppEffects';
import { subscribeAppMenuCommand } from '@/services/ui/appMenuCommandBus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const Probe: React.FC = () => {
  useAppShortcuts({ refreshFeed: async () => {}, isDeckOpen: false, requestCloseArticle: () => {} });
  return null;
};

describe('Mark All as Read keyboard shortcut', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<Probe />);
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('sends the same command as the menu item for Shift+Cmd+K and Ctrl+Shift+K', async () => {
    const received: AppMenuCommand[] = [];
    const unsubscribe = subscribeAppMenuCommand((command) => received.push(command));
    try {
      const mac = new KeyboardEvent('keydown', { key: 'K', metaKey: true, shiftKey: true, cancelable: true });
      const other = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, shiftKey: true, cancelable: true });
      const palette = new KeyboardEvent('keydown', { key: 'k', metaKey: true, cancelable: true });
      await act(async () => {
        window.dispatchEvent(mac);
        window.dispatchEvent(other);
        window.dispatchEvent(palette);
        await Promise.resolve();
      });

      expect(received).toEqual([{ type: 'markAllRead' }, { type: 'markAllRead' }]);
      expect(mac.defaultPrevented).toBe(true);
      expect(palette.defaultPrevented).toBe(false);
    } finally {
      unsubscribe();
    }
  });
});
