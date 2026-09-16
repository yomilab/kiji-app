export interface WindowChromeDragDismissOptions {
  closeSearch: boolean;
}

export type WindowChromeDragDismissListener = (
  options: WindowChromeDragDismissOptions,
) => void;

const listeners = new Set<WindowChromeDragDismissListener>();

export const subscribeWindowChromeDragDismiss = (
  listener: WindowChromeDragDismissListener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const notifyWindowChromeDragDismiss = (
  options: WindowChromeDragDismissOptions,
): void => {
  for (const listener of listeners) {
    listener(options);
  }
};
