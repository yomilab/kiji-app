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
    articles_get_content, articles_insert_batch, articles_query, articles_sync_feed_counts_batch,
    articles_toggle_starred, articles_update_feed_meta, articles_update_last_read_at,
    articles_update_read, articles_update_saved_state,
};
pub use feeds::{
    feeds_count, feeds_create, feeds_delete, feeds_get, feeds_get_by_url, feeds_list, feeds_update,
    feeds_update_article_count, feeds_update_last_fetched, feeds_update_unread_count,
};
use migrations::{read_current_migration_version, run_migrations};
pub use models::SavedArticleRecord;
use rusqlite::Connection;
pub use saved::{
    get_saved_article_by_id, get_saved_articles_page, saved_create, saved_delete, saved_get,
    saved_get_by_article_hash, saved_get_by_link, saved_get_content, saved_insert_batch,
    saved_list_all, saved_query, saved_update_highlights, saved_update_last_read_at,
    saved_update_notes,
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
        remove_orphaned_wal_sidecars(&path)?;

        let connection = match open_and_initialize(&path) {
            Ok(connection) => connection,
            Err(first_error) => {
                remove_wal_sidecars(&path)?;
                open_and_initialize(&path).map_err(|retry_error| format!(
                    "{first_error} Attempted WAL recovery by removing sidecars, but reopen failed: {retry_error}"
                ))?
            }
        };

        Ok(Self {
            path,
            connection: Mutex::new(connection),
        })
    }

    pub fn checkpoint_wal(&self) -> Result<(), String> {
        self.with_connection(|connection| {
            connection
                .query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |row| {
                    let _busy: i64 = row.get(0)?;
                    let _log: i64 = row.get(1)?;
                    let _checkpointed: i64 = row.get(2)?;
                    Ok(())
                })
                .map_err(|error| format!("Failed to checkpoint database WAL: {error}"))
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

    pub fn database_path(&self) -> PathBuf {
        self.path.clone()
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

fn open_and_initialize(path: &Path) -> Result<Connection, String> {
    let mut connection = open_connection(path)?;
    verify_database_integrity(&connection, path)?;
    run_migrations(&mut connection)?;
    Ok(connection)
}

fn wal_sidecar_path(path: &Path, extension: &str) -> PathBuf {
    path.with_extension(format!(
        "{}{extension}",
        path.extension()
            .and_then(|value| value.to_str())
            .unwrap_or("db")
    ))
}

fn remove_orphaned_wal_sidecars(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    remove_wal_sidecars(path)
}

fn remove_wal_sidecars(path: &Path) -> Result<(), String> {
    for extension in ["-wal", "-shm"] {
        let sidecar_path = wal_sidecar_path(path, extension);
        if !sidecar_path.exists() {
            continue;
        }

        fs::remove_file(&sidecar_path).map_err(|error| {
            format!(
                "Failed to remove database sidecar {}: {error}",
                sidecar_path.display()
            )
        })?;
    }

    Ok(())
}

fn verify_database_integrity(connection: &Connection, path: &Path) -> Result<(), String> {
    let result = connection
        .query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to verify KiJi database integrity: {error}"))?;

    if result == "ok" {
        return Ok(());
    }

    Err(format!(
        "KiJi database at {} failed integrity check: {result}. If you replaced kiji.db manually, copy it with `sqlite3 source.db \".backup 'dest.db'\"` while the source app is closed, then remove any stale kiji.db-wal and kiji.db-shm files.",
        path.display()
    ))
}

fn open_connection(path: &Path) -> Result<Connection, String> {
    let connection = Connection::open(path)
        .map_err(|error| {
            format!(
                "Failed to open the KiJi database at {}: {error}. If you replaced kiji.db manually, use `sqlite3 source.db \".backup 'dest.db'\"` while the source app is closed and remove stale kiji.db-wal and kiji.db-shm files.",
                path.display()
            )
        })?;

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
        articles::{get_article, query_articles, sync_feed_article_counts_batch, ArticleQueryRequest},
        feeds::list_feeds,
        migrations::{read_current_migration_version, run_migrations},
        saved::{get_saved_article_by_hash, query_saved_articles, SavedArticleQueryRequest},
        schema::{CREATE_SEARCH_INDEXES, CREATE_TABLES, SCHEMA_VERSION},
        tags::list_tags_with_feed_ids,
    };
    use crate::db::models::SavedArticleRecord;
    use rusqlite::{params, Connection};

    #[test]
    fn synthetic_v15_legacy_fixture_round_trips_repository_rows() {
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
    fn saved_articles_survive_reopen_without_deleting_wal_sidecars() {
        use std::fs;
        use uuid::Uuid;

        use super::{open_and_initialize, open_connection};
        use crate::db::{
            migrations::run_migrations,
            saved::{get_saved_article_by_hash, insert_saved_article},
            schema::CREATE_SEARCH_INDEXES,
        };

        let temp_root = std::env::temp_dir().join(format!("kiji-wal-persist-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).expect("create temp dir");
        let db_path = temp_root.join("kiji.db");

        {
            let mut connection = open_connection(&db_path).expect("open database");
            run_migrations(&mut connection).expect("run migrations");
            connection
                .execute_batch(CREATE_SEARCH_INDEXES)
                .expect("create search indexes");
            insert_saved_article(&connection, &wal_persist_saved_fixture()).expect("insert saved article");
        }

        let reopened = open_and_initialize(&db_path).expect("reopen database without deleting WAL sidecars");
        let saved = get_saved_article_by_hash(&reopened, "persist-hash")
            .expect("query saved article")
            .expect("saved article should survive reopen");
        assert_eq!(saved.id, "persist-saved-1");

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn remove_orphaned_wal_sidecars_only_when_main_database_is_missing() {
        use std::fs;
        use uuid::Uuid;

        use super::{remove_orphaned_wal_sidecars, wal_sidecar_path};

        let temp_root = std::env::temp_dir().join(format!("kiji-wal-orphan-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).expect("create temp dir");
        let db_path = temp_root.join("kiji.db");
        let wal_path = wal_sidecar_path(&db_path, "-wal");
        fs::write(&wal_path, b"orphaned-wal").expect("write orphaned wal sidecar");

        remove_orphaned_wal_sidecars(&db_path).expect("remove orphaned wal sidecars");
        assert!(!wal_path.exists(), "orphaned WAL sidecar should be removed");

        let _ = fs::remove_dir_all(&temp_root);
    }

    fn wal_persist_saved_fixture() -> SavedArticleRecord {
        SavedArticleRecord {
            id: "persist-saved-1".to_string(),
            article_hash: "persist-hash".to_string(),
            title: Some("Persisted Save".to_string()),
            description: None,
            content: Some("<p>Body</p>".to_string()),
            link: None,
            author: None,
            published_date: None,
            saved_date: "2026-06-06T00:00:00.000Z".to_string(),
            last_read_at: None,
            feed_id: None,
            feed_url: None,
            feed_title: None,
            feed_favicon: None,
            feed_favicon_has_transparency: None,
            feed_favicon_bg_light: None,
            feed_favicon_bg_dark: None,
            feed_image: None,
            preview_image: None,
            metadata: None,
            highlights: vec![],
            notes: None,
        }
    }

    #[test]
    fn synthetic_v13_legacy_fixture_migrates_without_identity_loss() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        connection
            .execute_batch(CREATE_TABLES)
            .expect("create synthetic legacy schema");
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

    #[test]
    fn desktop_smoke_workflow_exercises_feed_save_export_and_relaunch_persistence() {
        use std::{fs, path::Path};
        use uuid::Uuid;
        use zip::ZipArchive;

        use super::{
            articles::{
                get_article, get_article_content, insert_articles_batch, query_articles,
                ArticleQueryRequest,
            },
            feeds::{insert_feed, list_feeds, update_feed, FeedUpdate},
            migrations::run_migrations,
            models::{ArticleRecord, FeedRecord, SavedArticleRecord},
            saved::insert_saved_article,
            schema::CREATE_SEARCH_INDEXES,
        };
        use crate::saved::export_saved_articles_to_zip;
        use crate::settings::{AppSettings, BackgroundUpdateMode, Theme};

        fn open_smoke_database(dir: &Path) -> Connection {
            let db_path = dir.join("kiji.db");
            let mut connection = Connection::open(&db_path).expect("open smoke database on disk");
            run_migrations(&mut connection).expect("run migrations");
            connection
                .execute_batch(CREATE_SEARCH_INDEXES)
                .expect("create search indexes");
            connection
        }

        fn sample_feed() -> FeedRecord {
            FeedRecord {
                id: "smoke-feed-1".to_string(),
                title: "Smoke Feed".to_string(),
                url: "https://example.com/smoke-feed.xml".to_string(),
                created_at: "2026-06-06T00:00:00.000Z".to_string(),
                description: Some("Desktop smoke fixture".to_string()),
                last_fetched: None,
                last_failed_fetch_at: None,
                unread_count: 0,
                article_count: 0,
                tags: vec!["Smoke".to_string()],
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
                consecutive_failures: 0,
                last_favicon_refresh: None,
            }
        }

        fn sample_article() -> ArticleRecord {
            ArticleRecord {
                hash: "smoke-article-hash".to_string(),
                feed_id: "smoke-feed-1".to_string(),
                title: "Smoke Article".to_string(),
                description: "Article inserted during refresh smoke".to_string(),
                content: "<p>Smoke body</p>".to_string(),
                link: Some("https://example.com/smoke-article".to_string()),
                author: Some("Smoke Author".to_string()),
                published_date: Some("2026-06-06T00:00:00.000Z".to_string()),
                fetched_date: "2026-06-06T01:00:00.000Z".to_string(),
                read: false,
                starred: false,
                saved: false,
                saved_article_id: None,
                last_read_at: None,
                metadata: None,
                feed_url: Some("https://example.com/smoke-feed.xml".to_string()),
                feed_title: Some("Smoke Feed".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
            }
        }

        fn sample_saved_article() -> SavedArticleRecord {
            SavedArticleRecord {
                id: "smoke-saved-1".to_string(),
                article_hash: "smoke-article-hash".to_string(),
                title: Some("Smoke Article".to_string()),
                description: Some("Saved during smoke workflow".to_string()),
                content: Some("<p>Smoke body</p>".to_string()),
                link: Some("https://example.com/smoke-article".to_string()),
                author: Some("Smoke Author".to_string()),
                published_date: Some("2026-06-06T00:00:00.000Z".to_string()),
                saved_date: "2026-06-06T02:00:00.000Z".to_string(),
                last_read_at: None,
                feed_id: Some("smoke-feed-1".to_string()),
                feed_url: Some("https://example.com/smoke-feed.xml".to_string()),
                feed_title: Some("Smoke Feed".to_string()),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                preview_image: None,
                metadata: None,
                highlights: vec![],
                notes: None,
            }
        }

        fn read_zip_entry_names(archive_path: &Path) -> Vec<String> {
            let file = fs::File::open(archive_path).expect("open export zip");
            let mut archive = ZipArchive::new(file).expect("read export zip");
            (0..archive.len())
                .map(|index| {
                    archive
                        .by_index(index)
                        .expect("read zip entry")
                        .name()
                        .to_string()
                })
                .collect()
        }

        let temp_root = std::env::temp_dir().join(format!("kiji-smoke-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).expect("create smoke temp dir");

        let connection = open_smoke_database(&temp_root);

        insert_feed(&connection, &sample_feed()).expect("add feed");
        let feeds = list_feeds(&connection).expect("list feeds");
        assert_eq!(feeds.len(), 1);
        assert_eq!(feeds[0].url, "https://example.com/smoke-feed.xml");

        let inserted =
            insert_articles_batch(&connection, &[sample_article()]).expect("refresh feed");
        assert_eq!(inserted, 1);

        update_feed(
            &connection,
            "smoke-feed-1",
            FeedUpdate {
                title: None,
                url: None,
                created_at: None,
                description: None,
                last_fetched: Some(Some("2026-06-06T01:00:00.000Z".to_string())),
                last_failed_fetch_at: None,
                unread_count: Some(1),
                article_count: Some(1),
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
                etag: None,
                last_modified_header: None,
                sort_order: None,
                update_frequency_score: None,
                consecutive_failures: None,
                last_favicon_refresh: None,
            },
        )
        .expect("update feed counts");

        let opened = get_article(&connection, "smoke-article-hash")
            .expect("open article")
            .expect("article exists");
        assert_eq!(opened.title, "Smoke Article");
        let content = get_article_content(&connection, "smoke-article-hash")
            .expect("read article content")
            .expect("content exists");
        assert!(content.contains("Smoke body"));

        let page = query_articles(
            &connection,
            ArticleQueryRequest {
                feed_id: Some("smoke-feed-1".to_string()),
                feed_ids: None,
                tag_name: None,
                unread_only: None,
                saved_only: None,
                read: None,
                starred: None,
                saved: None,
                sort_field: None,
                sort_order: None,
                search_text: None,
                limit: Some(10),
                offset: None,
                cursor_date: None,
                cursor_hash: None,
                include_total: None,
            },
        )
        .expect("query articles");
        assert_eq!(page.total, 1);

        insert_saved_article(&connection, &sample_saved_article()).expect("save article");

        let export_path = temp_root.join("saved-export.zip");
        let (exported_count, written_bytes) =
            export_saved_articles_to_zip(&connection, &export_path).expect("export saved articles");
        assert_eq!(exported_count, 1);
        assert!(written_bytes > 0);

        let entry_names = read_zip_entry_names(&export_path);
        assert!(entry_names.iter().any(|name| name == "pocket.csv"));
        assert!(entry_names.iter().any(|name| name == "articles.md"));
        assert!(entry_names.iter().any(|name| name.starts_with("articles/")));

        let settings_path = temp_root.join("user-settings.json");
        let mut settings = AppSettings::default();
        settings.theme = Theme::Dark;
        settings.background_update = BackgroundUpdateMode::OnLaunch;
        settings.sidebar_width = 280;
        let raw = serde_json::to_string_pretty(&settings).expect("serialize settings");
        fs::write(&settings_path, raw).expect("write settings snapshot");

        let reloaded_raw = fs::read_to_string(&settings_path).expect("reload settings snapshot");
        let reloaded: AppSettings =
            serde_json::from_str(&reloaded_raw).expect("parse reloaded settings");
        assert_eq!(reloaded.theme, Theme::Dark);
        assert_eq!(reloaded.background_update, BackgroundUpdateMode::OnLaunch);
        assert_eq!(reloaded.sidebar_width, 280);

        let _ = fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn feed_scoped_query_uses_viewing_feed_metadata_for_shared_url_articles() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");

        for (feed_id, title, url) in [
            (
                "feed-hn",
                "Hacker News",
                "https://news.ycombinator.com/rss",
            ),
            (
                "feed-runtime",
                "RuntimeWire",
                "https://runtimewire.com/rss",
            ),
        ] {
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
                      ?1, ?2, ?3, '2026-06-16T00:00:00.000Z', '', NULL, NULL, 0, 0, '[]',
                      NULL, NULL, NULL, NULL, NULL, 0, NULL, NULL, '[]', 'en', 0, NULL,
                      0, NULL, NULL
                    )
                    "#,
                    params![feed_id, title, url],
                )
                .expect("insert feed");
        }

        let shared_hash = "shared-url-article-hash";
        let shared_link = "https://runtimewire.com/article/microsoft-github-aws-ai-capacity-crunch";
        connection
            .execute(
                r#"
                INSERT INTO articles (
                  hash, feed_id, title, description, content, link, author,
                  published_date, fetched_date, read, starred, saved, saved_article_id,
                  last_read_at, metadata_json, feed_url, feed_title, feed_favicon,
                  feed_favicon_has_transparency, feed_favicon_bg_light, feed_favicon_bg_dark, feed_image
                ) VALUES (
                  ?1, 'feed-hn', 'Microsoft turns to AWS as GitHub faces AI capacity crunch',
                  '', '', ?2, NULL, '2026-06-16T02:47:57.000Z', '2026-06-16T02:47:57.000Z',
                  0, 0, 0, NULL, NULL, NULL,
                  'https://news.ycombinator.com/rss', 'Hacker News', NULL, NULL, NULL, NULL, NULL
                )
                "#,
                params![shared_hash, shared_link],
            )
            .expect("insert shared article");

        for (feed_id, published_date, fetched_date) in [
            (
                "feed-hn",
                "2026-06-16T02:47:57.000Z",
                "2026-06-16T02:47:57.000Z",
            ),
            (
                "feed-runtime",
                "2026-06-16T02:19:39.000Z",
                "2026-06-16T02:19:39.000Z",
            ),
        ] {
            connection
                .execute(
                    r#"
                    INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
                    VALUES (?1, ?2, ?3, ?4)
                    "#,
                    params![feed_id, shared_hash, published_date, fetched_date],
                )
                .expect("insert article mapping");
        }

        let runtime_page = query_articles(
            &connection,
            ArticleQueryRequest {
                feed_id: Some("feed-runtime".to_string()),
                feed_ids: None,
                tag_name: None,
                unread_only: None,
                saved_only: None,
                read: None,
                starred: None,
                saved: None,
                sort_field: None,
                sort_order: None,
                search_text: None,
                limit: Some(10),
                offset: None,
                cursor_date: None,
                cursor_hash: None,
                include_total: None,
            },
        )
        .expect("query runtime feed");

        assert_eq!(runtime_page.total, 1);
        assert_eq!(runtime_page.articles.len(), 1);
        assert_eq!(runtime_page.articles[0].hash, shared_hash);
        assert_eq!(runtime_page.articles[0].feed_id, "feed-runtime");
        assert_eq!(
            runtime_page.articles[0].feed_title.as_deref(),
            Some("RuntimeWire")
        );

        let hn_page = query_articles(
            &connection,
            ArticleQueryRequest {
                feed_id: Some("feed-hn".to_string()),
                feed_ids: None,
                tag_name: None,
                unread_only: None,
                saved_only: None,
                read: None,
                starred: None,
                saved: None,
                sort_field: None,
                sort_order: None,
                search_text: None,
                limit: Some(10),
                offset: None,
                cursor_date: None,
                cursor_hash: None,
                include_total: None,
            },
        )
        .expect("query hn feed");

        assert_eq!(hn_page.articles[0].feed_id, "feed-hn");
        assert_eq!(hn_page.articles[0].feed_title.as_deref(), Some("Hacker News"));
    }

    #[test]
    fn sync_feed_article_counts_batch_updates_feed_rows_in_one_transaction() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        seed_repository_fixture(&connection);

        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, title, read, fetched_date) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    "article-hash-2",
                    "feed-1",
                    "Read article",
                    1,
                    "2026-01-02T00:00:00.000Z"
                ],
            )
            .expect("insert read article");

        let synced = sync_feed_article_counts_batch(&connection, &["feed-1".to_string()])
            .expect("sync feed counts");
        assert_eq!(synced.len(), 1);
        assert_eq!(synced[0].feed_id, "feed-1");
        assert_eq!(synced[0].article_count, 2);
        assert_eq!(synced[0].unread_count, 1);

        let stored_counts = connection
            .query_row(
                "SELECT unread_count, article_count FROM feeds WHERE id = ?1",
                params!["feed-1"],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .expect("read feed counts");
        assert_eq!(stored_counts, (1, 2));
    }
}
