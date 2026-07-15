pub const SCHEMA_VERSION: i64 = 16;

pub const CREATE_TABLES: &str = r#"
  CREATE TABLE IF NOT EXISTS feeds (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    url             TEXT NOT NULL UNIQUE,
    created_at      TEXT NOT NULL,
    description     TEXT,
    last_fetched    TEXT,
    last_failed_fetch_at TEXT,
    unread_count    INTEGER DEFAULT 0,
    article_count   INTEGER DEFAULT 0,
    tags_json       TEXT DEFAULT '[]',
    favicon         TEXT,
    favicon_has_transparency INTEGER,
    favicon_dominant_color   TEXT,
    favicon_bg_light TEXT,
    favicon_bg_dark  TEXT,
    favicon_fetch_failed INTEGER DEFAULT 0,
    emoji           TEXT,
    image           TEXT,
    categories_json TEXT,
    language        TEXT,
    is_podcast      INTEGER DEFAULT 0,
    podcast_metadata_json TEXT,
    reader_mode_enabled INTEGER DEFAULT 0,
    etag            TEXT,
    last_modified_header TEXT
  );

  CREATE TABLE IF NOT EXISTS articles (
    hash            TEXT PRIMARY KEY,
    feed_id         TEXT NOT NULL,
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    content         TEXT NOT NULL DEFAULT '',
    link            TEXT,
    author          TEXT,
    published_date  TEXT,
    fetched_date    TEXT NOT NULL,
    read            INTEGER NOT NULL DEFAULT 0,
    starred         INTEGER NOT NULL DEFAULT 0,
    saved           INTEGER NOT NULL DEFAULT 0,
    saved_article_id TEXT,
    last_read_at    TEXT,
    metadata_json   TEXT,
    feed_url        TEXT,
    feed_title      TEXT,
    feed_favicon    TEXT,
    feed_favicon_has_transparency INTEGER,
    feed_favicon_bg_light TEXT,
    feed_favicon_bg_dark  TEXT,
    feed_image      TEXT,
    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS article_feed_items (
    feed_id        TEXT NOT NULL,
    article_hash   TEXT NOT NULL,
    published_date TEXT,
    fetched_date   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (feed_id, article_hash),
    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
    FOREIGN KEY (article_hash) REFERENCES articles(hash) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS tags (
     name       TEXT PRIMARY KEY,
     color      TEXT,
     emoji      TEXT,
     created_at TEXT NOT NULL,
     sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS feed_tags (
    feed_id  TEXT NOT NULL,
    tag_name TEXT NOT NULL,
    PRIMARY KEY (feed_id, tag_name),
    FOREIGN KEY (feed_id) REFERENCES feeds(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_name) REFERENCES tags(name) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS saved_articles (
    id                TEXT PRIMARY KEY,
    article_hash      TEXT NOT NULL,
    title             TEXT,
    description       TEXT,
    content           TEXT,
    link              TEXT,
    author            TEXT,
    published_date    TEXT,
    saved_date        TEXT NOT NULL,
    last_read_at      TEXT,
    feed_id           TEXT,
    feed_url          TEXT,
    feed_title        TEXT,
    feed_favicon      TEXT,
    feed_favicon_has_transparency INTEGER,
    feed_favicon_bg_light TEXT,
    feed_favicon_bg_dark  TEXT,
    preview_image     TEXT,
    metadata_json      TEXT,
    highlights_json   TEXT DEFAULT '[]',
    notes             TEXT
  );
"#;

pub const CREATE_INDEXES: &str = r#"
  CREATE INDEX IF NOT EXISTS idx_articles_feed_id        ON articles(feed_id);
  CREATE INDEX IF NOT EXISTS idx_articles_effective_date ON articles(COALESCE(published_date, fetched_date) DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_read           ON articles(read, COALESCE(published_date, fetched_date) DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_starred        ON articles(starred);
  CREATE INDEX IF NOT EXISTS idx_articles_feed_date      ON articles(feed_id, COALESCE(published_date, fetched_date) DESC);
  CREATE INDEX IF NOT EXISTS idx_articles_saved          ON articles(saved);
  CREATE INDEX IF NOT EXISTS idx_feed_tags_tag_feed      ON feed_tags(tag_name, feed_id);
  CREATE INDEX IF NOT EXISTS idx_article_feed_items_hash ON article_feed_items(article_hash);
  CREATE INDEX IF NOT EXISTS idx_article_feed_items_feed_date ON article_feed_items(feed_id, COALESCE(published_date, fetched_date) DESC, article_hash);
  CREATE INDEX IF NOT EXISTS idx_saved_articles_hash     ON saved_articles(article_hash);
  CREATE INDEX IF NOT EXISTS idx_saved_articles_date     ON saved_articles(saved_date DESC);
"#;

pub const CREATE_SEARCH_INDEXES: &str = r#"
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
