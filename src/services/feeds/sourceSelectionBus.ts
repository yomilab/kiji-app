import type {
  SourceSelectionAbortReason,
  SourceSelectionReadyPayload,
} from '@/services/feeds/sourceSelectionTypes';

export type SourceSelectionEvent =
  | { type: 'source-local-ready'; payload: SourceSelectionReadyPayload }
  | { type: 'source-refresh-requested'; payload: SourceSelectionReadyPayload }
  | {
      type: 'source-refresh-aborted';
      payload: { token: number; sourceKey: string; reason: SourceSelectionAbortReason };
    }
  | {
      type: 'source-refresh-settled';
      payload: { token: number; sourceKey: string; insertedCount: number };
    };

type SourceSelectionListener = (event: SourceSelectionEvent) => void;

class SourceSelectionBus {
  private readonly listeners = new Set<SourceSelectionListener>();

  subscribe = (listener: SourceSelectionListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  publishLocalReady(payload: SourceSelectionReadyPayload): void {
    this.emit({ type: 'source-local-ready', payload });
  }

  publishRefreshRequested(payload: SourceSelectionReadyPayload): void {
    this.emit({ type: 'source-refresh-requested', payload });
  }

  publishRefreshAborted(
    token: number,
    sourceKey: string,
    reason: SourceSelectionAbortReason,
  ): void {
    this.emit({ type: 'source-refresh-aborted', payload: { token, sourceKey, reason } });
  }

  publishRefreshSettled(token: number, sourceKey: string, insertedCount: number): void {
    this.emit({ type: 'source-refresh-settled', payload: { token, sourceKey, insertedCount } });
  }

  private emit(event: SourceSelectionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const sourceSelectionBus = new SourceSelectionBus();
