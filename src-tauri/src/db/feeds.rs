use rusqlite::{params, params_from_iter, Connection, OptionalExtension, ToSql};
use serde::Deserialize;
use tauri::State;

use super::{
    articles::{
        delete_article_feed_mappings, delete_orphan_unsaved_articles, reassign_article_owners,
    },
    models::{bool_to_i64, to_json_string, to_optional_json_string, FeedRecord},
    DbState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedUpdate {
    pub title: Option<String>,
    pub url: Option<String>,
    pub created_at: Option<String>,
    pub description: Option<Option<String>>,
    pub last_fetched: Option<Option<String>>,
    pub last_failed_fetch_at: Option<Option<String>>,
    pub unread_count: Option<i64>,
    pub article_count: Option<i64>,
    pub tags: Option<Vec<String>>,
    pub favicon: Option<Option<String>>,
    pub favicon_has_transparency: Option<Option<bool>>,
    pub favicon_dominant_color: Option<Option<String>>,
    pub favicon_bg_light: Option<Option<String>>,
    pub favicon_bg_dark: Option<Option<String>>,
    pub favicon_fetch_failed: Option<bool>,
    pub emoji: Option<Option<String>>,
    pub image: Option<Option<String>>,
    pub categories: Option<Vec<String>>,
    pub language: Option<Option<String>>,
    pub is_podcast: Option<bool>,
    pub podcast_metadata: Option<Option<serde_json::Value>>,
    pub reader_mode_enabled: Option<bool>,
    pub etag: Option<Option<String>>,
    pub last_modified_header: Option<Option<String>>,
    pub sort_order: Option<i64>,
    pub update_frequency_score: Option<f64>,
    pub consecutive_failures: Option<i64>,
    pub last_favicon_refresh: Option<Option<String>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_list(state: State<'_, DbState>) -> Result<Vec<FeedRecord>, String> {
    let db = state.inner().clone();
    db.read(|connection| list_feeds(connection)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<FeedRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_feed(connection, &id)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_get_by_url(
    url: String,
    state: State<'_, DbState>,
) -> Result<Option<FeedRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_feed_by_url(connection, &url))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_create(feed: FeedRecord, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| insert_feed(connection, &feed))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_update(
    id: String,
    updates: FeedUpdate,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| update_feed(connection, &id, updates))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_delete(id: String, state: State<'_, DbState>) -> Result<bool, String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute("DELETE FROM feeds WHERE id = ?1", params![id])
            .map(|changes| changes > 0)
            .map_err(|error| format!("Failed to delete feed: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_delete_many(ids: Vec<String>, state: State<'_, DbState>) -> Result<i64, String> {
    let db = state.inner().clone();
    db.write(move |connection| delete_feeds_with_articles(connection, &ids))
        .await
}

/// Deletes many feeds with their articles in one transaction: one set-based
/// owner reassignment, one mapping delete, ONE library-wide orphan sweep, then
/// the feed rows. Replaces the per-feed loop that ran the global orphan GC once
/// per feed (multi-second sweeps × N feeds froze station deletion).
pub fn delete_feeds_with_articles(
    connection: &Connection,
    feed_ids: &[String],
) -> Result<i64, String> {
    if feed_ids.is_empty() {
        return Ok(0);
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start batch feed delete transaction: {error}"))?;

    reassign_article_owners(&transaction, feed_ids)?;
    delete_article_feed_mappings(&transaction, feed_ids)?;
    delete_orphan_unsaved_articles(&transaction)?;

    let placeholders = feed_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(", ");
    let sql = format!("DELETE FROM feeds WHERE id IN ({placeholders})");
    let deleted = transaction
        .execute(&sql, params_from_iter(feed_ids.iter()))
        .map_err(|error| format!("Failed to delete feeds: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit batch feed delete transaction: {error}"))?;

    Ok(deleted as i64)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_update_unread_count(
    id: String,
    count: i64,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE feeds SET unread_count = ?1 WHERE id = ?2",
                params![count, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update feed unread count: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_update_article_count(
    id: String,
    count: i64,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE feeds SET article_count = ?1 WHERE id = ?2",
                params![count, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update feed article count: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_update_last_fetched(
    id: String,
    last_fetched: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE feeds SET last_fetched = ?1 WHERE id = ?2",
                params![last_fetched, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update feed fetch timestamp: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_count(state: State<'_, DbState>) -> Result<i64, String> {
    let db = state.inner().clone();
    db.read(|connection| {
        connection
            .query_row("SELECT COUNT(*) FROM feeds", [], |row| row.get::<_, i64>(0))
            .map_err(|error| format!("Failed to count feeds: {error}"))
    })
    .await
}

pub fn list_feeds(connection: &Connection) -> Result<Vec<FeedRecord>, String> {
    let mut statement = connection
        .prepare("SELECT * FROM feeds ORDER BY sort_order ASC, title COLLATE NOCASE")
        .map_err(|error| format!("Failed to prepare feed list query: {error}"))?;
    let rows = statement
        .query_map([], FeedRecord::from_row)
        .map_err(|error| format!("Failed to query feeds: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read feed row: {error}"))
}

pub fn get_feed(connection: &Connection, id: &str) -> Result<Option<FeedRecord>, String> {
    connection
        .query_row(
            "SELECT * FROM feeds WHERE id = ?1",
            params![id],
            FeedRecord::from_row,
        )
        .optional()
        .map_err(|error| format!("Failed to read feed: {error}"))
}

pub fn get_feed_by_url(connection: &Connection, url: &str) -> Result<Option<FeedRecord>, String> {
    connection
        .query_row(
            "SELECT * FROM feeds WHERE url = ?1",
            params![url],
            FeedRecord::from_row,
        )
        .optional()
        .map_err(|error| format!("Failed to read feed by URL: {error}"))
}

pub fn insert_feed(connection: &Connection, feed: &FeedRecord) -> Result<(), String> {
    let tags_json = to_json_string(&feed.tags)?;
    let categories_json = to_json_string(&feed.categories)?;
    let podcast_metadata_json = to_optional_json_string(&feed.podcast_metadata)?;

    connection
        .execute(
            r#"
            INSERT INTO feeds (
              id, title, url, created_at, description, last_fetched, last_failed_fetch_at,
              unread_count, article_count, tags_json, favicon, favicon_has_transparency,
              favicon_dominant_color, favicon_bg_light, favicon_bg_dark, favicon_fetch_failed,
              last_favicon_refresh, emoji, image, categories_json, language, is_podcast,
              podcast_metadata_json, reader_mode_enabled, sort_order, update_frequency_score,
              consecutive_failures, etag, last_modified_header
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7,
              ?8, ?9, ?10, ?11, ?12,
              ?13, ?14, ?15, ?16,
              ?17, ?18, ?19, ?20, ?21, ?22,
              ?23, ?24, ?25, ?26,
              ?27, ?28, ?29
            )
            "#,
            params![
                feed.id,
                feed.title,
                feed.url,
                feed.created_at,
                feed.description,
                feed.last_fetched,
                feed.last_failed_fetch_at,
                feed.unread_count,
                feed.article_count,
                tags_json,
                feed.favicon,
                feed.favicon_has_transparency.map(bool_to_i64),
                feed.favicon_dominant_color,
                feed.favicon_bg_light,
                feed.favicon_bg_dark,
                bool_to_i64(feed.favicon_fetch_failed),
                feed.last_favicon_refresh,
                feed.emoji,
                feed.image,
                categories_json,
                feed.language,
                bool_to_i64(feed.is_podcast),
                podcast_metadata_json,
                bool_to_i64(feed.reader_mode_enabled),
                feed.sort_order,
                feed.update_frequency_score,
                feed.consecutive_failures,
                feed.etag,
                feed.last_modified_header,
            ],
        )
        .map(|_| ())
        .map_err(|error| map_feed_error(error, "create feed"))
}

pub fn update_feed(connection: &Connection, id: &str, updates: FeedUpdate) -> Result<(), String> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn ToSql>> = Vec::new();

    macro_rules! push_value {
        ($column:literal, $value:expr) => {{
            sets.push(format!("{} = ?", $column));
            values.push(Box::new($value));
        }};
    }

    if let Some(value) = updates.title {
        push_value!("title", value);
    }
    if let Some(value) = updates.url {
        push_value!("url", value);
    }
    if let Some(value) = updates.created_at {
        push_value!("created_at", value);
    }
    if let Some(value) = updates.description {
        push_value!("description", value);
    }
    if let Some(value) = updates.last_fetched {
        push_value!("last_fetched", value);
    }
    if let Some(value) = updates.last_failed_fetch_at {
        push_value!("last_failed_fetch_at", value);
    }
    if let Some(value) = updates.unread_count {
        push_value!("unread_count", value);
    }
    if let Some(value) = updates.article_count {
        push_value!("article_count", value);
    }
    if let Some(value) = updates.tags {
        push_value!("tags_json", to_json_string(&value)?);
    }
    if let Some(value) = updates.favicon {
        push_value!("favicon", value);
    }
    if let Some(value) = updates.favicon_has_transparency {
        push_value!("favicon_has_transparency", value.map(bool_to_i64));
    }
    if let Some(value) = updates.favicon_dominant_color {
        push_value!("favicon_dominant_color", value);
    }
    if let Some(value) = updates.favicon_bg_light {
        push_value!("favicon_bg_light", value);
    }
    if let Some(value) = updates.favicon_bg_dark {
        push_value!("favicon_bg_dark", value);
    }
    if let Some(value) = updates.favicon_fetch_failed {
        push_value!("favicon_fetch_failed", bool_to_i64(value));
    }
    if let Some(value) = updates.emoji {
        push_value!("emoji", value);
    }
    if let Some(value) = updates.image {
        push_value!("image", value);
    }
    if let Some(value) = updates.categories {
        push_value!("categories_json", to_json_string(&value)?);
    }
    if let Some(value) = updates.language {
        push_value!("language", value);
    }
    if let Some(value) = updates.is_podcast {
        push_value!("is_podcast", bool_to_i64(value));
    }
    if let Some(value) = updates.podcast_metadata {
        push_value!("podcast_metadata_json", to_optional_json_string(&value)?);
    }
    if let Some(value) = updates.reader_mode_enabled {
        push_value!("reader_mode_enabled", bool_to_i64(value));
    }
    if let Some(value) = updates.etag {
        push_value!("etag", value);
    }
    if let Some(value) = updates.last_modified_header {
        push_value!("last_modified_header", value);
    }
    if let Some(value) = updates.sort_order {
        push_value!("sort_order", value);
    }
    if let Some(value) = updates.update_frequency_score {
        push_value!("update_frequency_score", value);
    }
    if let Some(value) = updates.consecutive_failures {
        push_value!("consecutive_failures", value);
    }
    if let Some(value) = updates.last_favicon_refresh {
        push_value!("last_favicon_refresh", value);
    }

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE feeds SET {} WHERE id = ?", sets.join(", "));
    values.push(Box::new(id.to_string()));
    let params = values
        .iter()
        .map(|value| value.as_ref())
        .collect::<Vec<_>>();

    connection
        .execute(&sql, params.as_slice())
        .map(|_| ())
        .map_err(|error| map_feed_error(error, "update feed"))
}

fn map_feed_error(error: rusqlite::Error, context: &str) -> String {
    match &error {
        rusqlite::Error::SqliteFailure(failure, _)
            if failure.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            "This feed URL already exists in your library.".to_string()
        }
        _ => format!("Failed to {context}: {error}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    fn setup_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        connection
    }

    fn insert_feed(connection: &Connection, id: &str) {
        connection
            .execute(
                "INSERT INTO feeds (id, title, url, created_at) VALUES (?1, ?1, ?1, '2026-01-01T00:00:00Z')",
                params![id],
            )
            .expect("insert feed");
    }

    fn insert_article(connection: &Connection, hash: &str, feed_id: &str, saved: i64) {
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, fetched_date, saved) VALUES (?1, ?2, '2026-01-01T00:00:00Z', ?3)",
                params![hash, feed_id, saved],
            )
            .expect("insert article");
    }

    fn insert_mapping(connection: &Connection, feed_id: &str, hash: &str) {
        connection
            .execute(
                "INSERT INTO article_feed_items (feed_id, article_hash) VALUES (?1, ?2)",
                params![feed_id, hash],
            )
            .expect("insert article/feed mapping");
    }

    fn article_owner(connection: &Connection, hash: &str) -> Option<String> {
        connection
            .query_row(
                "SELECT feed_id FROM articles WHERE hash = ?1",
                params![hash],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .expect("read article owner")
    }

    fn feed_exists(connection: &Connection, id: &str) -> bool {
        connection
            .query_row(
                "SELECT COUNT(*) FROM feeds WHERE id = ?1",
                params![id],
                |row| row.get::<_, i64>(0),
            )
            .expect("count feed")
            > 0
    }

    #[test]
    fn batch_delete_reassigns_cross_feed_articles_and_collects_orphans_once() {
        let connection = setup_connection();
        for feed_id in ["f1", "f2", "f3"] {
            insert_feed(&connection, feed_id);
        }
        insert_article(&connection, "shared", "f1", 0);
        insert_mapping(&connection, "f1", "shared");
        insert_mapping(&connection, "f2", "shared");
        insert_article(&connection, "orphan", "f1", 0);
        insert_mapping(&connection, "f1", "orphan");
        insert_article(&connection, "kept-saved", "f1", 1);
        insert_mapping(&connection, "f1", "kept-saved");
        insert_article(&connection, "untouched", "f3", 0);
        insert_mapping(&connection, "f3", "untouched");

        let deleted = delete_feeds_with_articles(&connection, &["f1".to_string()])
            .expect("batch delete feed");

        assert_eq!(deleted, 1);
        assert!(!feed_exists(&connection, "f1"));
        assert_eq!(
            article_owner(&connection, "shared").as_deref(),
            Some("f2"),
            "cross-feed article should be reassigned to its remaining feed"
        );
        assert_eq!(
            article_owner(&connection, "orphan"),
            None,
            "unsaved orphan article should be garbage collected"
        );
        assert_eq!(
            article_owner(&connection, "kept-saved"),
            None,
            "articles still owned by the deleted feed cascade with it (articles.feed_id FK ON DELETE CASCADE)"
        );
        assert_eq!(
            article_owner(&connection, "untouched").as_deref(),
            Some("f3")
        );
    }

    #[test]
    fn batch_delete_multi_feed_sweeps_articles_mapped_only_inside_the_batch() {
        let connection = setup_connection();
        for feed_id in ["f1", "f2"] {
            insert_feed(&connection, feed_id);
        }
        insert_article(&connection, "inside-batch", "f1", 0);
        insert_mapping(&connection, "f1", "inside-batch");
        insert_mapping(&connection, "f2", "inside-batch");
        insert_article(&connection, "saved-inside-batch", "f1", 1);
        insert_mapping(&connection, "f1", "saved-inside-batch");
        insert_mapping(&connection, "f2", "saved-inside-batch");

        let deleted = delete_feeds_with_articles(
            &connection,
            &["f1".to_string(), "f2".to_string()],
        )
        .expect("batch delete feeds");

        assert_eq!(deleted, 2);
        assert_eq!(
            article_owner(&connection, "inside-batch"),
            None,
            "article mapped only to deleted feeds should be swept as orphan"
        );
        assert_eq!(
            article_owner(&connection, "saved-inside-batch"),
            None,
            "article whose whole mapping set was deleted cascades with its owner feed"
        );
    }

    #[test]
    fn batch_delete_with_no_ids_is_a_noop() {
        let connection = setup_connection();
        let deleted = delete_feeds_with_articles(&connection, &[]).expect("empty batch delete");
        assert_eq!(deleted, 0);
    }
}
