use rusqlite::Row;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;

pub fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub fn i64_to_bool(value: i64) -> bool {
    value != 0
}

pub fn parse_json_value(raw: Option<String>) -> Option<JsonValue> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

pub fn parse_json_array(raw: Option<String>) -> Vec<JsonValue> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

pub fn parse_string_array(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default()
}

pub fn to_json_string<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|error| format!("Failed to encode JSON value: {error}"))
}

pub fn to_optional_json_string(value: &Option<JsonValue>) -> Result<Option<String>, String> {
    value.as_ref().map(to_json_string).transpose()
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedRecord {
    pub id: String,
    pub title: String,
    pub url: String,
    pub created_at: String,
    pub description: Option<String>,
    pub last_fetched: Option<String>,
    pub last_failed_fetch_at: Option<String>,
    pub unread_count: i64,
    pub article_count: i64,
    pub tags: Vec<String>,
    pub favicon: Option<String>,
    pub favicon_has_transparency: Option<bool>,
    pub favicon_dominant_color: Option<String>,
    pub favicon_bg_light: Option<String>,
    pub favicon_bg_dark: Option<String>,
    pub favicon_fetch_failed: bool,
    pub emoji: Option<String>,
    pub image: Option<String>,
    pub categories: Vec<String>,
    pub language: Option<String>,
    pub is_podcast: bool,
    pub podcast_metadata: Option<JsonValue>,
    pub reader_mode_enabled: bool,
    pub etag: Option<String>,
    pub last_modified_header: Option<String>,
    pub sort_order: i64,
    pub update_frequency_score: f64,
    pub consecutive_failures: i64,
    pub last_favicon_refresh: Option<String>,
}

impl FeedRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let tags_json: Option<String> = row.get("tags_json")?;
        let categories_json: Option<String> = row.get("categories_json")?;
        let podcast_metadata_json: Option<String> = row.get("podcast_metadata_json")?;
        let favicon_has_transparency: Option<i64> = row.get("favicon_has_transparency")?;
        let favicon_fetch_failed: i64 = row.get("favicon_fetch_failed")?;
        let is_podcast: i64 = row.get("is_podcast")?;
        let reader_mode_enabled: i64 = row.get("reader_mode_enabled")?;

        Ok(Self {
            id: row.get("id")?,
            title: row.get("title")?,
            url: row.get("url")?,
            created_at: row.get("created_at")?,
            description: row.get("description")?,
            last_fetched: row.get("last_fetched")?,
            last_failed_fetch_at: row.get("last_failed_fetch_at")?,
            unread_count: row.get("unread_count")?,
            article_count: row.get("article_count")?,
            tags: parse_string_array(tags_json),
            favicon: row.get("favicon")?,
            favicon_has_transparency: favicon_has_transparency.map(i64_to_bool),
            favicon_dominant_color: row.get("favicon_dominant_color")?,
            favicon_bg_light: row.get("favicon_bg_light")?,
            favicon_bg_dark: row.get("favicon_bg_dark")?,
            favicon_fetch_failed: i64_to_bool(favicon_fetch_failed),
            emoji: row.get("emoji")?,
            image: row.get("image")?,
            categories: parse_string_array(categories_json),
            language: row.get("language")?,
            is_podcast: i64_to_bool(is_podcast),
            podcast_metadata: parse_json_value(podcast_metadata_json),
            reader_mode_enabled: i64_to_bool(reader_mode_enabled),
            etag: row.get("etag")?,
            last_modified_header: row.get("last_modified_header")?,
            sort_order: row.get("sort_order")?,
            update_frequency_score: row.get("update_frequency_score")?,
            consecutive_failures: row.get("consecutive_failures")?,
            last_favicon_refresh: row.get("last_favicon_refresh")?,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRecord {
    pub name: String,
    pub color: Option<String>,
    pub emoji: Option<String>,
    pub created_at: String,
    pub sort_order: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_ids: Option<Vec<String>>,
}

impl TagRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        Ok(Self {
            name: row.get("name")?,
            color: row.get("color")?,
            emoji: row.get("emoji")?,
            created_at: row.get("created_at")?,
            sort_order: row.get("sort_order")?,
            feed_ids: None,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleRecord {
    pub hash: String,
    pub feed_id: String,
    pub title: String,
    pub description: String,
    pub content: String,
    pub link: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub fetched_date: String,
    pub read: bool,
    pub starred: bool,
    pub saved: bool,
    pub saved_article_id: Option<String>,
    pub last_read_at: Option<String>,
    pub metadata: Option<JsonValue>,
    pub feed_url: Option<String>,
    pub feed_title: Option<String>,
    pub feed_favicon: Option<String>,
    pub feed_favicon_has_transparency: Option<bool>,
    pub feed_favicon_bg_light: Option<String>,
    pub feed_favicon_bg_dark: Option<String>,
    pub feed_image: Option<String>,
}

impl ArticleRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let read: i64 = row.get("read")?;
        let starred: i64 = row.get("starred")?;
        let saved: i64 = row.get("saved")?;
        let metadata_json: Option<String> = row.get("metadata_json")?;
        let feed_favicon_has_transparency: Option<i64> =
            row.get("feed_favicon_has_transparency")?;

        Ok(Self {
            hash: row.get("hash")?,
            feed_id: row.get("feed_id")?,
            title: row.get("title")?,
            description: row.get("description")?,
            content: row.get("content").unwrap_or_default(),
            link: row.get("link")?,
            author: row.get("author")?,
            published_date: row.get("published_date")?,
            fetched_date: row.get("fetched_date")?,
            read: i64_to_bool(read),
            starred: i64_to_bool(starred),
            saved: i64_to_bool(saved),
            saved_article_id: row.get("saved_article_id")?,
            last_read_at: row.get("last_read_at")?,
            metadata: parse_json_value(metadata_json),
            feed_url: row.get("feed_url")?,
            feed_title: row.get("feed_title")?,
            feed_favicon: row.get("feed_favicon")?,
            feed_favicon_has_transparency: feed_favicon_has_transparency.map(i64_to_bool),
            feed_favicon_bg_light: row.get("feed_favicon_bg_light")?,
            feed_favicon_bg_dark: row.get("feed_favicon_bg_dark")?,
            feed_image: row.get("feed_image")?,
        })
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticleRecord {
    pub id: String,
    pub article_hash: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub content: Option<String>,
    pub link: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub saved_date: String,
    pub last_read_at: Option<String>,
    pub feed_id: Option<String>,
    pub feed_url: Option<String>,
    pub feed_title: Option<String>,
    pub feed_favicon: Option<String>,
    pub feed_favicon_has_transparency: Option<bool>,
    pub feed_favicon_bg_light: Option<String>,
    pub feed_favicon_bg_dark: Option<String>,
    pub feed_image: Option<String>,
    pub preview_image: Option<String>,
    pub metadata: Option<JsonValue>,
    pub highlights: Vec<JsonValue>,
    pub notes: Option<String>,
}

impl SavedArticleRecord {
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let metadata_json: Option<String> = row.get("metadata_json")?;
        let highlights_json: Option<String> = row.get("highlights_json")?;
        let feed_favicon_has_transparency: Option<i64> =
            row.get("feed_favicon_has_transparency")?;

        Ok(Self {
            id: row.get("id")?,
            article_hash: row.get("article_hash")?,
            title: row.get("title")?,
            description: row.get("description")?,
            content: row.get("content").unwrap_or(None),
            link: row.get("link")?,
            author: row.get("author")?,
            published_date: row.get("published_date")?,
            saved_date: row.get("saved_date")?,
            last_read_at: row.get("last_read_at")?,
            feed_id: row.get("feed_id")?,
            feed_url: row.get("feed_url")?,
            feed_title: row.get("feed_title")?,
            feed_favicon: row.get("feed_favicon")?,
            feed_favicon_has_transparency: feed_favicon_has_transparency.map(i64_to_bool),
            feed_favicon_bg_light: row.get("feed_favicon_bg_light")?,
            feed_favicon_bg_dark: row.get("feed_favicon_bg_dark")?,
            feed_image: row.get("preview_image")?,
            preview_image: row.get("preview_image")?,
            metadata: parse_json_value(metadata_json),
            highlights: parse_json_array(highlights_json),
            notes: row.get("notes")?,
        })
    }
}
