use rusqlite::{params, params_from_iter, types::Value, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use tauri::State;

use crate::diagnostics::robustness::{record_many, RobustnessCounter};

use super::{
    models::{bool_to_i64, to_json_string, to_optional_json_string, SavedArticleRecord},
    search::{body_snippet, create_fts_prefix_query, search_meta_cte_sql, search_tier_sql},
    DbState,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticleQueryRequest {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub search_text: Option<String>,
    pub search_epoch: Option<String>,
    pub include_total: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedArticleQueryResponse {
    pub articles: Vec<SavedArticleRecord>,
    pub total: i64,
    pub cancelled: bool,
    /// Search only: saved article id -> short excerpt of the body text for
    /// rows that matched in the body but not in title, description or author.
    #[serde(skip_serializing_if = "HashMap::is_empty")]
    pub search_snippets: HashMap<String, String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn saved_query(
    request: SavedArticleQueryRequest,
    state: State<'_, DbState>,
) -> Result<SavedArticleQueryResponse, String> {
    let db = state.inner().clone();
    let is_search = request
        .search_text
        .as_deref()
        .is_some_and(|text| !text.trim().is_empty());
    if !is_search {
        return db
            .read(move |connection| query_saved_articles(connection, request))
            .await;
    }
    let search_epoch = match request.search_epoch.as_deref() {
        Some(value) => value
            .parse::<u64>()
            .map_err(|_| "Invalid saved search epoch.".to_string())?,
        None => db.begin_search(),
    };

    match db
        .search_read(search_epoch, move |connection| query_saved_articles(connection, request))
        .await?
    {
        Some(response) => Ok(response),
        None => Ok(SavedArticleQueryResponse {
            articles: Vec::new(),
            total: 0,
            cancelled: true,
            search_snippets: HashMap::new(),
        }),
    }
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
    // The contract stays `number` (rows inserted); callers derive the skipped
    // count as `submitted - inserted`.
    db.write(move |connection| {
        insert_saved_articles_batch(connection, &articles).map(|outcome| outcome.inserted)
    })
    .await
}

/// Result of [`insert_saved_articles_batch`].
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct SavedInsertBatchOutcome {
    pub inserted: i64,
    /// Rows whose hash or normalized link matched an already-saved article.
    pub skipped_existing: i64,
    /// Rows that repeated an earlier row of the same batch.
    pub skipped_in_batch: i64,
}

impl SavedInsertBatchOutcome {
    pub fn skipped(&self) -> i64 {
        self.skipped_existing + self.skipped_in_batch
    }
}

/// SQLite's historic default `SQLITE_MAX_VARIABLE_NUMBER` is 999; stay below it.
const EXISTING_LOOKUP_CHUNK: usize = 500;

/// Normalized link identity for import dedupe: trimmed, fragment dropped,
/// trailing slashes dropped. Deliberately conservative (no query or case
/// rewriting) so distinct articles never collapse.
fn normalize_saved_link(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let without_fragment = trimmed.split('#').next().unwrap_or("");
    let normalized = without_fragment.trim_end_matches('/');
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

/// Identity keys of one saved row: the raw hash plus the normalized forms of
/// the hash and link (imports store the URL as the hash).
fn saved_identity_keys(article_hash: &str, link: Option<&str>) -> Vec<String> {
    let mut keys = Vec::with_capacity(3);
    let hash = article_hash.trim();
    if !hash.is_empty() {
        keys.push(hash.to_string());
    }
    for value in [Some(hash), link] {
        if let Some(normalized) = value.and_then(normalize_saved_link) {
            if !keys.contains(&normalized) {
                keys.push(normalized);
            }
        }
    }
    keys
}

/// Loads identity keys of saved rows whose `article_hash` equals any candidate.
/// Uses `idx_saved_articles_hash`; `link` has no index, so rows saved from a
/// feed (hash != URL) are only matched when the import row carries their hash.
fn load_existing_saved_identity_keys(
    connection: &Connection,
    candidates: &[String],
) -> Result<std::collections::HashSet<String>, String> {
    let mut existing = std::collections::HashSet::new();
    for chunk in candidates.chunks(EXISTING_LOOKUP_CHUNK) {
        let placeholders = vec!["?"; chunk.len()].join(", ");
        let sql = format!(
            "SELECT article_hash, link FROM saved_articles WHERE article_hash IN ({placeholders})"
        );
        let mut statement = connection
            .prepare(&sql)
            .map_err(|error| format!("Failed to prepare saved duplicate lookup: {error}"))?;
        let rows = statement
            .query_map(params_from_iter(chunk.iter()), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })
            .map_err(|error| format!("Failed to query saved duplicates: {error}"))?;
        for row in rows {
            let (hash, link) =
                row.map_err(|error| format!("Failed to read saved duplicate row: {error}"))?;
            existing.extend(saved_identity_keys(&hash, link.as_deref()));
        }
    }
    Ok(existing)
}

/// Inserts a batch of saved articles in one transaction, skipping rows whose
/// article hash or normalized link is already saved or repeats an earlier row
/// of the batch. Existing rows are found with one indexed lookup per batch
/// (chunked by the SQLite parameter limit), never one query per row.
pub fn insert_saved_articles_batch(
    connection: &Connection,
    articles: &[SavedArticleRecord],
) -> Result<SavedInsertBatchOutcome, String> {
    let keys_per_article: Vec<Vec<String>> = articles
        .iter()
        .map(|article| saved_identity_keys(&article.article_hash, article.link.as_deref()))
        .collect();

    // A stored hash may still carry the trailing slash or fragment the
    // normalized key dropped; probe the slash variant as well.
    let mut candidate_set = std::collections::HashSet::new();
    for keys in &keys_per_article {
        for key in keys {
            candidate_set.insert(key.clone());
            candidate_set.insert(format!("{key}/"));
        }
    }
    let candidates: Vec<String> = candidate_set.into_iter().collect();

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| format!("Failed to start saved import transaction: {error}"))?;
    let existing = load_existing_saved_identity_keys(&transaction, &candidates)?;

    let mut outcome = SavedInsertBatchOutcome::default();
    let mut seen_in_batch = std::collections::HashSet::new();
    for (article, keys) in articles.iter().zip(&keys_per_article) {
        if keys.iter().any(|key| existing.contains(key)) {
            outcome.skipped_existing += 1;
            continue;
        }
        if keys.iter().any(|key| seen_in_batch.contains(key)) {
            outcome.skipped_in_batch += 1;
            continue;
        }
        insert_saved_article(&transaction, article)?;
        seen_in_batch.extend(keys.iter().cloned());
        outcome.inserted += 1;
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit saved import transaction: {error}"))?;
    record_many(
        RobustnessCounter::SavedImportSkippedExisting,
        outcome.skipped() as u64,
    );
    Ok(outcome)
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

    let search_query = normalized_search_text
        .map(|search_text| {
            create_fts_prefix_query(search_text)
                .ok_or_else(|| "Search text did not contain searchable tokens.".to_string())
        })
        .transpose()?;
    if let Some(search_query) = search_query.clone() {
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

    let total = if request.include_total != Some(false) {
        connection
            .query_row(
                &format!("SELECT COUNT(*) FROM {from_sql} {where_sql}"),
                params_from_iter(bindings.iter()),
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| format!("Failed to count saved articles: {error}"))?
    } else {
        0
    };

    // Title/description/author matches first, then body-only matches; each
    // tier newest-saved first (see `search_tier_sql`).
    let (search_meta_cte, tier_select, tier_order) = match &search_query {
        Some(query) => (
            search_meta_cte_sql("saved_articles_search", query),
            format!("\n          {} AS search_tier,", search_tier_sql("sa.rowid")),
            "search_tier ASC, ",
        ),
        None => (String::new(), String::new(), ""),
    };
    let mut data_bindings = bindings;
    let mut data_sql = format!(
        r#"
        {search_meta_cte}SELECT{tier_select}
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
        ORDER BY {tier_order}sa.saved_date DESC
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
    let is_search = normalized_search_text.is_some();
    let rows = statement
        .query_map(params_from_iter(data_bindings.iter()), |row| {
            let tier = if is_search {
                row.get::<_, i64>("search_tier")?
            } else {
                0
            };
            Ok((SavedArticleRecord::from_row(row)?, tier))
        })
        .map_err(|error| format!("Failed to query saved articles: {error}"))?;
    let rows = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to read saved article row: {error}"))?;
    let mut search_snippets = HashMap::new();
    if let Some(search_text) = normalized_search_text {
        for (article, _) in rows.iter().filter(|(_, tier)| *tier == 1) {
            let snippet = article
                .content
                .as_deref()
                .and_then(|content| body_snippet(content, search_text));
            if let Some(snippet) = snippet {
                search_snippets.insert(article.id.clone(), snippet);
            }
        }
    }

    Ok(SavedArticleQueryResponse {
        articles: rows.into_iter().map(|(article, _)| article).collect(),
        total,
        cancelled: false,
        search_snippets,
    })
}

pub fn insert_saved_article(
    connection: &Connection,
    article: &SavedArticleRecord,
) -> Result<(), String> {
    let metadata_json = to_optional_json_string(&article.metadata)?;
    let highlights_json = to_json_string(&article.highlights)?;

    connection
        .prepare_cached(
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
        )
        .and_then(|mut statement| statement.execute(params![
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
            ]))
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::run_migrations;

    fn setup_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        connection
    }

    fn imported(id: &str, url: &str) -> SavedArticleRecord {
        SavedArticleRecord {
            id: id.to_string(),
            article_hash: url.to_string(),
            title: Some(format!("Title {id}")),
            description: None,
            content: Some("body".to_string()),
            link: Some(url.to_string()),
            author: None,
            published_date: None,
            saved_date: "2026-01-01T00:00:00Z".to_string(),
            last_read_at: None,
            feed_id: Some("saved".to_string()),
            feed_url: Some(url.to_string()),
            feed_title: None,
            feed_favicon: None,
            feed_favicon_has_transparency: None,
            feed_favicon_bg_light: None,
            feed_favicon_bg_dark: None,
            feed_image: None,
            preview_image: None,
            metadata: None,
            highlights: Vec::new(),
            notes: None,
        }
    }

    fn saved_count(connection: &Connection) -> i64 {
        connection
            .query_row("SELECT COUNT(*) FROM saved_articles", [], |row| row.get(0))
            .expect("count saved articles")
    }

    #[test]
    fn reimporting_the_same_batch_inserts_nothing_and_reports_skips() {
        let connection = setup_connection();
        let first = vec![
            imported("a1", "https://a.example/1"),
            imported("a2", "https://a.example/2"),
            imported("a3", "https://a.example/3"),
        ];
        let before = crate::diagnostics::robustness::snapshot().saved_import_skipped_existing;

        let outcome = insert_saved_articles_batch(&connection, &first).expect("first import");
        assert_eq!(outcome.inserted, 3);
        assert_eq!(outcome.skipped(), 0);

        // Second import of the same file: fresh random ids, same URLs.
        let second: Vec<_> = first
            .iter()
            .map(|article| SavedArticleRecord {
                id: format!("{}-again", article.id),
                ..article.clone()
            })
            .collect();
        let outcome = insert_saved_articles_batch(&connection, &second).expect("second import");

        assert_eq!(
            outcome,
            SavedInsertBatchOutcome { inserted: 0, skipped_existing: 3, skipped_in_batch: 0 }
        );
        assert_eq!(saved_count(&connection), 3);
        let after = crate::diagnostics::robustness::snapshot().saved_import_skipped_existing;
        assert!(after >= before + 3, "skipped rows are recorded ({before} -> {after})");
    }

    #[test]
    fn duplicates_within_one_batch_are_inserted_once() {
        let connection = setup_connection();
        let batch = vec![
            imported("b1", "https://b.example/post"),
            imported("b2", "https://b.example/post"),
            // Same article, trailing slash + fragment: normalized link matches.
            imported("b3", " https://b.example/post/#comments"),
            imported("b4", "https://b.example/other"),
        ];

        let outcome = insert_saved_articles_batch(&connection, &batch).expect("import");

        assert_eq!(
            outcome,
            SavedInsertBatchOutcome { inserted: 2, skipped_existing: 0, skipped_in_batch: 2 }
        );
        assert_eq!(saved_count(&connection), 2);
    }

    #[test]
    fn existing_rows_match_by_hash_or_normalized_link() {
        let connection = setup_connection();
        // Saved from a feed: hash is the feed article hash, link is the URL.
        let mut feed_saved = imported("feed-1", "https://c.example/feed-post");
        feed_saved.article_hash = "feedhash123".to_string();
        insert_saved_article(&connection, &feed_saved).expect("seed feed-saved row");
        // Earlier import stored with a trailing slash.
        insert_saved_article(&connection, &imported("old-1", "https://c.example/slash/"))
            .expect("seed imported row");

        let mut same_hash = imported("n1", "https://c.example/moved");
        same_hash.article_hash = "feedhash123".to_string();
        let batch = vec![
            same_hash,
            imported("n2", "https://c.example/slash"),
            imported("n3", "https://c.example/new"),
        ];

        let outcome = insert_saved_articles_batch(&connection, &batch).expect("import");

        assert_eq!(
            outcome,
            SavedInsertBatchOutcome { inserted: 1, skipped_existing: 2, skipped_in_batch: 0 }
        );
        assert_eq!(saved_count(&connection), 3);
    }

    #[test]
    fn duplicate_lookup_uses_the_article_hash_index() {
        let connection = setup_connection();
        let plan: String = connection
            .query_row(
                "EXPLAIN QUERY PLAN SELECT article_hash, link FROM saved_articles WHERE article_hash IN (?1, ?2)",
                params!["a", "b"],
                |row| row.get(3),
            )
            .expect("query plan");
        assert!(plan.contains("idx_saved_articles_hash"), "plan: {plan}");
    }
}
