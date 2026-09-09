import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(),
}));

vi.mock('@/services/system/appUpdateService', () => ({
  openAboutWindow: vi.fn(),
}));

vi.mock('@/services/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

import { appToastService } from '@/services/ui/appToastService';
import { dispatchAppMenuAction } from '@/services/ui/dispatchAppMenuAction';
import {
  openSettingsWindow,
  SETTINGS_WINDOW_OPEN_FAILED_TOAST,
} from '@/services/ui/openSettingsWindow';

describe('openSettingsWindow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: undefined,
    });
  });

  it('does not toast when the settings window opens', async () => {
    const openSettings = vi.fn().mockResolvedValue(undefined);
    const show = vi.spyOn(appToastService, 'show');
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: { openSettings },
    });

    await openSettingsWindow();

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('toasts a genuine invoke failure and does not rethrow', async () => {
    const openSettings = vi.fn().mockRejectedValue(new Error('webview2 deadlock'));
    const show = vi.spyOn(appToastService, 'show');
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: { openSettings },
    });

    await expect(openSettingsWindow()).resolves.toBeUndefined();
    expect(show).toHaveBeenCalledWith(SETTINGS_WINDOW_OPEN_FAILED_TOAST);
  });

  it('KiJi → Settings uses the toasting helper', async () => {
    const openSettings = vi.fn().mockRejectedValue(new Error('create failed'));
    const show = vi.spyOn(appToastService, 'show');
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: { openSettings },
    });

    await dispatchAppMenuAction({ type: 'openSettings' });
    expect(show).toHaveBeenCalledWith(SETTINGS_WINDOW_OPEN_FAILED_TOAST);
  });

  it('gear, KiJi menu, and Ctrl+, all call openSettingsWindow', () => {
    const root = process.cwd();
    const gear = readFileSync(join(root, 'src/components/Sidebar/BottomWidget.tsx'), 'utf8');
    const menu = readFileSync(join(root, 'src/services/ui/dispatchAppMenuAction.ts'), 'utf8');
    const shortcut = readFileSync(join(root, 'src/hooks/useAppEffects.ts'), 'utf8');
    for (const source of [gear, menu, shortcut]) {
      expect(source).toContain("from '@/services/ui/openSettingsWindow'");
      expect(source).toContain('openSettingsWindow()');
      expect(source).not.toContain('kijiAPI.openSettings()');
    }
  });
});
