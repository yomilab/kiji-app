import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceSwitchLifecycle } from '@/services/feeds/sourceSwitchLifecycle';

describe('SourceSwitchLifecycle', () => {
  let lifecycle: SourceSwitchLifecycle;

  beforeEach(() => {
    vi.useFakeTimers();
    lifecycle = new SourceSwitchLifecycle();
  });

  afterEach(() => {
    lifecycle.dispose();
    vi.useRealTimers();
  });

  it('starts with no active attempt', () => {
    expect(lifecycle.currentToken).toBe(0);
    expect(lifecycle.currentSignal).toBeUndefined();
    expect(lifecycle.isActive(0)).toBe(false);
  });

  it('begin issues monotonic tokens and keeps only the newest active', () => {
    const first = lifecycle.begin();
    expect(lifecycle.isActive(first)).toBe(true);

    const second = lifecycle.begin();
    expect(second).toBe(first + 1);
    expect(lifecycle.isActive(first)).toBe(false);
    expect(lifecycle.isActive(second)).toBe(true);
  });

  it('aborts the previous attempt signal on begin', () => {
    lifecycle.begin();
    const firstSignal = lifecycle.currentSignal;
    expect(firstSignal?.aborted).toBe(false);

    lifecycle.begin();
    expect(firstSignal?.aborted).toBe(true);
    expect(lifecycle.currentSignal?.aborted).toBe(false);
  });

  it('runs supersede handlers once on the next begin', () => {
    lifecycle.begin();
    const handler = vi.fn();
    lifecycle.onSupersede(handler);

    lifecycle.begin();
    expect(handler).toHaveBeenCalledTimes(1);

    lifecycle.begin();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('does not run unregistered supersede handlers', () => {
    lifecycle.begin();
    const handler = vi.fn();
    const unregister = lifecycle.onSupersede(handler);
    unregister();

    lifecycle.begin();
    expect(handler).not.toHaveBeenCalled();
  });

  it('clears attempt timers when superseded', () => {
    lifecycle.begin();
    const callback = vi.fn();
    lifecycle.setAttemptTimer('recovery', 250, callback);

    lifecycle.begin();
    vi.advanceTimersByTime(1_000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('fires attempt timers that are not superseded', () => {
    lifecycle.begin();
    const callback = vi.fn();
    lifecycle.setAttemptTimer('recovery', 250, callback);

    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('replaces a pending timer with the same name', () => {
    lifecycle.begin();
    const firstCallback = vi.fn();
    const secondCallback = vi.fn();
    lifecycle.setAttemptTimer('recovery', 250, firstCallback);
    lifecycle.setAttemptTimer('recovery', 250, secondCallback);

    vi.advanceTimersByTime(500);
    expect(firstCallback).not.toHaveBeenCalled();
    expect(secondCallback).toHaveBeenCalledTimes(1);
  });

  it('invalidate aborts without starting a new attempt', () => {
    const token = lifecycle.begin();
    const signal = lifecycle.currentSignal;
    const handler = vi.fn();
    lifecycle.onSupersede(handler);

    lifecycle.invalidate();
    expect(signal?.aborted).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(lifecycle.isActive(token)).toBe(false);
    expect(lifecycle.currentSignal).toBeUndefined();
    expect(lifecycle.currentToken).toBe(token + 1);
  });

  it('tracks immediate paint per token', () => {
    const first = lifecycle.begin();
    expect(lifecycle.isImmediatePaintApplied(first)).toBe(false);

    lifecycle.markImmediatePaintApplied(first);
    expect(lifecycle.isImmediatePaintApplied(first)).toBe(true);

    const second = lifecycle.begin();
    expect(lifecycle.isImmediatePaintApplied(second)).toBe(false);
    expect(lifecycle.isImmediatePaintApplied(first)).toBe(true);
  });

  it('dispose clears timers and handlers without bumping the token', () => {
    const token = lifecycle.begin();
    const callback = vi.fn();
    const handler = vi.fn();
    lifecycle.setAttemptTimer('recovery', 250, callback);
    lifecycle.onSupersede(handler);

    lifecycle.dispose();
    vi.advanceTimersByTime(1_000);
    expect(callback).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    expect(lifecycle.currentToken).toBe(token);
  });
});
