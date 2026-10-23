use rusqlite::{params, Connection};

use super::schema::{CREATE_INDEXES, CREATE_SEARCH_INDEXES, CREATE_TABLES, SCHEMA_VERSION};
use super::search::{register_search_functions, start_body_search_migration};

type MigrationFn = fn(&Connection) -> Result<(), String>;

struct MigrationStep {
    version: i64,
    up: MigrationFn,
}

pub fn run_migrations(connection: &mut Connection) -> Result<(), String> {
    // The search triggers call this function on every article write.
    register_search_functions(connection)?;
    create_migration_ledger(connection)?;
    let current_version = read_current_migration_version(connection)?;

    if current_version >= SCHEMA_VERSION {
        ensure_schema_shape(connection)?;
        return Ok(());
    }

    let transaction = connection
        .transaction()
        .map_err(|error| format!("Failed to start database migration transaction: {error}"))?;

    for migration in MIGRATIONS {
        if migration.version <= current_version {
            continue;
        }

        (migration.up)(&transaction)?;
        transaction
            .execute(
                "INSERT INTO _migrations (version, applied_at) VALUES (?1, datetime('now'))",
                params![migration.version],
            )
            .map_err(|error| {
                format!(
                    "Failed to record database migration v{}: {error}",
                    migration.version
                )
            })?;
    }

    transaction
        .commit()
        .map_err(|error| format!("Failed to commit database migrations: {error}"))?;

    ensure_schema_shape(connection)
}

pub fn read_current_migration_version(connection: &Connection) -> Result<i64, String> {
    if !table_exists(connection, "_migrations")? {
        return Ok(0);
    }

    connection
        .query_row(
            "SELECT COALESCE(MAX(version), 0) FROM _migrations",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| format!("Failed to read migration ledger: {error}"))
}

fn create_migration_ledger(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS _migrations (
              version INTEGER PRIMARY KEY,
              applied_at TEXT NOT NULL
            );
            "#,
        )
        .map_err(|error| format!("Failed to create migration ledger: {error}"))
}

fn ensure_schema_shape(connection: &Connection) -> Result<(), String> {
    ensure_additive_feed_columns(connection)?;
    ensure_additive_tag_columns(connection)?;
    ensure_feed_tags_sort_order_column(connection)?;
    ensure_article_feed_items(connection)?;
    ensure_saved_article_metadata_column(connection)?;
    ensure_query_indexes(connection)?;
    // No-op while a v19 body backfill is pending: the v18 table and its
    // triggers keep these names until the staging index is swapped in.
    connection
        .execute_batch(CREATE_SEARCH_INDEXES)
        .map_err(|error| format!("Failed to ensure search indexes: {error}"))?;
    Ok(())
}

fn migration_1(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(CREATE_TABLES)
        .map_err(|error| format!("Failed to create database tables: {error}"))?;
    ensure_query_indexes(connection)?;
    rebuild_search_indexes(connection)
}

fn migration_2(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            DROP INDEX IF EXISTS idx_articles_published_date;
            DROP INDEX IF EXISTS idx_articles_read;
            DROP INDEX IF EXISTS idx_articles_feed_date;
            "#,
        )
        .map_err(|error| format!("Failed to drop legacy article indexes: {error}"))?;
    ensure_query_indexes(connection)
}

fn migration_3(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "sort_order", "INTEGER DEFAULT 0")?;
    ensure_add_column(
        connection,
        "feeds",
        "update_frequency_score",
        "REAL DEFAULT 0",
    )?;
    ensure_add_column(
        connection,
        "feeds",
        "consecutive_failures",
        "INTEGER DEFAULT 0",
    )
}

fn migration_4(connection: &Connection) -> Result<(), String> {
    clamp_future_published_dates(connection)
}

fn migration_5(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "last_favicon_refresh", "TEXT")
}

fn migration_6(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "created_at", "TEXT")?;
    connection
        .execute(
            r#"
            UPDATE feeds
            SET created_at = COALESCE(last_fetched, datetime('now'))
            WHERE created_at IS NULL OR created_at = ''
            "#,
            [],
        )
        .map_err(|error| format!("Failed to backfill feed creation dates: {error}"))?;
    Ok(())
}

