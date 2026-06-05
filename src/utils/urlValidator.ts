/**
 * URL Validator Utility
 *
 * Provides functions to validate and extract URLs from text.
 */

/**
 * Validates if a string is a valid http/https URL
 * @param url - The URL string to validate
 * @returns true if the URL is valid, false otherwise
 */
export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Extracts the first URL from a text string
 * @param text - The text to search for URLs
 * @returns The first valid URL found, or null if none found
 */
export function extractUrlFromText(text: string): string | null {
  // URL regex pattern that matches http/https URLs
  const urlPattern = /https?:\/\/[^\s]+/g;
  const matches = text.match(urlPattern);

  if (!matches || matches.length === 0) {
    return null;
  }

  // Find first valid URL
  for (const match of matches) {
    if (isValidUrl(match)) {
      return match;
    }
  }

  return null;
}

/**
 * Extracts the main host from a URL (e.g. example.com from https://www.example.com/rss)
 * @param urlStr - The URL string to parse
 * @returns The main host (hostname), or the original string if invalid
 */
export function extractMainHost(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    let host = url.hostname.toLowerCase();

    // Remove 'www.' prefix if it exists
    if (host.startsWith('www.')) {
      host = host.slice(4);
    }

    return host;
  } catch {
    return urlStr;
  }
}
