use rusqlite::{params, Connection, OptionalExtension, ToSql};
use serde::Deserialize;
use tauri::State;

use super::{
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
