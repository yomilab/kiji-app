export type ArticleResourceType = 'html' | 'pdf' | 'unsupported' | null;

export function linkLooksLikePdf(url: string | undefined | null): boolean {
  if (!url) {
    return false;
  }

  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return url.toLowerCase().split(/[?#]/)[0]?.endsWith('.pdf') ?? false;
  }
}

/** PDF and other non-HTML remote resources persist link only — never inline binary or parsed garbage. */
export function shouldSaveLinkOnlyContent(
  resourceType: ArticleResourceType,
  link?: string | null,
): boolean {
  return resourceType === 'pdf'
    || resourceType === 'unsupported'
    || linkLooksLikePdf(link);
}

export function getLinkOnlySavedContent(): string {
  return '';
}
