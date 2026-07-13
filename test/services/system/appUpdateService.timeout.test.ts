import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkForUpdateDetailed } from '@/services/system/appUpdateService';

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '1.0.2'),
}));

describe('checkForUpdateDetailed timeout handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a timed-out error message when the manifest fetch aborts', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
          return;
        }
        signal.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      })),
    );

    const pending = checkForUpdateDetailed();
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await pending;

    expect(result).toEqual({
      status: 'error',
      message: 'Update check timed out after 3s.',
    });
  });
});
