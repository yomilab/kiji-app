use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, ToSql};
use serde::Deserialize;
use tauri::State;

use super::{models::TagRecord, DbState};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagUpdate {
    pub color: Option<Option<String>>,
    pub emoji: Option<Option<String>>,
    pub created_at: Option<String>,
    pub sort_order: Option<i64>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_list(state: State<'_, DbState>) -> Result<Vec<TagRecord>, String> {
    let db = state.inner().clone();
    db.read(|connection| list_tags(connection)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_list_with_feed_ids(
    state: State<'_, DbState>,
) -> Result<Vec<TagRecord>, String> {
    let db = state.inner().clone();
    db.read(|connection| list_tags_with_feed_ids(connection))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_upsert(tag: TagRecord, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| upsert_tag(connection, &tag))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_update(
    name: String,
    updates: TagUpdate,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| update_tag(connection, &name, updates))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_rename(
    current_name: String,
    next_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| rename_tag(connection, &current_name, &next_name))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_delete(name: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| delete_tag(connection, &name))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_attach_feed(
    feed_id: String,
    tag_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| attach_feed(connection, &feed_id, &tag_name))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_detach_feed(
    feed_id: String,
    tag_name: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| detach_feed(connection, &feed_id, &tag_name))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_list_feed_ids(
    tag_name: String,
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db = state.inner().clone();
    db.read(move |connection| feed_ids_by_tag(connection, &tag_name))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_tags_list_by_feed(
    feed_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db = state.inner().clone();
    db.read(move |connection| tags_by_feed(connection, &feed_id))
        .await
}

pub fn list_tags(connection: &Connection) -> Result<Vec<TagRecord>, String> {
    let mut statement = connection
        .prepare("SELECT * FROM tags ORDER BY sort_order ASC, name COLLATE NOCASE")
        .map_err(|error| format!("Failed to prepare tag list query: {error}"))?;
    let rows = statement
        .query_map([], TagRecord::from_row)
        .map_err(|error| format!("Failed to query tags: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read tag row: {error}"))
}

pub fn list_tags_with_feed_ids(connection: &Connection) -> Result<Vec<TagRecord>, String> {
    let mut tags = list_tags(connection)?;

    for tag in &mut tags {
        tag.feed_ids = Some(feed_ids_by_tag(connection, &tag.name)?);
    }

    Ok(tags)
}

pub fn upsert_tag(connection: &Connection, tag: &TagRecord) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO tags (name, color, emoji, created_at, sort_order)
            VALUES (
              ?1,
              ?2,
              ?3,
              ?4,
              COALESCE(?5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tags))
            )
            ON CONFLICT(name) DO UPDATE SET
              color = COALESCE(excluded.color, tags.color),
              emoji = COALESCE(excluded.emoji, tags.emoji),
              sort_order = COALESCE(excluded.sort_order, tags.sort_order)
            "#,
            params![
                tag.name,
                tag.color,
                tag.emoji,
                tag.created_at,
                tag.sort_order
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to upsert tag: {error}"))
}

pub fn update_tag(connection: &Connection, name: &str, updates: TagUpdate) -> Result<(), String> {
    let mut sets: Vec<String> = Vec::new();
    let mut values: Vec<Box<dyn ToSql>> = Vec::new();

    macro_rules! push_value {
        ($column:literal, $value:expr) => {{
            sets.push(format!("{} = ?", $column));
            values.push(Box::new($value));
        }};
    }

    if let Some(value) = updates.color {
        push_value!("color", value);
    }
    if let Some(value) = updates.emoji {
        push_value!("emoji", value);
    }
    if let Some(value) = updates.created_at {
        push_value!("created_at", value);
    }
    if let Some(value) = updates.sort_order {
        push_value!("sort_order", value);
    }

    if sets.is_empty() {
        return Ok(());
    }

    let sql = format!("UPDATE tags SET {} WHERE name = ?", sets.join(", "));
    values.push(Box::new(name.to_string()));
    let params = values
        .iter()
        .map(|value| value.as_ref())
        .collect::<Vec<_>>();

    connection
        .execute(&sql, params.as_slice())
        .map(|_| ())
        .map_err(|error| format!("Failed to update tag: {error}"))
}

pub fn rename_tag(
    connection: &Connection,
    current_name: &str,
    next_name: &str,
) -> Result<(), String> {
    let normalized_next_name = next_name.trim();
    if normalized_next_name.is_empty() || normalized_next_name == current_name {
        return Ok(());
    }

    let existing =
        get_tag(connection, current_name)?.ok_or_else(|| "Station not found.".to_string())?;
    if get_tag(connection, normalized_next_name)?.is_some() {
        return Err("A station with this name already exists.".to_string());
    }

    connection
        .execute(
            "INSERT INTO tags (name, color, emoji, created_at, sort_order) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                normalized_next_name,
                existing.color,
                existing.emoji,
                existing.created_at,
                existing.sort_order
            ],
        )
        .map_err(|error| format!("Failed to create renamed tag: {error}"))?;
    connection
        .execute(
            "UPDATE feed_tags SET tag_name = ?1 WHERE tag_name = ?2",
            params![normalized_next_name, current_name],
        )
        .map_err(|error| format!("Failed to update renamed tag memberships: {error}"))?;
    connection
        .execute("DELETE FROM tags WHERE name = ?1", params![current_name])
        .map_err(|error| format!("Failed to delete old tag name: {error}"))?;
    resync_all_feed_tag_caches(connection)
}

pub fn delete_tag(connection: &Connection, name: &str) -> Result<(), String> {
    connection
        .execute("DELETE FROM feed_tags WHERE tag_name = ?1", params![name])
        .map_err(|error| format!("Failed to delete tag memberships: {error}"))?;
    connection
        .execute("DELETE FROM tags WHERE name = ?1", params![name])
        .map_err(|error| format!("Failed to delete tag: {error}"))?;
    resync_all_feed_tag_caches(connection)
}

pub fn attach_feed(connection: &Connection, feed_id: &str, tag_name: &str) -> Result<(), String> {
    if get_tag(connection, tag_name)?.is_none() {
        let tag = TagRecord {
            name: tag_name.to_string(),
            color: None,
            emoji: None,
            created_at: Utc::now().to_rfc3339(),
            sort_order: next_sort_order(connection)?,
            feed_ids: None,
        };
        upsert_tag(connection, &tag)?;
    }

    connection
        .execute(
            "INSERT OR IGNORE INTO feed_tags (feed_id, tag_name) VALUES (?1, ?2)",
            params![feed_id, tag_name],
        )
        .map_err(|error| format!("Failed to attach feed tag: {error}"))?;
    sync_feed_tag_cache(connection, feed_id)
}

pub fn detach_feed(connection: &Connection, feed_id: &str, tag_name: &str) -> Result<(), String> {
    connection
        .execute(
            "DELETE FROM feed_tags WHERE feed_id = ?1 AND tag_name = ?2",
            params![feed_id, tag_name],
        )
        .map_err(|error| format!("Failed to detach feed tag: {error}"))?;
    sync_feed_tag_cache(connection, feed_id)?;

    let remaining = connection
        .query_row(
            "SELECT COUNT(*) FROM feed_tags WHERE tag_name = ?1",
            params![tag_name],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Failed to count tag memberships: {error}"))?;
    if remaining == 0 {
        connection
            .execute("DELETE FROM tags WHERE name = ?1", params![tag_name])
            .map_err(|error| format!("Failed to delete empty tag: {error}"))?;
    }

    Ok(())
}

pub fn feed_ids_by_tag(connection: &Connection, tag_name: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare("SELECT feed_id FROM feed_tags WHERE tag_name = ?1 ORDER BY feed_id")
        .map_err(|error| format!("Failed to prepare tag feed query: {error}"))?;
    let rows = statement
        .query_map(params![tag_name], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query tag feed ids: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read tag feed id: {error}"))
}

pub fn tags_by_feed(connection: &Connection, feed_id: &str) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "SELECT tag_name FROM feed_tags WHERE feed_id = ?1 ORDER BY tag_name COLLATE NOCASE",
        )
        .map_err(|error| format!("Failed to prepare feed tag query: {error}"))?;
    let rows = statement
        .query_map(params![feed_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query feed tags: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read feed tag: {error}"))
}

fn get_tag(connection: &Connection, name: &str) -> Result<Option<TagRecord>, String> {
    connection
        .query_row(
            "SELECT * FROM tags WHERE name = ?1",
            params![name],
            TagRecord::from_row,
        )
        .optional()
        .map_err(|error| format!("Failed to read tag: {error}"))
}

fn next_sort_order(connection: &Connection) -> Result<i64, String> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM tags",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Failed to compute tag sort order: {error}"))
}

fn sync_feed_tag_cache(connection: &Connection, feed_id: &str) -> Result<(), String> {
    let tags = tags_by_feed(connection, feed_id)?;
    let tags_json = serde_json::to_string(&tags)
        .map_err(|error| format!("Failed to encode feed tag cache: {error}"))?;
    connection
        .execute(
            "UPDATE feeds SET tags_json = ?1 WHERE id = ?2",
            params![tags_json, feed_id],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to update feed tag cache: {error}"))
}

fn resync_all_feed_tag_caches(connection: &Connection) -> Result<(), String> {
    let mut statement = connection
        .prepare("SELECT id FROM feeds")
        .map_err(|error| format!("Failed to prepare feed cache resync query: {error}"))?;
    let feed_ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query feeds for tag cache resync: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read feed id for tag cache resync: {error}"))?;

    for feed_id in feed_ids {
        sync_feed_tag_cache(connection, &feed_id)?;
    }

    Ok(())
}
