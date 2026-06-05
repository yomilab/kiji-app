mod articles;
mod feeds;
mod migrations;
mod models;
mod saved;
mod schema;
mod search;
mod tags;

pub use articles::{
    articles_clean_old_across_feeds, articles_clean_old_by_feed, articles_count_by_feed,
    articles_count_unread_by_feed, articles_delete_by_feed, articles_exists, articles_get,
    articles_get_content, articles_insert_batch, articles_query, articles_toggle_starred,
    articles_update_feed_meta, articles_update_last_read_at, articles_update_read,
    articles_update_saved_state,
};
pub use feeds::{
    feeds_count, feeds_create, feeds_delete, feeds_get, feeds_get_by_url, feeds_list, feeds_update,
    feeds_update_article_count, feeds_update_last_fetched, feeds_update_unread_count,
};
use migrations::{read_current_migration_version, run_migrations};
use rusqlite::Connection;
pub use saved::{
    saved_create, saved_delete, saved_get, saved_get_by_article_hash, saved_get_by_link,
    saved_get_content, saved_insert_batch, saved_list_all, saved_query, saved_update_highlights,
    saved_update_last_read_at, saved_update_notes,
};
use schema::SCHEMA_VERSION;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
pub use tags::{
    feeds_tags_attach_feed, feeds_tags_delete, feeds_tags_detach_feed, feeds_tags_list,
    feeds_tags_list_by_feed, feeds_tags_list_feed_ids, feeds_tags_list_with_feed_ids,
    feeds_tags_rename, feeds_tags_update, feeds_tags_upsert,
};
use tauri::{AppHandle, Manager, State};

const DATABASE_FILE_NAME: &str = "kiji.db";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseStatus {
    path: String,
    schema_version: i64,
    current_migration_version: i64,
    journal_mode: String,
    foreign_keys_enabled: bool,
}

pub struct DbState {
    path: PathBuf,
    connection: Mutex<Connection>,
}

impl DbState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let path = resolve_database_path(app)?;
        let mut connection = open_connection(&path)?;
        run_migrations(&mut connection)?;

        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    fn status(&self) -> Result<DatabaseStatus, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Failed to lock the database connection.".to_string())?;

        Ok(DatabaseStatus {
            path: self.path.to_string_lossy().to_string(),
            schema_version: SCHEMA_VERSION,
            current_migration_version: read_current_migration_version(&connection)?,
            journal_mode: read_journal_mode(&connection)?,
            foreign_keys_enabled: read_foreign_keys_enabled(&connection)?,
        })
    }

    pub(crate) fn with_connection<T>(
        &self,
        action: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| "Failed to lock the database connection.".to_string())?;
        action(&connection)
    }
}

#[tauri::command]
pub fn db_get_status(state: State<'_, DbState>) -> Result<DatabaseStatus, String> {
    state.status()
}

