use rusqlite::{functions::FunctionFlags, params, types::ValueRef, Connection, OptionalExtension};

use super::{
    schema::{staging_search_indexes_sql, CREATE_SEARCH_INDEXES},
    with_savepoint,
};

/// Plain-text characters of article body indexed per row. Keeps the body
/// index bounded for very long articles (full-text feeds, saved pages).
pub const SEARCH_BODY_MAX_CHARS: usize = 20_000;

/// HTML read per row before stripping, so a huge page cannot stall a write.
/// Generous next to the text cap because markup is usually most of the bytes.
const SEARCH_BODY_MAX_INPUT_BYTES: usize = 256 * 1024;

/// SQL function the search triggers use to turn `content` HTML into the
/// indexed body text. Registered on the writer by `run_migrations`.
pub const SEARCH_BODY_FUNCTION: &str = "kiji_search_body";

/// Rows per backfill batch; each batch is one short writer transaction.
pub const SEARCH_BACKFILL_BATCH_SIZE: i64 = 200;

/// Characters of body text shown around the first match in a result row.
const SNIPPET_MAX_CHARS: usize = 180;
const SNIPPET_LEAD_CHARS: usize = 50;

fn search_tokens(search_text: &str) -> impl Iterator<Item = &str> {
    search_text
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty())
}

