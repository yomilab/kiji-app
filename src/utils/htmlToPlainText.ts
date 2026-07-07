/**
 * Convert HTML (or entity-encoded plain text) into display-ready plain text.
 */
export function htmlToPlainText(raw: string): string {
  if (!raw) {
    return '';
  }

  try {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }
}

/**
 * Repair descriptions persisted before HTML entity decoding was applied during ingest.
 */
export function normalizeStoredDescription(description: string): string {
  if (!description || !/&(#|[a-z])/i.test(description)) {
    return description;
  }

  return htmlToPlainText(description);
}
