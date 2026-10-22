//! Automatic removal of old read articles (Settings → General → "Remove old
//! read articles"). Runs natively at most once a day, after launch and while
//! KiJi keeps running in the background, in short writer batches.
//!
//! Only read, unsaved, unstarred articles whose own published date is older
//! than the cutoff are removed. Removed items that are still in a feed's XML
//! must not come back as new on the next refresh, so the cutoff of the latest
//! run is kept in a small state file beside the database (`purged_before`) and
//! the refresh store drops parsed items older than it for feeds that existed
//! when that run happened. Undated items get "now" as their date on every
//! parse, so that guard cannot catch them: they are never removed.

use chrono::{DateTime, Months, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager};

use super::{sync_feed_article_counts_batch, with_savepoint, ArticleRecord, DbState};
use crate::settings::{ArticleRetention, SettingsState};

pub const RETENTION_STATE_FILE_NAME: &str = "article-retention.json";
/// Rows removed per writer transaction; the writer is released between batches
/// so feed refreshes and user writes interleave.
pub const RETENTION_BATCH_SIZE: usize = 2_000;
const RUN_INTERVAL_HOURS: i64 = 24;
const BATCH_PAUSE: Duration = Duration::from_millis(50);
/// Let launch refresh and first list loads finish before cleanup starts.
const INITIAL_DELAY: Duration = Duration::from_secs(3 * 60);
const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);
/// Undated items are stored with `published_date` = fetch time minus a few
/// milliseconds per item; anything this close to its fetch time is treated as
/// undated and kept (see module docs).
const UNDATED_TOLERANCE_SECONDS: f64 = 10.0;
/// Pages released per run when the database uses incremental auto-vacuum.
const INCREMENTAL_VACUUM_PAGES: i64 = 4_096;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct RetentionState {
    /// Start of the latest run (once-a-day gate).
    pub last_run_at: Option<String>,
    /// Largest cutoff any run has used; the refresh store never re-adds items
    /// older than this to feeds that existed at `last_run_at`.
    pub purged_before: Option<String>,
}

pub struct RetentionStore {
    path: Option<PathBuf>,
    state: Mutex<RetentionState>,
}

impl RetentionStore {
    pub fn load(database_path: &Path) -> Self {
        let path = database_path.with_file_name(RETENTION_STATE_FILE_NAME);
        let state = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<RetentionState>(&raw).ok())
            .unwrap_or_default();
        Self {
            path: Some(path),
            state: Mutex::new(state),
        }
    }

    #[cfg(test)]
    pub fn in_memory() -> Self {
        Self {
            path: None,
            state: Mutex::new(RetentionState::default()),
        }
    }

    pub fn snapshot(&self) -> RetentionState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    /// Persists before updating memory: the file must record the cutoff
    /// before any row is removed, or a crash mid-run could let removed items
    /// come back.
    fn save(&self, next: RetentionState) -> Result<(), String> {
        if let Some(path) = &self.path {
            let raw = serde_json::to_string_pretty(&next)
                .map_err(|error| format!("Failed to serialize article retention state: {error}"))?;
            fs::write(path, raw)
                .map_err(|error| format!("Failed to write article retention state: {error}"))?;
        }
        let mut state = self
            .state
            .lock()
            .map_err(|_| "Failed to lock article retention state.".to_string())?;
        *state = next;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetentionOutcome {
    Disabled,
    NotDue,
    Ran { removed: usize },
}

fn parse_time(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|time| time.with_timezone(&Utc))
}