fn migration_7(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "etag", "TEXT")?;
    ensure_add_column(connection, "feeds", "last_modified_header", "TEXT")
}

fn migration_8(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "last_failed_fetch_at", "TEXT")
}

fn migration_9(connection: &Connection) -> Result<(), String> {
    ensure_additive_tag_columns(connection)?;
    connection
        .execute(
            r#"
            UPDATE tags
            SET sort_order = (
              SELECT COUNT(*)
              FROM tags AS ordered_tags
              WHERE ordered_tags.created_at < tags.created_at
                OR (
                  ordered_tags.created_at = tags.created_at
                  AND ordered_tags.name <= tags.name
                )
            ) - 1
            "#,
            [],
        )
        .map_err(|error| format!("Failed to backfill tag sort order: {error}"))?;
    Ok(())
}

fn migration_10(connection: &Connection) -> Result<(), String> {
    resync_feed_tags_json_cache(connection)
}

fn migration_11(connection: &Connection) -> Result<(), String> {
    clamp_future_published_dates(connection)
}

fn migration_12(connection: &Connection) -> Result<(), String> {
    rebuild_search_indexes(connection)
}

fn migration_13(connection: &Connection) -> Result<(), String> {
    ensure_article_feed_items(connection)?;
    ensure_saved_article_metadata_column(connection)
}

fn migration_14(connection: &Connection) -> Result<(), String> {
    ensure_article_feed_items(connection)
}

fn migration_15(connection: &Connection) -> Result<(), String> {
    ensure_query_indexes(connection)
}

fn migration_16(connection: &Connection) -> Result<(), String> {
    ensure_articles_unsaved_hash_index(connection)
}

fn migration_17(connection: &Connection) -> Result<(), String> {
    // The backfill reads feeds.sort_order, which only exists once the additive
    // feed columns have been applied — ledgers stamped past migration 3 skip it.
    ensure_additive_feed_columns(connection)?;
    ensure_feed_tags_sort_order_column(connection)?;
    backfill_feed_tags_sort_order(connection)
}

/// Starred/saved lists sort by effective date + hash. The single-column flag
/// indexes forced a table lookup per flagged row plus a temp B-tree sort;
/// the partial `(effective date DESC, hash) WHERE flag = 1` replacements in
/// `CREATE_INDEXES` let `ORDER BY ... LIMIT` stream off the index and only
/// hold flagged rows. `query_articles` emits the flag as a literal so the
/// partial index is usable.
fn migration_18(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            DROP INDEX IF EXISTS idx_articles_starred;
            DROP INDEX IF EXISTS idx_articles_saved;
            "#,
        )
        .map_err(|error| format!("Failed to drop legacy article flag indexes: {error}"))?;
    ensure_query_indexes(connection)
}

/// Article body search. FTS5 tables cannot gain a column in place, so
/// libraries with rows get a staging index that `db::search` backfills in
/// batches off the startup thread (see `DbState::spawn_search_backfill_if_needed`)
/// while the v18 index keeps title/description/author search working.
fn migration_19(connection: &Connection) -> Result<(), String> {
    start_body_search_migration(connection)
}

static MIGRATIONS: &[MigrationStep] = &[
    MigrationStep {
        version: 1,
        up: migration_1,
    },
    MigrationStep {
        version: 2,
        up: migration_2,
    },
    MigrationStep {
        version: 3,
        up: migration_3,
    },
    MigrationStep {
        version: 4,
        up: migration_4,
    },
    MigrationStep {
        version: 5,
        up: migration_5,
    },
    MigrationStep {
        version: 6,
        up: migration_6,
    },
    MigrationStep {
        version: 7,
        up: migration_7,
    },
    MigrationStep {
        version: 8,
        up: migration_8,
    },
    MigrationStep {
        version: 9,
        up: migration_9,
    },
    MigrationStep {
        version: 10,
        up: migration_10,
    },
    MigrationStep {
        version: 11,
        up: migration_11,
    },
    MigrationStep {
        version: 12,
        up: migration_12,
    },
    MigrationStep {
        version: 13,
        up: migration_13,
    },
    MigrationStep {
        version: 14,
        up: migration_14,
    },
    MigrationStep {
        version: 15,
        up: migration_15,
    },
    MigrationStep {
        version: 16,
        up: migration_16,
    },
    MigrationStep {
        version: 17,
        up: migration_17,
    },
    MigrationStep {
        version: 18,
        up: migration_18,
    },
    MigrationStep {
        version: 19,
        up: migration_19,
    },
];

