use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use super::{
    models::{bool_to_i64, to_optional_json_string, ArticleRecord},
    search::create_fts_prefix_query,
    DbState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleQueryRequest {
    pub feed_id: Option<String>,
    pub feed_ids: Option<Vec<String>>,
    pub tag_name: Option<String>,
    pub unread_only: Option<bool>,
    pub saved_only: Option<bool>,
    pub read: Option<bool>,
    pub starred: Option<bool>,
    pub saved: Option<bool>,
    pub sort_field: Option<String>,
    pub sort_order: Option<String>,
    pub search_text: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub cursor_date: Option<String>,
    pub cursor_hash: Option<String>,
    pub include_total: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleQueryResponse {
    pub articles: Vec<ArticleRecord>,
    pub total: i64,
    pub has_more: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleFeedMetaUpdate {
    pub feed_url: Option<Option<String>>,
    pub feed_title: Option<Option<String>>,
    pub feed_favicon: Option<Option<String>>,
    pub feed_favicon_has_transparency: Option<Option<bool>>,
    pub feed_favicon_bg_light: Option<Option<String>>,
    pub feed_favicon_bg_dark: Option<Option<String>>,
    pub feed_image: Option<Option<String>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_query(
    request: ArticleQueryRequest,
    state: State<'_, DbState>,
) -> Result<ArticleQueryResponse, String> {
    let db = state.inner().clone();
    db.read(move |connection| query_articles(connection, request))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_get(
    hash: String,
    state: State<'_, DbState>,
) -> Result<Option<ArticleRecord>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_article(connection, &hash))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_get_content(
    hash: String,
    state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let db = state.inner().clone();
    db.read(move |connection| get_article_content(connection, &hash))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_exists(hash: String, state: State<'_, DbState>) -> Result<bool, String> {
    let db = state.inner().clone();
    db.read(move |connection| {
        connection
            .query_row(
                "SELECT 1 FROM articles WHERE hash = ?1 LIMIT 1",
                params![hash],
                |_| Ok(()),
            )
            .optional()
            .map(|row| row.is_some())
            .map_err(|error| format!("Failed to check article existence: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_insert_batch(
    articles: Vec<ArticleRecord>,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.write(move |connection| insert_articles_batch(connection, &articles))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_update_read(
    hash: String,
    read: bool,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE articles SET read = ?1 WHERE hash = ?2",
                params![bool_to_i64(read), hash],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update article read status: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_update_last_read_at(
    hash: String,
    last_read_at: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE articles SET last_read_at = ?1 WHERE hash = ?2",
                params![last_read_at, hash],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update article last-read timestamp: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_toggle_starred(
    hash: String,
    state: State<'_, DbState>,
) -> Result<bool, String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .query_row(
                "UPDATE articles SET starred = CASE WHEN starred = 0 THEN 1 ELSE 0 END WHERE hash = ?1 RETURNING starred",
                params![hash],
                |row| row.get::<_, i64>(0),
            )
            .map(|starred| starred == 1)
            .map_err(|error| format!("Failed to toggle article starred state: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_update_saved_state(
    hash: String,
    saved: bool,
    saved_article_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| {
        connection
            .execute(
                "UPDATE articles SET saved = ?1, saved_article_id = ?2 WHERE hash = ?3",
                params![bool_to_i64(saved), saved_article_id, hash],
            )
            .map(|_| ())
            .map_err(|error| format!("Failed to update article saved state: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_delete_by_feed(
    feed_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db = state.inner().clone();
    db.write(move |connection| delete_articles_by_feed(connection, &feed_id))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_clean_old_by_feed(
    feed_id: String,
    cutoff_date: String,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.write(move |connection| clean_old_articles(connection, Some(&feed_id), &cutoff_date))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_clean_old_across_feeds(
    cutoff_date: String,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    let removed = db
        .write(move |connection| clean_old_articles(connection, None, &cutoff_date))
        .await?;

    if removed > 0 {
        // Deleting rows only marks pages free; VACUUM is required to shrink
        // the file. Run it in the background so the cleanup result returns
        // immediately; writes queue behind the writer lock until it finishes.
        let db = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = db.with_writer(|connection| {
                connection
                    .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                    .map_err(|error| format!("Failed to vacuum database after cleanup: {error}"))
            });
            if let Err(error) = result {
                eprintln!("[KiJi] {error}");
            }
        });
    }

    Ok(removed)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_count_unread_by_feed(
    feed_id: String,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.read(move |connection| {
        connection
            .query_row(
                "SELECT COUNT(*) FROM articles WHERE feed_id = ?1 AND read = 0",
                params![feed_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Failed to count unread articles: {error}"))
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_count_by_feed(
    feed_id: String,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.read(move |connection| {
        connection
            .query_row(
                "SELECT COUNT(*) FROM articles WHERE feed_id = ?1",
                params![feed_id],
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Failed to count feed articles: {error}"))
    })
    .await
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedArticleCounts {
    pub feed_id: String,
    pub unread_count: i64,
    pub article_count: i64,
}

pub fn sync_feed_article_counts_batch(
    connection: &Connection,
    feed_ids: &[String],
) -> Result<Vec<FeedArticleCounts>, String> {
    if feed_ids.is_empty() {
        return Ok(vec![]);
    }

    let mut counts_by_feed: HashMap<String, (i64, i64)> = HashMap::new();
    for feed_id in feed_ids {
        counts_by_feed.insert(feed_id.clone(), (0, 0));
    }

    let placeholders = feed_ids
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT feed_id, COUNT(*) AS article_count, \
         SUM(CASE WHEN read = 0 THEN 1 ELSE 0 END) AS unread_count \
         FROM articles WHERE feed_id IN ({placeholders}) GROUP BY feed_id"
    );

    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| format!("Failed to prepare batch feed count query: {error}"))?;
    let query_params: Vec<Value> = feed_ids
        .iter()
        .map(|feed_id| Value::Text(feed_id.clone()))
        .collect();
    let rows = statement
        .query_map(params_from_iter(query_params.iter()), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, i64>(2)?,
            ))
        })
        .map_err(|error| format!("Failed to query batch feed counts: {error}"))?;

    for row in rows {
        let (feed_id, article_count, unread_count) = row
            .map_err(|error| format!("Failed to read batch feed count row: {error}"))?;
        counts_by_feed.insert(feed_id, (article_count, unread_count));
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start feed count sync transaction: {error}"))?;

    let mut synced = Vec::with_capacity(feed_ids.len());
    for feed_id in feed_ids {
        let (article_count, unread_count) = counts_by_feed
            .get(feed_id)
            .copied()
            .unwrap_or((0, 0));
        transaction
            .execute(
                "UPDATE feeds SET unread_count = ?1, article_count = ?2 WHERE id = ?3",
                params![unread_count, article_count, feed_id],
            )
            .map_err(|error| format!("Failed to update feed counts for {feed_id}: {error}"))?;
        synced.push(FeedArticleCounts {
            feed_id: feed_id.clone(),
            unread_count,
            article_count,
        });
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit feed count sync transaction: {error}"))?;

    Ok(synced)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_sync_feed_counts_batch(
    feed_ids: Vec<String>,
    state: State<'_, DbState>,
) -> Result<Vec<FeedArticleCounts>, String> {
    let db = state.inner().clone();
    db.write(move |connection| sync_feed_article_counts_batch(connection, &feed_ids))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_update_feed_meta(
    feed_id: String,
    meta: ArticleFeedMetaUpdate,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db = state.inner().clone();
    db.write(move |connection| update_article_feed_meta(connection, &feed_id, meta))
        .await
}

pub fn query_articles(
    connection: &Connection,
    request: ArticleQueryRequest,
) -> Result<ArticleQueryResponse, String> {
    let mut conditions: Vec<String> = Vec::new();
    let mut bindings: Vec<Value> = Vec::new();
    let feed_ids = request
        .feed_ids
        .clone()
        .or_else(|| request.feed_id.clone().map(|feed_id| vec![feed_id]))
        .unwrap_or_default();
    let has_source_filter = !feed_ids.is_empty() || request.tag_name.is_some();
    let single_feed_only = feed_ids.len() == 1 && request.tag_name.is_none();

    if !feed_ids.is_empty() {
        let placeholders = repeat_placeholders(feed_ids.len());
        conditions.push(format!("afi.feed_id IN ({placeholders})"));
        bindings.extend(feed_ids.into_iter().map(Value::Text));
    }

    if let Some(tag_name) = request.tag_name {
        conditions
            .push("afi.feed_id IN (SELECT feed_id FROM feed_tags WHERE tag_name = ?)".to_string());
        bindings.push(Value::Text(tag_name));
    }

    let read_filter = request
        .read
        .or_else(|| request.unread_only.map(|unread| !unread));
    if let Some(read) = read_filter {
        conditions.push("a.read = ?".to_string());
        bindings.push(Value::Integer(bool_to_i64(read)));
    }

    if let Some(starred) = request.starred {
        conditions.push("a.starred = ?".to_string());
        bindings.push(Value::Integer(bool_to_i64(starred)));
    }

    let saved_filter = request.saved.or(request.saved_only);
    if let Some(saved) = saved_filter {
        conditions.push("a.saved = ?".to_string());
        bindings.push(Value::Integer(bool_to_i64(saved)));
    }

    let normalized_search_text = request
        .search_text
        .as_deref()
        .map(str::trim)
        .filter(|text| !text.is_empty());
    if let Some(search_text) = normalized_search_text {
        let search_query = create_fts_prefix_query(search_text)
            .ok_or_else(|| "Search text did not contain searchable tokens.".to_string())?;
        conditions.push("articles_search MATCH ?".to_string());
        bindings.push(Value::Text(search_query));
    }

    let sort_order = if request.sort_order.as_deref() == Some("asc") {
        "ASC"
    } else {
        "DESC"
    };
    let sort_expr = if request.sort_field.as_deref() == Some("fetched_date") {
        if has_source_filter {
            "afi.fetched_date"
        } else {
            "a.fetched_date"
        }
    } else if has_source_filter {
        "COALESCE(afi.published_date, afi.fetched_date)"
    } else {
        "COALESCE(a.published_date, a.fetched_date)"
    };
    let sort_hash_expr = if has_source_filter {
        "afi.article_hash"
    } else {
        "a.hash"
    };

    let count_conditions = conditions.clone();
    let count_bindings = bindings.clone();

    // Multi-feed/tag lists without article-level filters can dedupe and sort on
    // the covering `idx_article_feed_items_feed_date` index alone, then join
    // article/feed metadata for the final page only. The legacy shape joined
    // `articles` + `feeds` for every station row before GROUP BY/ORDER BY —
    // 0.3–0.9s per switch on a multi-GB library (H17: cold-switch skeleton
    // stuck while the deferred page query sorted ~65k joined rows).
    let grouped_source_fast_path = has_source_filter
        && !single_feed_only
        && normalized_search_text.is_none()
        && read_filter.is_none()
        && request.starred.is_none()
        && saved_filter.is_none();

    let mut having_conditions: Vec<String> = Vec::new();
    if let (Some(cursor_date), Some(cursor_hash)) = (request.cursor_date, request.cursor_hash) {
        let cursor_operator = if sort_order == "ASC" { ">" } else { "<" };
        if grouped_source_fast_path {
            // The aggregated sort date only exists after GROUP BY, so cursor
            // paging filters in HAVING on the aggregate alias.
            having_conditions.push(format!(
                "(sort_date {cursor_operator} ? OR (sort_date = ? AND article_hash > ?))"
            ));
        } else {
            conditions.push(format!(
                "({sort_expr} {cursor_operator} ? OR ({sort_expr} = ? AND {sort_hash_expr} > ?))"
            ));
        }
        bindings.push(Value::Text(cursor_date.clone()));
        bindings.push(Value::Text(cursor_date));
        bindings.push(Value::Text(cursor_hash));
    }

    let article_source_sql = if has_source_filter {
        "article_feed_items afi JOIN articles a ON a.hash = afi.article_hash"
    } else {
        "articles a"
    };
    let from_sql = if normalized_search_text.is_some() {
        format!("{article_source_sql} JOIN articles_search ON articles_search.rowid = a.rowid")
    } else {
        article_source_sql.to_string()
    };
    let count_from_sql = if has_source_filter
        && normalized_search_text.is_none()
        && read_filter.is_none()
        && request.starred.is_none()
        && saved_filter.is_none()
    {
        "article_feed_items afi".to_string()
    } else {
        from_sql.clone()
    };
    let count_distinct_expr = if has_source_filter
        && normalized_search_text.is_none()
        && read_filter.is_none()
        && request.starred.is_none()
        && saved_filter.is_none()
    {
        "afi.article_hash"
    } else {
        "a.hash"
    };
    let count_expr = if has_source_filter {
        format!("COUNT(DISTINCT {count_distinct_expr})")
    } else {
        "COUNT(*)".to_string()
    };

    let count_where = where_clause(&count_conditions);
    let total = if request.include_total != Some(false) {
        let count_sql = format!("SELECT {count_expr} FROM {count_from_sql} {count_where}");
        connection
            .query_row(&count_sql, params_from_iter(count_bindings.iter()), |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|error| format!("Failed to count articles: {error}"))?
    } else {
        0
    };

    let data_where = where_clause(&conditions);
    // Single-feed lists resolve metadata from the active subscription (afi), not the
    // canonical articles.feed_id owner when URLs overlap across feeds.
    let display_feed_id_sql = if single_feed_only {
        "afi.feed_id"
    } else {
        "a.feed_id"
    };

    let mut data_sql = if grouped_source_fast_path {
        // Page keys from the covering feed-date index, then join metadata for
        // the LIMIT rows only. Avoids sorting tens of thousands of joined
        // article+feed rows on every cold station switch (H17).
        let page_sort_expr = if request.sort_field.as_deref() == Some("fetched_date") {
            "afi.fetched_date"
        } else {
            "COALESCE(afi.published_date, afi.fetched_date)"
        };
        let having_sql = if having_conditions.is_empty() {
            String::new()
        } else {
            format!(" HAVING {}", having_conditions.join(" AND "))
        };
        format!(
            r#"
            SELECT
              a.hash,
              a.feed_id AS feed_id,
              a.title,
              a.description,
              '' AS content,
              a.link,
              a.author,
              a.published_date,
              a.fetched_date,
              a.read,
              a.starred,
              a.saved,
              a.saved_article_id,
              a.last_read_at,
              a.metadata_json,
              COALESCE(f.url, a.feed_url) AS feed_url,
              COALESCE(f.title, a.feed_title) AS feed_title,
              COALESCE(f.favicon, a.feed_favicon) AS feed_favicon,
              COALESCE(f.favicon_has_transparency, a.feed_favicon_has_transparency) AS feed_favicon_has_transparency,
              COALESCE(f.favicon_bg_light, a.feed_favicon_bg_light) AS feed_favicon_bg_light,
              COALESCE(f.favicon_bg_dark, a.feed_favicon_bg_dark) AS feed_favicon_bg_dark,
              COALESCE(f.image, a.feed_image) AS feed_image
            FROM (
              SELECT
                afi.article_hash AS article_hash,
                MAX({page_sort_expr}) AS sort_date
              FROM article_feed_items afi
              {data_where}
              GROUP BY afi.article_hash
              {having_sql}
              ORDER BY sort_date {sort_order}, article_hash ASC
            "#
        )
    } else {
        let group_by = if has_source_filter && !single_feed_only {
            " GROUP BY a.hash"
        } else {
            ""
        };
        format!(
            r#"
            SELECT
              a.hash,
              {display_feed_id_sql} AS feed_id,
              a.title,
              a.description,
              '' AS content,
              a.link,
              a.author,
              a.published_date,
              a.fetched_date,
              a.read,
              a.starred,
              a.saved,
              a.saved_article_id,
              a.last_read_at,
              a.metadata_json,
              COALESCE(f.url, a.feed_url) AS feed_url,
              COALESCE(f.title, a.feed_title) AS feed_title,
              COALESCE(f.favicon, a.feed_favicon) AS feed_favicon,
              COALESCE(f.favicon_has_transparency, a.feed_favicon_has_transparency) AS feed_favicon_has_transparency,
              COALESCE(f.favicon_bg_light, a.feed_favicon_bg_light) AS feed_favicon_bg_light,
              COALESCE(f.favicon_bg_dark, a.feed_favicon_bg_dark) AS feed_favicon_bg_dark,
              COALESCE(f.image, a.feed_image) AS feed_image
            FROM {from_sql}
            LEFT JOIN feeds f ON f.id = {display_feed_id_sql}
            {data_where}{group_by}
            ORDER BY {sort_expr} {sort_order}, {sort_hash_expr} ASC
            "#
        )
    };

    if let Some(limit) = request.limit {
        data_sql.push_str(" LIMIT ?");
        bindings.push(Value::Integer(limit));
        if let Some(offset) = request.offset {
            data_sql.push_str(" OFFSET ?");
            bindings.push(Value::Integer(offset));
        }
    }

    if grouped_source_fast_path {
        // Close the page subquery, then join metadata for the limited rows.
        data_sql.push_str(
            r#"
            ) page
            JOIN articles a ON a.hash = page.article_hash
            LEFT JOIN feeds f ON f.id = a.feed_id
            ORDER BY page.sort_date "#,
        );
        data_sql.push_str(sort_order);
        data_sql.push_str(", page.article_hash ASC");
    }

    let mut statement = connection
        .prepare(&data_sql)
        .map_err(|error| format!("Failed to prepare article query: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(bindings.iter()), ArticleRecord::from_row)
        .map_err(|error| format!("Failed to query articles: {error}"))?;
    let articles = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read article row: {error}"))?;
    let has_more = request
        .limit
        .map(|limit| {
            articles.len() >= limit as usize && total > (request.offset.unwrap_or(0) + limit)
        })
        .unwrap_or(false);

    Ok(ArticleQueryResponse {
        articles,
        total,
        has_more,
    })
}

pub fn get_article(connection: &Connection, hash: &str) -> Result<Option<ArticleRecord>, String> {
    connection
        .query_row(
            r#"
            SELECT
              a.hash,
              a.feed_id,
              a.title,
              a.description,
              a.content,
              a.link,
              a.author,
              a.published_date,
              a.fetched_date,
              a.read,
              a.starred,
              a.saved,
              a.saved_article_id,
              a.last_read_at,
              a.metadata_json,
              COALESCE(f.url, a.feed_url) AS feed_url,
              COALESCE(f.title, a.feed_title) AS feed_title,
              COALESCE(f.favicon, a.feed_favicon) AS feed_favicon,
              COALESCE(f.favicon_has_transparency, a.feed_favicon_has_transparency) AS feed_favicon_has_transparency,
              COALESCE(f.favicon_bg_light, a.feed_favicon_bg_light) AS feed_favicon_bg_light,
              COALESCE(f.favicon_bg_dark, a.feed_favicon_bg_dark) AS feed_favicon_bg_dark,
              COALESCE(f.image, a.feed_image) AS feed_image
            FROM articles a
            LEFT JOIN feeds f ON f.id = a.feed_id
            WHERE a.hash = ?1
            "#,
            params![hash],
            ArticleRecord::from_row,
        )
        .optional()
        .map_err(|error| format!("Failed to read article: {error}"))
}

pub fn get_article_content(connection: &Connection, hash: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT content FROM articles WHERE hash = ?1",
            params![hash],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read article content: {error}"))
}

pub fn insert_articles_batch(
    connection: &Connection,
    articles: &[ArticleRecord],
) -> Result<i64, String> {
    let article_sql = r#"
        INSERT OR IGNORE INTO articles (
          hash, feed_id, title, description, content, link, author,
          published_date, fetched_date, read, starred, saved, saved_article_id,
          last_read_at, metadata_json, feed_url, feed_title, feed_favicon,
          feed_favicon_has_transparency, feed_favicon_bg_light, feed_favicon_bg_dark, feed_image
        ) VALUES (
          ?1, ?2, ?3, ?4, ?5, ?6, ?7,
          ?8, ?9, ?10, ?11, ?12, ?13,
          ?14, ?15, ?16, ?17, ?18,
          ?19, ?20, ?21, ?22
        )
    "#;
    let feed_item_sql = r#"
        INSERT OR IGNORE INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
        SELECT ?1, ?2, published_date, fetched_date
        FROM articles
        WHERE hash = ?2
    "#;

    let mut inserted = 0;
    for article in articles {
        let metadata_json = to_optional_json_string(&article.metadata)?;
        let article_changes = connection
            .execute(
                article_sql,
                params![
                    article.hash,
                    article.feed_id,
                    article.title,
                    article.description,
                    article.content,
                    article.link,
                    article.author,
                    article.published_date,
                    article.fetched_date,
                    bool_to_i64(article.read),
                    bool_to_i64(article.starred),
                    bool_to_i64(article.saved),
                    article.saved_article_id,
                    article.last_read_at,
                    metadata_json,
                    article.feed_url,
                    article.feed_title,
                    article.feed_favicon,
                    article.feed_favicon_has_transparency.map(bool_to_i64),
                    article.feed_favicon_bg_light,
                    article.feed_favicon_bg_dark,
                    article.feed_image,
                ],
            )
            .map_err(|error| format!("Failed to insert article: {error}"))?;

        let is_feed_article = article.feed_id != "clipboard" && article.feed_id != "saved";
        let mapping_changes = if is_feed_article {
            connection
                .execute(feed_item_sql, params![article.feed_id, article.hash])
                .map_err(|error| format!("Failed to insert article/feed mapping: {error}"))?
        } else {
            0
        };

        if mapping_changes > 0 || (!is_feed_article && article_changes > 0) {
            inserted += 1;
        }
    }

    Ok(inserted)
}

pub fn delete_articles_by_feed(
    connection: &Connection,
    feed_id: &str,
) -> Result<Vec<String>, String> {
    delete_articles_by_feeds(connection, &[feed_id.to_string()])
}

pub fn delete_articles_by_feeds(
    connection: &Connection,
    feed_ids: &[String],
) -> Result<Vec<String>, String> {
    if feed_ids.is_empty() {
        return Ok(Vec::new());
    }

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start feed article delete transaction: {error}"))?;

    reassign_article_owners(&transaction, feed_ids)?;
    delete_article_feed_mappings(&transaction, feed_ids)?;
    let deleted_hashes = collect_orphan_unsaved_hashes(&transaction)?;
    delete_orphan_unsaved_articles(&transaction)?;

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit feed article delete transaction: {error}"))?;

    Ok(deleted_hashes)
}

fn numbered_feed_id_in_list(feed_ids: &[String]) -> String {
    (1..=feed_ids.len())
        .map(|index| format!("?{index}"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Reassigns canonical article owners away from deleted feeds to any remaining
/// mapped feed in a single set-based pass (one scan for the whole batch).
pub(crate) fn reassign_article_owners(
    connection: &Connection,
    feed_ids: &[String],
) -> Result<(), String> {
    if feed_ids.is_empty() {
        return Ok(());
    }

    let in_list = numbered_feed_id_in_list(feed_ids);
    let sql = format!(
        r#"
        UPDATE articles
        SET feed_id = (
          SELECT MIN(afi.feed_id)
          FROM article_feed_items afi
          WHERE afi.article_hash = articles.hash
            AND afi.feed_id NOT IN ({in_list})
        )
        WHERE feed_id IN ({in_list})
          AND EXISTS (
            SELECT 1
            FROM article_feed_items afi
            WHERE afi.article_hash = articles.hash
              AND afi.feed_id NOT IN ({in_list})
          )
        "#
    );
    connection
        .execute(&sql, params_from_iter(feed_ids.iter()))
        .map(|_| ())
        .map_err(|error| format!("Failed to reassign article owner feeds: {error}"))
}

pub(crate) fn delete_article_feed_mappings(
    connection: &Connection,
    feed_ids: &[String],
) -> Result<(), String> {
    if feed_ids.is_empty() {
        return Ok(());
    }

    let in_list = numbered_feed_id_in_list(feed_ids);
    let sql = format!("DELETE FROM article_feed_items WHERE feed_id IN ({in_list})");
    connection
        .execute(&sql, params_from_iter(feed_ids.iter()))
        .map(|_| ())
        .map_err(|error| format!("Failed to delete article/feed mappings: {error}"))
}

/// Library-wide orphan GC: only unsaved rows are collected here; rows still
/// owned by a deleted feed are removed by the `articles.feed_id` cascade when
/// the feed row is deleted (saved content persists in `saved_articles`).
/// Runs once per delete batch, not once per feed.
pub(crate) fn collect_orphan_unsaved_hashes(
    connection: &Connection,
) -> Result<Vec<String>, String> {
    let mut orphan_statement = connection
        .prepare(
            r#"
            SELECT hash
            FROM articles
            WHERE saved = 0
              AND NOT EXISTS (
                SELECT 1 FROM article_feed_items afi WHERE afi.article_hash = articles.hash
              )
            "#,
        )
        .map_err(|error| format!("Failed to prepare orphan article query: {error}"))?;
    let rows = orphan_statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to query orphan articles: {error}"))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read orphan article: {error}"))
}

pub(crate) fn delete_orphan_unsaved_articles(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            DELETE FROM articles
            WHERE saved = 0
              AND NOT EXISTS (
                SELECT 1 FROM article_feed_items afi WHERE afi.article_hash = articles.hash
              )
            "#,
            [],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to delete orphan articles: {error}"))
}

pub fn clean_old_articles(
    connection: &Connection,
    feed_id: Option<&str>,
    cutoff_date: &str,
) -> Result<i64, String> {
    let removed = if let Some(feed_id) = feed_id {
        connection
            .execute(
                r#"
                DELETE FROM article_feed_items
                WHERE feed_id = ?1
                  AND article_hash IN (
                    SELECT hash
                    FROM articles
                    WHERE saved = 0
                      AND starred = 0
                      AND COALESCE(published_date, fetched_date) < ?2
                  )
                "#,
                params![feed_id, cutoff_date],
            )
            .map_err(|error| format!("Failed to clean old feed article mappings: {error}"))?
    } else {
        connection
            .execute(
                r#"
                DELETE FROM article_feed_items
                WHERE article_hash IN (
                  SELECT hash
                  FROM articles
                  WHERE saved = 0
                    AND starred = 0
                    AND COALESCE(published_date, fetched_date) < ?1
                )
                "#,
                params![cutoff_date],
            )
            .map_err(|error| format!("Failed to clean old article mappings: {error}"))?
    };

    connection
        .execute(
            r#"
            DELETE FROM articles
            WHERE saved = 0
              AND starred = 0
              AND NOT EXISTS (
                SELECT 1 FROM article_feed_items afi WHERE afi.article_hash = articles.hash
              )
            "#,
            [],
        )
        .map_err(|error| format!("Failed to delete cleaned orphan articles: {error}"))?;

    Ok(removed as i64)
}

pub fn update_article_feed_meta(
    connection: &Connection,
    feed_id: &str,
    meta: ArticleFeedMetaUpdate,
) -> Result<(), String> {
    if let Some(value) = meta.feed_url {
        connection
            .execute(
                "UPDATE articles SET feed_url = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| format!("Failed to update article feed URL metadata: {error}"))?;
    }
    if let Some(value) = meta.feed_title {
        connection
            .execute(
                "UPDATE articles SET feed_title = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| format!("Failed to update article feed title metadata: {error}"))?;
    }
    if let Some(value) = meta.feed_favicon {
        connection
            .execute(
                "UPDATE articles SET feed_favicon = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| format!("Failed to update article feed favicon metadata: {error}"))?;
    }
    if let Some(value) = meta.feed_favicon_has_transparency {
        connection
            .execute(
                "UPDATE articles SET feed_favicon_has_transparency = ?1 WHERE feed_id = ?2",
                params![value.map(bool_to_i64), feed_id],
            )
            .map_err(|error| {
                format!("Failed to update article feed favicon transparency metadata: {error}")
            })?;
    }
    if let Some(value) = meta.feed_favicon_bg_light {
        connection
            .execute(
                "UPDATE articles SET feed_favicon_bg_light = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| {
                format!("Failed to update article feed favicon light background metadata: {error}")
            })?;
    }
    if let Some(value) = meta.feed_favicon_bg_dark {
        connection
            .execute(
                "UPDATE articles SET feed_favicon_bg_dark = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| {
                format!("Failed to update article feed favicon dark background metadata: {error}")
            })?;
    }
    if let Some(value) = meta.feed_image {
        connection
            .execute(
                "UPDATE articles SET feed_image = ?1 WHERE feed_id = ?2",
                params![value, feed_id],
            )
            .map_err(|error| format!("Failed to update article feed image metadata: {error}"))?;
    }

    Ok(())
}

fn repeat_placeholders(count: usize) -> String {
    std::iter::repeat("?")
        .take(count)
        .collect::<Vec<_>>()
        .join(", ")
}

fn where_clause(conditions: &[String]) -> String {
    if conditions.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", conditions.join(" AND "))
    }
}