pub fn create_fts_prefix_query(search_text: &str) -> Option<String> {
    let tokens = search_tokens(search_text)
        // FTS5 treats bare uppercase words such as AND, OR, NOT, and NEAR as
        // operators. Quote every user token so all input remains a literal
        // prefix term instead of occasionally becoming invalid FTS syntax.
        .map(|token| format!("\"{}\"*", token.replace('"', "\"\"")))
        .collect::<Vec<_>>();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

/// `WITH` clause for a search statement: the rowids whose title,
/// description or author match `fts_query`, materialized once so every
/// [`search_tier_sql`] use in the statement (select list, keyset cursor,
/// grouped station page) shares one FTS lookup. On the v18 table (no `body`
/// column, backfill still running) it holds every match.
///
/// `fts_query` comes from [`create_fts_prefix_query`] (quoted alphanumeric
/// tokens only); it is inlined so the clause does not shift the statement's
/// positional parameters.
pub fn search_meta_cte_sql(table: &str, fts_query: &str) -> String {
    let meta_query = format!("{{title description author}} : ({fts_query})").replace('\'', "''");
    format!(
        "WITH search_meta(rowid) AS MATERIALIZED (SELECT rowid FROM {table} WHERE {table} MATCH '{meta_query}')\n"
    )
}

/// Search result tier for the row whose FTS rowid is `rowid_expr` (needs
/// [`search_meta_cte_sql`] on the statement): 0 when the match is in title,
/// description or author, 1 when it is only in the body. A column-filtered
/// match rather than bm25 weights: SQLite rejects FTS5 auxiliary functions
/// in the grouped station query, and a float score cannot key a stable
/// paging cursor.
pub fn search_tier_sql(rowid_expr: &str) -> String {
    format!("(CASE WHEN {rowid_expr} IN search_meta THEN 0 ELSE 1 END)")
}

/// Indexed body text: HTML stripped to plain text (tags, attributes, scripts
/// and styles dropped, entities decoded), capped at [`SEARCH_BODY_MAX_CHARS`]
/// on a word boundary.
pub fn search_body_text(html: &str) -> String {
    if html.is_empty() {
        return String::new();
    }
    let input = truncate_at_char_boundary(html, SEARCH_BODY_MAX_INPUT_BYTES);
    let text = crate::mcp::format::html_to_text(input);
    match text.char_indices().nth(SEARCH_BODY_MAX_CHARS) {
        None => text,
        Some((cut, _)) => {
            let head = &text[..cut];
            // Drop a partial trailing word so the cap never indexes a fragment.
            let end = head
                .rfind(char::is_whitespace)
                .filter(|_| !text[cut..].starts_with(char::is_whitespace))
                .unwrap_or(cut);
            head[..end].trim_end().to_string()
        }
    }
}

fn truncate_at_char_boundary(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

pub fn register_search_functions(connection: &Connection) -> Result<(), String> {
    connection
        .create_scalar_function(
            SEARCH_BODY_FUNCTION,
            1,
            FunctionFlags::SQLITE_UTF8 | FunctionFlags::SQLITE_DETERMINISTIC,
            |context| {
                Ok(match context.get_raw(0) {
                    ValueRef::Text(bytes) => search_body_text(&String::from_utf8_lossy(bytes)),
                    _ => String::new(),
                })
            },
        )
        .map_err(|error| format!("Failed to register search functions: {error}"))
}

/// Short plain-text excerpt around the first word in `html` that starts with
/// one of the search tokens, for result rows that matched only in the body.
pub fn body_snippet(html: &str, search_text: &str) -> Option<String> {
    let tokens: Vec<String> = search_tokens(search_text).map(str::to_lowercase).collect();
    if tokens.is_empty() {
        return None;
    }
    let text = search_body_text(html).replace('\n', " ");
    let mut word_start: Option<usize> = None;
    let mut match_start: Option<usize> = None;
    for (index, character) in text.char_indices().chain(std::iter::once((text.len(), ' '))) {
        if character.is_alphanumeric() {
            word_start.get_or_insert(index);
            continue;
        }
        if let Some(start) = word_start.take() {
            let word = text[start..index].to_lowercase();
            if tokens.iter().any(|token| word.starts_with(token.as_str())) {
                match_start = Some(start);
                break;
            }
        }
    }
    let match_start = match_start?;

    let chars_before = text[..match_start].chars().count();
    let skip = chars_before.saturating_sub(SNIPPET_LEAD_CHARS);
    let mut start = text.char_indices().nth(skip).map_or(0, |(index, _)| index);
    if start > 0 {
        // Start on a word boundary, never inside the word before the match.
        start = text[start..match_start]
            .find(char::is_whitespace)
            .map_or(match_start, |offset| start + offset + 1);
    }
    let rest = &text[start..];
    let mut end = rest
        .char_indices()
        .nth(SNIPPET_MAX_CHARS)
        .map_or(rest.len(), |(index, _)| index);
    if end < rest.len() {
        end = rest[..end].rfind(char::is_whitespace).unwrap_or(end);
    }
    let body = rest[..end].trim();
    if body.is_empty() {
        return None;
    }
    // ASCII dots: the list renders non-ASCII runs in the CJK fallback font,
    // where a single ellipsis character sits mid-line.
    let prefix = if start > 0 { "..." } else { "" };
    let suffix = if end < rest.len() { "..." } else { "" };
    Some(format!("{prefix}{body}{suffix}"))
}

/// Present while v19's body backfill is still running: one row per source
/// table with the last rowid copied into the staging index.
const BACKFILL_TABLE: &str = "search_backfill";

struct SearchIndexTarget {
    source: &'static str,
    staging: &'static str,
    title: &'static str,
    description: &'static str,
    author: &'static str,
    content: &'static str,
}

const SEARCH_INDEX_TARGETS: [SearchIndexTarget; 2] = [
    SearchIndexTarget {
        source: "articles",
        staging: "articles_search_next",
        title: "title",
        description: "description",
        author: "COALESCE(author, '')",
        content: "content",
    },
    SearchIndexTarget {
        source: "saved_articles",
        staging: "saved_articles_search_next",
        title: "COALESCE(title, '')",
        description: "COALESCE(description, '')",
        author: "COALESCE(author, '')",
        content: "content",
    },
];

/// v19 entry point. Fresh or empty libraries switch to the body index right
/// away; libraries with rows keep the v18 index serving title/description/
/// author search while [`run_body_search_backfill_batch`] fills a staging
/// index off the startup thread.
pub(crate) fn start_body_search_migration(connection: &Connection) -> Result<(), String> {
    if search_index_has_body(connection)? {
        return Ok(());
    }
    let has_rows = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM articles) OR EXISTS(SELECT 1 FROM saved_articles)",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Failed to inspect library size: {error}"))?;
    if !has_rows {
        return swap_in_body_search_index(connection);
    }

    connection
        .execute_batch(&staging_search_indexes_sql())
        .map_err(|error| format!("Failed to create the staging search index: {error}"))?;
    connection
        .execute_batch(&format!(
            "CREATE TABLE IF NOT EXISTS {BACKFILL_TABLE} (
               source TEXT PRIMARY KEY,
               last_rowid INTEGER NOT NULL
             );
             INSERT OR IGNORE INTO {BACKFILL_TABLE} (source, last_rowid)
               VALUES ('articles', 0), ('saved_articles', 0);"
        ))
        .map_err(|error| format!("Failed to schedule the search backfill: {error}"))
}

pub(crate) fn body_search_backfill_pending(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
            params![BACKFILL_TABLE],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Failed to inspect the search backfill: {error}"))
}

