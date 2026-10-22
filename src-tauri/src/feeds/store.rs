use crate::db::{
    insert_articles_batch, sync_feed_article_counts_batch, update_feed, FeedUpdate,
    ArticleRecord,
};
use crate::feeds::convert::{convert_feed_items_to_articles, ConvertContext};
use crate::feeds::frequency::compute_frequency_from_dates;
use crate::feeds::mute::{compile_saved_rules, CompiledMuteRules};
use crate::feeds::parse::parse_feed_preview;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::State;

use crate::db::{with_savepoint, DbState};
use crate::diagnostics::robustness::{record, RobustnessCounter};
use crate::settings::SettingsState;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreParsedFeedRequest {
    pub feed_id: String,
    pub feed_url: String,
    pub raw_text: String,
    pub feed_title: Option<String>,
    pub feed_favicon: Option<String>,
    pub feed_favicon_has_transparency: Option<bool>,
    pub feed_favicon_bg_light: Option<String>,
    pub feed_favicon_bg_dark: Option<String>,
    pub feed_image: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub last_fetched: Option<String>,
    pub previous_update_frequency_score: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StoreParsedFeedResponse {
    pub feed_id: String,
    pub inserted_count: i64,
    pub parsed_item_count: usize,
    pub update_frequency_score: Option<f64>,
    pub unread_count: i64,
    pub article_count: i64,
    pub consecutive_failures: i64,
    pub parser_path: String,
    pub parity_gaps: Vec<String>,
}

/// Parsed + converted feed content, ready for the writer. Produced off the
/// writer lock so XML parsing (bodies up to 32 MB) never queues UI writes.
#[derive(Debug, Clone)]
struct PreparedFeedStore {
    feed_id: String,
    articles: Vec<ArticleRecord>,
    parsed_item_count: usize,
    parser_path: String,
    parity_gaps: Vec<String>,
    update_frequency_score: Option<f64>,
    last_fetched: String,
    etag: Option<String>,
    last_modified: Option<String>,
}

/// Pure step: parse and convert without touching the database. Mute rules
/// (compiled once per cycle) mark matching new articles read here, off the
/// writer lock; `INSERT OR IGNORE` keeps existing rows untouched.
fn prepare_parsed_feed_content(
    request: StoreParsedFeedRequest,
    mute_rules: Option<&CompiledMuteRules>,
) -> Result<PreparedFeedStore, String> {
    let preview = parse_feed_preview(request.raw_text, request.feed_url.clone())?;
    let fetch_time = request
        .last_fetched
        .as_deref()
        .and_then(parse_timestamp)
        .unwrap_or_else(Utc::now);

    let context = ConvertContext {
        feed_id: &request.feed_id,
        feed_url: &request.feed_url,
        feed_title: request.feed_title.as_deref(),
        feed_favicon: request.feed_favicon.as_deref(),
        feed_favicon_has_transparency: request.feed_favicon_has_transparency,
        feed_favicon_bg_light: request.feed_favicon_bg_light.as_deref(),
        feed_favicon_bg_dark: request.feed_favicon_bg_dark.as_deref(),
        feed_image: request.feed_image.as_deref(),
        fetch_time,
    };

    let mut articles = convert_feed_items_to_articles(&preview.items, &context);
    if let Some(rules) = mute_rules {
        rules.apply_to_new_articles(&request.feed_id, &mut articles);
    }
    let update_frequency_score = derive_update_frequency_score(
        &articles,
        request.previous_update_frequency_score,
    );

    Ok(PreparedFeedStore {
        feed_id: request.feed_id,
        articles,
        parsed_item_count: preview.item_count,
        parser_path: preview.parser_path,
        parity_gaps: preview.parity_gaps,
        update_frequency_score,
        last_fetched: fetch_time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        etag: request.etag,
        last_modified: request.last_modified,
    })
}

/// Writer step: article inserts, feed metadata (etag/last_modified) and count
/// sync commit together in ONE transaction, so a failure can never leave
/// articles without counts or — worse — an advanced etag without articles
/// (the next conditional GET would 304 and the items would be lost).
fn write_prepared_feed_content(
    connection: &Connection,
    prepared: PreparedFeedStore,
) -> Result<StoreParsedFeedResponse, String> {
    let PreparedFeedStore {
        feed_id,
        articles,
        parsed_item_count,
        parser_path,
        parity_gaps,
        update_frequency_score,
        last_fetched,
        etag,
        last_modified,
    } = prepared;

    let result = with_savepoint(connection, "store_parsed_feed", |connection| {
        // Articles first, then etag: order is kept inside the transaction too.
        let inserted_count = if articles.is_empty() {
            0
        } else {
            insert_articles_batch(connection, &articles)?
        };

        update_feed(
            connection,
            &feed_id,
            FeedUpdate {
                last_fetched: Some(Some(last_fetched)),
                last_failed_fetch_at: Some(None),
                consecutive_failures: Some(0),
                etag: etag.map(Some),
                last_modified_header: last_modified.map(Some),
                update_frequency_score,
                title: None,
                url: None,
                created_at: None,
                description: None,
                unread_count: None,
                article_count: None,
                tags: None,
                favicon: None,
                favicon_has_transparency: None,
                favicon_dominant_color: None,
                favicon_bg_light: None,
                favicon_bg_dark: None,
                favicon_fetch_failed: None,
                emoji: None,
                image: None,
                categories: None,
                language: None,
                is_podcast: None,
                podcast_metadata: None,
                reader_mode_enabled: None,
                sort_order: None,
                last_favicon_refresh: None,
            },
        )?;

        let counts = sync_feed_article_counts_batch(connection, &[feed_id.clone()])?;
        let (unread_count, article_count) = counts
            .first()
            .map(|entry| (entry.unread_count, entry.article_count))
            .unwrap_or((0, 0));
        Ok((inserted_count, unread_count, article_count))
    });

    let (inserted_count, unread_count, article_count) = match result {
        Ok(values) => values,
        Err(error) => {
            record(RobustnessCounter::StoreTransactionRollbacks);
            return Err(error);
        }
    };

    Ok(StoreParsedFeedResponse {
        feed_id,
        inserted_count,
        parsed_item_count,
        update_frequency_score,
        unread_count,
        article_count,
        consecutive_failures: 0,
        parser_path,
        parity_gaps,
    })
}

/// Parses on the blocking pool without the writer lock, then takes the writer
/// only for the short per-feed transaction. Parse errors never touch the
/// writer, and concurrent cycle feeds parse in parallel instead of
/// serializing on the writer mutex.
pub async fn store_parsed_feed_content(
    db: &DbState,
    request: StoreParsedFeedRequest,
    mute_rules: Option<Arc<CompiledMuteRules>>,
) -> Result<StoreParsedFeedResponse, String> {
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        prepare_parsed_feed_content(request, mute_rules.as_deref())
    })
    .await
    .map_err(|error| format!("Feed parse task failed: {error}"))??;
    db.write(move |connection| write_prepared_feed_content(connection, prepared))
        .await
}

