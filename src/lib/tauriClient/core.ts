import { invoke } from "@tauri-apps/api/core";
import { isExpectedFeedCommandFailure } from "./commandError";

export interface CommandPayload extends Record<string, unknown> {}

export type ContractCommand = {
  request?: unknown;
  response: unknown;
};

export type ContractRequest<TCommand extends ContractCommand> =
  TCommand extends { request: infer TRequest } ? TRequest : undefined;

export type ContractResponse<TCommand extends ContractCommand> = TCommand["response"];

export async function invokeCommand<TResponse>(
  command: string,
  payload?: CommandPayload,
): Promise<TResponse> {
  try {
    return await invoke<TResponse>(command, payload);
  } catch (error) {
    await logCommandFailure(command, payload, error);
    throw error;
  }
}

function resolveCommandFailureLevel(command: string, error: unknown): "error" | "warn" {
  return isExpectedFeedCommandFailure(command, error) ? "warn" : "error";
}

async function logCommandFailure(
  command: string,
  payload: CommandPayload | undefined,
  error: unknown,
): Promise<void> {
  if (command === "diagnostics_log_write_entry") {
    return;
  }

  const level = resolveCommandFailureLevel(command, error);

  try {
    await invoke("diagnostics_log_write_entry", {
      entry: {
        level,
        process: "renderer",
        category: "TauriCommand",
        event: "invoke-failed",
        message: `Tauri command failed: ${command}`,
        context: {
          command,
          payload: sanitizePayload(payload),
        },
        error: serializeError(error),
      },
    });
  } catch {
    // Avoid recursive logging failures.
  }
}

function sanitizePayload(value: unknown, depth = 0): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (depth >= 3) {
    return "[MaxDepth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizePayload(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["content", "html", "headers", "requestHeaders", "clipboardText"].includes(key))
        .map(([key, entryValue]) => [key, sanitizePayload(entryValue, depth + 1)]),
    );
  }
  return String(value);
}

function serializeError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return sanitizePayload(error);
}

export async function invokeContract<TCommand extends ContractCommand>(
  command: string,
  payload?: ContractRequest<TCommand> extends undefined
    ? undefined
    : ContractRequest<TCommand>,
): Promise<ContractResponse<TCommand>> {
  return invokeCommand<ContractResponse<TCommand>>(
    command,
    payload as CommandPayload | undefined,
  );
}
