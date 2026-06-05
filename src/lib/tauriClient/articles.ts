import type { ArticlesContract } from "./contracts";
import { invokeContract } from "./core";

export async function query(
  request: ArticlesContract["query"]["request"],
): Promise<ArticlesContract["query"]["response"]> {
  return invokeContract<ArticlesContract["query"]>("articles_query", request);
}

export async function get(
  request: ArticlesContract["get"]["request"],
): Promise<ArticlesContract["get"]["response"]> {
  return invokeContract<ArticlesContract["get"]>("articles_get", request);
}

export async function getContent(
  request: ArticlesContract["getContent"]["request"],
): Promise<ArticlesContract["getContent"]["response"]> {
  return invokeContract<ArticlesContract["getContent"]>("articles_get_content", request);
}

export async function exists(
  request: ArticlesContract["exists"]["request"],
): Promise<ArticlesContract["exists"]["response"]> {
  return invokeContract<ArticlesContract["exists"]>("articles_exists", request);
}

export async function insertBatch(
  request: ArticlesContract["insertBatch"]["request"],
): Promise<ArticlesContract["insertBatch"]["response"]> {
  return invokeContract<ArticlesContract["insertBatch"]>("articles_insert_batch", request);
}

export async function updateRead(
  request: ArticlesContract["updateRead"]["request"],
): Promise<ArticlesContract["updateRead"]["response"]> {
  return invokeContract<ArticlesContract["updateRead"]>("articles_update_read", request);
}

export async function updateLastReadAt(
  request: ArticlesContract["updateLastReadAt"]["request"],
): Promise<ArticlesContract["updateLastReadAt"]["response"]> {
  return invokeContract<ArticlesContract["updateLastReadAt"]>("articles_update_last_read_at", request);
}

export async function toggleStarred(
  request: ArticlesContract["toggleStarred"]["request"],
): Promise<ArticlesContract["toggleStarred"]["response"]> {
  return invokeContract<ArticlesContract["toggleStarred"]>("articles_toggle_starred", request);
}

export async function updateSavedState(
  request: ArticlesContract["updateSavedState"]["request"],
): Promise<ArticlesContract["updateSavedState"]["response"]> {
  return invokeContract<ArticlesContract["updateSavedState"]>("articles_update_saved_state", request);
}

export async function deleteByFeed(
  request: ArticlesContract["deleteByFeed"]["request"],
): Promise<ArticlesContract["deleteByFeed"]["response"]> {
  return invokeContract<ArticlesContract["deleteByFeed"]>("articles_delete_by_feed", request);
}

export async function cleanOldByFeed(
  request: ArticlesContract["cleanOldByFeed"]["request"],
): Promise<ArticlesContract["cleanOldByFeed"]["response"]> {
  return invokeContract<ArticlesContract["cleanOldByFeed"]>("articles_clean_old_by_feed", request);
}

export async function cleanOldAcrossFeeds(
  request: ArticlesContract["cleanOldAcrossFeeds"]["request"],
): Promise<ArticlesContract["cleanOldAcrossFeeds"]["response"]> {
  return invokeContract<ArticlesContract["cleanOldAcrossFeeds"]>(
    "articles_clean_old_across_feeds",
    request,
  );
}

export async function countUnreadByFeed(
  request: ArticlesContract["countUnreadByFeed"]["request"],
): Promise<ArticlesContract["countUnreadByFeed"]["response"]> {
  return invokeContract<ArticlesContract["countUnreadByFeed"]>("articles_count_unread_by_feed", request);
}

export async function countByFeed(
  request: ArticlesContract["countByFeed"]["request"],
): Promise<ArticlesContract["countByFeed"]["response"]> {
  return invokeContract<ArticlesContract["countByFeed"]>("articles_count_by_feed", request);
}

export async function updateFeedMeta(
  request: ArticlesContract["updateFeedMeta"]["request"],
): Promise<ArticlesContract["updateFeedMeta"]["response"]> {
  return invokeContract<ArticlesContract["updateFeedMeta"]>("articles_update_feed_meta", request);
}
