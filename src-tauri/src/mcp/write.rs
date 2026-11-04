//! Assistant write tools: mark read/unread, star, save. Listed and callable
//! only while **Allow assistants to make changes** is on (off by default).
//!
//! - Every write runs on the app's single writer connection through the same
//!   helpers as the renderer's commands (`db::articles`, `db::saved`), so each
//!   persisted field keeps one writer.
//! - Targets go through the sharing filter (`query::article_is_exposed`), with
//!   the same current-article exception as reads. Hidden = "not found".
//! - The returned [`LibraryChange`] is emitted to every window
//!   (`LIBRARY_CHANGED_EVENT`) so lists, counts and the saved view refresh.
//!   The renderer only applies it; it never writes these fields again.

use super::current::{CurrentArticle, CurrentArticleKind};
use super::query::{self, Exposure};
use super::settings::AssistantSettings;
use crate::db::articles::{
    get_article, set_article_starred, sync_feed_article_counts_batch, update_article_read,
    update_article_saved_state, FeedArticleCounts,
};
use crate::db::saved::{get_saved_article_by_hash, get_saved_article_by_link, insert_saved_article};
use crate::db::{with_savepoint, ArticleRecord, SavedArticleRecord};
use rusqlite::{params_from_iter, types::Value as SqlValue, Connection};
use serde::Serialize;
use serde_json::{json, Map, Value};

/// Tauri event carrying a [`LibraryChange`] to every window.
pub const LIBRARY_CHANGED_EVENT: &str = "assistant-library-changed";
pub const MAX_WRITE_HASHES: usize = 100;

pub const WRITE_TOOL_NAMES: [&str; 3] = ["mark_read", "set_starred", "save_article"];

pub fn is_write_tool(name: &str) -> bool {
    WRITE_TOOL_NAMES.contains(&name)
}

pub const CHANGES_OFF_MESSAGE: &str =
    "Changes are turned off. The user can allow them in Yomi Reader Settings -> Assistant -> Allow assistants to make changes.";

#[derive(Clone, Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArticleChange {
    pub hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub saved_article_id: Option<String>,
}

/// What changed, for the renderer. Counts are already persisted.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryChange {
    pub articles: Vec<ArticleChange>,
    pub feed_counts: Vec<FeedArticleCounts>,
    /// Saved snapshots created by this change (saved view insert, folder sync).
    pub saved_article_ids: Vec<String>,
}

impl LibraryChange {
    pub fn is_empty(&self) -> bool {
        self.articles.is_empty() && self.feed_counts.is_empty() && self.saved_article_ids.is_empty()
    }
}

pub struct SavedSnapshot {
    pub id: String,
    pub title: Option<String>,
}

pub struct WriteOutcome {
    pub text: String,
    pub structured: Value,
    pub change: LibraryChange,
    pub created_saved: Option<SavedSnapshot>,
}

fn annotations(title: &str, idempotent: bool) -> Value {
    json!({
        "title": title,
        "readOnlyHint": false,
        "destructiveHint": false,
        "idempotentHint": idempotent,
        "openWorldHint": false
    })
}

fn target_properties() -> Map<String, Value> {
    let mut properties = Map::new();
    properties.insert(
        "hash".into(),
        json!({ "type": "string", "description": "Article hash. Leave out (with `hashes`) to use the article open in Yomi Reader." }),
    );
    properties.insert(
        "hashes".into(),
        json!({ "type": "array", "items": { "type": "string" }, "maxItems": MAX_WRITE_HASHES, "description": "Several article hashes at once." }),
    );
    properties
}

pub fn tool_definitions() -> Vec<Value> {
    let mut read_properties = target_properties();
    read_properties.insert(
        "read".into(),
        json!({ "type": "boolean", "default": true, "description": "false marks the articles unread." }),
    );
    let mut star_properties = target_properties();
    star_properties.insert("starred".into(), json!({ "type": "boolean", "description": "true stars, false unstars." }));
    vec![
        json!({
            "name": "mark_read",
            "title": "Mark read",
            "description": "Mark articles read (or unread with read=false) in Yomi Reader. Only when the user asks.",
            "inputSchema": { "type": "object", "properties": read_properties },
            "annotations": annotations("Mark read", true)
        }),
        json!({
            "name": "set_starred",
            "title": "Star article",
            "description": "Star or unstar articles in Yomi Reader. Only when the user asks.",
            "inputSchema": { "type": "object", "properties": star_properties, "required": ["starred"] },
            "annotations": annotations("Star article", true)
        }),
        json!({
            "name": "save_article",
            "title": "Save article",
            "description": "Save an article to the user's Saved articles in Yomi Reader (a snapshot of the stored text). Only when the user asks.",
            "inputSchema": {
                "type": "object",
                "properties": { "hash": { "type": "string", "description": "Article hash. Leave out to save the article open in Yomi Reader." } }
            },
            "annotations": annotations("Save article", true)
        }),
    ]
}

