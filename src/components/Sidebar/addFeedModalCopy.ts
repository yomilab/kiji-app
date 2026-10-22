/**
 * Pure helpers for the Add Feeds modal: link normalisation, feed title
 * extraction, and plain-language copy for errors and summaries. Raw error
 * messages stay in logs; the modal only shows the strings returned here.
 */

const errorText = (error: unknown): string => (
  error instanceof Error ? error.message : typeof error === 'string' ? error : ''
);

/**
 * Turn what the user typed or pasted into an http(s) URL, or null.
 * A bare address like `example.com/feed` gets `https://` in front.
 */
export const normalizeLinkInput = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
  const candidate = hasScheme ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    // Without a scheme, require something that looks like a host name.
    if (!hasScheme && !url.hostname.includes('.') && url.hostname !== 'localhost') {
      return null;
    }
    return candidate;
  } catch {
    return null;
  }
};

export const extractFeedTitleFromXml = (xmlText: string): string | null => {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) {
    return null;
  }

  const titleElement =
    xmlDoc.querySelector('channel > title') ||
    xmlDoc.querySelector('feed > title') ||
    xmlDoc.querySelector('title');

  return titleElement?.textContent?.trim() || null;
};

export const hostLabel = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export const formatExistingSubscriptionMessage = (stationNames: string[]): string => {
  if (stationNames.length === 0) {
    return 'You already follow this feed.';
  }
  if (stationNames.length === 1) {
    return `You already follow this feed in ${stationNames[0]}.`;
  }
  return `You already follow this feed in ${stationNames.join(', ')}.`;
};

export const pluralize = (count: number, singular: string, plural = `${singular}s`): string => (
  `${count} ${count === 1 ? singular : plural}`
);

/** Plain-language message for a failed feed or feed-list lookup. */
export const describeLinkError = (error: unknown): string => {
  const message = errorText(error).toLowerCase();

  if (error instanceof Error && error.name === 'FeedNotFoundError') {
    return 'We couldn\'t find a feed on this page.';
  }
  if (message.includes('already exists')) {
    return 'This feed is already in your library.';
  }
  if (message.includes('timed out') || message.includes('timeout')) {
    return 'The site took too long to answer. Check your connection and try again.';
  }
  if (
    message.includes('not recognized')
    || message.includes('parse')
    || message.includes('empty')
    || message.includes('no feed items')
    || message.includes('opml')
  ) {
    return 'There is no feed at this link. Try the site\'s RSS or Atom link instead.';
  }
  if (message.includes('only available in the desktop app')) {
    return 'Adding feeds works in the KiJi app only.';
  }
  return 'This link could not be opened. Check the address and try again.';
};

/** Plain-language message for a failed OPML file import. */
export const describeFileImportError = (error: unknown): string => {
  const message = errorText(error).toLowerCase();

  if (message.includes('only available in the desktop app')) {
    return 'Importing works in the KiJi app only.';
  }
  if (message.includes('empty')) {
    return 'That file is empty. Choose another feed list.';
  }
  if (message.includes('opml') || message.includes('xml') || message.includes('body')) {
    return 'That file is not a feed list KiJi can read. Choose an .opml file exported from another reader.';
  }
  return 'The import did not finish. Please try again.';
};
