import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PayloadLoadTimeoutError,
  withTimeout,
} from '@/hooks/useSecondaryWindowPayload';

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when the promise finishes before the timeout', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 3_000)).resolves.toBe('ok');
  });

  it('rejects with PayloadLoadTimeoutError when the timeout elapses first', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => undefined), 3_000);
    const expectation = expect(pending).rejects.toBeInstanceOf(PayloadLoadTimeoutError);
    await vi.advanceTimersByTimeAsync(3_000);
    await expectation;
  });

  it('passes through when timeoutMs is not positive', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 0)).resolves.toBe('ok');
  });
});
