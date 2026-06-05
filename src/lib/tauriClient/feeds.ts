import type { FeedsContract } from "./contracts";
import { invokeContract } from "./core";

export async function fetch(
  request: FeedsContract["fetch"]["request"],
): Promise<FeedsContract["fetch"]["response"]> {
  return invokeContract<FeedsContract["fetch"]>("feeds_fetch", request);
}

export async function fetchWithCache(
  request: FeedsContract["fetchWithCache"]["request"],
): Promise<FeedsContract["fetchWithCache"]["response"]> {
  return invokeContract<FeedsContract["fetchWithCache"]>("feeds_fetch_with_cache", request);
}

export async function fetchDataUrl(
  request: FeedsContract["fetchDataUrl"]["request"],
): Promise<FeedsContract["fetchDataUrl"]["response"]> {
  return invokeContract<FeedsContract["fetchDataUrl"]>("feeds_fetch_data_url", request);
}

export async function abortRequest(
  request: FeedsContract["abortRequest"]["request"],
): Promise<FeedsContract["abortRequest"]["response"]> {
  return invokeContract<FeedsContract["abortRequest"]>("feeds_abort_request", request);
}

export async function list(): Promise<FeedsContract["list"]["response"]> {
  return invokeContract<FeedsContract["list"]>("feeds_list");
}

export async function get(
  request: FeedsContract["get"]["request"],
): Promise<FeedsContract["get"]["response"]> {
  return invokeContract<FeedsContract["get"]>("feeds_get", request);
}

export async function getByUrl(
  request: FeedsContract["getByUrl"]["request"],
): Promise<FeedsContract["getByUrl"]["response"]> {
  return invokeContract<FeedsContract["getByUrl"]>("feeds_get_by_url", request);
}

export async function create(
  request: FeedsContract["create"]["request"],
): Promise<FeedsContract["create"]["response"]> {
  return invokeContract<FeedsContract["create"]>("feeds_create", request);
}

export async function update(
  request: FeedsContract["update"]["request"],
): Promise<FeedsContract["update"]["response"]> {
  return invokeContract<FeedsContract["update"]>("feeds_update", request);
}

export async function deleteFeed(
  request: FeedsContract["delete"]["request"],
): Promise<FeedsContract["delete"]["response"]> {
  return invokeContract<FeedsContract["delete"]>("feeds_delete", request);
}

export async function updateUnreadCount(
  request: FeedsContract["updateUnreadCount"]["request"],
): Promise<FeedsContract["updateUnreadCount"]["response"]> {
  return invokeContract<FeedsContract["updateUnreadCount"]>("feeds_update_unread_count", request);
}

export async function updateArticleCount(
  request: FeedsContract["updateArticleCount"]["request"],
): Promise<FeedsContract["updateArticleCount"]["response"]> {
  return invokeContract<FeedsContract["updateArticleCount"]>("feeds_update_article_count", request);
}

export async function updateLastFetched(
  request: FeedsContract["updateLastFetched"]["request"],
): Promise<FeedsContract["updateLastFetched"]["response"]> {
  return invokeContract<FeedsContract["updateLastFetched"]>("feeds_update_last_fetched", request);
}

export async function count(): Promise<FeedsContract["count"]["response"]> {
  return invokeContract<FeedsContract["count"]>("feeds_count");
}

export const tags = {
  list(): Promise<FeedsContract["tagsList"]["response"]> {
    return invokeContract<FeedsContract["tagsList"]>("feeds_tags_list");
  },
  listWithFeedIds(): Promise<FeedsContract["tagsListWithFeedIds"]["response"]> {
    return invokeContract<FeedsContract["tagsListWithFeedIds"]>("feeds_tags_list_with_feed_ids");
  },
  upsert(
    request: FeedsContract["tagsUpsert"]["request"],
  ): Promise<FeedsContract["tagsUpsert"]["response"]> {
    return invokeContract<FeedsContract["tagsUpsert"]>("feeds_tags_upsert", request);
  },
  update(
    request: FeedsContract["tagsUpdate"]["request"],
  ): Promise<FeedsContract["tagsUpdate"]["response"]> {
    return invokeContract<FeedsContract["tagsUpdate"]>("feeds_tags_update", request);
  },
  rename(
    request: FeedsContract["tagsRename"]["request"],
  ): Promise<FeedsContract["tagsRename"]["response"]> {
    return invokeContract<FeedsContract["tagsRename"]>("feeds_tags_rename", request);
  },
  delete(
    request: FeedsContract["tagsDelete"]["request"],
  ): Promise<FeedsContract["tagsDelete"]["response"]> {
    return invokeContract<FeedsContract["tagsDelete"]>("feeds_tags_delete", request);
  },
  attachFeed(
    request: FeedsContract["tagsAttachFeed"]["request"],
  ): Promise<FeedsContract["tagsAttachFeed"]["response"]> {
    return invokeContract<FeedsContract["tagsAttachFeed"]>("feeds_tags_attach_feed", request);
  },
  detachFeed(
    request: FeedsContract["tagsDetachFeed"]["request"],
  ): Promise<FeedsContract["tagsDetachFeed"]["response"]> {
    return invokeContract<FeedsContract["tagsDetachFeed"]>("feeds_tags_detach_feed", request);
  },
  listFeedIds(
    request: FeedsContract["tagsListFeedIds"]["request"],
  ): Promise<FeedsContract["tagsListFeedIds"]["response"]> {
    return invokeContract<FeedsContract["tagsListFeedIds"]>("feeds_tags_list_feed_ids", request);
  },
  listByFeed(
    request: FeedsContract["tagsListByFeed"]["request"],
  ): Promise<FeedsContract["tagsListByFeed"]["response"]> {
    return invokeContract<FeedsContract["tagsListByFeed"]>("feeds_tags_list_by_feed", request);
  },
};