fn ensure_additive_feed_columns(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "feeds", "sort_order", "INTEGER DEFAULT 0")?;
    ensure_add_column(
        connection,
        "feeds",
        "update_frequency_score",
        "REAL DEFAULT 0",
    )?;
    ensure_add_column(
        connection,
        "feeds",
        "consecutive_failures",
        "INTEGER DEFAULT 0",
    )?;
    ensure_add_column(connection, "feeds", "last_favicon_refresh", "TEXT")?;
    ensure_add_column(connection, "feeds", "created_at", "TEXT")?;
    ensure_add_column(connection, "feeds", "etag", "TEXT")?;
    ensure_add_column(connection, "feeds", "last_modified_header", "TEXT")?;
    ensure_add_column(connection, "feeds", "last_failed_fetch_at", "TEXT")
}

fn ensure_additive_tag_columns(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "tags", "sort_order", "INTEGER DEFAULT 0")
}

fn ensure_feed_tags_sort_order_column(connection: &Connection) -> Result<(), String> {
    ensure_add_column(
        connection,
        "feed_tags",
        "sort_order",
        "INTEGER NOT NULL DEFAULT 0",
    )
}

fn backfill_feed_tags_sort_order(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            r#"
            UPDATE feed_tags
            SET sort_order = (
              SELECT COUNT(*)
              FROM feed_tags AS other
              JOIN feeds AS other_feed ON other_feed.id = other.feed_id
              JOIN feeds AS this_feed ON this_feed.id = feed_tags.feed_id
              WHERE other.tag_name = feed_tags.tag_name
                AND (
                  COALESCE(other_feed.sort_order, 0) < COALESCE(this_feed.sort_order, 0)
                  OR (
                    COALESCE(other_feed.sort_order, 0) = COALESCE(this_feed.sort_order, 0)
                    AND (
                      COALESCE(other_feed.title, '') COLLATE NOCASE
                        < COALESCE(this_feed.title, '') COLLATE NOCASE
                      OR (
                        COALESCE(other_feed.title, '') COLLATE NOCASE
                          = COALESCE(this_feed.title, '') COLLATE NOCASE
                        AND other.feed_id <= feed_tags.feed_id
                      )
                    )
                  )
                )
            ) - 1
            "#,
            [],
        )
        .map(|_| ())
        .map_err(|error| format!("Failed to backfill feed_tags.sort_order: {error}"))
}

