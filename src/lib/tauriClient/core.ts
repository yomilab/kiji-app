import { invoke } from "@tauri-apps/api/core";

export interface CommandPayload extends Record<string, unknown> {}

export async function invokeCommand<TResponse>(
  command: string,
  payload?: CommandPayload,
): Promise<TResponse> {
  return invoke<TResponse>(command, payload);
}