fn derive_update_frequency_score(
    articles: &[ArticleRecord],
    previous_score: Option<f64>,
) -> Option<f64> {
    let dates = articles
        .iter()
        .filter_map(|article| article.published_date.clone())
        .collect::<Vec<_>>();
    if dates.is_empty() {
        return previous_score;
    }
    Some(compute_frequency_from_dates(&dates))
}

fn parse_timestamp(value: &str) -> Option<chrono::DateTime<Utc>> {
    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .or_else(|| value.parse::<chrono::DateTime<Utc>>().ok())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_store_parsed_content(
    request: StoreParsedFeedRequest,
    state: State<'_, DbState>,
    settings: State<'_, Arc<SettingsState>>,
) -> Result<StoreParsedFeedResponse, String> {
    let db = state.inner().clone();
    let mute_rules = compile_saved_rules(settings.inner(), &db).await;
    store_parsed_feed_content(&db, request, mute_rules).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::store_parsed_feed_content as store_parsed_feed_content_async;
    use crate::db::feeds::insert_feed;
    use crate::db::schema::CREATE_SEARCH_INDEXES;
    use crate::db::{run_migrations, FeedRecord};
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

    /// Parse + write on one connection, for repository-level assertions.
    fn store_parsed_feed_content(
        connection: &Connection,
        request: StoreParsedFeedRequest,
    ) -> Result<StoreParsedFeedResponse, String> {
        write_prepared_feed_content(connection, prepare_parsed_feed_content(request, None)?)
    }

    fn open_test_connection() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        connection
            .execute_batch(CREATE_SEARCH_INDEXES)
            .expect("create search indexes");
        connection
    }

    fn insert_test_feed(connection: &Connection, feed_id: &str, feed_url: &str) {
        insert_feed(
            connection,
            &FeedRecord {
                id: feed_id.to_string(),
                title: "Test Feed".to_string(),
                url: feed_url.to_string(),
                created_at: "2026-06-22T00:00:00.000Z".to_string(),
                description: None,
                last_fetched: None,
                last_failed_fetch_at: None,
                unread_count: 0,
                article_count: 0,
                tags: vec![],
                favicon: None,
                favicon_has_transparency: None,
                favicon_dominant_color: None,
                favicon_bg_light: None,
                favicon_bg_dark: None,
                favicon_fetch_failed: false,
                emoji: None,
                image: None,
                categories: vec![],
                language: Some("en".to_string()),
                is_podcast: false,
                podcast_metadata: None,
                reader_mode_enabled: false,
                etag: None,
                last_modified_header: None,
                sort_order: 0,
                update_frequency_score: 0.0,
                consecutive_failures: 2,
                last_favicon_refresh: None,
            },
        )
        .expect("insert feed");
    }

    fn read_fixture(name: &str) -> Option<String> {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("../test/data");
        path.push(name);
        fs::read_to_string(path).ok()
    }

    const MINIMAL_RSS: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example</title>
    <item>
      <title>First Article</title>
      <link>https://example.com/posts/first</link>
      <guid>first-guid</guid>
      <pubDate>Mon, 22 Jun 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Hello native store</p>]]></description>
    </item>
    <item>
      <title>Second Article</title>
      <link>https://example.com/posts/second</link>
      <guid>second-guid</guid>
      <pubDate>Sun, 21 Jun 2026 12:00:00 GMT</pubDate>
      <description><![CDATA[<p>Another item</p>]]></description>
    </item>
  </channel>
