//! Read-only library queries for assistants. Every query goes through the
//! sharing filter: a feed is visible only when one of its stations is shared
//! (or it has no station and unstationed feeds are shared). Hidden items are
//! reported as "not found", never as "hidden".

use super::settings::AssistantSettings;
use crate::db::search::create_fts_prefix_query;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{params_from_iter, types::Value, Connection, OptionalExtension, Row};
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::BTreeMap;

pub const DEFAULT_LIST_LIMIT: usize = 50;
pub const MAX_LIST_LIMIT: usize = 200;
/// Bytes of article content read for list summaries when the feed gave no
/// description; keeps list queries from pulling whole bodies.
const SUMMARY_CONTENT_HEAD: i64 = 4_000;

/// What the user chose to share, captured once per request.
#[derive(Clone, Debug, Default)]
pub struct Exposure {
    pub stations: Option<Vec<String>>,
    pub include_unstationed: bool,
}

impl Exposure {
    pub fn from_settings(settings: &AssistantSettings) -> Self {
        Self {
            stations: settings.shared_stations.clone(),
            include_unstationed: settings.include_unstationed_feeds,
        }
    }

    pub fn everything() -> Self {
        Self {
            stations: None,
            include_unstationed: true,
        }
    }

    fn is_station_shared(&self, name: &str) -> bool {
        self.stations
            .as_ref()
            .map(|names| names.iter().any(|candidate| candidate == name))
            .unwrap_or(true)
    }