fn resolve_database_path(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve the app data directory: {error}"))?;

    fs::create_dir_all(&data_dir)
        .map_err(|error| format!("Failed to create the app data directory: {error}"))?;

    Ok(data_dir.join(DATABASE_FILE_NAME))
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| format!("Failed to open the KiJi database: {error}"))?;

    connection
        .pragma_update(None, "journal_mode", "WAL")
        .map_err(|error| format!("Failed to enable WAL mode: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("Failed to enable foreign keys: {error}"))?;

    Ok(connection)
}

fn read_journal_mode(connection: &Connection) -> Result<String, String> {
    connection
        .query_row("PRAGMA journal_mode", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to read database journal mode: {error}"))
}

fn read_foreign_keys_enabled(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row("PRAGMA foreign_keys", [], |row| row.get::<_, i64>(0))
        .map(|enabled| enabled == 1)
        .map_err(|error| format!("Failed to read foreign key state: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{
        articles::{get_article, query_articles, ArticleQueryRequest},
        feeds::list_feeds,
        migrations::{read_current_migration_version, run_migrations},
        saved::{get_saved_article_by_hash, query_saved_articles, SavedArticleQueryRequest},
        schema::{CREATE_SEARCH_INDEXES, CREATE_TABLES, SCHEMA_VERSION},
        tags::list_tags_with_feed_ids,
    };
    use rusqlite::{params, Connection};

    #[test]
    fn synthetic_v15_electron_fixture_round_trips_repository_rows() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        seed_repository_fixture(&connection);

        let feeds = list_feeds(&connection).expect("list feeds");
        assert_eq!(feeds.len(), 1);
        assert_eq!(feeds[0].id, "feed-1");
        assert_eq!(feeds[0].tags, vec!["Tech"]);

        let article = get_article(&connection, "article-hash-1")
            .expect("get article")
            .expect("article exists");
        assert_eq!(article.hash, "article-hash-1");
        assert_eq!(article.feed_id, "feed-1");
        assert_eq!(article.feed_title.as_deref(), Some("Example Feed"));

        let article_page = query_articles(
            &connection,
            ArticleQueryRequest {
                feed_id: Some("feed-1".to_string()),
                feed_ids: None,
                tag_name: None,
                unread_only: None,
                saved_only: None,
                read: None,
                starred: None,
                saved: None,
                sort_field: None,
                sort_order: None,
                search_text: Some("Example".to_string()),
                limit: Some(10),
                offset: None,
                cursor_date: None,
                cursor_hash: None,
                include_total: None,
            },
        )
        .expect("query articles");
        assert_eq!(article_page.total, 1);
        assert_eq!(article_page.articles[0].hash, "article-hash-1");

        let tags = list_tags_with_feed_ids(&connection).expect("list tags");
        assert_eq!(tags[0].name, "Tech");
        assert_eq!(
            tags[0].feed_ids.as_ref().expect("feed ids"),
            &vec!["feed-1".to_string()]
        );

        let saved = get_saved_article_by_hash(&connection, "article-hash-1")
            .expect("get saved")
            .expect("saved article exists");
        assert_eq!(saved.id, "saved-1");

        let saved_page = query_saved_articles(
            &connection,
            SavedArticleQueryRequest {
                limit: Some(10),
                offset: None,
                search_text: Some("Saved".to_string()),
            },
        )
        .expect("query saved");
        assert_eq!(saved_page.total, 1);
        assert_eq!(saved_page.articles[0].article_hash, "article-hash-1");
    }

    #[test]
    fn synthetic_v13_electron_fixture_migrates_without_identity_loss() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(CREATE_TABLES)
            .expect("create synthetic electron schema");
        connection
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS _migrations (
                  version INTEGER PRIMARY KEY,
                  applied_at TEXT NOT NULL
                );
                INSERT INTO _migrations (version, applied_at) VALUES (13, '2026-01-01T00:00:00.000Z');
                "#,
            )
            .expect("create v13 ledger");
        seed_repository_fixture(&connection);

        run_migrations(&mut connection).expect("run migrations");

        assert_eq!(
            read_current_migration_version(&connection).expect("read migration version"),
            SCHEMA_VERSION
        );
        let article = get_article(&connection, "article-hash-1")
            .expect("get article")
            .expect("article survives");
        assert_eq!(article.hash, "article-hash-1");

        let mapping_count = connection
            .query_row(
                "SELECT COUNT(*) FROM article_feed_items WHERE feed_id = ?1 AND article_hash = ?2",
                params!["feed-1", "article-hash-1"],
                |row| row.get::<_, i64>(0),
            )
            .expect("read mapping count");
        assert_eq!(mapping_count, 1);
    }

    fn seed_repository_fixture(connection: &Connection) {
        connection
            .execute_batch(CREATE_SEARCH_INDEXES)
            .expect("create search indexes");
        connection
            .execute(
                r#"
                INSERT INTO feeds (
                  id, title, url, created_at, description, last_fetched, last_failed_fetch_at,
                  unread_count, article_count, tags_json, favicon, favicon_has_transparency,
                  favicon_dominant_color, favicon_bg_light, favicon_bg_dark, favicon_fetch_failed,
                  emoji, image, categories_json, language, is_podcast,
                  podcast_metadata_json, reader_mode_enabled, etag, last_modified_header
                ) VALUES (
                  'feed-1', 'Example Feed', 'https://example.com/feed.xml', '2026-01-01T00:00:00.000Z',
                  'A fixture feed', '2026-01-02T00:00:00.000Z', NULL, 1, 1, '["Tech"]',
                  NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '[]', 'en', 0, NULL,
                  0, 'etag-1', 'Mon, 01 Jan 2026 00:00:00 GMT'
                )
                "#,
                [],
            )
            .expect("insert feed");
        connection
            .execute(
                "INSERT INTO tags (name, color, emoji, created_at, sort_order) VALUES ('Tech', NULL, NULL, '2026-01-01T00:00:00.000Z', 0)",
                [],
            )
            .expect("insert tag");
        connection
            .execute(
                "INSERT INTO feed_tags (feed_id, tag_name) VALUES ('feed-1', 'Tech')",
                [],
            )
            .expect("insert feed tag");
        connection
            .execute(
                r#"
                INSERT INTO articles (
                  hash, feed_id, title, description, content, link, author,
                  published_date, fetched_date, read, starred, saved, saved_article_id,
                  last_read_at, metadata_json, feed_url, feed_title, feed_favicon,
                  feed_favicon_has_transparency, feed_favicon_bg_light, feed_favicon_bg_dark, feed_image
                ) VALUES (
                  'article-hash-1', 'feed-1', 'Example Article', 'Fixture article', '<p>Hello</p>',
                  'https://example.com/article', 'Author', '2026-01-02T00:00:00.000Z',
                  '2026-01-02T01:00:00.000Z', 0, 0, 1, 'saved-1', NULL, '{"source":"fixture"}',
                  'https://example.com/feed.xml', 'Example Feed', NULL, NULL, NULL, NULL, NULL
                )
                "#,
                [],
            )
            .expect("insert article");
        connection
            .execute(
                r#"
                INSERT OR IGNORE INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
                VALUES ('feed-1', 'article-hash-1', '2026-01-02T00:00:00.000Z', '2026-01-02T01:00:00.000Z')
                "#,
                [],
            )
            .expect("insert article mapping");
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
                  'saved-1', 'article-hash-1', 'Saved Example', 'Saved fixture', '<p>Hello</p>',
                  'https://example.com/article', 'Author', '2026-01-02T00:00:00.000Z',
                  '2026-01-03T00:00:00.000Z', NULL, 'feed-1', 'https://example.com/feed.xml',
                  'Example Feed', NULL, NULL, NULL, NULL, NULL, '{"source":"fixture"}', '[]', 'note'
                )
                "#,
                [],
            )
            .expect("insert saved article");
    }
}