/// Runs a write tool on the writer connection. `Err` = tool error text.
pub fn run(
    conn: &Connection,
    settings: &AssistantSettings,
    current: Option<&CurrentArticle>,
    name: &str,
    args: &Value,
) -> Result<WriteOutcome, String> {
    if !settings.allow_changes {
        return Err(CHANGES_OFF_MESSAGE.to_string());
    }
    let exposure = Exposure::from_settings(settings);
    match name {
        "mark_read" => {
            let read = args.get("read").and_then(Value::as_bool).unwrap_or(true);
            let targets = resolve_targets(conn, &exposure, current, args, true)?;
            with_savepoint(conn, "assistant_mark_read", |conn| mark_read(conn, targets, read))
        }
        "set_starred" => {
            let starred = args
                .get("starred")
                .and_then(Value::as_bool)
                .ok_or_else(|| "Give `starred`: true to star, false to unstar.".to_string())?;
            let targets = resolve_targets(conn, &exposure, current, args, true)?;
            with_savepoint(conn, "assistant_set_starred", |conn| set_starred(conn, targets, starred))
        }
        "save_article" => {
            if !settings.share_saved_articles {
                return Err("Saved articles aren't shared with assistants, so they can't save either. The user can turn on Saved articles in Yomi Reader Settings -> Assistant.".to_string());
            }
            let targets = resolve_targets(conn, &exposure, current, args, false)?;
            let hash = targets.found.into_iter().next().ok_or_else(|| not_found(&targets.missing))?;
            with_savepoint(conn, "assistant_save_article", |conn| save_article(conn, &hash))
        }
        _ => Err(format!("Unknown tool: {name}")),
    }
}

struct Targets {
    found: Vec<String>,
    missing: Vec<String>,
}

fn not_found(missing: &[String]) -> String {
    match missing {
        [] => "No shared article to change.".to_string(),
        [one] => format!("No shared article with hash `{one}`. It may be in a station that isn't shared, or it was removed."),
        many => format!("No shared articles with these hashes: {}.", many.join(", ")),
    }
}

/// The article open in Yomi Reader, when it is a stored feed article.
fn current_hash(current: Option<&CurrentArticle>) -> Option<&str> {
    let current = current?;
    match current.kind {
        CurrentArticleKind::Feed | CurrentArticleKind::Saved => current.hash.as_deref(),
        CurrentArticleKind::Temporary => None,
    }
}

fn resolve_targets(
    conn: &Connection,
    exposure: &Exposure,
    current: Option<&CurrentArticle>,
    args: &Value,
    allow_many: bool,
) -> Result<Targets, String> {
    let mut requested: Vec<String> = Vec::new();
    if allow_many {
        if let Some(list) = args.get("hashes").and_then(Value::as_array) {
            for value in list {
                if let Some(hash) = value.as_str().map(str::trim).filter(|hash| !hash.is_empty()) {
                    if !requested.iter().any(|existing| existing == hash) {
                        requested.push(hash.to_string());
                    }
                }
            }
        }
    }
    if let Some(hash) = args.get("hash").and_then(Value::as_str).map(str::trim).filter(|hash| !hash.is_empty()) {
        if !requested.iter().any(|existing| existing == hash) {
            requested.push(hash.to_string());
        }
    }
    if requested.len() > MAX_WRITE_HASHES {
        return Err(format!("Change at most {MAX_WRITE_HASHES} articles at once."));
    }
    let open_hash = current_hash(current);
    if requested.is_empty() {
        let hash = open_hash.ok_or_else(|| {
            "Give an article `hash` (from list_articles), or open a feed article in Yomi Reader.".to_string()
        })?;
        requested.push(hash.to_string());
    }
    let mut targets = Targets { found: Vec::new(), missing: Vec::new() };
    for hash in requested {
        // Same rule as reads: shared stations, plus the article the user is
        // looking at right now.
        let visible = query::article_is_exposed(conn, exposure, &hash)?
            || (open_hash == Some(hash.as_str()) && query::article_is_exposed(conn, &Exposure::everything(), &hash)?);
        if visible {
            targets.found.push(hash);
        } else {
            targets.missing.push(hash);
        }
    }
    Ok(targets)
}

