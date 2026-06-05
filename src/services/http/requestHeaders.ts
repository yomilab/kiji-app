/**
 * Centralized request header normalization.
 *
 * Provides a single source of truth for the Chrome user-agent string and
 * utilities that ensure outgoing HTTP requests carry browser-like headers
 * instead of Electron's local origins (which trigger hotlink protection).
 */

/** Chrome 144 on macOS — used everywhere a browser-like UA is needed. */
export const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36';

// Chrome client-hints + fetch-metadata headers. Some origins (Cloudflare,
// Akamai bot rules, custom UA sniffers) treat requests without these as
// suspicious or legacy IE clients, so we send a consistent modern-Chrome set.
const CHROME_CLIENT_HINTS: Readonly<Record<string, string>> = Object.freeze({
  'sec-ch-ua': '"Chromium";v="144", "Not?A_Brand";v="24", "Google Chrome";v="144"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-User': '?1',
  'Sec-Fetch-Dest': 'document',
});

const LOCAL_ORIGIN_RE =
  /^(?:file:\/\/|https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?)/i;

/** Returns `true` when `url` looks like a local / dev-server origin. */
export function isLocalOrigin(url: string): boolean {
  return LOCAL_ORIGIN_RE.test(url);
}

// Case-insensitive lookup for an existing header key. Header objects in this
// codebase mix casings ("User-Agent" from us, "user-agent" from net/Electron).
function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return true;
  }
  return false;
}

/** Base headers that make a request look like a normal browser visit. */
export function buildDefaultHeaders(): Record<string, string> {
  return {
    'User-Agent': CHROME_USER_AGENT,
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    ...CHROME_CLIENT_HINTS,
  };
}

/**
 * Sanitize outgoing request headers for a given target URL.
 *
 * - If `Referer` is a local origin, replace it with the target URL's origin.
 * - Ensure `User-Agent` is set to our Chrome UA.
 * - Ensure `Accept-Language` is present.
 * - Backfill modern Chrome client-hint / fetch-metadata headers when missing
 *   so server-side UA sniffers don't classify us as a legacy/IE client.
 *
 * The headers object is mutated in place **and** returned for convenience.
 */
export function sanitizeRequestHeaders(
  targetUrl: string,
  headers: Record<string, string>,
): Record<string, string> {
  // Fix Referer when it points at a local origin
  const referer = headers['Referer'] || headers['referer'];
  if (referer && isLocalOrigin(referer)) {
    try {
      const origin = new URL(targetUrl).origin;
      headers['Referer'] = `${origin}/`;
    } catch {
      // Malformed target URL — drop the local referer entirely
      delete headers['Referer'];
      delete headers['referer'];
    }
  }

  // Ensure browser-like defaults
  if (!hasHeader(headers, 'User-Agent')) {
    headers['User-Agent'] = CHROME_USER_AGENT;
  }
  if (!hasHeader(headers, 'Accept-Language')) {
    headers['Accept-Language'] = 'en-US,en;q=0.9';
  }

  // Backfill Chrome client-hints / Sec-Fetch-* without overwriting any value
  // the caller already provided (e.g. Sec-Fetch-Mode for sub-resource fetches).
  for (const [key, value] of Object.entries(CHROME_CLIENT_HINTS)) {
    if (!hasHeader(headers, key)) {
      headers[key] = value;
    }
  }

  return headers;
}
