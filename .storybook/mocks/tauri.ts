const asyncNoop = async (): Promise<void> => {};

const currentWindow = {
  label: 'storybook',
  startDragging: asyncNoop,
  toggleMaximize: asyncNoop,
  close: asyncNoop,
};

export function getCurrentWindow() {
  return currentWindow;
}

export async function invoke(command: string): Promise<never> {
  throw new Error(`Unexpected Tauri invoke from Storybook: ${command}`);
}

export async function listen() {
  return asyncNoop;
}

