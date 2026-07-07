import type { Article } from '@/types/article';

/**
 * Pre-allocate one array for non-overlapping pagination appends so long sessions
 * do not pay spread-operator copies over the full retained list on every page.
 */
const appendArticlesPreservingExisting = (existing: Article[], incoming: Article[]): Article[] => {
  const merged = new Array<Article>(existing.length + incoming.length);
  for (let index = 0; index < existing.length; index += 1) {
    merged[index] = existing[index];
  }
  for (let index = 0; index < incoming.length; index += 1) {
    merged[existing.length + index] = incoming[index];
  }
  return merged;
};

/**
 * Keep infinite-scroll append idempotent: stale/retried page fetches should not
 * duplicate heavy article payloads in memory.
 */
export function mergeUniqueArticlesByHash(existing: Article[], incoming: Article[]): Article[] {
  if (incoming.length === 0) {
    return existing;
  }

  const incomingHashes = new Set<string>();
  const uniqueIncoming: Article[] = [];

  for (const article of incoming) {
    if (incomingHashes.has(article.hash)) {
      continue;
    }
    incomingHashes.add(article.hash);
    uniqueIncoming.push(article);
  }

  if (uniqueIncoming.length === 0) {
    return existing;
  }

  let overlapsExisting = false;
  for (const article of existing) {
    if (incomingHashes.has(article.hash)) {
      overlapsExisting = true;
      break;
    }
  }

  if (!overlapsExisting) {
    return appendArticlesPreservingExisting(existing, uniqueIncoming);
  }

  const seenHashes = new Set(existing.map((article) => article.hash));
  const dedupedIncoming: Article[] = [];
  for (const article of uniqueIncoming) {
    if (seenHashes.has(article.hash)) {
      continue;
    }
    seenHashes.add(article.hash);
    dedupedIncoming.push(article);
  }

  if (dedupedIncoming.length === 0) {
    return existing;
  }

  return appendArticlesPreservingExisting(existing, dedupedIncoming);
}
