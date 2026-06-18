import { invoke } from '@tauri-apps/api/core';

export interface E2eCommand {
  name: string;
  payload: Record<string, unknown>;
}

export async function takeE2eCommand(): Promise<E2eCommand | null> {
  try {
    const response = await invoke<{ name: string; payload: Record<string, unknown> } | null>(
      'e2e_take_command',
    );
    if (!response?.name) {
      return null;
    }
    return {
      name: response.name,
      payload: response.payload ?? {},
    };
  } catch {
    return null;
  }
}

export async function readE2eTextFile(path: string): Promise<string> {
  return invoke<string>('e2e_read_text_file', { path });
}

export async function writeE2eHarnessText(relativePath: string, content: string): Promise<void> {
  await invoke('e2e_write_harness_text', { relativePath, content });
}
