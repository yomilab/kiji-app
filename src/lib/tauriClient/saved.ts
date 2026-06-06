import type { SavedContract } from "./contracts";
import { invokeCommand, invokeContract } from "./core";

export async function query(
  request: SavedContract["query"]["request"],
): Promise<SavedContract["query"]["response"]> {
  return invokeCommand<SavedContract["query"]["response"]>("saved_query", { request });
}

export async function create(
  request: SavedContract["create"]["request"],
): Promise<SavedContract["create"]["response"]> {
  return invokeContract<SavedContract["create"]>("saved_create", request);
}

export async function insertBatch(
  request: SavedContract["insertBatch"]["request"],
): Promise<SavedContract["insertBatch"]["response"]> {
  return invokeContract<SavedContract["insertBatch"]>("saved_insert_batch", request);
}

export async function deleteSaved(
  request: SavedContract["delete"]["request"],
): Promise<SavedContract["delete"]["response"]> {
  return invokeContract<SavedContract["delete"]>("saved_delete", request);
}

export async function get(
  request: SavedContract["get"]["request"],
): Promise<SavedContract["get"]["response"]> {
  return invokeContract<SavedContract["get"]>("saved_get", request);
}

export async function getByArticleHash(
  request: SavedContract["getByArticleHash"]["request"],
): Promise<SavedContract["getByArticleHash"]["response"]> {
  return invokeContract<SavedContract["getByArticleHash"]>("saved_get_by_article_hash", request);
}

export async function getByLink(
  request: SavedContract["getByLink"]["request"],
): Promise<SavedContract["getByLink"]["response"]> {
  return invokeContract<SavedContract["getByLink"]>("saved_get_by_link", request);
}

export async function listAll(): Promise<SavedContract["listAll"]["response"]> {
  return invokeContract<SavedContract["listAll"]>("saved_list_all");
}

export async function getContent(
  request: SavedContract["getContent"]["request"],
): Promise<SavedContract["getContent"]["response"]> {
  return invokeContract<SavedContract["getContent"]>("saved_get_content", request);
}

export async function updateHighlights(
  request: SavedContract["updateHighlights"]["request"],
): Promise<SavedContract["updateHighlights"]["response"]> {
  return invokeContract<SavedContract["updateHighlights"]>("saved_update_highlights", request);
}

export async function updateNotes(
  request: SavedContract["updateNotes"]["request"],
): Promise<SavedContract["updateNotes"]["response"]> {
  return invokeContract<SavedContract["updateNotes"]>("saved_update_notes", request);
}

export async function updateLastReadAt(
  request: SavedContract["updateLastReadAt"]["request"],
): Promise<SavedContract["updateLastReadAt"]["response"]> {
  return invokeContract<SavedContract["updateLastReadAt"]>("saved_update_last_read_at", request);
}

export async function exportStart(
  request: SavedContract["exportStart"]["request"],
): Promise<SavedContract["exportStart"]["response"]> {
  return invokeContract<SavedContract["exportStart"]>("saved_export_start", request);
}