fn format_time(time: DateTime<Utc>) -> String {
    time.to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn is_due(state: &RetentionState, now: DateTime<Utc>) -> bool {
    match state.last_run_at.as_deref().and_then(parse_time) {
        Some(last) => now - last >= chrono::Duration::hours(RUN_INTERVAL_HOURS) || last > now,
        None => true,
    }
}

pub fn cutoff_for(retention: ArticleRetention, now: DateTime<Utc>) -> Option<String> {
    let months = retention.months()?;
    now.checked_sub_months(Months::new(months)).map(format_time)
}

/// Refresh-store guard: drops parsed items older than the latest cleanup
/// cutoff for feeds that existed when that cleanup ran, so removed items still
/// listed in the feed's XML are not re-added as unread.
pub(crate) fn drop_purged_items(
    connection: &Connection,
    state: &RetentionState,
    feed_id: &str,
    articles: Vec<ArticleRecord>,
) -> Result<Vec<ArticleRecord>, String> {
    let (Some(purged_before), Some(last_run_at)) = (
        state.purged_before.as_deref().and_then(parse_time),
        state.last_run_at.as_deref().and_then(parse_time),
    ) else {
        return Ok(articles);
    };
    let created_at = connection
        .query_row(
            "SELECT created_at FROM feeds WHERE id = ?1",
            params![feed_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|error| format!("Failed to read feed creation time: {error}"))?
        .flatten();
    // Unknown creation time counts as "existed": keeping a removed item away
    // is safer than showing it again as new.
    if created_at
        .as_deref()
        .and_then(parse_time)
        .is_some_and(|created| created >= last_run_at)
    {
        return Ok(articles);
    }
    Ok(articles
        .into_iter()
        .filter(|article| {
            article
                .published_date
                .as_deref()
                .and_then(parse_time)
                .is_none_or(|published| published >= purged_before)
        })
        .collect())
}

/// Leads with `read = 1 AND <effective date> < cutoff` so SQLite walks
/// `idx_articles_read` instead of scanning the table.
const EXPIRED_ARTICLES_SQL: &str = r#"
    SELECT hash FROM articles
    WHERE read = 1
      AND COALESCE(published_date, fetched_date) < ?1
      AND saved = 0
      AND starred = 0
      AND feed_id NOT IN ('clipboard', 'saved')
      AND julianday(fetched_date) - julianday(published_date) > ?2
      AND NOT EXISTS (
        SELECT 1 FROM saved_articles s WHERE s.article_hash = articles.hash
      )
    LIMIT ?3
"#;

/// Removes up to `limit` expired read articles in one transaction and syncs
/// the counts of the subscriptions that listed them. FTS rows follow through
/// the `articles_search_ad` trigger.
pub(crate) fn delete_expired_batch(
    connection: &Connection,
    cutoff: &str,
    limit: usize,
) -> Result<usize, String> {
    with_savepoint(connection, "article_retention_batch", |connection| {
        let hashes = {
            let mut statement = connection
                .prepare_cached(EXPIRED_ARTICLES_SQL)
                .map_err(|error| format!("Failed to prepare expired article query: {error}"))?;
            let rows = statement
                .query_map(
                    params![cutoff, UNDATED_TOLERANCE_SECONDS / 86_400.0, limit as i64],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|error| format!("Failed to query expired articles: {error}"))?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Failed to read expired article: {error}"))?
        };
        if hashes.is_empty() {
            return Ok(0);
        }

        let mut feed_ids = BTreeSet::new();
        {
            let mut delete_mappings = connection
                .prepare_cached(
                    "DELETE FROM article_feed_items WHERE article_hash = ?1 RETURNING feed_id",
                )
                .map_err(|error| format!("Failed to prepare mapping cleanup: {error}"))?;
            let mut delete_article = connection
                .prepare_cached("DELETE FROM articles WHERE hash = ?1")
                .map_err(|error| format!("Failed to prepare article cleanup: {error}"))?;
            for hash in &hashes {
                let rows = delete_mappings
                    .query_map(params![hash], |row| row.get::<_, String>(0))
                    .map_err(|error| format!("Failed to remove article mappings: {error}"))?;
                for feed_id in rows {
                    feed_ids.insert(
                        feed_id.map_err(|error| format!("Failed to read mapping feed: {error}"))?,
                    );
                }
                delete_article
                    .execute(params![hash])
                    .map_err(|error| format!("Failed to remove expired article: {error}"))?;
            }
        }

        let feed_ids = feed_ids.into_iter().collect::<Vec<_>>();
        sync_feed_article_counts_batch(connection, &feed_ids)?;
        Ok(hashes.len())
    })
}

/// Cheap follow-up only: never a full VACUUM. `incremental_vacuum` does
/// nothing unless the file was created with `auto_vacuum = INCREMENTAL`.
fn finish_maintenance(connection: &Connection) -> Result<(), String> {
    let auto_vacuum = connection
        .query_row("PRAGMA auto_vacuum", [], |row| row.get::<_, i64>(0))
        .map_err(|error| format!("Failed to read auto_vacuum mode: {error}"))?;
    if auto_vacuum == 2 {
        connection
            .execute_batch(&format!("PRAGMA incremental_vacuum({INCREMENTAL_VACUUM_PAGES})"))
            .map_err(|error| format!("Failed to run incremental vacuum: {error}"))?;
    }
    connection
        .execute_batch("PRAGMA optimize")
        .map_err(|error| format!("Failed to optimize database: {error}"))
}

/// Blocking: call from a blocking thread. Takes the writer once per batch.
pub fn run_retention(
    db: &DbState,
    retention: ArticleRetention,
    now: DateTime<Utc>,
) -> Result<RetentionOutcome, String> {
    let Some(cutoff) = cutoff_for(retention, now) else {
        return Ok(RetentionOutcome::Disabled);
    };
    let store = db.retention();
    let previous = store.snapshot();
    if !is_due(&previous, now) {
        return Ok(RetentionOutcome::NotDue);
    }

    let purged_before = match previous.purged_before.as_deref().and_then(parse_time) {
        Some(previous_cutoff) if parse_time(&cutoff).is_some_and(|next| next < previous_cutoff) => {
            format_time(previous_cutoff)
        }
        _ => cutoff.clone(),
    };
    store.save(RetentionState {
        last_run_at: Some(format_time(now)),
        purged_before: Some(purged_before),
    })?;

    let mut removed = 0;
    loop {
        let batch = db.with_writer(|connection| {
            delete_expired_batch(connection, &cutoff, RETENTION_BATCH_SIZE)
        })?;
        removed += batch;
        if batch < RETENTION_BATCH_SIZE {
            break;
        }
        std::thread::sleep(BATCH_PAUSE);
    }
    if removed > 0 {
        db.with_writer(finish_maintenance)?;
    }
    Ok(RetentionOutcome::Ran { removed })
}

/// One long-lived hourly check for the whole process (launch + background
/// mode); the once-a-day gate decides whether a check actually runs.
pub fn spawn_retention_loop(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(INITIAL_DELAY).await;
        loop {
            let retention = app
                .try_state::<std::sync::Arc<SettingsState>>()
                .and_then(|settings| settings.snapshot().ok())
                .map(|settings| settings.article_retention)
                .unwrap_or_default();
            if let Some(db) = app.try_state::<DbState>().map(|state| state.inner().clone()) {
                let result = tauri::async_runtime::spawn_blocking(move || {
                    run_retention(&db, retention, Utc::now())
                })
                .await;
                match result {
                    Ok(Ok(RetentionOutcome::Ran { removed })) if removed > 0 => {
                        eprintln!("[KiJi] Removed {removed} old read articles");
                    }
                    Ok(Err(error)) => eprintln!("[KiJi] Article cleanup failed: {error}"),
                    Err(error) => eprintln!("[KiJi] Article cleanup task failed: {error}"),
                    _ => {}
                }
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{insert_articles_batch, run_migrations};
    use crate::db::schema::CREATE_SEARCH_INDEXES;

    fn open_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        connection
            .execute_batch(CREATE_SEARCH_INDEXES)
            .expect("create search indexes");
        connection
            .execute(
                "INSERT INTO feeds (id, title, url, created_at) VALUES ('f1', 'Feed', 'https://example.com/rss', '2025-01-01T00:00:00.000Z')",
                [],
            )
            .expect("insert feed");
        connection
    }

    fn record(hash: &str, published: &str, read: bool) -> ArticleRecord {
        ArticleRecord {
            hash: hash.to_string(),
            feed_id: "f1".to_string(),
            title: format!("Title {hash}"),
            description: String::new(),
            content: String::new(),
            link: None,
            author: None,
            published_date: Some(published.to_string()),
            fetched_date: "2026-10-01T00:00:00.000Z".to_string(),
            read,
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

    fn count(connection: &Connection, sql: &str) -> i64 {
        connection.query_row(sql, [], |row| row.get(0)).expect("count")
    }

    fn now() -> DateTime<Utc> {
        parse_time("2026-10-22T12:00:00.000Z").unwrap()
    }

    #[test]
    fn removes_only_old_read_unsaved_unstarred_dated_articles() {
        let connection = open_connection();
        let mut starred = record("old-starred", "2026-01-01T00:00:00.000Z", true);
        starred.starred = true;
        let mut saved = record("old-saved", "2026-01-01T00:00:00.000Z", true);
        saved.saved = true;
        let mut undated = record("old-undated", "2026-01-01T00:00:00.000Z", true);
        undated.fetched_date = "2026-01-01T00:00:00.050Z".to_string();
        insert_articles_batch(
            &connection,
            &[
                record("old-read", "2026-01-01T00:00:00.000Z", true),
                record("old-unread", "2026-01-01T00:00:00.000Z", false),
                record("recent-read", "2026-10-01T00:00:00.000Z", true),
                starred,
                saved,
                undated,
            ],
        )
        .expect("insert");
        connection
            .execute("UPDATE feeds SET article_count = 6, unread_count = 1 WHERE id = 'f1'", [])
            .expect("seed counts");

        let cutoff = cutoff_for(ArticleRetention::ThreeMonths, now()).unwrap();
        assert_eq!(delete_expired_batch(&connection, &cutoff, 100).unwrap(), 1);

        let mut statement = connection.prepare("SELECT hash FROM articles ORDER BY hash").unwrap();
        let left = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            left,
            ["old-saved", "old-starred", "old-undated", "old-unread", "recent-read"]
        );
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM article_feed_items"), 5);
        assert_eq!(count(&connection, "SELECT COUNT(*) FROM articles_search"), 5);
        assert_eq!(count(&connection, "SELECT article_count FROM feeds WHERE id = 'f1'"), 5);
        assert_eq!(count(&connection, "SELECT unread_count FROM feeds WHERE id = 'f1'"), 1);
    }

    #[test]
    fn batched_run_removes_everything_past_the_cutoff_and_respects_it() {
        let connection = open_connection();
        let total = RETENTION_BATCH_SIZE * 2 + 7;
        let articles = (0..total)
            .map(|index| record(&format!("old-{index}"), "2026-01-01T00:00:00.000Z", true))
            .chain(std::iter::once(record("edge", "2026-07-23T00:00:00.000Z", true)))
            .collect::<Vec<_>>();
        insert_articles_batch(&connection, &articles).expect("insert");
        let db = DbState::for_tests(connection);

        let outcome = run_retention(&db, ArticleRetention::ThreeMonths, now()).unwrap();
        assert_eq!(outcome, RetentionOutcome::Ran { removed: total });
        db.with_writer(|connection| {
            assert_eq!(count(connection, "SELECT COUNT(*) FROM articles"), 1);
            assert_eq!(count(connection, "SELECT article_count FROM feeds WHERE id = 'f1'"), 1);
            Ok(())
        })
        .unwrap();
    }

    #[test]
    fn runs_at_most_once_a_day_and_never_when_disabled() {
        let db = DbState::for_tests(open_connection());
        assert_eq!(
            run_retention(&db, ArticleRetention::Never, now()).unwrap(),
            RetentionOutcome::Disabled
        );
        assert_eq!(db.retention().snapshot(), RetentionState::default());

        assert!(matches!(
            run_retention(&db, ArticleRetention::OneMonth, now()).unwrap(),
            RetentionOutcome::Ran { .. }
        ));
        let later = now() + chrono::Duration::hours(23);
        assert_eq!(
            run_retention(&db, ArticleRetention::OneMonth, later).unwrap(),
            RetentionOutcome::NotDue
        );
        let next_day = now() + chrono::Duration::hours(24);
        assert!(matches!(
            run_retention(&db, ArticleRetention::OneMonth, next_day).unwrap(),
            RetentionOutcome::Ran { .. }
        ));
    }

    #[test]
    fn purged_before_never_moves_back_when_retention_gets_longer() {
        let db = DbState::for_tests(open_connection());
        run_retention(&db, ArticleRetention::OneMonth, now()).unwrap();
        let next_day = now() + chrono::Duration::days(1);
        run_retention(&db, ArticleRetention::OneYear, next_day).unwrap();
        assert_eq!(
            db.retention().snapshot().purged_before.as_deref(),
            Some("2026-09-22T12:00:00.000Z")
        );
    }

    #[test]
    fn guard_keeps_items_for_feeds_added_after_the_last_run() {
        let connection = open_connection();
        connection
            .execute(
                "INSERT INTO feeds (id, title, url, created_at) VALUES ('new', 'New', 'https://example.com/new', '2026-10-23T00:00:00.000Z')",
                [],
            )
            .unwrap();
        let state = RetentionState {
            last_run_at: Some("2026-10-22T12:00:00.000Z".to_string()),
            purged_before: Some("2026-07-22T12:00:00.000Z".to_string()),
        };
        let items = vec![record("old", "2026-01-01T00:00:00.000Z", false)];
        assert_eq!(drop_purged_items(&connection, &state, "new", items.clone()).unwrap().len(), 1);
        assert!(drop_purged_items(&connection, &state, "f1", items).unwrap().is_empty());
    }

    #[test]
    fn expired_query_walks_the_read_date_index() {
        let connection = open_connection();
        let plan = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {EXPIRED_ARTICLES_SQL}"))
            .unwrap()
            .query_map(params!["2026-01-01", 0.0, 10], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
            .join("\n");
        assert!(plan.contains("idx_articles_read"), "{plan}");
    }
}