fn flag(conn: &Connection, column: &str, hash: &str) -> Result<bool, String> {
    conn.query_row(&format!("SELECT {column} FROM articles WHERE hash = ?1"), [hash], |row| row.get::<_, i64>(0))
        .map(|value| value != 0)
        .map_err(|error| format!("Failed to read article state: {error}"))
}

/// Every subscription that lists these articles (counts are per mapping).
fn feeds_for_articles(conn: &Connection, hashes: &[String]) -> Result<Vec<String>, String> {
    if hashes.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; hashes.len()].join(",");
    let sql = format!(
        "SELECT feed_id FROM article_feed_items WHERE article_hash IN ({placeholders})
         UNION SELECT feed_id FROM articles WHERE hash IN ({placeholders})"
    );
    let params: Vec<SqlValue> = hashes.iter().chain(hashes.iter()).map(|hash| SqlValue::Text(hash.clone())).collect();
    let mut statement = conn.prepare(&sql).map_err(|error| format!("Failed to find article feeds: {error}"))?;
    let rows = statement
        .query_map(params_from_iter(params), |row| row.get::<_, String>(0))
        .map_err(|error| format!("Failed to find article feeds: {error}"))?;
    let mut feeds = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("Failed to find article feeds: {error}"))?;
    feeds.sort();
    feeds.dedup();
    Ok(feeds)
}

fn summary_text(verb: &str, changed: usize, unchanged: usize, missing: &[String]) -> String {
    let noun = |count: usize| if count == 1 { "article" } else { "articles" };
    let mut parts = vec![format!("{verb} {changed} {}.", noun(changed))];
    if unchanged > 0 {
        parts.push(format!("{unchanged} {} already were.", noun(unchanged)));
    }
    if !missing.is_empty() {
        parts.push(not_found(missing));
    }
    parts.join(" ")
}

fn mark_read(conn: &Connection, targets: Targets, read: bool) -> Result<WriteOutcome, String> {
    if targets.found.is_empty() {
        return Err(not_found(&targets.missing));
    }
    let mut changed = Vec::new();
    let mut unchanged = 0;
    for hash in &targets.found {
        if flag(conn, "read", hash)? == read {
            unchanged += 1;
            continue;
        }
        update_article_read(conn, hash, read)?;
        changed.push(hash.clone());
    }
    let feed_ids = feeds_for_articles(conn, &changed)?;
    let feed_counts = sync_feed_article_counts_batch(conn, &feed_ids)?;
    let verb = if read { "Marked as read:" } else { "Marked as unread:" };
    Ok(WriteOutcome {
        text: summary_text(verb, changed.len(), unchanged, &targets.missing),
        structured: json!({ "changed": changed, "unchanged": unchanged, "notFound": targets.missing, "read": read }),
        change: LibraryChange {
            articles: changed
                .iter()
                .map(|hash| ArticleChange { hash: hash.clone(), read: Some(read), ..Default::default() })
                .collect(),
            feed_counts,
            saved_article_ids: Vec::new(),
        },
        created_saved: None,
    })
}

fn set_starred(conn: &Connection, targets: Targets, starred: bool) -> Result<WriteOutcome, String> {
    if targets.found.is_empty() {
        return Err(not_found(&targets.missing));
    }
    let mut changed = Vec::new();
    let mut unchanged = 0;
    for hash in &targets.found {
        if flag(conn, "starred", hash)? == starred {
            unchanged += 1;
            continue;
        }
        set_article_starred(conn, hash, starred)?;
        changed.push(hash.clone());
    }
    let verb = if starred { "Starred" } else { "Unstarred" };
    Ok(WriteOutcome {
        text: summary_text(verb, changed.len(), unchanged, &targets.missing),
        structured: json!({ "changed": changed, "unchanged": unchanged, "notFound": targets.missing, "starred": starred }),
        change: LibraryChange {
            articles: changed
                .iter()
                .map(|hash| ArticleChange { hash: hash.clone(), starred: Some(starred), ..Default::default() })
                .collect(),
            ..Default::default()
        },
        created_saved: None,
    })
}