    /// `exposed_feeds(id)` CTE body for this exposure.
    fn exposed_feeds_cte(&self, params: &mut Vec<Value>) -> String {
        let tagged = match &self.stations {
            None => "EXISTS (SELECT 1 FROM feed_tags ft WHERE ft.feed_id = f.id)".to_string(),
            Some(names) if names.is_empty() => "0".to_string(),
            Some(names) => {
                let placeholders = names
                    .iter()
                    .map(|name| {
                        params.push(Value::Text(name.clone()));
                        "?"
                    })
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "EXISTS (SELECT 1 FROM feed_tags ft WHERE ft.feed_id = f.id AND ft.tag_name IN ({placeholders}))"
                )
            }
        };
        let condition = if self.include_unstationed {
            if self.stations.is_none() {
                "1".to_string()
            } else {
                format!("({tagged} OR NOT EXISTS (SELECT 1 FROM feed_tags ft2 WHERE ft2.feed_id = f.id))")
            }
        } else {
            tagged
        };
        format!("exposed_feeds(id) AS (SELECT f.id FROM feeds f WHERE {condition})")
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ArticleScope {
    All,
    Station(String),
    Feed(String),
    Starred,
    Unread,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StationRow {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
    pub feed_count: i64,
    pub unread_count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FeedRow {
    pub id: String,
    pub title: String,
    pub url: String,
    pub stations: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    pub is_podcast: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_fetched: Option<String>,
    pub unread_count: i64,
    pub article_count: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleRow {
    pub hash: String,
    pub title: String,
    pub feed_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub date: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub summary: String,
    pub read: bool,
    pub starred: bool,
    pub saved: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ArticleFull {
    pub hash: String,
    pub title: String,
    pub description: String,
    pub content: String,
    pub link: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub fetched_date: String,
    pub feed_id: String,
    pub feed_title: Option<String>,
    pub read: bool,
    pub starred: bool,
    pub stations: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedRow {
    pub id: String,
    pub article_hash: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub feed_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
    pub saved_date: String,
    pub summary: String,
    pub highlight_count: usize,
    pub has_notes: bool,
}

#[derive(Clone, Debug)]
pub struct SavedFull {
    pub id: String,
    pub title: String,
    pub content: String,
    pub description: String,
    pub link: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub saved_date: String,
    pub feed_title: Option<String>,
    pub highlights: Vec<JsonValue>,
    pub notes: Option<String>,
}

#[derive(Clone, Copy)]
pub struct ListArticlesRequest<'a> {
    pub scope: &'a ArticleScope,
    pub since: Option<&'a str>,
    pub until: Option<&'a str>,
    pub search: Option<&'a str>,
    pub cursor: Option<&'a str>,
    pub limit: usize,
}

pub fn clamp_limit(limit: Option<u64>) -> usize {
    limit
        .map(|value| value as usize)
        .unwrap_or(DEFAULT_LIST_LIMIT)
        .clamp(1, MAX_LIST_LIMIT)
}

fn sql_error(error: rusqlite::Error) -> String {
    match error {
        rusqlite::Error::SqliteFailure(code, _) if code.code == rusqlite::ErrorCode::OperationInterrupted => {
            "That request took too long. Try a shorter time range or a smaller limit.".to_string()
        }
        other => format!("Library query failed: {other}"),
    }
}

pub fn list_stations(conn: &Connection, exposure: &Exposure) -> Result<Vec<StationRow>, String> {
    let mut statement = conn
        .prepare(
            "SELECT t.name, t.emoji,
                    (SELECT COUNT(*) FROM feed_tags ft WHERE ft.tag_name = t.name) AS feed_count,
                    (SELECT COALESCE(SUM(f.unread_count), 0) FROM feed_tags ft JOIN feeds f ON f.id = ft.feed_id
                      WHERE ft.tag_name = t.name) AS unread_count
             FROM tags t
             ORDER BY t.sort_order ASC, t.name ASC",
        )
        .map_err(sql_error)?;
    let rows = statement
        .query_map([], |row| {
            Ok(StationRow {
                name: row.get(0)?,
                emoji: row.get(1)?,
                feed_count: row.get(2)?,
                unread_count: row.get(3)?,
            })
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;
    Ok(rows
        .into_iter()
        .filter(|row| exposure.is_station_shared(&row.name))
        .collect())
}

pub fn station_exists(conn: &Connection, exposure: &Exposure, name: &str) -> Result<bool, String> {
    if !exposure.is_station_shared(name) {
        return Ok(false);
    }
    conn.query_row("SELECT 1 FROM tags WHERE name = ?1", [name], |_| Ok(()))
        .optional()
        .map(|row| row.is_some())
        .map_err(sql_error)
}

pub fn list_feeds(
    conn: &Connection,
    exposure: &Exposure,
    station: Option<&str>,
) -> Result<Vec<FeedRow>, String> {
    let mut params = Vec::new();
    let cte = exposure.exposed_feeds_cte(&mut params);
    let mut sql = format!(
        "WITH {cte}
         SELECT f.id, f.title, f.url, f.description, f.language, COALESCE(f.is_podcast, 0),
                f.last_fetched, COALESCE(f.unread_count, 0), COALESCE(f.article_count, 0),
                (SELECT group_concat(tag_name, char(31)) FROM
                   (SELECT ft.tag_name FROM feed_tags ft WHERE ft.feed_id = f.id ORDER BY ft.tag_name)) AS stations
         FROM feeds f
         WHERE f.id IN (SELECT id FROM exposed_feeds)"
    );
    if let Some(name) = station {
        sql.push_str(" AND f.id IN (SELECT feed_id FROM feed_tags WHERE tag_name = ?)");
        params.push(Value::Text(name.to_string()));
        sql.push_str(" ORDER BY (SELECT ft.sort_order FROM feed_tags ft WHERE ft.feed_id = f.id AND ft.tag_name = ?), f.title COLLATE NOCASE");
        params.push(Value::Text(name.to_string()));
    } else {
        sql.push_str(" ORDER BY f.title COLLATE NOCASE");
    }

    let mut statement = conn.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map(params_from_iter(params), |row| {
            let stations: Option<String> = row.get(9)?;
            Ok(FeedRow {
                id: row.get(0)?,
                title: row.get(1)?,
                url: row.get(2)?,
                description: row.get::<_, Option<String>>(3)?.filter(|value| !value.trim().is_empty()),
                language: row.get(4)?,
                is_podcast: row.get::<_, i64>(5)? != 0,
                last_fetched: row.get(6)?,
                unread_count: row.get(7)?,
                article_count: row.get(8)?,
                stations: split_stations(stations),
            })
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;

    Ok(rows
        .into_iter()
        .map(|mut row| {
            row.stations.retain(|name| exposure.is_station_shared(name));
            row
        })
        .collect())
}

pub fn feed_is_exposed(conn: &Connection, exposure: &Exposure, feed_id: &str) -> Result<bool, String> {
    let mut params = Vec::new();
    let cte = exposure.exposed_feeds_cte(&mut params);
    params.push(Value::Text(feed_id.to_string()));
    conn.query_row(
        &format!("WITH {cte} SELECT 1 FROM exposed_feeds WHERE id = ?"),
        params_from_iter(params),
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(sql_error)
}

/// Whether an article is visible under `exposure` (its own feed or any
/// cross-posting points at a shared feed). Write tools check this first.
pub fn article_is_exposed(conn: &Connection, exposure: &Exposure, hash: &str) -> Result<bool, String> {
    let mut params = Vec::new();
    let cte = exposure.exposed_feeds_cte(&mut params);
    params.push(Value::Text(hash.to_string()));
    conn.query_row(
        &format!(
            "WITH {cte}
             SELECT 1 FROM articles a
             WHERE a.hash = ?
               AND (a.feed_id IN (SELECT id FROM exposed_feeds)
                    OR EXISTS (SELECT 1 FROM article_feed_items afi
                               WHERE afi.article_hash = a.hash AND afi.feed_id IN (SELECT id FROM exposed_feeds)))"
        ),
        params_from_iter(params),
        |_| Ok(()),
    )
    .optional()
    .map(|row| row.is_some())
    .map_err(sql_error)
}

/// Look-back windows tried, newest first, when no `since` is given. Grouping
/// every mapping of a large library takes seconds; a recent window that
/// already holds more than `limit` rows yields the same top rows.
const OPEN_RANGE_WINDOWS_DAYS: [i64; 3] = [3, 30, 365];

pub fn list_articles(
    conn: &Connection,
    exposure: &Exposure,
    request: &ListArticlesRequest<'_>,
) -> Result<Page<ArticleRow>, String> {
    // Small candidate sets (starred, keyword search) are cheap unbounded;
    // windows only help scopes that are dense in recent articles.
    let sparse = matches!(request.scope, ArticleScope::Starred) || request.search.is_some();
    if request.since.is_some() || sparse {
        return list_articles_once(conn, exposure, request);
    }
    let cursor_date = request.cursor.map(decode_cursor).transpose()?.map(|(date, _)| date);
    let anchor = [request.until.map(str::to_string), cursor_date]
        .into_iter()
        .flatten()
        .filter_map(|value| chrono::DateTime::parse_from_rfc3339(&value).ok())
        .map(|value| value.with_timezone(&chrono::Utc))
        .min()
        .unwrap_or_else(chrono::Utc::now);
    for days in OPEN_RANGE_WINDOWS_DAYS {
        let since = super::time_range::format_stored(anchor - chrono::Duration::days(days));
        let page = list_articles_once(conn, exposure, &ListArticlesRequest { since: Some(&since), ..*request })?;
        if page.next_cursor.is_some() {
            return Ok(page);
        }
    }
    list_articles_once(conn, exposure, request)
}

fn list_articles_once(
    conn: &Connection,
    exposure: &Exposure,
    request: &ListArticlesRequest<'_>,
) -> Result<Page<ArticleRow>, String> {
    let mut params = Vec::new();
    let cte = exposure.exposed_feeds_cte(&mut params);

    let scope_filter = match request.scope {
        ArticleScope::Station(name) => {
            params.push(Value::Text(name.clone()));
            " WHERE id IN (SELECT feed_id FROM feed_tags WHERE tag_name = ?)"
        }
        ArticleScope::Feed(id) => {
            params.push(Value::Text(id.clone()));
            " WHERE id = ?"
        }
        _ => "",
    };

    let mut candidate_filters = String::new();
    if let Some(since) = request.since {
        candidate_filters.push_str(" AND COALESCE(afi.published_date, afi.fetched_date) >= ?");
        params.push(Value::Text(since.to_string()));
    }
    if let Some(until) = request.until {
        candidate_filters.push_str(" AND COALESCE(afi.published_date, afi.fetched_date) < ?");
        params.push(Value::Text(until.to_string()));
    }
    match request.scope {
        ArticleScope::Starred => candidate_filters
            .push_str(" AND afi.article_hash IN (SELECT hash FROM articles WHERE starred = 1)"),
        ArticleScope::Unread => candidate_filters
            .push_str(" AND afi.article_hash IN (SELECT hash FROM articles WHERE read = 0)"),
        _ => {}
    }
    if let Some(search) = request.search {
        let Some(fts) = create_fts_prefix_query(search) else {
            return Ok(Page { items: Vec::new(), next_cursor: None });
        };
        candidate_filters.push_str(
            " AND afi.article_hash IN (SELECT a3.hash FROM articles a3 WHERE a3.rowid IN
                 (SELECT rowid FROM articles_search WHERE articles_search MATCH ?))",
        );
        params.push(Value::Text(fts));
    }

    // Placeholders bind in text order: the SELECT list (summary head) comes
    // before the outer WHERE (cursor) and LIMIT.
    params.push(Value::Integer(SUMMARY_CONTENT_HEAD));
    let mut outer_filters = String::new();
    if let Some(cursor) = request.cursor {
        let (date, hash) = decode_cursor(cursor)?;
        outer_filters.push_str(" AND (c.d < ? OR (c.d = ? AND a.hash < ?))");
        params.push(Value::Text(date.clone()));
        params.push(Value::Text(date));
        params.push(Value::Text(hash));
    }
    params.push(Value::Integer(request.limit as i64 + 1));

    let sql = format!(
        "WITH {cte},
         scope_feeds(id) AS (SELECT id FROM exposed_feeds{scope_filter}),
         candidates(hash, d, feed) AS (
           SELECT afi.article_hash, MAX(COALESCE(afi.published_date, afi.fetched_date)), MIN(afi.feed_id)
           FROM article_feed_items afi
           WHERE afi.feed_id IN (SELECT id FROM scope_feeds){candidate_filters}
           GROUP BY afi.article_hash
         )
         -- Show a feed from the shared scope: the article's primary feed may
         -- sit in a station that isn't shared.
         SELECT a.hash, a.title, c.feed,
                CASE WHEN c.feed = a.feed_id THEN COALESCE(f.title, a.feed_title) ELSE f.title END,
                a.author, c.d, a.link,
                a.description, CASE WHEN length(a.description) = 0 THEN substr(a.content, 1, ?) ELSE '' END,
                a.read, a.starred, a.saved
         FROM candidates c
         JOIN articles a ON a.hash = c.hash
         LEFT JOIN feeds f ON f.id = c.feed
         WHERE 1{outer_filters}
         ORDER BY c.d DESC, a.hash DESC
         LIMIT ?"
    );

    let mut statement = conn.prepare(&sql).map_err(sql_error)?;
    let mut rows = statement
        .query_map(params_from_iter(params), article_row)
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;

    let next_cursor = if rows.len() > request.limit {
        rows.truncate(request.limit);
        rows.last().map(|row| encode_cursor(&row.date, &row.hash))
    } else {
        None
    };
    Ok(Page { items: rows, next_cursor })
}

fn article_row(row: &Row<'_>) -> rusqlite::Result<ArticleRow> {
    let description: String = row.get(7)?;
    let content_head: String = row.get(8)?;
    Ok(ArticleRow {
        hash: row.get(0)?,
        title: row.get(1)?,
        feed_id: row.get(2)?,
        feed_title: row.get(3)?,
        author: row.get::<_, Option<String>>(4)?.filter(|value| !value.trim().is_empty()),
        date: row.get(5)?,
        link: row.get(6)?,
        summary: super::format::summarize(&description, &content_head),
        read: row.get::<_, i64>(9)? != 0,
        starred: row.get::<_, i64>(10)? != 0,
        saved: row.get::<_, i64>(11)? != 0,
    })
}

pub fn get_article(
    conn: &Connection,
    exposure: &Exposure,
    hash: &str,
) -> Result<Option<ArticleFull>, String> {
    let mut params = Vec::new();
    let cte = exposure.exposed_feeds_cte(&mut params);
    params.push(Value::Text(hash.to_string()));
    let sql = format!(
        "WITH {cte}
         SELECT a.hash, a.title, a.description, a.content, a.link, a.author, a.published_date,
                a.fetched_date, a.feed_id, COALESCE(f.title, a.feed_title), a.read, a.starred
         FROM articles a
         LEFT JOIN feeds f ON f.id = a.feed_id
         WHERE a.hash = ?
           AND (a.feed_id IN (SELECT id FROM exposed_feeds)
                OR EXISTS (SELECT 1 FROM article_feed_items afi
                           WHERE afi.article_hash = a.hash AND afi.feed_id IN (SELECT id FROM exposed_feeds)))"
    );
    let article = conn
        .query_row(&sql, params_from_iter(params), |row| {
            Ok(ArticleFull {
                hash: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                content: row.get(3)?,
                link: row.get(4)?,
                author: row.get(5)?,
                published_date: row.get(6)?,
                fetched_date: row.get(7)?,
                feed_id: row.get(8)?,
                feed_title: row.get(9)?,
                read: row.get::<_, i64>(10)? != 0,
                starred: row.get::<_, i64>(11)? != 0,
                stations: Vec::new(),
            })
        })
        .optional()
        .map_err(sql_error)?;

    let Some(mut article) = article else {
        return Ok(None);
    };
    if !feed_is_exposed(conn, exposure, &article.feed_id)? {
        // Visible through a cross-posting: name a shared feed instead of the
        // (hidden) primary one.
        let mut params = Vec::new();
        let cte = exposure.exposed_feeds_cte(&mut params);
        params.push(Value::Text(article.hash.clone()));
        let shown = conn
            .query_row(
                &format!(
                    "WITH {cte}
                     SELECT f.id, f.title FROM article_feed_items afi JOIN feeds f ON f.id = afi.feed_id
                     WHERE afi.article_hash = ? AND afi.feed_id IN (SELECT id FROM exposed_feeds)
                     ORDER BY afi.feed_id LIMIT 1"
                ),
                params_from_iter(params),
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()
            .map_err(sql_error)?;
        if let Some((id, title)) = shown {
            article.feed_id = id;
            article.feed_title = Some(title);
        }
    }
    article.stations = article_stations(conn, &article.hash)?
        .into_iter()
        .filter(|name| exposure.is_station_shared(name))
        .collect();
    Ok(Some(article))
}

/// Reads an article whatever its station. Only the current-article path uses
/// this (the user is looking at it); station names still follow `exposure`.
pub fn get_article_unfiltered(conn: &Connection, exposure: &Exposure, hash: &str) -> Result<Option<ArticleFull>, String> {
    let mut article = get_article(conn, &Exposure::everything(), hash)?;
    if let Some(article) = article.as_mut() {
        article.stations.retain(|name| exposure.is_station_shared(name));
    }
    Ok(article)
}

fn article_stations(conn: &Connection, hash: &str) -> Result<Vec<String>, String> {
    let mut statement = conn
        .prepare(
            "SELECT DISTINCT ft.tag_name FROM feed_tags ft
             WHERE ft.feed_id IN (SELECT feed_id FROM article_feed_items WHERE article_hash = ?1)
                OR ft.feed_id = (SELECT feed_id FROM articles WHERE hash = ?1)
             ORDER BY ft.tag_name",
        )
        .map_err(sql_error)?;
    let names = statement
        .query_map([hash], |row| row.get::<_, String>(0))
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error);
    names
}

/// Stations for a set of feeds (used to group digests).
pub fn stations_by_feed(
    conn: &Connection,
    exposure: &Exposure,
    feed_ids: &[String],
) -> Result<BTreeMap<String, Vec<String>>, String> {
    let mut map: BTreeMap<String, Vec<String>> = BTreeMap::new();
    if feed_ids.is_empty() {
        return Ok(map);
    }
    let placeholders = vec!["?"; feed_ids.len()].join(", ");
    let sql = format!(
        "SELECT ft.feed_id, ft.tag_name FROM feed_tags ft
         JOIN tags t ON t.name = ft.tag_name
         WHERE ft.feed_id IN ({placeholders})
         ORDER BY t.sort_order, t.name"
    );
    let mut statement = conn.prepare(&sql).map_err(sql_error)?;
    let rows = statement
        .query_map(params_from_iter(feed_ids.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(sql_error)?;
    for row in rows {
        let (feed_id, station) = row.map_err(sql_error)?;
        if exposure.is_station_shared(&station) {
            map.entry(feed_id).or_default().push(station);
        }
    }
    Ok(map)
}

pub fn list_saved(
    conn: &Connection,
    since: Option<&str>,
    until: Option<&str>,
    search: Option<&str>,
    cursor: Option<&str>,
    limit: usize,
) -> Result<Page<SavedRow>, String> {
    // The SELECT list's summary placeholder binds first (text order).
    let mut params: Vec<Value> = vec![Value::Integer(SUMMARY_CONTENT_HEAD)];
    let mut filters = String::new();
    if let Some(since) = since {
        filters.push_str(" AND s.saved_date >= ?");
        params.push(Value::Text(since.to_string()));
    }
    if let Some(until) = until {
        filters.push_str(" AND s.saved_date < ?");
        params.push(Value::Text(until.to_string()));
    }
    if let Some(search) = search {
        let Some(fts) = create_fts_prefix_query(search) else {
            return Ok(Page { items: Vec::new(), next_cursor: None });
        };
        filters.push_str(
            " AND s.rowid IN (SELECT rowid FROM saved_articles_search WHERE saved_articles_search MATCH ?)",
        );
        params.push(Value::Text(fts));
    }
    if let Some(cursor) = cursor {
        let (date, id) = decode_cursor(cursor)?;
        filters.push_str(" AND (s.saved_date < ? OR (s.saved_date = ? AND s.id < ?))");
        params.push(Value::Text(date.clone()));
        params.push(Value::Text(date));
        params.push(Value::Text(id));
    }
    params.push(Value::Integer(limit as i64 + 1));

    let sql = format!(
        "SELECT s.id, s.article_hash, COALESCE(s.title, ''), s.feed_title, s.link, s.saved_date,
                COALESCE(s.description, ''),
                CASE WHEN length(COALESCE(s.description, '')) = 0 THEN substr(COALESCE(s.content, ''), 1, ?) ELSE '' END,
                COALESCE(s.highlights_json, '[]'), s.notes
         FROM saved_articles s
         WHERE 1{filters}
         ORDER BY s.saved_date DESC, s.id DESC
         LIMIT ?"
    );
    let mut statement = conn.prepare(&sql).map_err(sql_error)?;
    let mut rows = statement
        .query_map(params_from_iter(params), |row| {
            let description: String = row.get(6)?;
            let content_head: String = row.get(7)?;
            let highlights: String = row.get(8)?;
            let notes: Option<String> = row.get(9)?;
            Ok(SavedRow {
                id: row.get(0)?,
                article_hash: row.get(1)?,
                title: row.get(2)?,
                feed_title: row.get(3)?,
                link: row.get(4)?,
                saved_date: row.get(5)?,
                summary: super::format::summarize(&description, &content_head),
                highlight_count: serde_json::from_str::<Vec<JsonValue>>(&highlights)
                    .map(|items| items.len())
                    .unwrap_or(0),
                has_notes: notes.map(|value| !value.trim().is_empty()).unwrap_or(false),
            })
        })
        .map_err(sql_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql_error)?;

    let next_cursor = if rows.len() > limit {
        rows.truncate(limit);
        rows.last().map(|row| encode_cursor(&row.saved_date, &row.id))
    } else {
        None
    };
    Ok(Page { items: rows, next_cursor })
}

pub fn get_saved(conn: &Connection, id: &str) -> Result<Option<SavedFull>, String> {
    query_saved(conn, "s.id = ?1", id)
}

pub fn get_saved_by_article_hash(conn: &Connection, hash: &str) -> Result<Option<SavedFull>, String> {
    query_saved(conn, "s.article_hash = ?1", hash)
}

fn query_saved(conn: &Connection, condition: &str, value: &str) -> Result<Option<SavedFull>, String> {
    let sql = format!(
        "SELECT s.id, s.article_hash, COALESCE(s.title, ''), COALESCE(s.content, ''),
                COALESCE(s.description, ''), s.link, s.author, s.published_date, s.saved_date,
                s.feed_title, COALESCE(s.highlights_json, '[]'), s.notes
         FROM saved_articles s WHERE {condition}
         ORDER BY s.saved_date DESC LIMIT 1"
    );
    conn.query_row(&sql, [value], |row| {
        let highlights: String = row.get(10)?;
        Ok(SavedFull {
            id: row.get(0)?,
            title: row.get(2)?,
            content: row.get(3)?,
            description: row.get(4)?,
            link: row.get(5)?,
            author: row.get(6)?,
            published_date: row.get(7)?,
            saved_date: row.get(8)?,
            feed_title: row.get(9)?,
            highlights: serde_json::from_str(&highlights).unwrap_or_default(),
            notes: row.get::<_, Option<String>>(11)?.filter(|value| !value.trim().is_empty()),
        })
    })
    .optional()
    .map_err(sql_error)
}

fn split_stations(raw: Option<String>) -> Vec<String> {
    raw.map(|value| {
        value
            .split('\u{1f}')
            .filter(|name| !name.is_empty())
            .map(str::to_string)
            .collect()
    })
    .unwrap_or_default()
}

pub fn encode_cursor(date: &str, key: &str) -> String {
    URL_SAFE_NO_PAD.encode(format!("{date}\u{1f}{key}"))
}

pub fn decode_cursor(cursor: &str) -> Result<(String, String), String> {
    let invalid = || "That cursor is not valid. Start again without a cursor.".to_string();
    let bytes = URL_SAFE_NO_PAD.decode(cursor.trim()).map_err(|_| invalid())?;
    let text = String::from_utf8(bytes).map_err(|_| invalid())?;
    let (date, key) = text.split_once('\u{1f}').ok_or_else(invalid)?;
    // The date may be empty (no published date and a blank fetched date).
    if key.is_empty() {
        return Err(invalid());
    }
    Ok((date.to_string(), key.to_string()))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::db::schema::{CREATE_INDEXES, CREATE_SEARCH_INDEXES, CREATE_TABLES};

    pub(crate) fn fixture() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::search::register_search_functions(&conn).unwrap();
        conn.execute_batch(CREATE_TABLES).unwrap();
        conn.execute_batch(CREATE_INDEXES).unwrap();
        conn.execute_batch(CREATE_SEARCH_INDEXES).unwrap();
        conn.execute_batch(
            r#"
            INSERT INTO tags (name, emoji, created_at, sort_order) VALUES
              ('Tech', '💻', '2026-01-01T00:00:00.000Z', 0),
              ('Health', NULL, '2026-01-01T00:00:00.000Z', 1);
            INSERT INTO feeds (id, title, url, created_at, unread_count, article_count) VALUES
              ('f-tech', 'Tech Feed', 'https://tech.example/feed', '2026-01-01T00:00:00.000Z', 2, 3),
              ('f-health', 'Health Feed', 'https://health.example/feed', '2026-01-01T00:00:00.000Z', 1, 1),
              ('f-both', 'Both Feed', 'https://both.example/feed', '2026-01-01T00:00:00.000Z', 0, 1),
              ('f-loose', 'Loose Feed', 'https://loose.example/feed', '2026-01-01T00:00:00.000Z', 0, 1);
            INSERT INTO feed_tags (feed_id, tag_name, sort_order) VALUES
              ('f-tech', 'Tech', 0), ('f-both', 'Tech', 1), ('f-health', 'Health', 0), ('f-both', 'Health', 1);
            INSERT INTO articles (hash, feed_id, title, description, content, link, published_date, fetched_date, read, starred) VALUES
              ('t1', 'f-tech', 'Rust async deep dive', '<p>Futures explained</p>', '<p>Body one</p>', 'https://tech.example/1', '2026-10-18T10:00:00.000Z', '2026-10-18T10:05:00.000Z', 0, 1),
              ('t2', 'f-tech', 'Compilers weekly', '', '<p>Fallback summary text</p>', 'https://tech.example/2', '2026-10-17T10:00:00.000Z', '2026-10-17T10:05:00.000Z', 1, 0),
              ('t3', 'f-tech', 'Old news', 'Old', '<p>Old body</p>', 'https://tech.example/3', '2026-09-01T10:00:00.000Z', '2026-09-01T10:05:00.000Z', 0, 0),
              ('h1', 'f-health', 'Sleep study', 'Sleep more', '<p>Health body</p>', 'https://health.example/1', '2026-10-18T09:00:00.000Z', '2026-10-18T09:05:00.000Z', 0, 0),
              ('b1', 'f-both', 'Shared story', 'Cross-posted', '<p>Both body</p>', 'https://both.example/1', '2026-10-18T08:00:00.000Z', '2026-10-18T08:05:00.000Z', 0, 0),
              ('l1', 'f-loose', 'Loose item', 'No station', '<p>Loose body</p>', 'https://loose.example/1', '2026-10-18T07:00:00.000Z', '2026-10-18T07:05:00.000Z', 0, 0);
            INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
              SELECT feed_id, hash, published_date, fetched_date FROM articles;
            -- 'b1' also appears in the Tech feed (same story in two feeds).
            INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
              VALUES ('f-tech', 'b1', '2026-10-18T08:00:00.000Z', '2026-10-18T08:05:00.000Z');
            INSERT INTO saved_articles (id, article_hash, title, description, content, link, saved_date, feed_title, highlights_json, notes) VALUES
              ('s1', 't1', 'Rust async deep dive', 'Futures explained', '<p>Saved body</p>', 'https://tech.example/1', '2026-10-18T12:00:00.000Z', 'Tech Feed', '[{"id":"x","text":"Pin matters"}]', 'Re-read section 2'),
              ('s2', 'h1', 'Sleep study', 'Sleep more', '<p>Saved health</p>', 'https://health.example/1', '2026-10-10T12:00:00.000Z', 'Health Feed', '[]', NULL);
            "#,
        )
        .unwrap();
        conn
    }

    fn tech_only() -> Exposure {
        Exposure {
            stations: Some(vec!["Tech".into()]),
            include_unstationed: false,
        }
    }

    fn list(conn: &Connection, exposure: &Exposure, scope: ArticleScope) -> Vec<String> {
        list_articles(
            conn,
            exposure,
            &ListArticlesRequest { scope: &scope, since: None, until: None, search: None, cursor: None, limit: 50 },
        )
        .unwrap()
        .items
        .into_iter()
        .map(|row| row.hash)
        .collect()
    }

    #[test]
    fn stations_respect_sharing() {
        let conn = fixture();
        let all = list_stations(&conn, &Exposure::everything()).unwrap();
        assert_eq!(all.iter().map(|row| row.name.as_str()).collect::<Vec<_>>(), vec!["Tech", "Health"]);
        assert_eq!(all[0].feed_count, 2);
        assert_eq!(all[0].unread_count, 2);
        let tech = list_stations(&conn, &tech_only()).unwrap();
        assert_eq!(tech.len(), 1);
        assert!(!station_exists(&conn, &tech_only(), "Health").unwrap());
    }

    #[test]
    fn feeds_hide_unshared_stations_and_unstationed_feeds() {
        let conn = fixture();
        let feeds = list_feeds(&conn, &tech_only(), None).unwrap();
        let ids: Vec<_> = feeds.iter().map(|feed| feed.id.as_str()).collect();
        assert_eq!(ids, vec!["f-both", "f-tech"]);
        // f-both is in Health too, but only shared station names are listed.
        assert_eq!(feeds[0].stations, vec!["Tech".to_string()]);

        let with_loose = Exposure { include_unstationed: true, ..tech_only() };
        assert!(list_feeds(&conn, &with_loose, None).unwrap().iter().any(|feed| feed.id == "f-loose"));
        assert!(feed_is_exposed(&conn, &with_loose, "f-loose").unwrap());
        assert!(!feed_is_exposed(&conn, &tech_only(), "f-health").unwrap());
    }

    #[test]
    fn station_scope_dedupes_cross_posted_articles_and_orders_by_date() {
        let conn = fixture();
        let hashes = list(&conn, &Exposure::everything(), ArticleScope::Station("Tech".into()));
        assert_eq!(hashes, vec!["t1", "b1", "t2", "t3"]);
    }

    #[test]
    fn hidden_station_articles_never_leak() {
        let conn = fixture();
        let exposure = tech_only();
        let all = list(&conn, &exposure, ArticleScope::All);
        assert!(!all.contains(&"h1".to_string()));
        assert!(!all.contains(&"l1".to_string()));
        // Cross-posted article is visible because one of its feeds is shared.
        assert!(all.contains(&"b1".to_string()));
        assert!(get_article(&conn, &exposure, "h1").unwrap().is_none());
        assert!(get_article(&conn, &exposure, "t1").unwrap().is_some());
        let search = list_articles(
            &conn,
            &exposure,
            &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: Some("sleep"), cursor: None, limit: 10 },
        )
        .unwrap();
        assert!(search.items.is_empty());
        // The unfiltered path (current article) still reads it.
        let current = get_article_unfiltered(&conn, &exposure, "h1").unwrap().unwrap();
        assert!(current.stations.is_empty(), "hidden station names stay hidden");
        // Station names of a cross-posted article are filtered too.
        assert_eq!(get_article(&conn, &exposure, "b1").unwrap().unwrap().stations, vec!["Tech".to_string()]);
    }

    #[test]
    fn cross_posted_articles_name_a_shared_feed() {
        let conn = fixture();
        // 'h2' belongs to the hidden Health feed and is cross-posted to Tech.
        conn.execute_batch(
            "INSERT INTO articles (hash, feed_id, title, description, content, published_date, fetched_date)
               VALUES ('h2', 'f-health', 'Cross story', '', '<p>x</p>', '2026-10-18T11:00:00.000Z', '2026-10-18T11:00:00.000Z');
             INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date) VALUES
               ('f-health', 'h2', '2026-10-18T11:00:00.000Z', '2026-10-18T11:00:00.000Z'),
               ('f-tech', 'h2', '2026-10-18T11:00:00.000Z', '2026-10-18T11:00:00.000Z');",
        )
        .unwrap();
        let exposure = tech_only();
        let page = list_articles(
            &conn,
            &exposure,
            &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: None, cursor: None, limit: 50 },
        )
        .unwrap();
        let row = page.items.iter().find(|row| row.hash == "h2").unwrap();
        assert_eq!(row.feed_id, "f-tech");
        assert_eq!(row.feed_title.as_deref(), Some("Tech Feed"));
        let article = get_article(&conn, &exposure, "h2").unwrap().unwrap();
        assert_eq!(article.feed_id, "f-tech");
        assert_eq!(article.feed_title.as_deref(), Some("Tech Feed"));
    }

    #[test]
    fn time_range_and_flags_filter() {
        let conn = fixture();
        let page = list_articles(
            &conn,
            &Exposure::everything(),
            &ListArticlesRequest {
                scope: &ArticleScope::Feed("f-tech".into()),
                since: Some("2026-10-17T00:00:00.000Z"),
                until: Some("2026-10-18T00:00:00.000Z"),
                search: None,
                cursor: None,
                limit: 10,
            },
        )
        .unwrap();
        assert_eq!(page.items.iter().map(|row| row.hash.as_str()).collect::<Vec<_>>(), vec!["t2"]);
        assert_eq!(page.items[0].summary, "Fallback summary text");

        assert_eq!(list(&conn, &Exposure::everything(), ArticleScope::Starred), vec!["t1"]);
        let unread = list(&conn, &Exposure::everything(), ArticleScope::Unread);
        assert!(!unread.contains(&"t2".to_string()));
        assert!(unread.contains(&"t1".to_string()));
    }

    #[test]
    fn keyset_paging_walks_every_row_once() {
        let conn = fixture();
        let mut cursor: Option<String> = None;
        let mut seen = Vec::new();
        loop {
            let page = list_articles(
                &conn,
                &Exposure::everything(),
                &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: None, cursor: cursor.as_deref(), limit: 2 },
            )
            .unwrap();
            seen.extend(page.items.into_iter().map(|row| row.hash));
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        assert_eq!(seen, vec!["t1", "h1", "b1", "l1", "t2", "t3"]);
        assert!(decode_cursor("not-a-cursor").is_err());
    }

    #[test]
    fn search_treats_operator_words_as_literals() {
        let conn = fixture();
        let page = list_articles(
            &conn,
            &Exposure::everything(),
            &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: Some("rust AND"), cursor: None, limit: 10 },
        );
        assert!(page.is_ok());
        let page = list_articles(
            &conn,
            &Exposure::everything(),
            &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: Some("rust"), cursor: None, limit: 10 },
        )
        .unwrap();
        assert_eq!(page.items.iter().map(|row| row.hash.as_str()).collect::<Vec<_>>(), vec!["t1"]);
    }

    #[test]
    fn search_finds_article_and_saved_body_text() {
        let conn = fixture();
        let hashes = |search: &str| {
            list_articles(
                &conn,
                &Exposure::everything(),
                &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: Some(search), cursor: None, limit: 10 },
            )
            .unwrap()
            .items
            .into_iter()
            .map(|row| row.hash)
            .collect::<Vec<_>>()
        };
        assert_eq!(hashes("fallback"), vec!["t2"], "body-only word");
        let tech = list_articles(
            &conn,
            &tech_only(),
            &ListArticlesRequest { scope: &ArticleScope::All, since: None, until: None, search: Some("body"), cursor: None, limit: 10 },
        )
        .unwrap();
        assert_eq!(
            tech.items.iter().map(|row| row.hash.as_str()).collect::<Vec<_>>(),
            vec!["t1", "b1", "t3"],
            "exposure scope still applies to body matches"
        );
        let saved = list_saved(&conn, None, None, Some("health"), None, 10).unwrap();
        assert_eq!(saved.items.iter().map(|row| row.id.as_str()).collect::<Vec<_>>(), vec!["s2"]);
    }

    #[test]
    fn saved_list_and_detail() {
        let conn = fixture();
        let page = list_saved(&conn, Some("2026-10-15T00:00:00.000Z"), None, None, None, 10).unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].highlight_count, 1);
        assert!(page.items[0].has_notes);
        let saved = get_saved(&conn, "s1").unwrap().unwrap();
        assert_eq!(saved.notes.as_deref(), Some("Re-read section 2"));
        assert_eq!(saved.highlights.len(), 1);
        assert!(get_saved_by_article_hash(&conn, "h1").unwrap().is_some());
        let search = list_saved(&conn, None, None, Some("sleep"), None, 10).unwrap();
        assert_eq!(search.items[0].id, "s2");
    }
}

