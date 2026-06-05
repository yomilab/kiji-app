import { userMessageBus } from '@/services/ui/userMessageBus';

export const APP_TOAST_CHANNEL = 'app-toast';
const APP_TOAST_DURATION_MS = 5000;

class AppToastService {
  show(text: string, durationMs = APP_TOAST_DURATION_MS): void {
    userMessageBus.publish(APP_TOAST_CHANNEL, text, { durationMs });
  }

  clear(): void {
    userMessageBus.clear(APP_TOAST_CHANNEL);
  }
}

export const appToastService = new AppToastService();
