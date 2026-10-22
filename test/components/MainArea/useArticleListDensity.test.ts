import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

const mockSettings = { articleListDensity: 'compact' as string };

vi.mock('@/services/settings', () => ({
  settingsManager: {
    getArticleListDensityNow: () => mockSettings.articleListDensity,
    getSettings: vi.fn(async () => ({ ...mockSettings })),
  },
}));

import { useArticleListDensity } from '@/components/MainArea/hooks/useArticleListDensity';

describe('useArticleListDensity', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'kijiAPI');
    mockSettings.articleListDensity = 'compact';
  });

  it('starts from the saved density and follows changes made in another window', async () => {
    let notify: (() => void) | undefined;
    const removeListener = vi.fn();
    window.kijiAPI = {
      onSettingsChanged: (callback: () => void) => {
        notify = callback;
        return removeListener;
      },
    } as unknown as typeof window.kijiAPI;

    const { result, unmount } = renderHook(() => useArticleListDensity());
    // First render already uses the saved value, so the list never flashes Comfortable.
    expect(result.current).toBe('compact');

    mockSettings.articleListDensity = 'large-images';
    act(() => {
      notify?.();
    });
    await waitFor(() => {
      expect(result.current).toBe('large-images');
    });

    unmount();
    expect(removeListener).toHaveBeenCalledTimes(1);
  });

  it('falls back to Comfortable for an unknown stored value', () => {
    mockSettings.articleListDensity = 'huge';
    const { result } = renderHook(() => useArticleListDensity());
    expect(result.current).toBe('comfortable');
  });
});
