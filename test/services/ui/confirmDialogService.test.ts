import { afterEach, describe, expect, it, vi } from 'vitest';

import { confirmDialog } from '@/services/ui/confirmDialogService';

describe('confirmDialogService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: undefined,
    });
  });

  it('uses the native confirm dialog when kijiAPI is available', async () => {
    const confirmDialogMock = vi.fn().mockResolvedValue(true);
    Object.defineProperty(window, 'kijiAPI', {
      configurable: true,
      value: { confirmDialog: confirmDialogMock },
    });

    await expect(confirmDialog({
      title: 'Clear all feeds',
      message: 'Are you sure?',
    })).resolves.toBe(true);

    expect(confirmDialogMock).toHaveBeenCalledWith({
      title: 'Clear all feeds',
      message: 'Are you sure?',
    });
  });

  it('falls back to window.confirm in non-desktop environments', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await expect(confirmDialog({ message: 'Fallback confirm' })).resolves.toBe(false);
    expect(confirmSpy).toHaveBeenCalledWith('Fallback confirm');
  });
});