fn ensure_article_feed_items(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS article_feed_items (
              feed_id        TEXT NOT NULL,
              article_hash   TEXT NOT NULL,
              published_date TEXT,
              fetched_date   TEXT NOT NULL DEFAULT '',
              PRIMARY KEY (feed_id, article_hash),
              FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
              FOREIGN KEY (article_hash) REFERENCES articles(hash) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_article_feed_items_hash ON article_feed_items(article_hash);
            "#,
        )
        .map_err(|error| format!("Failed to ensure article/feed mapping table: {error}"))?;

    let mut needs_date_backfill = false;
    if !has_column(connection, "article_feed_items", "published_date")? {
        ensure_add_column(connection, "article_feed_items", "published_date", "TEXT")?;
        needs_date_backfill = true;
    }
    if !has_column(connection, "article_feed_items", "fetched_date")? {
        ensure_add_column(
            connection,
            "article_feed_items",
            "fetched_date",
            "TEXT NOT NULL DEFAULT ''",
        )?;
        needs_date_backfill = true;
    }

    let has_mapping_rows = connection
        .query_row("SELECT 1 FROM article_feed_items LIMIT 1", [], |_| Ok(()))
        .is_ok();
    if !has_mapping_rows {
        connection
            .execute_batch(
                r#"
                INSERT OR IGNORE INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
                SELECT feed_id, hash, published_date, fetched_date
                FROM articles
                WHERE feed_id IN (SELECT id FROM feeds);
                "#,
            )
            .map_err(|error| format!("Failed to backfill article/feed mappings: {error}"))?;
        needs_date_backfill = true;
    }

    if needs_date_backfill {
        connection
            .execute_batch(
                r#"
                UPDATE article_feed_items
                SET
                  published_date = (SELECT published_date FROM articles WHERE articles.hash = article_feed_items.article_hash),
                  fetched_date = COALESCE((SELECT fetched_date FROM articles WHERE articles.hash = article_feed_items.article_hash), fetched_date, '')
                WHERE fetched_date = ''
                  OR fetched_date IS NULL
                  OR published_date IS NOT (SELECT published_date FROM articles WHERE articles.hash = article_feed_items.article_hash)
                  OR fetched_date IS NOT (SELECT fetched_date FROM articles WHERE articles.hash = article_feed_items.article_hash);
                "#,
            )
            .map_err(|error| format!("Failed to backfill article/feed mapping dates: {error}"))?;
    }

    connection
        .execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_article_feed_items_feed_date ON article_feed_items(feed_id, COALESCE(published_date, fetched_date) DESC, article_hash);
            CREATE TRIGGER IF NOT EXISTS article_feed_items_article_dates_au
            AFTER UPDATE OF published_date, fetched_date ON articles
            BEGIN
              UPDATE article_feed_items
              SET published_date = new.published_date,
                  fetched_date = new.fetched_date
              WHERE article_hash = new.hash;
            END;
            "#,
        )
        .map_err(|error| format!("Failed to ensure article/feed mapping indexes: {error}"))
}

fn ensure_saved_article_metadata_column(connection: &Connection) -> Result<(), String> {
    ensure_add_column(connection, "saved_articles", "metadata_json", "TEXT")
}

fn ensure_query_indexes(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(CREATE_INDEXES)
        .map_err(|error| format!("Failed to ensure database query indexes: {error}"))
}

/// Partial covering index for feed-delete orphan cleanup (`delete_articles_by_feed`).
/// Applied only via versioned migration v16 — not added to `ensure_schema_shape` startup
/// self-healing so large libraries are not forced to rebuild the index on every launch.
fn ensure_articles_unsaved_hash_index(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            CREATE INDEX IF NOT EXISTS idx_articles_unsaved_hash
              ON articles(hash) WHERE saved = 0;
            "#,
        )
        .map_err(|error| format!("Failed to create articles unsaved hash index: {error}"))
}

fn resync_feed_tags_json_cache(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            UPDATE feeds
            SET tags_json = COALESCE(
              (
                SELECT json_group_array(tag_name)
                FROM (
                  SELECT tag_name
                  FROM feed_tags
                  WHERE feed_id = feeds.id
                  ORDER BY tag_name COLLATE NOCASE
                )
              ),
              '[]'
            );
            "#,
        )
        .map_err(|error| format!("Failed to resync feed tag cache: {error}"))
}

fn clamp_future_published_dates(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            r#"
            UPDATE articles
            SET published_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE published_date IS NOT NULL
              AND published_date > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

            UPDATE saved_articles
            SET published_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            WHERE published_date IS NOT NULL
              AND published_date > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
            "#,
        )
        .map_err(|error| format!("Failed to clamp future published dates: {error}"))
}

