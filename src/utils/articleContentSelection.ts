/**
 * Detects embeddable media blocks in HTML content.
 */
export function hasEmbeddableMedia(html?: string | null): boolean {
  if (!html) return false;
  return /<(iframe|video|audio|lite-youtube|embed|object|feed-audio-player)\b/i.test(html);
}

interface SelectArticleHtmlInput {
  postlightHtml?: string | null;
  readerHtml?: string | null;
}

/**
 * Prefer reader-mode HTML when it contains media embeds that are missing from Postlight output.
 */
export function selectArticleHtmlContent({
  postlightHtml,
  readerHtml,
}: SelectArticleHtmlInput): string {
  const postlight = (postlightHtml || '').trim();
  const reader = (readerHtml || '').trim();

  if (!postlight) return reader;
  if (!reader) return postlight;

  const postlightHasMedia = hasEmbeddableMedia(postlight);
  const readerHasMedia = hasEmbeddableMedia(reader);

  if (!postlightHasMedia && readerHasMedia) {
    return reader;
  }

  return postlight;
}
