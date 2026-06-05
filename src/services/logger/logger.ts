import * as diagnostics from "../../lib/tauriClient/diagnostics";
import type { LogEntry, LogEntryInput, LogLevel, LogProcess } from "./shared";
import { formatConsoleArgs, formatLocalTimestamp, normalizeLogEntry } from "./shared";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";

class Logger {
  private logs: LogEntry[] = [];
  private readonly maxLogs = 500;
  private logLevel: LogLevel = import.meta.env.DEV ? "debug" : "info";
  private persistToFile = true;
  private consoleInstalled = false;
  private originalConsole: Pick<Console, ConsoleMethod> | null = null;

  setLogLevel(level: LogLevel): void {
    this.logLevel = level;
  }

  setPersistToFile(enabled: boolean): void {
    this.persistToFile = enabled;
  }

  installConsoleCapture(processName: LogProcess = "renderer"): void {
    if (this.consoleInstalled) {
      return;
    }
    this.consoleInstalled = true;
    this.originalConsole = {
      log: console.log.bind(console),
      info: console.info.bind(console),
      warn: console.warn.bind(console),
      error: console.error.bind(console),
      debug: console.debug.bind(console),
    };

    const levels: Record<ConsoleMethod, LogLevel> = {
      log: "info",
      info: "info",
      warn: "warn",
      error: "error",
      debug: "debug",
    };

    (Object.keys(levels) as ConsoleMethod[]).forEach((method) => {
      const original = this.originalConsole?.[method] ?? console[method].bind(console);
      console[method] = (...args: unknown[]) => {
        if (import.meta.env.DEV) {
          original(...args);
        }
        const { message, context } = formatConsoleArgs(args);
        void this.send({
          level: levels[method],
          process: processName,
          category: "Console",
          event: `console.${method}`,
          message,
          context,
        }, false);
      };
    });
  }

  installGlobalErrorHandlers(processName: LogProcess = "renderer"): void {
    window.addEventListener("error", (event) => {
      this.error("Renderer", "Unhandled renderer error", {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
      }, event.error, processName);
    });

    window.addEventListener("unhandledrejection", (event) => {
      this.error("Renderer", "Unhandled promise rejection", undefined, event.reason, processName);
    });
  }

  debug(category: string, message: string, context?: unknown): void {
    if (!this.shouldLog("debug")) {
      return;
    }
    void this.send({ level: "debug", process: "renderer", category, message, context });
  }

  info(category: string, message: string, context?: unknown): void {
    if (!this.shouldLog("info")) {
      return;
    }
    void this.send({ level: "info", process: "renderer", category, message, context });
  }

  warn(category: string, message: string, context?: unknown): void {
    if (!this.shouldLog("warn")) {
      return;
    }
    void this.send({ level: "warn", process: "renderer", category, message, context });
  }

  error(
    category: string,
    message: string,
    context?: unknown,
    error?: unknown,
    process: LogProcess = "renderer",
  ): void {
    if (!this.shouldLog("error")) {
      return;
    }
    void this.send({ level: "error", process, category, message, context, error });
  }

  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  async getLogsPath(): Promise<string | null> {
    try {
      return await diagnostics.logGetPath();
    } catch {
      return null;
    }
  }

  async exportDiagnostics(): Promise<{ filePath: string } | null> {
    try {
      return await diagnostics.exportBundle();
    } catch {
      return null;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  private async send(entryInput: LogEntryInput, mirrorToConsole = true): Promise<void> {
    const entry = normalizeLogEntry(entryInput);
    this.addLocalLog(entry);

    if (mirrorToConsole && import.meta.env.DEV && this.originalConsole) {
      const original = entry.level === "error"
        ? this.originalConsole.error
        : entry.level === "warn"
          ? this.originalConsole.warn
          : entry.level === "debug"
            ? this.originalConsole.debug
            : this.originalConsole.info;
      original(`[${entry.category}] ${entry.message}`, entry.error ?? entry.context ?? "");
    }

    if (!this.persistToFile) {
      return;
    }

    try {
      await diagnostics.logWriteEntry(entry);
    } catch {
      // Avoid recursive logging failures.
    }
  }

  private addLocalLog(entry: LogEntry): void {
    this.logs.push({
      ...entry,
      timestamp: entry.timestamp ?? formatLocalTimestamp(),
    });
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
  }
}

export const logger = new Logger();
