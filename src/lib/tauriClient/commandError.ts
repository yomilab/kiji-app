export interface StructuredCommandError {
  code: string;
  message: string;
  httpStatus?: number;
}

const EXPECTED_FEED_FAILURE_CODES = new Set([
  "FEED_HTTP_STATUS",
  "FEED_NETWORK_TIMEOUT",
  "FEED_NETWORK_CONNECT",
  "FEED_REQUEST_CANCELLED",
]);

const EXPECTED_FEED_HTTP_STATUSES = new Set([403, 404, 410]);

export function parseStructuredCommandError(error: unknown): StructuredCommandError | null {
  const message = error instanceof Error ? error.message : String(error);

  try {
    const parsed = JSON.parse(message) as StructuredCommandError;
    if (typeof parsed.code === "string" && typeof parsed.message === "string") {
      return parsed;
    }
  } catch {
    // Fall through for legacy plain-string invoke errors.
  }

  return null;
}

export function isExpectedFeedCommandFailure(command: string, error: unknown): boolean {
  if (
    command !== "feeds_fetch"
    && command !== "feeds_fetch_with_cache"
    && command !== "feeds_fetch_data_url"
    && command !== "feeds_fetch_pdf_data_url"
  ) {
    return false;
  }

  const structured = parseStructuredCommandError(error);
  if (structured) {
    if (structured.code === "FEED_HTTP_STATUS") {
      return structured.httpStatus != null && EXPECTED_FEED_HTTP_STATUSES.has(structured.httpStatus);
    }

    return EXPECTED_FEED_FAILURE_CODES.has(structured.code);
  }

  const message = error instanceof Error ? error.message : String(error);
  return /404|403|not found|forbidden|timed out|timeout|dns|enotfound|econnrefused|certificate|cancelled/i.test(message);
}
