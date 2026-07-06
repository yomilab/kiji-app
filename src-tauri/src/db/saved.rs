use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use super::{
    models::{bool_to_i64, to_json_string, to_optional_json_string, SavedArticleRecord},
    search::create_fts_prefix_query,
    DbState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticleQueryRequest {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search_text: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticleQueryResponse {
    pub articles: Vec<SavedArticleRecord>,
    pub total: i64,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_query(
    request: SavedArticleQueryRequest,
    state: State<'_, DbState>,
) -> Result<SavedArticleQueryResponse, String> {
    let db = state.inner().clone();
    db.read(move |connection| query_saved_articles(connection, request))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_create(
    article: SavedArticleRecord,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| insert_saved_article(connection, &article))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_insert_batch(
    articles: Vec<SavedArticleRecord>,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        let mut inserted = 0;
        for article in &articles {
            insert_saved_article(connection, article)?;
            inserted += 1;
        }
        Ok(inserted)
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_delete(id: String, state: State<'_, DbState>) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute("DELETE FROM saved_articles WHERE id = ?1", params![id])
            .map(|_| ())
            .map_err(|error| format!("Failed to delete saved article: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_get(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<SavedArticleRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_saved_article_by_id(connection, &id))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_get_by_article_hash(
    article_hash: String,
    state: State<'_, DbState>,
) -> Result<Option<SavedArticleRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_saved_article_by_hash(connection, &article_hash))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_get_by_link(
    link: String,
    state: State<'_, DbState>,
) -> Result<Option<SavedArticleRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_saved_article_by_link(connection, &link))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_list_all(state: State<'_, DbState>) -> Result<Vec<SavedArticleRecord>, String> {
    let db = state.inner().clone();
    db.read(|connection| list_saved_articles(connection)).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_get_content(
    id: String,
    state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let db = state.inner().clone();
    db.read(move |connection| {
        connection
            .query_row(
                "SELECT content FROM saved_articles WHERE id = ?1",
                params![id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| format!("Failed to read saved article content: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_update_highlights(
    id: String,
    highlights: Vec<serde_json::Value>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        let highlights_json = to_json_string(&highlights)?;
        connection
            .execute(
                "UPDATE saved_articles SET highlights_json = ?1 WHERE id = ?2",
                params![highlights_json, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update saved article highlights: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_update_notes(
    id: String,
    notes: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE saved_articles SET notes = ?1 WHERE id = ?2",
                params![notes, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update saved article notes: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_update_last_read_at(
    id: String,
    last_read_at: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE saved_articles SET last_read_at = ?1 WHERE id = ?2",
                params![last_read_at, id],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update saved article last-read timestamp: {error}"))
    })
    .await
}

pub fn query_saved_articles(
    connection: &Connection,
    request: SavedArticleQueryRequest,
) -> Result<SavedArticleQueryResponse, String> {
    let mut conditions = Vec::new();
    let mut bindings = Vec::new();
    let normalized_search_text = request
        .search_text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());

    if let Some(search_text) = normalized_search_text {
        let search_query = create_fts_prefix_query(search_text)
            .ok_or_else(|| "Search text did not contain searchable tokens.".to_string())?;
        conditions.push("saved_articles_search MATCH ?".to_string());
        bindings.push(Value::Text(search_query));
    }

    let from_sql = if normalized_search_text.is_some() {
        "saved_articles_search JOIN saved_articles sa ON sa.rowid = saved_articles_search.rowid"
    } else {
        "saved_articles sa"
    };
    let where_sql = if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    };

    let total = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM {from_sql} {where_sql}"),
            params_from_iter(bindings.iter()),
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Failed to count saved articles: {error}"))?;

    let mut data_bindings = bindings;
    let mut data_sql = format!(
        r#"
        SELECT
          sa.id,
          sa.article_hash,
          sa.title,
          sa.description,
          sa.content,
          sa.link,
          sa.author,
          sa.published_date,
          sa.saved_date,
          sa.last_read_at,
          sa.feed_id,
          sa.feed_url,
          sa.feed_title,
          sa.feed_favicon,
          sa.feed_favicon_has_transparency,
          sa.feed_favicon_bg_light,
          sa.feed_favicon_bg_dark,
          sa.preview_image,
          sa.metadata_json,
          sa.highlights_json,
          sa.notes
        FROM {from_sql}
        {where_sql}
        ORDER BY sa.saved_date DESC
        "#
    );
    if let Some(limit) = request.limit {
        data_sql.push_str(" LIMIT ?");
        data_bindings.push(Value::Integer(limit));
        if let Some(offset) = request.offset {
            data_sql.push_str(" OFFSET ?");
            data_bindings.push(Value::Integer(offset));
        }
    }

    let mut statement = connection
        .prepare(&data_sql)
        .map_err(|error| format!("Failed to prepare saved article query: {error}"))?;
    let rows = statement
        .query_map(
            params_from_iter(data_bindings.iter()),
            SavedArticleRecord::from_row,
        )
        .map_err(|error| format!("Failed to query saved articles: {error}"))?;
    let articles = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read saved article row: {error}"))?;

    Ok(SavedArticleQueryResponse { articles, total })
}

pub fn insert_saved_article(
    connection: &Connection,
    article: &SavedArticleRecord,
) -> Result<(), String> {
    let metadata_json = to_optional_json_string(&article.metadata)?;
    let highlights_json = to_json_string(&article.highlights)?;

    connection
        .execute(
            r#"
            INSERT INTO saved_articles (
              id, article_hash, title, description, content, link, author,
              published_date, saved_date, last_read_at, feed_id, feed_url,
              feed_title, feed_favicon, feed_favicon_has_transparency,
              feed_favicon_bg_light, feed_favicon_bg_dark, preview_image,
              metadata_json, highlights_json, notes
            ) VALUES (
              ?1, ?2, ?3, ?4, ?5, ?6, ?7,
              ?8, ?9, ?10, ?11, ?12,
              ?13, ?14, ?15,
              ?16, ?17, ?18,
              ?19, ?20, ?21
            )
            "#,
            params![
                article.id,
                article.article_hash,
                article.title,
                article.description,
                article.content,
                article.link,
                article.author,
                article.published_date,
                article.saved_date,
                article.last_read_at,
                article.feed_id,
                article.feed_url,
                article.feed_title,
                article.feed_favicon,
                article.feed_favicon_has_transparency.map(bool_to_i64),
                article.feed_favicon_bg_light,
                article.feed_favicon_bg_dark,
                article.preview_image,
                metadata_json,
                highlights_json,
                article.notes,
            ],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to insert saved article: {error}"))
}

pub fn get_saved_articles_page(
    connection: &Connection,
    limit: i64,
    offset: i64,
) -> Result<Vec<SavedArticleRecord>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              id, article_hash, title, description, content, link, author,
              published_date, saved_date, last_read_at, feed_id, feed_url,
              feed_title, feed_favicon, feed_favicon_has_transparency,
              feed_favicon_bg_light, feed_favicon_bg_dark, preview_image,
              metadata_json, highlights_json, notes
            FROM saved_articles
            ORDER BY saved_date DESC, id DESC
            LIMIT ?1 OFFSET ?2
            "#,
        )
        .map_err(|error| format!("Failed to prepare saved article page query: {error}"))?;
    let rows = statement
        .query_map(params![limit, offset], SavedArticleRecord::from_row)
        .map_err(|error| format!("Failed to query saved article page: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read saved article row: {error}"))
}

pub fn list_saved_articles(connection: &Connection) -> Result<Vec<SavedArticleRecord>, String> {
    let mut statement = connection
        .prepare(
            r#"
            SELECT
              id, article_hash, title, description, content, link, author,
              published_date, saved_date, last_read_at, feed_id, feed_url,
              feed_title, feed_favicon, feed_favicon_has_transparency,
              feed_favicon_bg_light, feed_favicon_bg_dark, preview_image,
              metadata_json, highlights_json, notes
            FROM saved_articles
            ORDER BY saved_date DESC
            "#,
        )
        .map_err(|error| format!("Failed to prepare saved article list query: {error}"))?;
    let rows = statement
        .query_map([], SavedArticleRecord::from_row)
        .map_err(|error| format!("Failed to query saved articles: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read saved article row: {error}"))
}

pub fn get_saved_article_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<SavedArticleRecord>, String> {
    get_saved_article_by_column(connection, "id", id)
}

pub fn get_saved_article_by_hash(
    connection: &Connection,
    article_hash: &str,
) -> Result<Option<SavedArticleRecord>, String> {
    get_saved_article_by_column(connection, "article_hash", article_hash)
}

pub fn get_saved_article_by_link(
    connection: &Connection,
    link: &str,
) -> Result<Option<SavedArticleRecord>, String> {
    get_saved_article_by_column(connection, "link", link)
}

fn get_saved_article_by_column(
    connection: &Connection,
    column: &str,
    value: &str,
) -> Result<Option<SavedArticleRecord>, String> {
    let sql = format!(
        r#"
        SELECT
          id, article_hash, title, description, content, link, author,
          published_date, saved_date, last_read_at, feed_id, feed_url,
          feed_title, feed_favicon, feed_favicon_has_transparency,
          feed_favicon_bg_light, feed_favicon_bg_dark, preview_image,
          metadata_json, highlights_json, notes
        FROM saved_articles
        WHERE {column} = ?1
        LIMIT 1
        "#
    );

    connection
        .query_row(&sql, params![value], SavedArticleRecord::from_row)
        .optional()
        .map_err(|error| format!("Failed to read saved article: {error}"))
}
