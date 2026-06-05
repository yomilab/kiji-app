use rusqlite::{params, Connection};

use super::schema::{CREATE_INDEXES, CREATE_SEARCH_INDEXES, CREATE_TABLES, SCHEMA_VERSION};

type MigrationFn = fn(&Connection) -> Result<(), String>;

struct MigrationStep {
    version: i64,
    up: MigrationFn,
}

pub fn run_migrations(connection: &mut Connection) -> Result<(), String> {
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
    ensure_article_feed_items(connection)?;
    ensure_saved_article_metadata_column(connection)?;
    ensure_query_indexes(connection)?;
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

fn rebuild_search_indexes(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(CREATE_SEARCH_INDEXES)
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
    }
}