fn lead_image(content: String, image: Option<&str>) -> String {
    let Some(image) = image.map(str::trim).filter(|url| url.starts_with("http://") || url.starts_with("https://")) else {
        return content;
    };
    if content.to_ascii_lowercase().contains("<img") {
        return content;
    }
    let escaped = image.replace('&', "&amp;").replace('"', "&quot;").replace('<', "&lt;");
    format!("<figure class=\"article-lead-image\"><img src=\"{escaped}\" alt=\"\" /></figure>{content}")
}

/// Mirrors the renderer's basic-mode save (`toSavedRecord` +
/// `getBasicModeContentForSave`): stored content, else the description.
fn saved_record_from_article(article: &ArticleRecord, id: String, saved_date: String) -> SavedArticleRecord {
    let metadata = article.metadata.as_ref().and_then(Value::as_object);
    let pick = |key: &str| metadata.and_then(|object| object.get(key)).cloned().filter(|value| !value.is_null());
    let preview_image = pick("previewImage").and_then(|value| value.as_str().map(str::to_string));
    let base = if article.content.trim().is_empty() { article.description.clone() } else { article.content.clone() };
    let mut saved_metadata = Map::new();
    for key in ["enclosures", "duration", "episodeNumber", "seasonNumber"] {
        if let Some(value) = pick(key) {
            saved_metadata.insert(key.to_string(), value);
        }
    }
    SavedArticleRecord {
        id,
        article_hash: article.hash.clone(),
        title: Some(article.title.clone()),
        description: Some(article.description.clone()),
        content: Some(lead_image(base, preview_image.as_deref())),
        link: article.link.clone(),
        author: article.author.clone(),
        published_date: article.published_date.clone(),
        saved_date,
        last_read_at: article.last_read_at.clone(),
        feed_id: Some(article.feed_id.clone()),
        feed_url: article.feed_url.clone(),
        feed_title: article.feed_title.clone(),
        feed_favicon: article.feed_favicon.clone(),
        feed_favicon_has_transparency: article.feed_favicon_has_transparency,
        feed_favicon_bg_light: article.feed_favicon_bg_light.clone(),
        feed_favicon_bg_dark: article.feed_favicon_bg_dark.clone(),
        feed_image: article.feed_image.clone(),
        preview_image,
        metadata: Some(Value::Object(saved_metadata)),
        highlights: Vec::new(),
        notes: None,
    }
}

fn save_article(conn: &Connection, hash: &str) -> Result<WriteOutcome, String> {
    let article = get_article(conn, hash)?.ok_or_else(|| not_found(&[hash.to_string()]))?;
    let existing = match get_saved_article_by_hash(conn, hash)? {
        Some(saved) => Some(saved),
        None => match article.link.as_deref().filter(|link| !link.trim().is_empty()) {
            Some(link) => get_saved_article_by_link(conn, link)?,
            None => None,
        },
    };
    if let Some(saved) = existing {
        // Already saved: only repair the article's flag if it drifted.
        let mut change = LibraryChange::default();
        if !article.saved || article.saved_article_id.as_deref() != Some(saved.id.as_str()) {
            update_article_saved_state(conn, hash, true, Some(&saved.id))?;
            change.articles.push(ArticleChange {
                hash: hash.to_string(),
                saved: Some(true),
                saved_article_id: Some(saved.id.clone()),
                ..Default::default()
            });
        }
        return Ok(WriteOutcome {
            text: format!("Already saved (saved article id `{}`).", saved.id),
            structured: json!({ "savedArticleId": saved.id, "alreadySaved": true }),
            change,
            created_saved: None,
        });
    }
    let id = uuid::Uuid::new_v4().to_string();
    let record = saved_record_from_article(&article, id.clone(), super::now_stamp());
    insert_saved_article(conn, &record)?;
    update_article_saved_state(conn, hash, true, Some(&id))?;
    Ok(WriteOutcome {
        text: format!("Saved \"{}\" (saved article id `{id}`).", article.title),
        structured: json!({ "savedArticleId": id, "alreadySaved": false }),
        change: LibraryChange {
            articles: vec![ArticleChange {
                hash: hash.to_string(),
                saved: Some(true),
                saved_article_id: Some(id.clone()),
                ..Default::default()
            }],
            feed_counts: Vec::new(),
            saved_article_ids: vec![id.clone()],
        },
        created_saved: Some(SavedSnapshot { id, title: Some(article.title.clone()).filter(|title| !title.is_empty()) }),
    })
}

