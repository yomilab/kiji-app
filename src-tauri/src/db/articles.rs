use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use super::{
    models::{bool_to_i64, to_optional_json_string, ArticleRecord},
    search::create_fts_prefix_query,
    with_savepoint, DbState,
};

#[derive(Debug, Default, Deserialize)]
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
    pub search_epoch: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub cursor_date: Option<String>,
    pub cursor_hash: Option<String>,
    pub include_total: Option<bool>,
    /// Today view: effective date within the last 24 hours, measured when the query runs.
    pub today: Option<bool>,
}

/// Rolling window for the Today view (NetNewsWire-style "last 24 hours", not calendar day).
const TODAY_WINDOW_HOURS: i64 = 24;

/// Inclusive lower bound for the Today view, in the stored `…Z` millisecond format so the
/// comparison against `COALESCE(published_date, fetched_date)` is a plain index range.
fn today_cutoff(now: chrono::DateTime<chrono::Utc>) -> String {
    (now - chrono::Duration::hours(TODAY_WINDOW_HOURS))
        .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleQueryResponse {
    pub articles: Vec<ArticleRecord>,
    pub total: i64,
    pub has_more: bool,
    pub cancelled: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArticleFeedMetaUpdate {
    pub feed_url: Option<Option<String>>,
    pub feed_title: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::feeds::deserialize_double_option")]
    pub feed_favicon: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::feeds::deserialize_double_option")]
    pub feed_favicon_has_transparency: Option<Option<bool>>,
    #[serde(default, deserialize_with = "super::feeds::deserialize_double_option")]
    pub feed_favicon_bg_light: Option<Option<String>>,
    #[serde(default, deserialize_with = "super::feeds::deserialize_double_option")]
    pub feed_favicon_bg_dark: Option<Option<String>>,
    pub feed_image: Option<Option<String>>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_query(
    request: ArticleQueryRequest,
    state: State<'_, DbState>,
) -> Result<ArticleQueryResponse, String> {
    let db = state.inner().clone();
    let is_search = request
        .search_text
        .as_deref()
        .is_some_and(|text| !text.trim().is_empty());
    if !is_search {
        return db.read(move |connection| query_articles(connection, request)).await;
    }
    let search_epoch = match request.search_epoch.as_deref() {
        Some(value) => value
            .parse::<u64>()
            .map_err(|_| "Invalid article search epoch.".to_string())?,
        None => db.begin_search(),
    };

    match db
        .search_read(search_epoch, move |connection| query_articles(connection, request))
        .await?
    {
        Some(response) => Ok(response),
        None => Ok(ArticleQueryResponse {
            articles: Vec::new(),
            total: 0,
            has_more: false,
            cancelled: true,
        }),
    }
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
    db.write(move |connection| update_article_read(connection, &hash, read).map(|_| ()))
        .await
}

/// Sets `articles.read`; returns rows changed. Shared by the command and
/// assistant writes so there is one writer for the field.
pub(crate) fn update_article_read(connection: &Connection, hash: &str, read: bool) -> Result<usize, String> {
    connection
        .execute(
            "UPDATE articles SET read = ?1 WHERE hash = ?2",
            params![bool_to_i64(read), hash],
        )
        .map_err(|error| format!("Failed to update article read status: {error}"))
}

/// Sets `articles.starred` to an explicit value (the toggle command flips it).
pub(crate) fn set_article_starred(connection: &Connection, hash: &str, starred: bool) -> Result<usize, String> {
    connection
        .execute(
            "UPDATE articles SET starred = ?1 WHERE hash = ?2",
            params![bool_to_i64(starred), hash],
        )
        .map_err(|error| format!("Failed to update article starred state: {error}"))
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
        update_article_saved_state(connection, &hash, saved, saved_article_id.as_deref()).map(|_| ())
    })
    .await
}

pub(crate) fn update_article_saved_state(
    connection: &Connection,
    hash: &str,
    saved: bool,
    saved_article_id: Option<&str>,
) -> Result<usize, String> {
    connection
        .execute(
            "UPDATE articles SET saved = ?1, saved_article_id = ?2 WHERE hash = ?3",
            params![bool_to_i64(saved), saved_article_id, hash],
        )
        .map_err(|error| format!("Failed to update article saved state: {error}"))
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
pub async fn articles_delete_by_feeds(
    feed_ids: Vec<String>,
    state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db = state.inner().clone();
    let deleted = db
        .write(move |connection| delete_articles_by_feeds(connection, &feed_ids))
        .await?;

    if !deleted.is_empty() {
        // Same rationale as articles_clean_old_across_feeds: deleting rows only
        // marks pages free; VACUUM is required to shrink the file. Run it in
        // the background so the clear result returns immediately; writes queue
        // behind the writer lock until it finishes.
        let db = state.inner().clone();
        tauri::async_runtime::spawn_blocking(move || {
            let result = db.with_writer(|connection| {
                connection
                    .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); VACUUM;")
                    .map_err(|error| format!("Failed to vacuum database after clearing articles: {error}"))
            });
            if let Err(error) = result {
                eprintln!("[KiJi] {error}");
            }
        });
    }

    Ok(deleted)
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
    db.read(move |connection| count_feed_articles(connection, &feed_id).map(|(_, unread)| unread))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn articles_count_by_feed(
    feed_id: String,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db = state.inner().clone();
    db.read(move |connection| count_feed_articles(connection, &feed_id).map(|(total, _)| total))
        .await
}

/// Per-subscription `(article_count, unread_count)`. Counts go through
/// `article_feed_items` (the same membership the article list reads) rather
/// than the canonical `articles.feed_id` owner, so a story shared by two
/// subscriptions counts for both. Plan: SEARCH afi USING COVERING INDEX
/// idx_article_feed_items_feed_date (feed_id=?) + SEARCH a USING INDEX
/// sqlite_autoindex_articles_1 (hash=?) — no scan, no sort.
pub fn count_feed_articles(connection: &Connection, feed_id: &str) -> Result<(i64, i64), String> {
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN a.read = 0 THEN 1 ELSE 0 END), 0) \
             FROM article_feed_items afi JOIN articles a ON a.hash = afi.article_hash \
             WHERE afi.feed_id = ?1",
            params![feed_id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .map_err(|error| format!("Failed to count feed articles: {error}"))
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

    // A savepoint (not BEGIN) so this composes inside the per-feed store
    // transaction and still commits on its own when called standalone.
    with_savepoint(connection, "sync_feed_counts", |connection| {
        let mut counts_by_feed: HashMap<String, (i64, i64)> = HashMap::new();
        for feed_id in feed_ids {
            counts_by_feed.insert(feed_id.clone(), (0, 0));
        }

        let placeholders = feed_ids
            .iter()
            .map(|_| "?")
            .collect::<Vec<_>>()
            .join(",");
        // Per-subscription membership (see `count_feed_articles`).
        let sql = format!(
            "SELECT afi.feed_id, COUNT(*) AS article_count, \
             SUM(CASE WHEN a.read = 0 THEN 1 ELSE 0 END) AS unread_count \
             FROM article_feed_items afi JOIN articles a ON a.hash = afi.article_hash \
             WHERE afi.feed_id IN ({placeholders}) GROUP BY afi.feed_id"
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

        let mut synced = Vec::with_capacity(feed_ids.len());
        for feed_id in feed_ids {
            let (article_count, unread_count) = counts_by_feed
                .get(feed_id)
                .copied()
                .unwrap_or((0, 0));
            connection
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

        Ok(synced)
    })
}

/// Recomputes every feed's stored counts from per-subscription membership in
/// one statement: a single grouped pass over `article_feed_items` (walked in
/// primary-key order, so no temp b-tree for GROUP BY) joined to `articles`
/// by hash. Feeds without mappings drop to 0. Used by the one-time data repair.
pub(crate) fn recount_all_feed_article_counts(connection: &Connection) -> Result<usize, String> {
    connection
        .execute(
            r#"
            UPDATE feeds
            SET unread_count = counts.unread_count,
                article_count = counts.article_count
            FROM (
              SELECT f.id AS feed_id,
                     COALESCE(grouped.article_count, 0) AS article_count,
                     COALESCE(grouped.unread_count, 0) AS unread_count
              FROM feeds f
              LEFT JOIN (
                SELECT afi.feed_id AS feed_id,
                       COUNT(*) AS article_count,
                       SUM(CASE WHEN a.read = 0 THEN 1 ELSE 0 END) AS unread_count
                FROM article_feed_items afi
                JOIN articles a ON a.hash = afi.article_hash
                GROUP BY afi.feed_id
              ) grouped ON grouped.feed_id = f.id
            ) counts
            WHERE counts.feed_id = feeds.id
              AND (feeds.unread_count IS NOT counts.unread_count
                OR feeds.article_count IS NOT counts.article_count)
            "#,
            [],
        )
        .map_err(|error| format!("Failed to recount feed article counts: {error}"))
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
    query_articles_at(connection, request, chrono::Utc::now())
}

fn query_articles_at(
    connection: &Connection,
    request: ArticleQueryRequest,
    now: chrono::DateTime<chrono::Utc>,
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

    if request.today == Some(true) {
        // Same expression as the effective-date indexes (`idx_articles_effective_date`,
        // `idx_articles_read`, `idx_article_feed_items_feed_date`) so SQLite can range-seek.
        let effective_date_expr = if has_source_filter {
            "COALESCE(afi.published_date, afi.fetched_date)"
        } else {
            "COALESCE(a.published_date, a.fetched_date)"
        };
        conditions.push(format!("{effective_date_expr} >= ?"));
        bindings.push(Value::Text(today_cutoff(now)));
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
    let sort_last_read = request.sort_field.as_deref() == Some("last_read_at");
    let sort_expr = if sort_last_read {
        "a.last_read_at"
    } else if request.sort_field.as_deref() == Some("fetched_date") {
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
        && !sort_last_read
        && read_filter.is_none()
        && request.starred.is_none()
        && saved_filter.is_none();

    let mut having_conditions: Vec<String> = Vec::new();
    if let Some(cursor_hash) = request.cursor_hash {
        if sort_last_read {
            if let Some(cursor_date) = request.cursor_date {
                let cursor_operator = if sort_order == "ASC" { ">" } else { "<" };
                // DESC NULLS LAST: after a dated cursor, remaining dated rows
                // plus the NULL tail must both qualify. SQLite `NULL < date` is
                // unknown, so the NULL partition is an explicit OR.
                conditions.push(format!(
                    "(({sort_expr} {cursor_operator} ? OR ({sort_expr} = ? AND {sort_hash_expr} > ?)) OR {sort_expr} IS NULL)"
                ));
                bindings.push(Value::Text(cursor_date.clone()));
                bindings.push(Value::Text(cursor_date));
                bindings.push(Value::Text(cursor_hash));
            } else {
                conditions.push(format!("{sort_expr} IS NULL AND {sort_hash_expr} > ?"));
                bindings.push(Value::Text(cursor_hash));
            }
        } else if let Some(cursor_date) = request.cursor_date {
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
        let page_from_sql = if normalized_search_text.is_some() {
            "articles_search \
             JOIN articles search_article ON search_article.rowid = articles_search.rowid \
             JOIN article_feed_items afi INDEXED BY idx_article_feed_items_hash \
               ON afi.article_hash = search_article.hash"
        } else {
            "article_feed_items afi"
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
              FROM {page_from_sql}
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
        cancelled: false,
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

    // One savepoint for the whole batch: a single commit (not one autocommit +
    // FTS trigger fsync per row) and all-or-nothing on error. Nests inside the
    // per-feed store transaction.
    with_savepoint(connection, "insert_articles_batch", |connection| {
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
    })
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

    #[test]
    fn station_search_treats_operator_words_as_literals_and_dedupes_mappings() {
        let connection = setup_connection();
        insert_feed(&connection, "f1");
        insert_feed(&connection, "f2");
        connection
            .execute(
                "INSERT INTO tags (name, created_at) VALUES ('Tech', '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("insert tag");
        for feed_id in ["f1", "f2"] {
            connection
                .execute(
                    "INSERT INTO feed_tags (feed_id, tag_name) VALUES (?1, 'Tech')",
                    params![feed_id],
                )
                .expect("attach feed to tag");
        }
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, title, description, fetched_date) VALUES ('operator-match', 'f1', 'AND now for something literal', '', '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("insert searchable article");
        insert_mapping(&connection, "f1", "operator-match");
        insert_mapping(&connection, "f2", "operator-match");

        let page = query_articles(
            &connection,
            ArticleQueryRequest {
                feed_id: None,
                feed_ids: None,
                tag_name: Some("Tech".to_string()),
                unread_only: None,
                saved_only: None,
                read: None,
                starred: None,
                saved: None,
                sort_field: Some("published_date".to_string()),
                sort_order: Some("desc".to_string()),
                search_text: Some("AND".to_string()),
                search_epoch: None,
                limit: Some(100),
                offset: None,
                cursor_date: None,
                cursor_hash: None,
                include_total: Some(false),
                today: None,
            },
        )
        .expect("query station search");

        assert_eq!(page.total, 0, "live search must skip the exact count pass");
        assert!(!page.cancelled);
        assert_eq!(
            page.articles
                .iter()
                .map(|article| article.hash.as_str())
                .collect::<Vec<_>>(),
            vec!["operator-match"],
            "overlapping station mappings must return one article row"
        );

        let mut plan = connection
            .prepare(
                r#"
                EXPLAIN QUERY PLAN
                SELECT afi.article_hash
                FROM articles_search
                JOIN articles search_article ON search_article.rowid = articles_search.rowid
                JOIN article_feed_items afi INDEXED BY idx_article_feed_items_hash
                  ON afi.article_hash = search_article.hash
                WHERE afi.feed_id IN (
                  SELECT feed_id FROM feed_tags WHERE tag_name = ?1
                )
                  AND articles_search MATCH ?2
                GROUP BY afi.article_hash
                LIMIT 100
                "#,
            )
            .expect("prepare search query plan");
        let details = plan
            .query_map(params!["Tech", "\"AND\"*"], |row| row.get::<_, String>(3))
            .expect("query search plan")
            .collect::<Result<Vec<_>, _>>()
            .expect("read search plan");
        assert!(
            details
                .iter()
                .any(|detail| detail.contains("idx_article_feed_items_hash")),
            "station search must probe memberships by article hash: {details:?}"
        );
    }

    fn article_exists(connection: &Connection, hash: &str) -> bool {
        connection
            .query_row(
                "SELECT COUNT(*) FROM articles WHERE hash = ?1",
                params![hash],
                |row| row.get::<_, i64>(0),
            )
            .expect("count article")
            > 0
    }

    fn mapping_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM article_feed_items", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("count mappings")
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
    fn clear_all_articles_one_batch_sweeps_unsaved_keeps_saved_and_feeds() {
        let connection = setup_connection();
        for feed_id in ["f1", "f2"] {
            insert_feed(&connection, feed_id);
        }
        insert_article(&connection, "shared-unsaved", "f1", 0);
        insert_mapping(&connection, "f1", "shared-unsaved");
        insert_mapping(&connection, "f2", "shared-unsaved");
        insert_article(&connection, "plain-unsaved", "f2", 0);
        insert_mapping(&connection, "f2", "plain-unsaved");
        insert_article(&connection, "kept-saved", "f1", 1);
        insert_mapping(&connection, "f1", "kept-saved");

        let mut deleted = delete_articles_by_feeds(
            &connection,
            &["f1".to_string(), "f2".to_string()],
        )
        .expect("batched clear all articles");
        deleted.sort();

        assert_eq!(
            deleted,
            vec!["plain-unsaved".to_string(), "shared-unsaved".to_string()],
            "one batch call should collect every unsaved orphan exactly once"
        );
        assert!(!article_exists(&connection, "shared-unsaved"));
        assert!(!article_exists(&connection, "plain-unsaved"));
        assert!(
            article_exists(&connection, "kept-saved"),
            "saved articles survive a clear-all"
        );
        assert_eq!(
            mapping_count(&connection),
            0,
            "all feed mappings are removed, including saved articles'"
        );
        assert!(feed_exists(&connection, "f1") && feed_exists(&connection, "f2"));
    }

    #[test]
    fn delete_articles_by_feeds_with_no_ids_is_a_noop() {
        let connection = setup_connection();
        let deleted = delete_articles_by_feeds(&connection, &[]).expect("empty batch");
        assert!(deleted.is_empty());
    }

    fn insert_library_article(
        connection: &Connection,
        hash: &str,
        feed_id: &str,
        read: i64,
        last_read_at: Option<&str>,
    ) {
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, fetched_date, read, last_read_at) VALUES (?1, ?2, '2026-01-01T00:00:00Z', ?3, ?4)",
                params![hash, feed_id, read, last_read_at],
            )
            .expect("insert library article");
    }

    fn read_query(
        limit: i64,
        cursor_date: Option<&str>,
        cursor_hash: Option<&str>,
    ) -> ArticleQueryRequest {
        ArticleQueryRequest {
            feed_id: None,
            feed_ids: None,
            tag_name: None,
            unread_only: None,
            saved_only: None,
            read: Some(true),
            starred: None,
            saved: None,
            sort_field: Some("last_read_at".to_string()),
            sort_order: Some("desc".to_string()),
            search_text: None,
            search_epoch: None,
            limit: Some(limit),
            offset: None,
            cursor_date: cursor_date.map(str::to_string),
            cursor_hash: cursor_hash.map(str::to_string),
            include_total: Some(true),
            today: None,
        }
    }

    #[test]
    fn query_read_articles_sorts_by_last_read_at_nulls_last_and_pages_null_tail() {
        let connection = setup_connection();
        insert_feed(&connection, "f1");
        insert_library_article(&connection, "dated-c", "f1", 1, Some("2026-09-03T00:00:00Z"));
        insert_library_article(&connection, "dated-b", "f1", 1, Some("2026-09-02T00:00:00Z"));
        insert_library_article(&connection, "dated-a", "f1", 1, Some("2026-09-01T00:00:00Z"));
        insert_library_article(&connection, "null-b", "f1", 1, None);
        insert_library_article(&connection, "null-a", "f1", 1, None);
        insert_library_article(&connection, "unread-x", "f1", 0, Some("2026-09-04T00:00:00Z"));

        let page_one = query_articles(&connection, read_query(3, None, None)).expect("page one");
        assert_eq!(page_one.total, 5);
        assert_eq!(
            page_one
                .articles
                .iter()
                .map(|article| article.hash.as_str())
                .collect::<Vec<_>>(),
            vec!["dated-c", "dated-b", "dated-a"]
        );

        let page_two = query_articles(
            &connection,
            read_query(3, Some("2026-09-01T00:00:00Z"), Some("dated-a")),
        )
        .expect("page two after last dated row");
        assert_eq!(
            page_two
                .articles
                .iter()
                .map(|article| article.hash.as_str())
                .collect::<Vec<_>>(),
            vec!["null-a", "null-b"],
            "dated cursor must continue into the NULL last_read_at tail"
        );

        let null_tail = query_articles(&connection, read_query(3, None, Some("null-a")))
            .expect("null-tail cursor");
        assert_eq!(
            null_tail
                .articles
                .iter()
                .map(|article| article.hash.as_str())
                .collect::<Vec<_>>(),
            vec!["null-b"]
        );
    }

    #[test]
    fn feed_meta_update_json_null_clears_favicon_columns_only() {
        let parse = |json: &str| -> ArticleFeedMetaUpdate {
            serde_json::from_str(json).expect("deserialize ArticleFeedMetaUpdate")
        };
        let absent = parse("{}");
        assert_eq!(absent.feed_favicon, None);
        assert_eq!(
            parse(r#"{"feedFavicon":"data:x"}"#).feed_favicon,
            Some(Some("data:x".to_string()))
        );

        let connection = setup_connection();
        insert_feed(&connection, "f1");
        insert_article(&connection, "a1", "f1", 0);
        update_article_feed_meta(
            &connection,
            "f1",
            parse(
                r#"{"feedFavicon":"data:x","feedFaviconHasTransparency":true,
                    "feedFaviconBgLight":"white","feedFaviconBgDark":"black","feedTitle":"T"}"#,
            ),
        )
        .expect("seed article feed meta");

        let cleared = parse(
            r#"{"feedFavicon":null,"feedFaviconHasTransparency":null,
                "feedFaviconBgLight":null,"feedFaviconBgDark":null,"feedTitle":null}"#,
        );
        assert_eq!(cleared.feed_favicon, Some(None));
        assert_eq!(cleared.feed_favicon_has_transparency, Some(None));
        assert_eq!(cleared.feed_favicon_bg_light, Some(None));
        assert_eq!(cleared.feed_favicon_bg_dark, Some(None));
        assert_eq!(cleared.feed_title, None, "feedTitle null stays 'unchanged'");
        update_article_feed_meta(&connection, "f1", cleared).expect("clear article feed meta");

        let row: (
            Option<String>,
            Option<i64>,
            Option<String>,
            Option<String>,
            Option<String>,
        ) = connection
            .query_row(
                "SELECT feed_favicon, feed_favicon_has_transparency, feed_favicon_bg_light,
                        feed_favicon_bg_dark, feed_title
                 FROM articles WHERE hash = 'a1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .expect("read article meta");
        assert_eq!(row, (None, None, None, None, Some("T".to_string())));
    }

    fn record_for(hash: &str, feed_id: &str) -> ArticleRecord {
        ArticleRecord {
            hash: hash.to_string(),
            feed_id: feed_id.to_string(),
            title: format!("Title {hash}"),
            description: String::new(),
            content: String::new(),
            link: Some(format!("https://example.com/{hash}")),
            author: None,
            published_date: Some("2026-06-22T12:00:00.000Z".to_string()),
            fetched_date: "2026-06-22T12:00:00.000Z".to_string(),
            read: false,
            starred: false,
            saved: false,
            saved_article_id: None,
            last_read_at: None,
            metadata: None,
            feed_url: None,
            feed_title: None,
            feed_favicon: None,
            feed_favicon_has_transparency: None,
            feed_favicon_bg_light: None,
            feed_favicon_bg_dark: None,
            feed_image: None,
        }
    }

    fn counts_for(connection: &Connection, feed_ids: &[&str]) -> Vec<(String, i64, i64)> {
        let ids: Vec<String> = feed_ids.iter().map(|id| id.to_string()).collect();
        sync_feed_article_counts_batch(connection, &ids)
            .expect("sync counts")
            .into_iter()
            .map(|entry| (entry.feed_id, entry.unread_count, entry.article_count))
            .collect()
    }

    #[test]
    fn shared_hash_counts_unread_for_every_subscription() {
        let connection = setup_connection();
        insert_feed(&connection, "feed-a");
        insert_feed(&connection, "feed-b");
        // Same story in both feeds: canonical owner is feed-a, feed-b only
        // has the article_feed_items membership row.
        insert_articles_batch(&connection, &[record_for("shared", "feed-a")]).expect("insert a");
        insert_articles_batch(&connection, &[record_for("shared", "feed-b")]).expect("insert b");

        assert_eq!(
            counts_for(&connection, &["feed-a", "feed-b"]),
            vec![
                ("feed-a".to_string(), 1, 1),
                ("feed-b".to_string(), 1, 1),
            ],
            "the non-owner subscription must count the shared unread story"
        );
        assert_eq!(count_feed_articles(&connection, "feed-b").expect("count b"), (1, 1));

        connection
            .execute("UPDATE articles SET read = 1 WHERE hash = 'shared'", [])
            .expect("mark read");
        assert_eq!(
            counts_for(&connection, &["feed-a", "feed-b"]),
            vec![
                ("feed-a".to_string(), 0, 1),
                ("feed-b".to_string(), 0, 1),
            ],
            "marking the shared story read must clear both badges"
        );
        assert_eq!(count_feed_articles(&connection, "feed-a").expect("count a"), (1, 0));
        let stored: Vec<(i64, i64)> = connection
            .prepare("SELECT unread_count, article_count FROM feeds ORDER BY id")
            .expect("prepare")
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("rows");
        assert_eq!(stored, vec![(0, 1), (0, 1)]);
    }

    #[test]
    fn per_feed_count_queries_use_indexes_not_scans() {
        let connection = setup_connection();
        let plan = |sql: &str| -> String {
            connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare plan")
                .query_map(params!["feed-1"], |row| row.get::<_, String>(3))
                .expect("query plan")
                .collect::<Result<Vec<_>, _>>()
                .expect("plan rows")
                .join(" | ")
        };
        let single = plan(
            "SELECT COUNT(*), COALESCE(SUM(CASE WHEN a.read = 0 THEN 1 ELSE 0 END), 0) \
             FROM article_feed_items afi JOIN articles a ON a.hash = afi.article_hash \
             WHERE afi.feed_id = ?1",
        );
        let batch = plan(
            "SELECT afi.feed_id, COUNT(*), SUM(CASE WHEN a.read = 0 THEN 1 ELSE 0 END) \
             FROM article_feed_items afi JOIN articles a ON a.hash = afi.article_hash \
             WHERE afi.feed_id IN (?1) GROUP BY afi.feed_id",
        );
        println!("single-feed count plan: {single}");
        println!("batch count plan: {batch}");
        for current in [&single, &batch] {
            assert!(!current.contains("SCAN"), "count query must not full-scan: {current}");
            assert!(!current.contains("TEMP B-TREE"), "count query must not sort: {current}");
        }
    }

    #[test]
    fn insert_articles_batch_is_all_or_nothing() {
        let connection = setup_connection();
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .expect("enable foreign keys like production connections");
        insert_feed(&connection, "feed-a");
        // The second record violates the articles.feed_id foreign key.
        let error = insert_articles_batch(
            &connection,
            &[record_for("good", "feed-a"), record_for("bad", "missing-feed")],
        )
        .expect_err("FK violation must fail the batch");
        assert!(error.contains("Failed to insert article"), "{error}");
        let rows: i64 = connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM articles) + (SELECT COUNT(*) FROM article_feed_items)",
                [],
                |row| row.get(0),
            )
            .expect("count rows");
        assert_eq!(rows, 0, "the earlier article in the batch must roll back");
        assert!(connection.is_autocommit());
    }

    fn insert_dated_article(
        connection: &Connection,
        hash: &str,
        feed_id: &str,
        published_date: Option<&str>,
        fetched_date: &str,
        read: i64,
    ) {
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, published_date, fetched_date, read) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![hash, feed_id, published_date, fetched_date, read],
            )
            .expect("insert dated article");
        connection
            .execute(
                "INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date) VALUES (?1, ?2, ?3, ?4)",
                params![feed_id, hash, published_date, fetched_date],
            )
            .expect("insert dated mapping");
    }

    fn fixed_now() -> chrono::DateTime<chrono::Utc> {
        chrono::DateTime::parse_from_rfc3339("2026-10-22T12:00:00.000Z")
            .expect("parse fixed now")
            .with_timezone(&chrono::Utc)
    }

    fn today_query(read: Option<bool>) -> ArticleQueryRequest {
        ArticleQueryRequest {
            read,
            limit: Some(100),
            include_total: Some(true),
            today: Some(true),
            ..ArticleQueryRequest::default()
        }
    }

    #[test]
    fn today_query_keeps_last_24_hours_across_feeds_newest_first() {
        let connection = setup_connection();
        insert_feed(&connection, "f1");
        insert_feed(&connection, "f2");
        let fetched = "2026-10-22T11:59:00.000Z";
        insert_dated_article(&connection, "edge-in", "f1", Some("2026-10-21T12:00:00.000Z"), fetched, 0);
        insert_dated_article(&connection, "edge-out", "f1", Some("2026-10-21T11:59:59.999Z"), fetched, 0);
        insert_dated_article(&connection, "fresh-read", "f2", Some("2026-10-22T11:00:00.000Z"), fetched, 1);
        insert_dated_article(&connection, "fetched-only", "f2", None, "2026-10-22T06:00:00.000Z", 0);
        // Effective date is the published date, so an old post fetched today stays out.
        insert_dated_article(&connection, "old-post", "f1", Some("2026-10-01T00:00:00.000Z"), fetched, 0);
        insert_dated_article(&connection, "shared", "f1", Some("2026-10-22T09:00:00.000Z"), fetched, 0);
        connection
            .execute(
                "INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date) VALUES ('f2', 'shared', '2026-10-22T09:00:00.000Z', ?1)",
                params![fetched],
            )
            .expect("second subscription for shared article");

        let all = query_articles_at(&connection, today_query(None), fixed_now()).expect("today");
        assert_eq!(
            all.articles.iter().map(|article| article.hash.as_str()).collect::<Vec<_>>(),
            vec!["fresh-read", "shared", "fetched-only", "edge-in"],
            "read and unread from every feed, newest first, shared article once, 24h boundary inclusive"
        );
        assert_eq!(all.total, 4);

        let unread = query_articles_at(
            &connection,
            ArticleQueryRequest { limit: Some(0), ..today_query(Some(false)) },
            fixed_now(),
        )
        .expect("today unread count");
        assert_eq!(unread.total, 3, "sidebar count is Today's unread articles");

        let later = fixed_now() + chrono::Duration::hours(3);
        let shifted = query_articles_at(&connection, today_query(None), later).expect("later");
        assert_eq!(
            shifted.articles.iter().map(|article| article.hash.as_str()).collect::<Vec<_>>(),
            vec!["fresh-read", "shared", "fetched-only"],
            "the window slides with the query time"
        );
    }

    #[test]
    fn today_queries_use_effective_date_indexes_not_scans() {
        let connection = setup_connection();
        let plan = |sql: &str, bindings: &[&dyn rusqlite::ToSql]| -> String {
            connection
                .prepare(&format!("EXPLAIN QUERY PLAN {sql}"))
                .expect("prepare plan")
                .query_map(bindings, |row| row.get::<_, String>(3))
                .expect("query plan")
                .collect::<Result<Vec<_>, _>>()
                .expect("plan rows")
                .join(" | ")
        };
        let cutoff = today_cutoff(fixed_now());
        // Same shape query_articles builds for `today: true` with no feed/tag source.
        let page = plan(
            "SELECT a.hash, COALESCE(f.title, a.feed_title) \
             FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id \
             WHERE COALESCE(a.published_date, a.fetched_date) >= ?1 \
             ORDER BY COALESCE(a.published_date, a.fetched_date) DESC, a.hash ASC LIMIT 100",
            &[&cutoff],
        );
        let unread_count = plan(
            "SELECT COUNT(*) FROM articles a \
             WHERE COALESCE(a.published_date, a.fetched_date) >= ?1 AND a.read = ?2",
            &[&cutoff, &0_i64],
        );
        println!("today page plan: {page}");
        println!("today unread count plan: {unread_count}");
        assert!(page.contains("idx_articles_effective_date"), "page must seek the effective-date index: {page}");
        assert!(unread_count.contains("idx_articles_read"), "count must seek (read, effective date): {unread_count}");
        for current in [&page, &unread_count] {
            assert!(!current.contains("SCAN a"), "today query must not full-scan articles: {current}");
            assert!(
                !current.contains("USE TEMP B-TREE FOR ORDER BY"),
                "today query must not sort the whole window: {current}"
            );
        }
    }
}
