/**
 * Temporary Article Factory
 *
 * Creates temporary articles from clipboard URLs.
 */

import type { Article } from '@/types/article';
import type { ReaderModeContent } from '@/services/articles/readerModeService';
import type { PostlightResult } from '@/services/articles/postlightParserService';
import { articleHasher } from '@/services/articles/articleHasher';
import { normalizePublishedDate } from '@/services/articles/publishedDateNormalizer';
import type { FeedItem } from '@/services/feeds/feedsFetcher';

/**
 * Creates a temporary article from clipboard content using reader mode data
 * @param url - The original URL
 * @param readerContent - The parsed reader mode content
 * @param favicon - Optional favicon data URL
 * @returns A temporary Article object
 */
async function buildTemporaryHash(url: string, title: string, content: string): Promise<string> {
  const hashItem: FeedItem = {
    id: url,
    title,
    content,
    link: url,
    feedId: 'clipboard',
    guid: `clipboard:${url}`,
  };

  return articleHasher.generateHash(hashItem);
}

export async function createTemporaryArticle(
  url: string,
  readerContent: ReaderModeContent,
  favicon?: string
): Promise<Article> {
  const hash = await buildTemporaryHash(url, readerContent.title || 'Untitled', readerContent.content);
  const nowIso = new Date().toISOString();

  // Extract hostname for feedTitle fallback
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Keep original URL if parsing fails
  }

  return {
    hash,
    feedId: 'clipboard',
    feedUrl: url,
    feedTitle: readerContent.siteName || hostname,
    feedFavicon: favicon,
    title: readerContent.title || 'Untitled',
    description: readerContent.excerpt || '',
    link: url,
    content: readerContent.content,
    author: readerContent.byline || undefined,
    publishedDate: nowIso,
    fetchedDate: nowIso,
    read: false,
    starred: false,
    saved: false,
    guid: `clipboard:${url}`,
  };
}

/**
 * Creates a temporary article from clipboard content using Postlight parser data
 * @param url - The original URL
 * @param postlightContent - The parsed Postlight content
 * @param favicon - Optional favicon data URL
 * @returns A temporary Article object
 */
export async function createTemporaryArticleFromPostlight(
  url: string,
  postlightContent: PostlightResult,
  favicon?: string
): Promise<Article> {
  const hash = await buildTemporaryHash(url, postlightContent.title || 'Untitled', postlightContent.content || '');
  const now = new Date();
  const nowIso = now.toISOString();
  const publishedDate = normalizePublishedDate(postlightContent.datePublished || undefined, { now }) || nowIso;

  // Extract hostname for feedTitle fallback
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Keep original URL if parsing fails
  }

  return {
    hash,
    feedId: 'clipboard',
    feedUrl: url,
    feedTitle: postlightContent.siteName || postlightContent.domain || hostname,
    feedFavicon: favicon,
    title: postlightContent.title || 'Untitled',
    description: postlightContent.excerpt || '',
    link: url,
    content: postlightContent.content || '',
    author: postlightContent.author || undefined,
    publishedDate,
    fetchedDate: nowIso,
    read: false,
    starred: false,
    saved: false,
    guid: `clipboard:${url}`,
  };
}