/// Copies the next batch of rows into the staging index, or swaps the
/// staging index in once every source table is done. Returns `true` when
/// nothing is left. Each call is one savepoint, so the writer is released
/// between batches and an interrupted backfill resumes from its cursor.
pub(crate) fn run_body_search_backfill_batch(
    connection: &Connection,
    batch_size: i64,
) -> Result<bool, String> {
    if !body_search_backfill_pending(connection)? {
        return Ok(true);
    }
    with_savepoint(connection, "search_backfill", |connection| {
        let next = connection
            .query_row(
                &format!("SELECT source, last_rowid FROM {BACKFILL_TABLE} ORDER BY source LIMIT 1"),
                [],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()
            .map_err(|error| format!("Failed to read the search backfill cursor: {error}"))?;
        let Some((source, last_rowid)) = next else {
            swap_in_body_search_index(connection)?;
            return Ok(true);
        };
        let target = SEARCH_INDEX_TARGETS
            .iter()
            .find(|target| target.source == source)
            .ok_or_else(|| format!("Unknown search backfill source {source}."))?;

        let batch = format!(
            "SELECT rowid FROM {source} WHERE rowid > ?1 ORDER BY rowid LIMIT ?2",
            source = target.source
        );
        // Rows the staging triggers already indexed are replaced, not doubled.
        connection
            .execute(
                &format!("DELETE FROM {} WHERE rowid IN ({batch})", target.staging),
                params![last_rowid, batch_size],
            )
            .map_err(|error| format!("Failed to clear a search backfill batch: {error}"))?;
        connection
            .execute(
                &format!(
                    "INSERT INTO {staging}(rowid, title, description, author, body)
                     SELECT rowid, {title}, {description}, {author}, {SEARCH_BODY_FUNCTION}({content})
                     FROM {source} WHERE rowid IN ({batch})",
                    staging = target.staging,
                    title = target.title,
                    description = target.description,
                    author = target.author,
                    content = target.content,
                    source = target.source,
                ),
                params![last_rowid, batch_size],
            )
            .map_err(|error| format!("Failed to index a search backfill batch: {error}"))?;
        let batch_end = connection
            .query_row(
                &format!("SELECT MAX(rowid) FROM ({batch})"),
                params![last_rowid, batch_size],
                |row| row.get::<_, Option<i64>>(0),
            )
            .map_err(|error| format!("Failed to advance the search backfill: {error}"))?;
        match batch_end {
            Some(rowid) => connection.execute(
                &format!("UPDATE {BACKFILL_TABLE} SET last_rowid = ?1 WHERE source = ?2"),
                params![rowid, source],
            ),
            None => connection.execute(
                &format!("DELETE FROM {BACKFILL_TABLE} WHERE source = ?1"),
                params![source],
            ),
        }
        .map_err(|error| format!("Failed to save the search backfill cursor: {error}"))?;
        Ok(false)
    })
}

fn search_index_has_body(connection: &Connection) -> Result<bool, String> {
    connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('articles_search') WHERE name = 'body')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Failed to inspect the search index: {error}"))
}

