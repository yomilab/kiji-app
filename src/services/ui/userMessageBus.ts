export interface UserMessage {
  channel: string;
  text: string;
  expiresAt: number | null;
}

type Listener = () => void;

interface PublishOptions {
  durationMs?: number;
}

class UserMessageBus {
  private readonly listeners = new Set<Listener>();
  private readonly messages = new Map<string, UserMessage>();
  private readonly timers = new Map<string, number>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getMessage(channel: string): UserMessage | null {
    const message = this.messages.get(channel);
    if (!message) {
      return null;
    }

    if (message.expiresAt !== null && message.expiresAt <= Date.now()) {
      this.clear(channel);
      return null;
    }

    return message;
  }

  publish(channel: string, text: string, options: PublishOptions = {}): void {
    const durationMs = options.durationMs ?? null;
    const expiresAt = durationMs !== null ? Date.now() + durationMs : null;

    this.clearTimer(channel);
    this.messages.set(channel, {
      channel,
      text,
      expiresAt,
    });

    if (durationMs !== null) {
      const timerId = window.setTimeout(() => {
        this.clear(channel);
      }, durationMs);
      this.timers.set(channel, timerId);
    }

    this.emit();
  }

  clear(channel: string): void {
    this.clearTimer(channel);
    if (!this.messages.delete(channel)) {
      return;
    }
    this.emit();
  }

  private clearTimer(channel: string): void {
    const timerId = this.timers.get(channel);
    if (timerId === undefined) {
      return;
    }
    window.clearTimeout(timerId);
    this.timers.delete(channel);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const userMessageBus = new UserMessageBus();
