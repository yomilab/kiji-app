import { userMessageBus, type UserMessageAction } from '@/services/ui/userMessageBus';

export const APP_TOAST_CHANNEL = 'app-toast';
const APP_TOAST_DURATION_MS = 5000;

class AppToastService {
  show(text: string, durationMs = APP_TOAST_DURATION_MS): void {
    userMessageBus.publish(APP_TOAST_CHANNEL, text, { durationMs });
  }

  /** A toast with one button; the button (and what it holds) goes when the toast does. */
  showWithAction(text: string, action: UserMessageAction, durationMs = APP_TOAST_DURATION_MS): void {
    userMessageBus.publish(APP_TOAST_CHANNEL, text, { durationMs, action });
  }

  clear(): void {
    userMessageBus.clear(APP_TOAST_CHANNEL);
  }
}

export const appToastService = new AppToastService();
