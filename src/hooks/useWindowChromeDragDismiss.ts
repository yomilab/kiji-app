import { useDependencyEffect } from '@/hooks/useLifecycleEffects';
import {
  subscribeWindowChromeDragDismiss,
  type WindowChromeDragDismissListener,
} from '@/services/ui/windowChromeDragDismiss';

export const useWindowChromeDragDismiss = (
  listener: WindowChromeDragDismissListener,
): void => {
  useDependencyEffect(
    () => subscribeWindowChromeDragDismiss(listener),
    [listener],
  );
};
