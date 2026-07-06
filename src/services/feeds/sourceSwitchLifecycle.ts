/**
 * Owns the cancellation lifecycle for sidebar source switches (feed, station
 * tag, smart view). Exactly one attempt is current at a time; starting a new
 * attempt supersedes the previous one:
 *
 * - the previous attempt's AbortSignal is aborted,
 * - attempt-scoped timers (deferred SQLite recovery, etc.) are cleared,
 * - registered supersede handlers run (paint-gate waits cancel themselves).
 *
 * This replaces the previous constellation of refs in FeedContext
 * (selectionTokenRef, selectionAbortControllerRef,
 * stationSwitchSideWorkGenerationRef, cancelStationSwitchIdleWorkRef,
 * deferredSwitchRecoveryTimerRef, immediateSwitchPaintTokenRef) with a single
 * owner so no cancellation step can be forgotten on a new switch path.
 *
 * One instance per FeedProvider; not a module singleton so tests stay isolated.
 */
export class SourceSwitchLifecycle {
  private tokenCounter = 0;
  private abortController: AbortController | null = null;
  private supersedeHandlers = new Set<() => void>();
  private timers = new Map<string, number>();
  private immediatePaintToken = 0;

  /** Token of the current attempt (0 before the first switch). */
  get currentToken(): number {
    return this.tokenCounter;
  }

  /** Abort signal of the current attempt, if one is running. */
  get currentSignal(): AbortSignal | undefined {
    return this.abortController?.signal;
  }

  /** True while `token` identifies the current, non-aborted attempt. */
  isActive(token: number): boolean {
    const controller = this.abortController;
    if (!controller) {
      return false;
    }
    return token === this.tokenCounter && !controller.signal.aborted;
  }

  /** Supersede the current attempt and start a new one. Returns the new token. */
  begin(): number {
    this.cancelCurrentAttempt();
    this.abortController = new AbortController();
    this.tokenCounter += 1;
    return this.tokenCounter;
  }

  /**
   * Abort the current attempt without starting a new one (clear selection,
   * feed edit view). Later `isActive` checks with older tokens all fail.
   */
  invalidate(): void {
    this.cancelCurrentAttempt();
    this.abortController = null;
    this.tokenCounter += 1;
  }

  /**
   * Register cleanup that runs when the current attempt is superseded or
   * invalidated. Returns an unregister function for work that completes on
   * its own.
   */
  onSupersede(handler: () => void): () => void {
    this.supersedeHandlers.add(handler);
    return () => {
      this.supersedeHandlers.delete(handler);
    };
  }

  /**
   * Schedule an attempt-scoped timer. Automatically cleared when the attempt
   * is superseded or invalidated; setting the same name again replaces the
   * pending timer.
   */
  setAttemptTimer(name: string, delayMs: number, callback: () => void): void {
    this.clearAttemptTimer(name);
    const id = window.setTimeout(() => {
      this.timers.delete(name);
      callback();
    }, delayMs);
    this.timers.set(name, id);
  }

  clearAttemptTimer(name: string): void {
    const id = this.timers.get(name);
    if (id === undefined) {
      return;
    }
    window.clearTimeout(id);
    this.timers.delete(name);
  }

  /** Record that the synchronous switch paint ran for this attempt. */
  markImmediatePaintApplied(token: number): void {
    this.immediatePaintToken = token;
  }

  isImmediatePaintApplied(token: number): boolean {
    return this.immediatePaintToken === token;
  }

  /** Release timers and handlers on provider unmount (no token bump). */
  dispose(): void {
    for (const id of this.timers.values()) {
      window.clearTimeout(id);
    }
    this.timers.clear();
    this.supersedeHandlers.clear();
  }

  private cancelCurrentAttempt(): void {
    for (const id of this.timers.values()) {
      window.clearTimeout(id);
    }
    this.timers.clear();

    const handlers = Array.from(this.supersedeHandlers);
    this.supersedeHandlers.clear();
    for (const handler of handlers) {
      handler();
    }

    this.abortController?.abort();
  }
}
