use crate::db::{
    insert_articles_batch, sync_feed_article_counts_batch, update_feed, FeedUpdate,
    ArticleRecord,
};
use crate::feeds::convert::{convert_feed_items_to_articles, ConvertContext};
use crate::feeds::frequency::compute_frequency_from_dates;
use crate::feeds::parse::parse_feed_preview;
use chrono::Utc;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;

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

pub fn store_parsed_feed_content(
    connection: &Connection,
    request: StoreParsedFeedRequest,
) -> Result<StoreParsedFeedResponse, String> {
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

    let articles = convert_feed_items_to_articles(&preview.items, &context);
    let inserted_count = if articles.is_empty() {
        0
    } else {
        insert_articles_batch(connection, &articles)?
    };

    let update_frequency_score = derive_update_frequency_score(
        &articles,
        request.previous_update_frequency_score,
    );

    let last_fetched = fetch_time.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    update_feed(
        connection,
        &request.feed_id,
        FeedUpdate {
            last_fetched: Some(Some(last_fetched)),
            last_failed_fetch_at: Some(None),
            consecutive_failures: Some(0),
            etag: request.etag.map(Some),
            last_modified_header: request.last_modified.map(Some),
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

    let counts = sync_feed_article_counts_batch(connection, &[request.feed_id.clone()])?;
    let (unread_count, article_count) = counts
        .first()
        .map(|entry| (entry.unread_count, entry.article_count))
        .unwrap_or((0, 0));

    Ok(StoreParsedFeedResponse {
        feed_id: request.feed_id,
        inserted_count,
        parsed_item_count: preview.item_count,
        update_frequency_score,
        unread_count,
        article_count,
        consecutive_failures: 0,
        parser_path: preview.parser_path,
        parity_gaps: preview.parity_gaps,
    })
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
) -> Result<StoreParsedFeedResponse, String> {
    let db = state.inner().clone();
    db.write(move |connection| store_parsed_feed_content(connection, request))
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::feeds::insert_feed;
    use crate::db::schema::CREATE_SEARCH_INDEXES;
    use crate::db::{run_migrations, FeedRecord};
    use rusqlite::Connection;
    use std::fs;
    use std::path::PathBuf;

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
}
