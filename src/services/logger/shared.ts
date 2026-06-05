export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogProcess = "main" | "renderer" | "native" | "worker";

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface LogEntryInput {
  level: LogLevel;
  process: LogProcess;
  category: string;
  message: string;
  event?: string;
  context?: unknown;
  error?: unknown;
  timestamp?: string;
}

export interface LogEntry extends LogEntryInput {
  timestamp: string;
}

const REDACTED_KEYS = new Set([
  "authorization",
  "clipboardText",
  "content",
  "cookies",
  "headers",
  "html",
  "requestHeaders",
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

export const serializeError = (error: unknown): SerializedError | unknown => {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return sanitizeForLogging(error);
};

export const sanitizeForLogging = (value: unknown, depth = 0): unknown => {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (value instanceof URL) {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return serializeError(value);
  }
  if (typeof value === "function") {
    return `[Function ${value.name || "anonymous"}]`;
  }
  if (depth >= 4) {
    return "[MaxDepth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeForLogging(item, depth + 1));
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !REDACTED_KEYS.has(key))
        .map(([key, entryValue]) => [key, sanitizeForLogging(entryValue, depth + 1)]),
    );
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

export const formatLocalTimestamp = (date = new Date()): string => {
  const tzo = -date.getTimezoneOffset();
  const dif = tzo >= 0 ? "+" : "-";
  const pad = (num: number, targetLength = 2) => String(num).padStart(targetLength, "0");

  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
    `.${pad(date.getMilliseconds(), 3)}${dif}${pad(Math.floor(Math.abs(tzo) / 60))}:${pad(Math.abs(tzo) % 60)}`
  );
};

export const normalizeLogEntry = (entry: LogEntryInput): LogEntry => ({
  ...entry,
  timestamp: entry.timestamp ?? formatLocalTimestamp(),
  context: sanitizeForLogging(entry.context),
  error: entry.error === undefined ? undefined : serializeError(entry.error),
});

export const formatConsoleArgs = (args: unknown[]): { message: string; context?: unknown } => {
  if (args.length === 0) {
    return { message: "" };
  }

  const [first, ...rest] = args;
  const message = typeof first === "string" ? first : stringifyForMessage(first);
  if (rest.length === 0) {
    return { message };
  }

  return {
    message,
    context: rest.length === 1
      ? sanitizeForLogging(rest[0])
      : rest.map((item) => sanitizeForLogging(item)),
  };
};

function stringifyForMessage(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