/// Replaces the v18 title/description/author index with the body index in
/// one step: readers see either the old table or the complete new one.
fn swap_in_body_search_index(connection: &Connection) -> Result<(), String> {
    let staged = connection
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'articles_search_next')",
            [],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("Failed to inspect the staging search index: {error}"))?;
    let mut sql = String::new();
    for table in ["articles_search", "saved_articles_search"] {
        for suffix in ["", "_next"] {
            for trigger in ["ai", "ad", "au"] {
                sql.push_str(&format!("DROP TRIGGER IF EXISTS {table}{suffix}_{trigger};\n"));
            }
        }
        sql.push_str(&format!("DROP TABLE IF EXISTS {table};\n"));
        if staged {
            sql.push_str(&format!("ALTER TABLE {table}_next RENAME TO {table};\n"));
        }
    }
    sql.push_str(CREATE_SEARCH_INDEXES);
    sql.push_str(&format!("DROP TABLE IF EXISTS {BACKFILL_TABLE};\n"));
    connection
        .execute_batch(&sql)
        .map_err(|error| format!("Failed to switch to the body search index: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{
        articles::{query_articles, ArticleQueryRequest},
        migrations::run_migrations,
        saved::{query_saved_articles, SavedArticleQueryRequest},
    };

    fn library() -> Connection {
        let mut connection = Connection::open_in_memory().expect("open database");
        run_migrations(&mut connection).expect("migrate");
        connection
            .execute_batch(
                "INSERT INTO feeds (id, title, url, created_at) VALUES
                   ('f1', 'One', 'https://one.example/rss', '2026-01-01T00:00:00Z'),
                   ('f2', 'Two', 'https://two.example/rss', '2026-01-01T00:00:00Z');
                 INSERT INTO tags (name, created_at) VALUES ('Tech', '2026-01-01T00:00:00Z');
                 INSERT INTO feed_tags (feed_id, tag_name) VALUES ('f1', 'Tech'), ('f2', 'Tech');",
            )
            .expect("seed feeds");
        connection
    }

    struct Seed<'a> {
        hash: &'a str,
        feed: &'a str,
        title: &'a str,
        description: &'a str,
        author: Option<&'a str>,
        content: &'a str,
        date: &'a str,
    }

    fn add(connection: &Connection, seed: Seed<'_>) {
        connection
            .execute(
                "INSERT INTO articles (hash, feed_id, title, description, author, content, published_date, fetched_date)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                params![seed.hash, seed.feed, seed.title, seed.description, seed.author, seed.content, seed.date],
            )
            .expect("insert article");
        connection
            .execute(
                "INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date)
                 VALUES (?1, ?2, ?3, ?3)",
                params![seed.feed, seed.hash, seed.date],
            )
            .expect("insert mapping");
    }

    fn add_body(connection: &Connection, hash: &str, content: &str) {
        add(
            connection,
            Seed { hash, feed: "f1", title: "Untitled", description: "", author: None, content, date: "2026-03-01T00:00:00Z" },
        );
    }

    fn search(connection: &Connection, text: &str) -> Vec<String> {
        search_request(connection, ArticleQueryRequest {
            search_text: Some(text.to_string()),
            limit: Some(100),
            ..Default::default()
        })
    }

    fn search_request(connection: &Connection, request: ArticleQueryRequest) -> Vec<String> {
        query_articles(connection, request)
            .expect("search")
            .articles
            .into_iter()
            .map(|article| article.hash)
            .collect()
    }

    #[test]
    fn finds_words_in_the_article_body() {
        let connection = library();
        add_body(&connection, "a1", "<p>Notes on the <em>axolotl</em> habitat.</p>");
        add_body(&connection, "a2", "<p>Nothing to see here.</p>");

        assert_eq!(search(&connection, "axolotl"), vec!["a1"]);
        assert_eq!(search(&connection, "axol"), vec!["a1"], "prefix search covers the body");
        assert_eq!(search(&connection, "axolotl habitat"), vec!["a1"]);
        assert!(search(&connection, "axolotl zebra").is_empty());
    }

    #[test]
    fn html_markup_is_not_searchable() {
        let connection = library();
        add_body(
            &connection,
            "a1",
            r#"<div class="lede" data-track="zebrafish"><a href="https://quokka.example/ocelot" title="tapir">platypus</a>
               &amp; caf&eacute; &#39;wombat&#39;</div><script>var narwhal = 1;</script><style>.gecko{}</style>"#,
        );

        assert_eq!(search(&connection, "platypus"), vec!["a1"]);
        assert_eq!(search(&connection, "wombat"), vec!["a1"], "entities decode to text");
        for markup in ["lede", "zebrafish", "quokka", "ocelot", "tapir", "narwhal", "gecko", "div", "href", "amp", "track"] {
            assert!(search(&connection, markup).is_empty(), "{markup} must not be searchable");
        }
    }

    #[test]
    fn indexed_body_text_is_capped() {
        let filler = "lorem ".repeat(SEARCH_BODY_MAX_CHARS / 6);
        let html = format!("<p>beforecap {filler} aftercap</p>");
        let text = search_body_text(&html);
        assert!(text.chars().count() <= SEARCH_BODY_MAX_CHARS, "{}", text.chars().count());
        assert!(text.starts_with("beforecap"));
        assert!(!text.contains("aftercap"));
        assert!(text.ends_with("lorem"), "cap cuts on a word boundary");

        let connection = library();
        add_body(&connection, "long", &html);
        assert_eq!(search(&connection, "beforecap"), vec!["long"]);
        assert!(search(&connection, "aftercap").is_empty(), "text past the cap is not indexed");
    }

    #[test]
    fn title_description_and_author_matches_rank_above_body_only_matches() {
        let connection = library();
        // Body-only matches are the newest, so date order alone would list them first.
        for (hash, feed, title, description, author, content, date) in [
            ("body-new", "f1", "Weekly", "", None, "<p>All about kestrels.</p>", "2026-05-05T00:00:00Z"),
            ("body-old", "f2", "Daily", "", None, "<p>Kestrel sighting.</p>", "2026-05-04T00:00:00Z"),
            ("title", "f1", "Kestrel facts", "", None, "", "2026-05-01T00:00:00Z"),
            ("author", "f2", "Field notes", "", Some("Kestrel Smith"), "", "2026-05-03T00:00:00Z"),
            ("description", "f1", "Birds", "A kestrel hovers", None, "<p>kestrel</p>", "2026-05-02T00:00:00Z"),
            ("miss", "f1", "Sparrows", "", None, "<p>sparrow</p>", "2026-05-06T00:00:00Z"),
        ] {
            add(&connection, Seed { hash, feed, title, description, author, content, date });
        }
        let expected = vec!["author", "description", "title", "body-new", "body-old"];

        assert_eq!(search(&connection, "kestrel"), expected);

        // Keyset paging (one row per page) walks the same tiered order, in
        // the library list, a multi-feed station and a single feed.
        for (feed_ids, tag_name) in [
            (None, None),
            (None, Some("Tech".to_string())),
            (Some(vec!["f1".to_string(), "f2".to_string()]), None),
        ] {
            let mut pages = Vec::new();
            let mut cursor: Option<(String, String)> = None;
            loop {
                let page = query_articles(
                    &connection,
                    ArticleQueryRequest {
                        feed_ids: feed_ids.clone(),
                        tag_name: tag_name.clone(),
                        search_text: Some("kestrel".to_string()),
                        limit: Some(1),
                        cursor_date: cursor.as_ref().map(|(date, _)| date.clone()),
                        cursor_hash: cursor.as_ref().map(|(_, hash)| hash.clone()),
                        include_total: Some(false),
                        ..Default::default()
                    },
                )
                .expect("search page");
                let Some(article) = page.articles.into_iter().next() else { break };
                cursor = Some((article.published_date.clone().expect("date"), article.hash.clone()));
                pages.push(article.hash);
                assert!(pages.len() <= expected.len(), "paging must terminate: {pages:?}");
            }
            assert_eq!(pages, expected, "feed_ids={feed_ids:?} tag={tag_name:?}");
        }

        let single_feed = search_request(&connection, ArticleQueryRequest {
            feed_id: Some("f1".to_string()),
            search_text: Some("kestrel".to_string()),
            limit: Some(100),
            ..Default::default()
        });
        assert_eq!(single_feed, vec!["description", "title", "body-new"]);
    }

    #[test]
    fn search_keeps_read_and_source_filters() {
        let connection = library();
        add(&connection, Seed { hash: "r1", feed: "f1", title: "x", description: "", author: None, content: "<p>heron</p>", date: "2026-05-01T00:00:00Z" });
        add(&connection, Seed { hash: "r2", feed: "f2", title: "heron", description: "", author: None, content: "", date: "2026-05-02T00:00:00Z" });
        connection.execute("UPDATE articles SET read = 1 WHERE hash = 'r2'", []).expect("mark read");

        let unread = search_request(&connection, ArticleQueryRequest {
            search_text: Some("heron".to_string()),
            read: Some(false),
            limit: Some(100),
            ..Default::default()
        });
        assert_eq!(unread, vec!["r1"]);
        let feed_two = search_request(&connection, ArticleQueryRequest {
            feed_id: Some("f2".to_string()),
            search_text: Some("heron".to_string()),
            limit: Some(100),
            ..Default::default()
        });
        assert_eq!(feed_two, vec!["r2"]);
    }

    #[test]
    fn body_only_rows_carry_a_snippet_of_the_match() {
        let connection = library();
        add(&connection, Seed { hash: "body", feed: "f1", title: "Weekly", description: "Summary", author: None,
            content: "<p>Long intro text that goes on for a while before the point. Then the <b>pelican</b> lands on the pier and waits.</p>",
            date: "2026-05-02T00:00:00Z" });
        add(&connection, Seed { hash: "title", feed: "f1", title: "Pelican news", description: "Summary", author: None,
            content: "<p>pelican</p>", date: "2026-05-01T00:00:00Z" });

        let page = query_articles(&connection, ArticleQueryRequest {
            search_text: Some("pelic".to_string()),
            limit: Some(100),
            ..Default::default()
        })
        .expect("search");
        assert_eq!(page.search_snippets.len(), 1, "{:?}", page.search_snippets);
        let snippet = &page.search_snippets["body"];
        assert!(snippet.contains("pelican lands"), "{snippet}");
        assert!(!snippet.contains('<'), "{snippet}");

        let plain = query_articles(&connection, ArticleQueryRequest { limit: Some(100), ..Default::default() })
            .expect("list");
        assert!(plain.search_snippets.is_empty());
    }

    #[test]
    fn snippet_starts_on_a_word_near_the_match() {
        let text = format!("<p>{} needle in the haystack {}</p>", "alpha ".repeat(40), "omega ".repeat(60));
        let snippet = body_snippet(&text, "NEEDLE").expect("snippet");
        assert!(snippet.starts_with("...alpha"), "{snippet}");
        assert!(snippet.contains("needle in the haystack"), "{snippet}");
        assert!(snippet.ends_with("omega..."), "{snippet}");
        assert!(snippet.chars().count() <= SNIPPET_MAX_CHARS + 6, "{snippet}");
        assert_eq!(body_snippet("<p>short needle</p>", "needle").as_deref(), Some("short needle"));
        assert_eq!(body_snippet("<p>no match</p>", "needle"), None);
        assert_eq!(body_snippet("<a href=\"needle\">x</a>", "needle"), None, "markup never matches");
    }

    #[test]
    fn triggers_keep_the_body_index_in_sync() {
        let connection = library();
        add_body(&connection, "a1", "<p>first lynx</p>");
        assert_eq!(search(&connection, "lynx"), vec!["a1"]);

        connection
            .execute("UPDATE articles SET content = '<p>second puma</p>' WHERE hash = 'a1'", [])
            .expect("update content");
        assert!(search(&connection, "lynx").is_empty(), "old body words leave the index");
        assert_eq!(search(&connection, "puma"), vec!["a1"]);

        // Flag updates leave the index alone and keep the row searchable.
        connection.execute("UPDATE articles SET read = 1 WHERE hash = 'a1'", []).expect("mark read");
        assert_eq!(search(&connection, "puma"), vec!["a1"]);

        connection.execute("DELETE FROM articles WHERE hash = 'a1'", []).expect("delete");
        assert!(search(&connection, "puma").is_empty());
        let indexed: i64 = connection
            .query_row("SELECT COUNT(*) FROM articles_search WHERE articles_search MATCH 'puma'", [], |row| row.get(0))
            .expect("count index rows");
        assert_eq!(indexed, 0);
    }

    fn saved_search(connection: &Connection, text: &str) -> (Vec<String>, std::collections::HashMap<String, String>) {
        let response = query_saved_articles(
            connection,
            SavedArticleQueryRequest {
                limit: Some(100),
                offset: None,
                search_text: Some(text.to_string()),
                search_epoch: None,
                include_total: Some(true),
            },
        )
        .expect("saved search");
        assert_eq!(response.total as usize, response.articles.len());
        (response.articles.into_iter().map(|article| article.id).collect(), response.search_snippets)
    }

    #[test]
    fn saved_article_search_covers_saved_content() {
        let connection = library();
        for (id, title, content, saved_date) in [
            ("s-body", "Recipe", "<p>Slow-cooked <i>cassoulet</i> with beans.</p><script>var risotto;</script>", "2026-05-03T00:00:00Z"),
            ("s-title", "Cassoulet guide", "<p>beans</p>", "2026-05-01T00:00:00Z"),
            ("s-miss", "Soup", "<p>broth</p>", "2026-05-04T00:00:00Z"),
        ] {
            connection
                .execute(
                    "INSERT INTO saved_articles (id, article_hash, title, content, saved_date) VALUES (?1, ?1, ?2, ?3, ?4)",
                    params![id, title, content, saved_date],
                )
                .expect("insert saved");
        }

        let (ids, snippets) = saved_search(&connection, "cassoulet");
        assert_eq!(ids, vec!["s-title", "s-body"], "title match ranks above the newer body-only match");
        assert!(snippets["s-body"].contains("cassoulet"), "{snippets:?}");
        assert!(!snippets.contains_key("s-title"));
        assert!(saved_search(&connection, "risotto").0.is_empty(), "scripts are not indexed");

        connection
            .execute("UPDATE saved_articles SET content = '<p>gumbo</p>' WHERE id = 's-body'", [])
            .expect("update saved content");
        assert_eq!(saved_search(&connection, "gumbo").0, vec!["s-body"]);
        assert_eq!(saved_search(&connection, "cassoulet").0, vec!["s-title"]);
        connection.execute("DELETE FROM saved_articles WHERE id = 's-body'", []).expect("delete saved");
        assert!(saved_search(&connection, "gumbo").0.is_empty());
    }


    #[test]
    fn quotes_fts_operator_words_as_literal_prefixes() {
        assert_eq!(
            create_fts_prefix_query("AND OR NOT NEAR"),
            Some("\"AND\"* AND \"OR\"* AND \"NOT\"* AND \"NEAR\"*".to_string())
        );
    }

    #[test]
    fn keeps_unicode_tokens_and_discards_punctuation_only_input() {
        assert_eq!(
            create_fts_prefix_query("KiJi 日本語"),
            Some("\"KiJi\"* AND \"日本語\"*".to_string())
        );
        assert_eq!(create_fts_prefix_query("---"), None);
    }

    /// Size and timing report on a synthetic 100k-article library with ~3 KB
    /// HTML bodies, upgraded from the v18 index. Not a pass/fail check: run
    /// `cargo test --release --manifest-path src-tauri/Cargo.toml body_search_size_and_timing -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn body_search_size_and_timing_on_synthetic_library() {
        use std::time::Instant;

        const ARTICLES: usize = 100_000;
        const FEEDS: usize = 200;
        const VOCABULARY: usize = 30_000;
        let path = std::env::temp_dir().join("kiji-body-search-bench.sqlite");
        let _ = std::fs::remove_file(&path);
        let mut connection = Connection::open(&path).expect("open bench db");
        run_migrations(&mut connection).expect("migrate");
        crate::db::migrations::rewind_to_v18_search(&connection);

        let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let words: Vec<String> = (0..VOCABULARY)
            .map(|_| {
                let length = 3 + (next() % 9) as usize;
                (0..length).map(|_| (b'a' + (next() % 26) as u8) as char).collect()
            })
            .collect();
        // Zipf-like: a few very common words, a long tail of rare ones.
        let mut word = || {
            let unit = (next() % 1_000_000) as f64 / 1_000_000.0;
            words[((VOCABULARY as f64) * unit.powi(3)) as usize].as_str()
        };
        let mut sentence = |count: usize| (0..count).map(|_| word()).collect::<Vec<_>>().join(" ");

        let started = Instant::now();
        let transaction = connection.transaction().expect("seed transaction");
        for feed in 0..FEEDS {
            transaction
                .execute(
                    "INSERT INTO feeds (id, title, url, created_at) VALUES (?1, ?1, ?1, '2026-01-01')",
                    params![format!("f{feed}")],
                )
                .expect("feed");
            transaction
                .execute(
                    "INSERT OR IGNORE INTO tags (name, created_at) VALUES (?1, '2026-01-01')",
                    params![format!("t{}", feed % 10)],
                )
                .expect("tag");
            transaction
                .execute(
                    "INSERT INTO feed_tags (feed_id, tag_name) VALUES (?1, ?2)",
                    params![format!("f{feed}"), format!("t{}", feed % 10)],
                )
                .expect("feed tag");
        }
        let mut body_bytes = 0usize;
        for index in 0..ARTICLES {
            let mut body = String::new();
            while body.len() < 2_900 {
                body.push_str(&format!(
                    "<p class=\"para\">{} <a href=\"https://example.com/{}/{index}\">{}</a> <strong>{}</strong> {}.</p>\n",
                    sentence(30),
                    sentence(1),
                    sentence(2),
                    sentence(1),
                    sentence(25)
                ));
            }
            body_bytes += body.len();
            let feed = index % FEEDS;
            let date = format!("2026-{:02}-{:02}T{:02}:00:00Z", 1 + index % 9, 1 + (index / 9) % 28, (index / 300) % 24);
            transaction
                .execute(
                    "INSERT INTO articles (hash, feed_id, title, description, author, content, published_date, fetched_date, read)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8)",
                    params![
                        format!("h{index:08}"),
                        format!("f{feed}"),
                        sentence(7),
                        sentence(25),
                        sentence(2),
                        body,
                        date,
                        i64::from(index % 5 != 0)
                    ],
                )
                .expect("article");
            transaction
                .execute(
                    "INSERT INTO article_feed_items (feed_id, article_hash, published_date, fetched_date) VALUES (?1, ?2, ?3, ?3)",
                    params![format!("f{feed}"), format!("h{index:08}"), date],
                )
                .expect("mapping");
        }
        transaction.commit().expect("commit seed");
        println!(
            "seeded {ARTICLES} articles (avg body {} bytes HTML) in {:.1}s",
            body_bytes / ARTICLES,
            started.elapsed().as_secs_f64()
        );

        let size = |connection: &Connection, pattern: &str| -> f64 {
            connection
                .query_row("SELECT COALESCE(SUM(pgsize), 0) FROM dbstat WHERE name LIKE ?1", params![pattern], |row| {
                    row.get::<_, i64>(0)
                })
                .expect("dbstat") as f64
                / 1_048_576.0
        };
        let report = |connection: &Connection, label: &str| {
            let total = size(connection, "%");
            let index = size(connection, "articles_search%");
            println!("{label}: database {total:.1} MB, article search index {index:.1} MB ({:.1}% of database)", index / total * 100.0);
        };
        report(&connection, "v18 (title/description/author)");

        let queries = ["the", "ab", "abc", "zzq", "kestrel", "ab cd"];
        let fixed: Vec<String> = (0..4).map(|offset| words[VOCABULARY / 2 + offset].clone()).collect();
        let common = words[3].clone();
        let mut probes: Vec<String> = queries.iter().map(|query| query.to_string()).collect();
        probes.extend(fixed.iter().cloned());
        probes.push(common.clone());
        probes.push(format!("{} {}", common, fixed[0]));
        let median_ms = |connection: &Connection, request: &dyn Fn() -> ArticleQueryRequest| -> (f64, usize) {
            let mut rows = 0;
            let mut samples: Vec<f64> = (0..5)
                .map(|_| {
                    let started = Instant::now();
                    rows = query_articles(connection, request()).expect("search").articles.len();
                    started.elapsed().as_secs_f64() * 1000.0
                })
                .collect();
            samples.sort_by(|a, b| a.partial_cmp(b).expect("finite"));
            (samples[samples.len() / 2], rows)
        };
        let time_searches = |connection: &Connection, label: &str| {
            for probe in &probes {
                let library = median_ms(connection, &|| ArticleQueryRequest {
                    search_text: Some(probe.clone()),
                    sort_field: Some("published_date".to_string()),
                    sort_order: Some("desc".to_string()),
                    limit: Some(50),
                    include_total: Some(false),
                    ..Default::default()
                });
                let station = median_ms(connection, &|| ArticleQueryRequest {
                    tag_name: Some("t0".to_string()),
                    read: Some(false),
                    search_text: Some(probe.clone()),
                    sort_field: Some("published_date".to_string()),
                    sort_order: Some("desc".to_string()),
                    limit: Some(50),
                    include_total: Some(false),
                    ..Default::default()
                });
                let total: i64 = connection
                    .query_row(
                        "SELECT COUNT(*) FROM articles_search WHERE articles_search MATCH ?1",
                        params![create_fts_prefix_query(probe).expect("query")],
                        |row| row.get(0),
                    )
                    .expect("count");
                println!(
                    "{label} search {probe:?} ({total} matches): library page {:.1} ms ({} rows), unread station page {:.1} ms ({} rows)",
                    library.0, library.1, station.0, station.1
                );
            }
        };
        time_searches(&connection, "v18");

        let started = Instant::now();
        run_migrations(&mut connection).expect("migrate to v19");
        println!("v19 migration on the startup thread: {:.1} ms", started.elapsed().as_secs_f64() * 1000.0);
        let started = Instant::now();
        let mut batches = 0;
        let mut slowest = 0.0f64;
        loop {
            let batch_started = Instant::now();
            let done = run_body_search_backfill_batch(&connection, SEARCH_BACKFILL_BATCH_SIZE).expect("batch");
            slowest = slowest.max(batch_started.elapsed().as_secs_f64() * 1000.0);
            if done {
                break;
            }
            batches += 1;
        }
        println!(
            "backfill: {batches} batches of {SEARCH_BACKFILL_BATCH_SIZE} in {:.1}s (slowest batch {slowest:.0} ms; app adds a 25 ms pause per batch)",
            started.elapsed().as_secs_f64()
        );
        report(&connection, "v19 (plus body)");
        time_searches(&connection, "v19");

        for (label, options) in [("prefix '2 3 4'", "prefix='2 3 4'"), ("prefix '2'", "prefix='2'")] {
            let options = if options.is_empty() { String::new() } else { format!(", {options}") };
            connection
                .execute_batch(&format!(
                    "CREATE VIRTUAL TABLE alt_search USING fts5(hash UNINDEXED, title, description, author, body,
                       content='', contentless_delete=1, tokenize='unicode61'{options});
                     INSERT INTO alt_search(rowid, title, description, author, body)
                       SELECT rowid, title, description, COALESCE(author, ''), kiji_search_body(content) FROM articles;"
                ))
                .expect("alternative index");
            println!("alternative {label}: {:.1} MB", size(&connection, "alt_search%"));
            connection.execute_batch("DROP TABLE alt_search;").expect("drop alternative");
        }
        let _ = std::fs::remove_file(&path);
    }
}
