const createAbortError = () => {
  const error = new Error("Feed refresh was aborted");
  error.name = "AbortError";
  return error;
};

export class FeedRefreshCoordinator {
  private tails = new Map<string, Promise<void>>();

  async run<T>(
    feedId: string,
    operation: () => Promise<T>,
    options?: { signal?: AbortSignal },
  ): Promise<T> {
    const previousTurn = (this.tails.get(feedId) ?? Promise.resolve()).catch(
      (): void => undefined,
    );

    let releaseTurn!: () => void;
    const currentTurn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const queuedTurn = previousTurn.then(() => currentTurn);
    this.tails.set(feedId, queuedTurn);

    try {
      await this.waitForTurn(previousTurn, options?.signal);
      this.throwIfAborted(options?.signal);
      return await operation();
    } finally {
      releaseTurn();
      if (this.tails.get(feedId) === queuedTurn) {
        this.tails.delete(feedId);
      }
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw createAbortError();
    }
  }

  private async waitForTurn(turn: Promise<void>, signal?: AbortSignal): Promise<void> {
    if (!signal) {
      await turn;
      return;
    }

    this.throwIfAborted(signal);
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => reject(createAbortError());
      signal.addEventListener("abort", onAbort, { once: true });
      turn.then(
        () => {
          signal.removeEventListener("abort", onAbort);
          resolve();
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    });
  }
}

export const feedRefreshCoordinator = new FeedRefreshCoordinator();