/// Title/description/author search index as of v1–v18. Migrations 1 and 12
/// still build this shape; v19 replaces it with `create_search_indexes_sql`.
const LEGACY_SEARCH_INDEXES: &str = r#"
  CREATE VIRTUAL TABLE IF NOT EXISTS articles_search USING fts5(
    hash UNINDEXED,
    title,
    description,
    author,
    tokenize='unicode61',
    prefix='2 3 4'
  );

  CREATE TRIGGER IF NOT EXISTS articles_search_ai AFTER INSERT ON articles BEGIN
    INSERT INTO articles_search(rowid, hash, title, description, author)
    VALUES (new.rowid, new.hash, new.title, new.description, COALESCE(new.author, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS articles_search_ad AFTER DELETE ON articles BEGIN
    DELETE FROM articles_search WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS articles_search_au AFTER UPDATE OF hash, title, description, author ON articles BEGIN
    DELETE FROM articles_search WHERE rowid = old.rowid;
    INSERT INTO articles_search(rowid, hash, title, description, author)
    VALUES (new.rowid, new.hash, new.title, new.description, COALESCE(new.author, ''));
  END;

  CREATE VIRTUAL TABLE IF NOT EXISTS saved_articles_search USING fts5(
    id UNINDEXED,
    title,
    description,
    author,
    tokenize='unicode61',
    prefix='2 3 4'
  );

  CREATE TRIGGER IF NOT EXISTS saved_articles_search_ai AFTER INSERT ON saved_articles BEGIN
    INSERT INTO saved_articles_search(rowid, id, title, description, author)
    VALUES (new.rowid, new.id, COALESCE(new.title, ''), COALESCE(new.description, ''), COALESCE(new.author, ''));
  END;

  CREATE TRIGGER IF NOT EXISTS saved_articles_search_ad AFTER DELETE ON saved_articles BEGIN
    DELETE FROM saved_articles_search WHERE rowid = old.rowid;
  END;

  CREATE TRIGGER IF NOT EXISTS saved_articles_search_au AFTER UPDATE OF id, title, description, author ON saved_articles BEGIN
    DELETE FROM saved_articles_search WHERE rowid = old.rowid;
    INSERT INTO saved_articles_search(rowid, id, title, description, author)
    VALUES (new.rowid, new.id, COALESCE(new.title, ''), COALESCE(new.description, ''), COALESCE(new.author, ''));
  END;
"#;

fn rebuild_search_indexes(connection: &Connection) -> Result<(), String> {
    // A database already on the v19 body index (ledger rewound in tests)
    // keeps it; v19 itself is a no-op there.
    if has_column(connection, "articles_search", "body")? {
        return Ok(());
    }
    connection
        .execute_batch(LEGACY_SEARCH_INDEXES)
        .map_err(|error| format!("Failed to create search indexes: {error}"))?;
    connection
        .execute_batch(
            r#"
            DELETE FROM articles_search;
            INSERT INTO articles_search(rowid, hash, title, description, author)
            SELECT rowid, hash, title, description, COALESCE(author, '')
            FROM articles;

            DELETE FROM saved_articles_search;
            INSERT INTO saved_articles_search(rowid, id, title, description, author)
            SELECT rowid, id, COALESCE(title, ''), COALESCE(description, ''), COALESCE(author, '')
            FROM saved_articles;
            "#,
        )
        .map_err(|error| format!("Failed to rebuild search indexes: {error}"))
}

fn ensure_add_column(
    connection: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    if !table_exists(connection, table)? || has_column(connection, table, column)? {
        return Ok(());
    }

    connection
        .execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition};"
        ))
        .map_err(|error| format!("Failed to add {table}.{column}: {error}"))
}

fn has_column(connection: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("Failed to inspect table {table}: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("Failed to read columns for {table}: {error}"))?;

    for row in rows {
        if row.map_err(|error| format!("Failed to read column for {table}: {error}"))? == column {
            return Ok(true);
        }
    }

    Ok(false)
}

fn table_exists(connection: &Connection, table: &str) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(
                SELECT 1
                FROM sqlite_master
                WHERE type = 'table' AND name = ?1
            )",
            params![table],
            |row| row.get::<_, i64>(0),
        )
        .map(|exists| exists == 1)
        .map_err(|error| format!("Failed to inspect table {table}: {error}"))
}

