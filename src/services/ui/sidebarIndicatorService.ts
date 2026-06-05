import { userMessageBus } from '@/services/ui/userMessageBus';

export const SIDEBAR_INDICATOR_CHANNEL = 'sidebar-indicator';

interface SidebarIndicatorOptions {
  durationMs?: number;
}

class SidebarIndicatorService {
  show(text: string, options: SidebarIndicatorOptions = {}): void {
    userMessageBus.publish(SIDEBAR_INDICATOR_CHANNEL, text, options);
  }

  clear(): void {
    userMessageBus.clear(SIDEBAR_INDICATOR_CHANNEL);
  }
}

export const sidebarIndicatorService = new SidebarIndicatorService();
