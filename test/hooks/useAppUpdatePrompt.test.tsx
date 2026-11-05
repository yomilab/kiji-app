import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppUpdatePrompt } from '@/hooks/useAppUpdatePrompt';

const mocks = vi.hoisted(() => ({
  autoUpdateActive: vi.fn(),
  checkForUpdateDetailed: vi.fn(),
}));

vi.mock('@/lib/tauriClient', () => ({
  tauriClient: { system: { app: { autoUpdateActive: mocks.autoUpdateActive } } },
}));

vi.mock('@/services/system/appUpdateService', () => ({
  checkForUpdateDetailed: mocks.checkForUpdateDetailed,
  openUpdateWindow: vi.fn(),
  toUpdateWindowPayload: vi.fn(),
}));

vi.mock('@/services/system/appUpdateSession', () => ({
  dismissUpdatePromptForSession: vi.fn(),
  isUpdatePromptDismissedForSession: () => false,
  subscribeUpdatePromptSession: () => () => {},
}));

describe('useAppUpdatePrompt', () => {
  beforeEach(() => {
    mocks.checkForUpdateDetailed.mockResolvedValue({
      status: 'available',
      availability: { latestVersion: '2.0.0' },
    });
  });

  it('hides the badge while updates install by themselves', async () => {
    mocks.autoUpdateActive.mockResolvedValue(true);
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.availability).not.toBeNull());
    await waitFor(() => expect(mocks.autoUpdateActive).toHaveBeenCalled());
    expect(result.current.showBadge).toBe(false);
  });

  it('shows the badge where updates cannot install by themselves', async () => {
    mocks.autoUpdateActive.mockResolvedValue(false);
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.showBadge).toBe(true));
  });

  it('shows the badge when the status can\'t be read', async () => {
    mocks.autoUpdateActive.mockRejectedValue(new Error('no bridge'));
    const { result } = renderHook(() => useAppUpdatePrompt());
    await waitFor(() => expect(result.current.showBadge).toBe(true));
  });
});