#[cfg(test)]
/// Rewinds a migrated database to the v18 search shape: the
/// title/description/author tables and triggers, ledger at 18.
pub(crate) fn rewind_to_v18_search(connection: &Connection) {
    let mut sql = String::new();
    for table in ["articles_search", "saved_articles_search"] {
        for trigger in ["ai", "ad", "au"] {
            sql.push_str(&format!("DROP TRIGGER {table}_{trigger};\n"));
        }
        sql.push_str(&format!("DROP TABLE {table};\n"));
    }
    sql.push_str(LEGACY_SEARCH_INDEXES);
    sql.push_str("DELETE FROM _migrations WHERE version >= 19;");
    connection.execute_batch(&sql).expect("rewind to v18 search index");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_reaches_current_schema() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");

        run_migrations(&mut connection).expect("run migrations");

        assert_eq!(
            read_current_migration_version(&connection).expect("read migration version"),
            SCHEMA_VERSION
        );
        assert!(table_exists(&connection, "feeds").expect("feeds table exists"));
        assert!(table_exists(&connection, "articles").expect("articles table exists"));
        assert!(table_exists(&connection, "article_feed_items").expect("mapping table exists"));
        assert!(table_exists(&connection, "articles_search").expect("article FTS exists"));
        assert!(
            table_exists(&connection, "saved_articles_search").expect("saved article FTS exists")
        );
        assert!(has_column(&connection, "feeds", "last_favicon_refresh")
            .expect("feed favicon refresh column exists"));
        assert!(has_column(&connection, "feeds", "sort_order").expect("feed sort column exists"));
        assert!(
            index_exists(&connection, "idx_articles_unsaved_hash").expect("query index exists"),
            "idx_articles_unsaved_hash should exist after migrations"
        );
    }

    #[test]
    fn migration_16_recreates_unsaved_hash_index_on_upgrade_from_v15() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");

        connection
            .execute("DROP INDEX IF EXISTS idx_articles_unsaved_hash", [])
            .expect("drop index");
        connection
            .execute("DELETE FROM _migrations WHERE version >= 16", [])
            .expect("rewind migration ledger");

        assert_eq!(
            read_current_migration_version(&connection).expect("read migration version"),
            15
        );
        assert!(
            !index_exists(&connection, "idx_articles_unsaved_hash").expect("query index"),
            "simulated v15 database should not have idx_articles_unsaved_hash"
        );

        run_migrations(&mut connection).expect("run migration 16");
        assert_eq!(
            read_current_migration_version(&connection).expect("read migration version"),
            SCHEMA_VERSION
        );
        assert!(
            index_exists(&connection, "idx_articles_unsaved_hash").expect("query index"),
            "migration 16 should add idx_articles_unsaved_hash"
        );
    }

    #[test]
    fn migration_18_swaps_flag_indexes_for_partial_date_indexes_on_v17_data() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");

        // Rewind to the v17 shape: single-column flag indexes, no partial ones.
        connection
            .execute_batch(
                r#"
                DROP INDEX idx_articles_starred_date;
                DROP INDEX idx_articles_saved_date;
                CREATE INDEX idx_articles_starred ON articles(starred);
                CREATE INDEX idx_articles_saved ON articles(saved);
                DELETE FROM _migrations WHERE version >= 18;
                INSERT INTO feeds (id, title, url, created_at)
                  VALUES ('f1', 'Feed', 'https://example.com/rss', '2026-01-01T00:00:00Z');
                "#,
            )
            .expect("simulate v17 database");
        for index in 0..40 {
            connection
                .execute(
                    "INSERT INTO articles (hash, feed_id, published_date, fetched_date, read, starred, saved)
                     VALUES (?1, 'f1', ?2, ?2, ?3, ?4, ?5)",
                    params![
                        format!("h{index:02}"),
                        format!("2026-01-{:02}T00:00:00Z", 1 + index % 5),
                        index % 2,
                        i64::from(index % 3 == 0),
                        i64::from(index % 4 == 0)
                    ],
                )
                .expect("insert v17 article");
        }
        assert_eq!(read_current_migration_version(&connection).expect("version"), 17);

        run_migrations(&mut connection).expect("run migration 18");
        assert_eq!(
            read_current_migration_version(&connection).expect("version"),
            SCHEMA_VERSION
        );
        for (name, expected) in [
            ("idx_articles_starred", false),
            ("idx_articles_saved", false),
            ("idx_articles_starred_date", true),
            ("idx_articles_saved_date", true),
        ] {
            assert_eq!(index_exists(&connection, name).expect("index"), expected, "{name}");
        }
        let count = |sql: &str| -> i64 {
            connection.query_row(sql, [], |row| row.get(0)).expect("count")
        };
        assert_eq!(count("SELECT COUNT(*) FROM articles"), 40, "migration keeps every row");
        assert_eq!(
            count("SELECT COUNT(*) FROM articles INDEXED BY idx_articles_starred_date WHERE starred = 1"),
            14
        );
        assert_eq!(
            count("SELECT COUNT(*) FROM articles INDEXED BY idx_articles_saved_date WHERE saved = 1"),
            10
        );

        // Startup self-healing must not bring the dropped indexes back.
        run_migrations(&mut connection).expect("rerun at current version");
        assert!(!index_exists(&connection, "idx_articles_starred").expect("index"));
        assert!(!index_exists(&connection, "idx_articles_saved").expect("index"));
    }

    fn matches(connection: &Connection, table: &str, query: &str) -> i64 {
        connection
            .query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE {table} MATCH ?1"),
                params![query],
                |row| row.get(0),
            )
            .expect("count matches")
    }

    fn search_triggers(connection: &Connection) -> Vec<String> {
        let mut statement = connection
            .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%search%' ORDER BY name")
            .expect("prepare");
        statement
            .query_map([], |row| row.get(0))
            .expect("query")
            .collect::<Result<_, _>>()
            .expect("read")
    }

    #[test]
    fn migration_19_backfills_body_text_in_batches_from_v18_data() {
        use crate::db::search::{body_search_backfill_pending, run_body_search_backfill_batch};

        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        rewind_to_v18_search(&connection);
        connection
            .execute(
                "INSERT INTO feeds (id, title, url, created_at) VALUES ('f1', 'Feed', 'https://example.com/rss', '2026-01-01T00:00:00Z')",
                [],
            )
            .expect("feed");
        for index in 0..1_200 {
            connection
                .execute(
                    "INSERT INTO articles (hash, feed_id, title, content, fetched_date) VALUES (?1, 'f1', ?2, ?3, '2026-01-01T00:00:00Z')",
                    params![
                        format!("h{index:04}"),
                        format!("headline{index}"),
                        format!("<p class=\"markup\">bodyword{index} common</p>")
                    ],
                )
                .expect("article");
        }
        connection
            .execute(
                "INSERT INTO saved_articles (id, article_hash, title, content, saved_date) VALUES ('s1', 'h0001', 'Kept', '<p>savedbody</p>', '2026-01-01')",
                [],
            )
            .expect("saved");
        assert_eq!(read_current_migration_version(&connection).expect("version"), 18);
        assert_eq!(matches(&connection, "articles_search", "headline7"), 1, "v18 title search");

        run_migrations(&mut connection).expect("run migration 19");
        assert_eq!(read_current_migration_version(&connection).expect("version"), SCHEMA_VERSION);
        assert!(body_search_backfill_pending(&connection).expect("pending"), "large library backfills later");
        // Startup is done; title search still works, body search not yet.
        assert_eq!(matches(&connection, "articles_search", "headline7"), 1);
        assert_eq!(matches(&connection, "articles_search", "common"), 0);
        // Restarting before the backfill finishes keeps the v18 index serving.
        run_migrations(&mut connection).expect("rerun during backfill");
        assert_eq!(matches(&connection, "articles_search", "headline7"), 1);

        let mut batches = 0;
        while !run_body_search_backfill_batch(&connection, 500).expect("backfill batch") {
            batches += 1;
            if batches == 1 {
                // Writes during the backfill reach the staging index through
                // its triggers and stay correct when the batch reaches them.
                connection
                    .execute(
                        "INSERT INTO articles (hash, feed_id, title, content, fetched_date) VALUES ('late', 'f1', 'Late', '<p>latebody</p>', '2026-01-02T00:00:00Z')",
                        [],
                    )
                    .expect("insert during backfill");
                connection
                    .execute("UPDATE articles SET content = '<p>editedbody</p>' WHERE hash = 'h1100'", [])
                    .expect("update during backfill");
                connection
                    .execute("DELETE FROM articles WHERE hash = 'h1101'", [])
                    .expect("delete during backfill");
                assert_eq!(matches(&connection, "articles_search", "headline5"), 1, "title search mid-backfill");
                let page = crate::db::articles::query_articles(
                    &connection,
                    crate::db::articles::ArticleQueryRequest {
                        search_text: Some("headline5".to_string()),
                        limit: Some(5),
                        ..Default::default()
                    },
                )
                .expect("list search mid-backfill");
                assert_eq!(page.articles[0].hash, "h0005");
            }
            assert!(batches < 20, "backfill must finish");
        }
        assert!(batches >= 3, "1,200 rows at 500 per batch take several batches: {batches}");

        assert!(!body_search_backfill_pending(&connection).expect("pending"));
        assert!(has_column(&connection, "articles_search", "body").expect("body column"));
        assert!(!table_exists(&connection, "articles_search_next").expect("staging gone"));
        assert_eq!(matches(&connection, "articles_search", "common"), 1_198, "one edited, one deleted");
        assert_eq!(matches(&connection, "articles_search", "bodyword7"), 1);
        assert_eq!(matches(&connection, "articles_search", "headline7"), 1);
        assert_eq!(matches(&connection, "articles_search", "latebody"), 1);
        assert_eq!(matches(&connection, "articles_search", "editedbody"), 1);
        assert_eq!(matches(&connection, "articles_search", "bodyword1100"), 0);
        assert_eq!(matches(&connection, "articles_search", "bodyword1101"), 0);
        assert_eq!(matches(&connection, "articles_search", "markup"), 0);
        assert_eq!(matches(&connection, "saved_articles_search", "savedbody"), 1);
        assert_eq!(
            search_triggers(&connection),
            vec![
                "articles_search_ad", "articles_search_ai", "articles_search_au",
                "saved_articles_search_ad", "saved_articles_search_ai", "saved_articles_search_au",
            ]
        );

        // The swapped-in index is live: triggers index new rows' bodies.
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, title, content, fetched_date) VALUES ('after', 'f1', 'After', '<p>afterbody</p>', '2026-01-03T00:00:00Z')",
                [],
            )
            .expect("insert after swap");
        assert_eq!(matches(&connection, "articles_search", "afterbody"), 1);
        run_migrations(&mut connection).expect("rerun after backfill");
        assert_eq!(matches(&connection, "articles_search", "common"), 1_198, "one edited, one deleted");
    }

    #[test]
    fn migration_19_switches_an_empty_v18_library_immediately() {
        let mut connection = Connection::open_in_memory().expect("open in-memory database");
        run_migrations(&mut connection).expect("run migrations");
        rewind_to_v18_search(&connection);

        run_migrations(&mut connection).expect("run migration 19");
        assert!(has_column(&connection, "articles_search", "body").expect("body column"));
        assert!(!table_exists(&connection, "search_backfill").expect("no backfill"));
    }

    fn index_exists(connection: &Connection, name: &str) -> Result<bool, String> {
        connection
            .query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM sqlite_master
                    WHERE type = 'index' AND name = ?1
                )",
                params![name],
                |row| row.get::<_, i64>(0),
            )
            .map(|exists| exists == 1)
            .map_err(|error| format!("Failed to inspect index {name}: {error}"))
    }
}