</rss>"#;

    #[test]
    fn stores_minimal_rss_fixture_and_updates_feed_metadata() {
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/rss.xml");

        let response = store_parsed_feed_content(
            &connection,
            StoreParsedFeedRequest {
                feed_id: "feed-1".to_string(),
                feed_url: "https://example.com/rss.xml".to_string(),
                raw_text: MINIMAL_RSS.to_string(),
                feed_title: Some("Example".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                etag: Some("etag-1".to_string()),
                last_modified: Some("Mon, 22 Jun 2026 00:00:00 GMT".to_string()),
                last_fetched: Some("2026-06-22T12:00:00.000Z".to_string()),
                previous_update_frequency_score: Some(0.1),
            },
        )
        .expect("store parsed feed");

        assert_eq!(response.feed_id, "feed-1");
        assert_eq!(response.inserted_count, 2);
        assert_eq!(response.parsed_item_count, 2);
        assert_eq!(response.unread_count, 2);
        assert_eq!(response.article_count, 2);
        assert_eq!(response.consecutive_failures, 0);
        assert_eq!(response.parser_path, "feed-rs");
        assert!(response.update_frequency_score.is_some());

        let etag: String = connection
            .query_row(
                "SELECT etag FROM feeds WHERE id = ?1",
                rusqlite::params!["feed-1"],
                |row| row.get(0),
            )
            .expect("read etag");
        assert_eq!(etag, "etag-1");
    }

    #[test]
    fn dedupes_articles_on_second_store_with_same_links() {
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/rss.xml");

        let request = StoreParsedFeedRequest {
            feed_id: "feed-1".to_string(),
            feed_url: "https://example.com/rss.xml".to_string(),
            raw_text: MINIMAL_RSS.to_string(),
            feed_title: Some("Example".to_string()),
            feed_favicon: None,
            feed_favicon_has_transparency: None,
            feed_favicon_bg_light: None,
            feed_favicon_bg_dark: None,
            feed_image: None,
            etag: None,
            last_modified: None,
            last_fetched: None,
            previous_update_frequency_score: None,
        };

        let first = store_parsed_feed_content(&connection, request.clone()).expect("first store");
        let second = store_parsed_feed_content(&connection, request).expect("second store");

        assert_eq!(first.inserted_count, 2);
        assert_eq!(second.inserted_count, 0);
        assert_eq!(second.article_count, 2);
    }

    #[test]
    fn links_shared_article_hash_across_two_feeds() {
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-a", "https://example.com/a.xml");
        insert_test_feed(&connection, "feed-b", "https://example.com/b.xml");

        let shared_link = "https://news.example.com/shared-story";
        let rss_for = |_feed_url: &str| {
            format!(
                r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Feed</title>
      <item>
        <title>Shared Story</title>
        <link>{shared_link}</link>
        <guid>shared-guid</guid>
        <pubDate>Mon, 22 Jun 2026 12:00:00 GMT</pubDate>
        <description><![CDATA[<p>Shared body</p>]]></description>
      </item>
    </channel></rss>"#
            )
        };

        store_parsed_feed_content(
            &connection,
            StoreParsedFeedRequest {
                feed_id: "feed-a".to_string(),
                feed_url: "https://example.com/a.xml".to_string(),
                raw_text: rss_for("https://example.com/a.xml"),
                feed_title: Some("Feed A".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                etag: None,
                last_modified: None,
                last_fetched: None,
                previous_update_frequency_score: None,
            },
        )
        .expect("store feed a");

        let second = store_parsed_feed_content(
            &connection,
            StoreParsedFeedRequest {
                feed_id: "feed-b".to_string(),
                feed_url: "https://example.com/b.xml".to_string(),
                raw_text: rss_for("https://example.com/b.xml"),
                feed_title: Some("Feed B".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                etag: None,
                last_modified: None,
                last_fetched: None,
                previous_update_frequency_score: None,
            },
        )
        .expect("store feed b");

        assert_eq!(second.inserted_count, 1);

        let mapping_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM article_feed_items WHERE article_hash IN (
                    SELECT hash FROM articles WHERE link = ?1
                 )",
                rusqlite::params![shared_link],
                |row| row.get(0),
            )
            .expect("count mappings");
        assert_eq!(mapping_count, 2);
    }

    fn minimal_request(feed_id: &str, etag: Option<&str>) -> StoreParsedFeedRequest {
        StoreParsedFeedRequest {
            feed_id: feed_id.to_string(),
            feed_url: "https://example.com/rss.xml".to_string(),
            raw_text: MINIMAL_RSS.to_string(),
            feed_title: Some("Example".to_string()),
            feed_favicon: None,
            feed_favicon_has_transparency: None,
            feed_favicon_bg_light: None,
            feed_favicon_bg_dark: None,
            feed_image: None,
            etag: etag.map(str::to_string),
            last_modified: Some("Mon, 22 Jun 2026 00:00:00 GMT".to_string()),
            last_fetched: Some("2026-06-22T12:00:00.000Z".to_string()),
            previous_update_frequency_score: None,
        }
    }

    fn read_feed_state(connection: &Connection, feed_id: &str) -> (Option<String>, i64, i64) {
        connection
            .query_row(
                "SELECT etag, consecutive_failures, \
                 (SELECT COUNT(*) FROM articles) + (SELECT COUNT(*) FROM article_feed_items) \
                 FROM feeds WHERE id = ?1",
                rusqlite::params![feed_id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("read feed state")
    }

    #[test]
    fn failure_after_inserts_rolls_back_articles_and_etag_together() {
        use crate::diagnostics::robustness::snapshot;
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/rss.xml");
        connection
            .execute("UPDATE feeds SET etag = 'etag-old' WHERE id = 'feed-1'", [])
            .expect("seed etag");
        // Inject a failure at the last step (count sync), after the article
        // inserts and the etag/last_modified update already ran.
        connection
            .execute_batch(
                "CREATE TRIGGER inject_count_failure BEFORE UPDATE OF unread_count ON feeds \
                 BEGIN SELECT RAISE(ABORT, 'injected count failure'); END;",
            )
            .expect("install failure trigger");

        let before = snapshot().store_transaction_rollbacks;
        let error = store_parsed_feed_content(&connection, minimal_request("feed-1", Some("etag-new")))
            .expect_err("injected failure must surface");
        assert!(error.contains("injected count failure"), "{error}");
        assert!(snapshot().store_transaction_rollbacks > before);

        let (etag, consecutive_failures, stored_rows) = read_feed_state(&connection, "feed-1");
        assert_eq!(etag.as_deref(), Some("etag-old"), "etag must not advance without articles");
        assert_eq!(consecutive_failures, 2, "feed update must roll back too");
        assert_eq!(stored_rows, 0, "no articles or mappings may survive the rollback");
        assert!(connection.is_autocommit(), "rollback must close the transaction");

        connection
            .execute_batch("DROP TRIGGER inject_count_failure")
            .expect("drop failure trigger");
        let response = store_parsed_feed_content(&connection, minimal_request("feed-1", Some("etag-new")))
            .expect("store succeeds after the failure is removed");
        assert_eq!(response.inserted_count, 2);
    }

    #[test]
    fn successful_store_commits_articles_and_etag_together() {
        let path = std::env::temp_dir().join(format!(
            "kiji-store-commit-{}-{}.db",
            std::process::id(),
            chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        {
            let mut writer = Connection::open(&path).expect("open file database");
            run_migrations(&mut writer).expect("run migrations");
            insert_test_feed(&writer, "feed-1", "https://example.com/rss.xml");
            let response =
                store_parsed_feed_content(&writer, minimal_request("feed-1", Some("etag-1")))
                    .expect("store parsed feed");
            assert_eq!(response.inserted_count, 2);
            assert!(writer.is_autocommit(), "store must commit, not leave a transaction open");

            // A second connection only sees committed data.
            let observer = Connection::open(&path).expect("open observer");
            let (etag, consecutive_failures, stored_rows) = read_feed_state(&observer, "feed-1");
            assert_eq!(etag.as_deref(), Some("etag-1"));
            assert_eq!(consecutive_failures, 0);
            assert_eq!(stored_rows, 4, "2 articles + 2 mappings committed with the etag");
        }
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let _ = fs::remove_file(format!("{}{suffix}", path.display()));
        }
    }

    #[test]
    fn parse_error_returns_without_taking_the_writer() {
        let mut writer = Connection::open_in_memory().expect("open writer");
        run_migrations(&mut writer).expect("run migrations");
        let db = DbState::for_tests(writer);

        // Hold the writer for the whole call, as a long store or VACUUM would.
        let (locked_tx, locked_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel::<()>();
        let holder_db = db.clone();
        let holder = std::thread::spawn(move || {
            holder_db
                .with_writer(|_| {
                    locked_tx.send(()).expect("announce writer held");
                    let _ = release_rx.recv();
                    Ok(())
                })
                .expect("hold writer");
        });
        locked_rx.recv().expect("writer held");

        let (result_tx, result_rx) = std::sync::mpsc::channel();
        let store_db = db.clone();
        std::thread::spawn(move || {
            let mut request = minimal_request("feed-1", Some("etag-1"));
            request.raw_text = "this is not a feed".to_string();
            let result = tauri::async_runtime::block_on(store_parsed_feed_content_async(
                &store_db, request, None,
            ));
            let _ = result_tx.send(result);
        });

        let outcome = result_rx.recv_timeout(std::time::Duration::from_secs(5));
        release_tx.send(()).expect("release writer");
        holder.join().expect("join writer holder");
        let result = outcome.expect("parse error must not wait for the writer");
        assert!(result.is_err(), "invalid XML must fail to parse");
    }

    #[test]
    fn stores_real_rss_fixture_when_present() {
        let Some(raw) = read_fixture("caminodetexas.xml") else {
            return;
        };
        let connection = open_test_connection();
        insert_test_feed(
            &connection,
            "feed-texas",
            "https://caminodetexas.substack.com/feed",
        );

        let response = store_parsed_feed_content(
            &connection,
            StoreParsedFeedRequest {
                feed_id: "feed-texas".to_string(),
                feed_url: "https://caminodetexas.substack.com/feed".to_string(),
                raw_text: raw,
                feed_title: Some("CaminodeTexas".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                etag: None,
                last_modified: None,
                last_fetched: None,
                previous_update_frequency_score: None,
            },
        )
        .expect("store fixture feed");

        assert!(response.parsed_item_count > 0);
        assert_eq!(response.inserted_count, response.parsed_item_count as i64);
        assert_eq!(response.article_count, response.inserted_count);
    }

    fn mute_rule(id: &str, text: &str, scope: crate::feeds::mute::MuteRuleScope) -> crate::feeds::MuteRule {
        crate::feeds::MuteRule {
            id: id.to_string(),
            text: text.to_string(),
            match_description: false,
            scope,
            action: crate::feeds::mute::MuteRuleAction::MarkRead,
        }
    }

    fn read_flags(connection: &Connection) -> Vec<(String, i64)> {
        let mut statement = connection
            .prepare("SELECT title, read FROM articles ORDER BY title")
            .unwrap();
        statement
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn mute_rules_mark_new_matching_articles_read_at_store_time() {
        use crate::feeds::mute::MuteRuleScope;
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/feed.xml");
        let rules = CompiledMuteRules::compile_with_connection(
            &connection,
            &[mute_rule("1", "first", MuteRuleScope::All)],
        )
        .unwrap();

        let response = write_prepared_feed_content(
            &connection,
            prepare_parsed_feed_content(minimal_request("feed-1", None), Some(&rules)).unwrap(),
        )
        .unwrap();

        assert_eq!(response.inserted_count, 2);
        assert_eq!(response.unread_count, 1);
        assert_eq!(
            read_flags(&connection),
            vec![("First Article".to_string(), 1), ("Second Article".to_string(), 0)]
        );
    }

    #[test]
    fn mute_rules_scoped_to_another_feed_or_station_leave_articles_unread() {
        use crate::feeds::mute::MuteRuleScope;
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/feed.xml");
        let rules = CompiledMuteRules::compile_with_connection(
            &connection,
            &[
                mute_rule("1", "first", MuteRuleScope::Feed { id: "feed-2".to_string() }),
                mute_rule("2", "second", MuteRuleScope::Station { name: "Missing".to_string() }),
            ],
        )
        .unwrap();

        let response = write_prepared_feed_content(
            &connection,
            prepare_parsed_feed_content(minimal_request("feed-1", None), Some(&rules)).unwrap(),
        )
        .unwrap();
        assert_eq!(response.unread_count, 2);
    }

    #[test]
    fn mute_rules_do_not_touch_existing_articles_on_restore_but_apply_to_existing_does() {
        use crate::feeds::mute::{apply_mute_rules_to_existing, MuteRuleScope};
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/feed.xml");
        store_parsed_feed_content(&connection, minimal_request("feed-1", None)).unwrap();

        // Rule added later: a re-store of the same items does not mark them read.
        let rules = CompiledMuteRules::compile_with_connection(
            &connection,
            &[mute_rule("1", "second", MuteRuleScope::All)],
        )
        .unwrap();
        let response = write_prepared_feed_content(
            &connection,
            prepare_parsed_feed_content(minimal_request("feed-1", None), Some(&rules)).unwrap(),
        )
        .unwrap();
        assert_eq!(response.unread_count, 2);

        let result = apply_mute_rules_to_existing(&connection, &rules).unwrap();
        assert_eq!(result.marked_count, 1);
        assert_eq!(result.feeds.len(), 1);
        assert_eq!(result.feeds[0].feed_id, "feed-1");
        assert_eq!(result.feeds[0].unread_count, 1);
        let stored_unread: i64 = connection
            .query_row("SELECT unread_count FROM feeds WHERE id = 'feed-1'", [], |row| row.get(0))
            .unwrap();
        assert_eq!(stored_unread, 1);
        assert_eq!(
            read_flags(&connection),
            vec![("First Article".to_string(), 0), ("Second Article".to_string(), 1)]
        );

        // Running it again finds nothing new.
        assert_eq!(apply_mute_rules_to_existing(&connection, &rules).unwrap().marked_count, 0);
    }

    #[test]
    fn mute_preview_counts_matches_among_recent_articles_using_the_date_index() {
        use crate::feeds::mute::{preview_mute_rule, MuteRuleScope};
        let connection = open_test_connection();
        insert_test_feed(&connection, "feed-1", "https://example.com/feed.xml");
        store_parsed_feed_content(&connection, minimal_request("feed-1", None)).unwrap();

        let preview = preview_mute_rule(&connection, &mute_rule("1", "ARTICLE", MuteRuleScope::All)).unwrap();
        assert_eq!((preview.matched, preview.scanned), (2, 2));
        let preview = preview_mute_rule(&connection, &mute_rule("1", "first", MuteRuleScope::All)).unwrap();
        assert_eq!((preview.matched, preview.scanned), (1, 2));

        let plan: Vec<String> = connection
            .prepare(&format!("EXPLAIN QUERY PLAN {}", crate::feeds::mute::PREVIEW_SQL))
            .unwrap()
            .query_map([500], |row| row.get::<_, String>(3))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        let plan = plan.join(" | ");
        assert!(plan.contains("idx_articles_effective_date"), "{plan}");
        assert!(!plan.contains("TEMP B-TREE"), "{plan}");
    }
}