/// MCP `tools/call` result for a write outcome.
pub fn tool_result(outcome: &Result<WriteOutcome, String>) -> Value {
    match outcome {
        Ok(outcome) => json!({
            "content": [{ "type": "text", "text": outcome.text }],
            "structuredContent": outcome.structured,
            "isError": false
        }),
        Err(message) => json!({ "content": [{ "type": "text", "text": message }], "isError": true }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::current::CurrentArticleInput;
    use crate::mcp::query::tests::fixture;

    fn allowed() -> AssistantSettings {
        AssistantSettings {
            enabled: true,
            allow_changes: true,
            shared_stations: Some(vec!["Tech".into()]),
            include_unstationed_feeds: false,
            ..Default::default()
        }
    }

    fn open(hash: &str) -> CurrentArticle {
        CurrentArticle::from_input(
            "main",
            CurrentArticleInput {
                kind: CurrentArticleKind::Feed,
                hash: Some(hash.into()),
                saved_id: None,
                title: None,
                link: None,
                feed_title: None,
                author: None,
                published_date: None,
                body_html: None,
                reader_mode: None,
            },
            "2026-10-19T01:00:00.000Z".into(),
        )
        .unwrap()
    }

    fn column(conn: &Connection, sql: &str) -> i64 {
        conn.query_row(sql, [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn write_tools_are_annotated_as_non_read_only_and_non_destructive() {
        for tool in tool_definitions() {
            assert_eq!(tool["annotations"]["readOnlyHint"], false, "{}", tool["name"]);
            assert_eq!(tool["annotations"]["destructiveHint"], false, "{}", tool["name"]);
            assert_eq!(tool["annotations"]["openWorldHint"], false, "{}", tool["name"]);
            assert_eq!(tool["inputSchema"]["type"], "object");
            assert!(is_write_tool(tool["name"].as_str().unwrap()));
        }
    }

    #[test]
    fn nothing_is_written_while_changes_are_off() {
        let conn = fixture();
        let settings = AssistantSettings { allow_changes: false, ..allowed() };
        let error = run(&conn, &settings, None, "mark_read", &json!({ "hash": "t1" })).err().unwrap();
        assert_eq!(error, CHANGES_OFF_MESSAGE);
        assert_eq!(column(&conn, "SELECT read FROM articles WHERE hash = 't1'"), 0);
    }

    #[test]
    fn mark_read_writes_shared_articles_syncs_counts_and_hides_the_rest() {
        let conn = fixture();
        let outcome = run(&conn, &allowed(), None, "mark_read", &json!({ "hashes": ["t1", "t2", "b1", "h1", "nope"] })).unwrap();
        // t2 was already read; h1 is in an unshared station; nope is missing.
        assert_eq!(outcome.structured["changed"], json!(["t1", "b1"]));
        assert_eq!(outcome.structured["unchanged"], 1);
        assert_eq!(outcome.structured["notFound"], json!(["h1", "nope"]));
        assert_eq!(column(&conn, "SELECT read FROM articles WHERE hash = 'h1'"), 0, "hidden article untouched");
        assert_eq!(column(&conn, "SELECT read FROM articles WHERE hash = 't1'"), 1);

        // Counts are persisted here (one writer) for every mapping of b1.
        let feeds: Vec<&str> = outcome.change.feed_counts.iter().map(|counts| counts.feed_id.as_str()).collect();
        assert_eq!(feeds, vec!["f-both", "f-tech"]);
        assert_eq!(column(&conn, "SELECT unread_count FROM feeds WHERE id = 'f-tech'"), 1, "only t3 left unread");
        assert_eq!(column(&conn, "SELECT unread_count FROM feeds WHERE id = 'f-both'"), 0);
        assert_eq!(outcome.change.articles.len(), 2);
        assert_eq!(outcome.change.articles[0].read, Some(true));
        assert!(!outcome.text.contains("Health"), "{}", outcome.text);

        let only_hidden = run(&conn, &allowed(), None, "mark_read", &json!({ "hash": "h1" }));
        assert!(only_hidden.err().unwrap().contains("No shared article"));

        let unread = run(&conn, &allowed(), None, "mark_read", &json!({ "hash": "t1", "read": false })).unwrap();
        assert_eq!(unread.change.articles[0].read, Some(false));
        assert_eq!(column(&conn, "SELECT unread_count FROM feeds WHERE id = 'f-tech'"), 2);
    }

    #[test]
    fn the_open_article_is_the_default_target_even_in_a_hidden_station() {
        let conn = fixture();
        let current = open("h1");
        let outcome = run(&conn, &allowed(), Some(&current), "set_starred", &json!({ "starred": true })).unwrap();
        assert_eq!(outcome.structured["changed"], json!(["h1"]));
        assert_eq!(column(&conn, "SELECT starred FROM articles WHERE hash = 'h1'"), 1);
        assert!(outcome.change.feed_counts.is_empty(), "starring never touches counts");

        let again = run(&conn, &allowed(), Some(&current), "set_starred", &json!({ "starred": true })).unwrap();
        assert!(again.change.is_empty(), "idempotent");
        assert!(run(&conn, &allowed(), None, "set_starred", &json!({})).is_err(), "starred is required");
        assert!(run(&conn, &allowed(), None, "mark_read", &json!({})).err().unwrap().contains("hash"));
    }

    #[test]
    fn save_article_creates_one_snapshot_and_respects_the_saved_toggle() {
        let conn = fixture();
        let outcome = run(&conn, &allowed(), None, "save_article", &json!({ "hash": "t2" })).unwrap();
        let id = outcome.structured["savedArticleId"].as_str().unwrap().to_string();
        assert_eq!(outcome.change.saved_article_ids, vec![id.clone()]);
        assert_eq!(outcome.created_saved.as_ref().unwrap().id, id);
        assert_eq!(
            conn.query_row("SELECT saved, saved_article_id FROM articles WHERE hash = 't2'", [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))
                .unwrap(),
            (1, id.clone())
        );
        let content: String = conn.query_row("SELECT content FROM saved_articles WHERE id = ?1", [&id], |row| row.get(0)).unwrap();
        assert_eq!(content, "<p>Fallback summary text</p>");

        let again = run(&conn, &allowed(), None, "save_article", &json!({ "hash": "t2" })).unwrap();
        assert_eq!(again.structured["alreadySaved"], true);
        assert!(again.change.is_empty());
        assert_eq!(column(&conn, "SELECT COUNT(*) FROM saved_articles WHERE article_hash = 't2'"), 1);

        // t1 has a saved copy (s1) but the article row lost its flag: repaired.
        let repaired = run(&conn, &allowed(), None, "save_article", &json!({ "hash": "t1" })).unwrap();
        assert_eq!(repaired.change.articles[0].saved_article_id.as_deref(), Some("s1"));
        assert!(repaired.created_saved.is_none());

        let no_saved = AssistantSettings { share_saved_articles: false, ..allowed() };
        assert!(run(&conn, &no_saved, None, "save_article", &json!({ "hash": "t3" })).is_err());
        assert!(run(&conn, &allowed(), None, "save_article", &json!({ "hash": "h1" })).is_err(), "hidden");
        assert_eq!(column(&conn, "SELECT COUNT(*) FROM saved_articles"), 3);
    }

    #[test]
    fn lead_image_is_added_only_when_missing() {
        assert_eq!(lead_image("<p>x</p>".into(), None), "<p>x</p>");
        assert_eq!(lead_image("<img src=a><p>x</p>".into(), Some("https://i/a.png")), "<img src=a><p>x</p>");
        assert!(lead_image("<p>x</p>".into(), Some("https://i/a.png?a=1&b=\"")).starts_with("<figure class=\"article-lead-image\"><img src=\"https://i/a.png?a=1&amp;b=&quot;\""));
        assert_eq!(lead_image("<p>x</p>".into(), Some("javascript:alert(1)")), "<p>x</p>");
    }
}
