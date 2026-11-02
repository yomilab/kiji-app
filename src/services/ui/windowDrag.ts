import { invoke } from '@tauri-apps/api/core';

/**
 * Start moving the window from a mouse-down in a drag strip.
 *
 * Goes through our own plain `shell_window_drag_start` command, not the window API's
 * `startDragging()`: that one is an async plugin command and macOS 27 ignores the drag it
 * starts (see `src-tauri/src/shell/window_drag.rs`).
 */
export const startWindowDrag = (): void => {
  void invoke('shell_window_drag_start').catch(() => undefined);
};
