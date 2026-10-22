//! Mute words: user rules that mark matching articles as read when they are
//! stored. Rules live in `user-settings.json` (`AppSettings::mute_rules`), are
//! compiled once per refresh cycle (lowercased needles, station scopes
//! resolved to feed ids) and matched off the writer lock while the feed is
//! prepared. Only NEW articles are affected at store time; existing unread
//! articles change only through `mute_rules_apply_to_existing`.
//!
//! Hide is not offered: the articles table has no hidden flag and filtering
//! list queries by rule text would not be indexed, so the only action is
//! Mark as read.

use crate::db::articles::FeedArticleCounts;
use crate::db::{sync_feed_article_counts_batch, with_savepoint, ArticleRecord, DbState};
use crate::settings::SettingsState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

/// Matching stays O(articles × rules); the cap keeps a refresh cheap.
pub const MAX_MUTE_RULES: usize = 200;
pub const MAX_MUTE_RULE_TEXT_CHARS: usize = 200;
/// The live "would match N of the last 500 articles" hint.
pub const MUTE_PREVIEW_ARTICLE_LIMIT: i64 = 500;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum MuteRuleScope {
    #[default]
    All,
    Feed {
        id: String,
    },
    Station {
        name: String,
    },
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum MuteRuleAction {
    #[default]
    MarkRead,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MuteRule {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub match_description: bool,
    #[serde(default)]
    pub scope: MuteRuleScope,
    #[serde(default)]
    pub action: MuteRuleAction,
}

/// Trims text, drops blank rules, and enforces the count and length caps.
pub fn normalize_mute_rules(rules: Vec<MuteRule>) -> Result<Vec<MuteRule>, String> {
    if rules.len() > MAX_MUTE_RULES {
        return Err(format!("muteRules can hold at most {MAX_MUTE_RULES} rules."));
    }
    let mut seen_ids = HashSet::new();
    let mut normalized = Vec::with_capacity(rules.len());
    for mut rule in rules {
        rule.text = rule.text.trim().to_string();
        if rule.text.is_empty() {
            continue;
        }
        if rule.text.chars().count() > MAX_MUTE_RULE_TEXT_CHARS {
            return Err(format!(
                "muteRules text must be at most {MAX_MUTE_RULE_TEXT_CHARS} characters."
            ));
        }
        if rule.id.trim().is_empty() || !seen_ids.insert(rule.id.clone()) {
            return Err("muteRules ids must be unique and non-empty.".to_string());
        }
        normalized.push(rule);
    }
    Ok(normalized)
}

/* ── Matching ─────────────────────────────────────────────────────────────── */

/// Han, kana, Hangul and related blocks: text without spaces between words,
/// so rules containing them match as substrings.
fn is_cjk(c: char) -> bool {
    matches!(
        c as u32,
        0x1100..=0x11FF
            | 0x2E80..=0x2FDF
            | 0x3040..=0x30FF
            | 0x3130..=0x318F
            | 0x31F0..=0x31FF
            | 0x3400..=0x4DBF
            | 0x4E00..=0x9FFF
            | 0xAC00..=0xD7AF
            | 0xF900..=0xFAFF
            | 0xFF66..=0xFF9F
            | 0x20000..=0x2FFFF
    )
}

/// Characters that make up a Latin-style word. CJK characters are not word
/// characters, so "apple" still matches as a whole word in "apple发布".
fn is_word_char(c: char) -> bool {
    (c.is_alphanumeric() || c == '_') && !is_cjk(c)
}

/// Lowercases and collapses whitespace; with `strip_tags`, drops `<…>` markup
/// (descriptions are HTML snippets).
fn normalize_text(value: &str, strip_tags: bool) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_tag = false;
    let mut pending_space = false;
    for c in value.chars() {
        if strip_tags {
            if in_tag {
                if c == '>' {
                    in_tag = false;
                    pending_space = true;
                }
                continue;
            }
            if c == '<' {
                in_tag = true;
                continue;
            }
        }
        if c.is_whitespace() {
            pending_space = true;
            continue;
        }
        if pending_space && !out.is_empty() {
            out.push(' ');
        }
        pending_space = false;
        out.extend(c.to_lowercase());
    }
    out
}

/// Finds `needle` in `haystack` with word boundaries at its word-character
/// edges ("ai" does not match "said"; "c++" still matches "c++ tips").
fn contains_whole_word(haystack: &str, needle: &str) -> bool {
    let (Some(first), Some(last)) = (needle.chars().next(), needle.chars().next_back()) else {
        return false;
    };
    let check_before = is_word_char(first);
    let check_after = is_word_char(last);
    let mut start = 0;
    while let Some(offset) = haystack[start..].find(needle) {
        let begin = start + offset;
        let end = begin + needle.len();
        let before_ok = !check_before
            || haystack[..begin]
                .chars()
                .next_back()
                .is_none_or(|c| !is_word_char(c));
        let after_ok = !check_after
            || haystack[end..]
                .chars()
                .next()
                .is_none_or(|c| !is_word_char(c));
        if before_ok && after_ok {
            return true;
        }
        start = begin + first.len_utf8();
    }
    false
}

#[derive(Debug, Clone)]
struct CompiledRule {
    needle: String,
    substring: bool,
    match_description: bool,
    /// `None` = all feeds.
    feed_ids: Option<HashSet<String>>,
}

impl CompiledRule {
    fn applies_to_any<'a>(&self, mut feed_ids: impl Iterator<Item = &'a str>) -> bool {
        match &self.feed_ids {
            None => true,
            Some(scope) => feed_ids.any(|feed_id| scope.contains(feed_id)),
        }
    }

    fn matches_text(&self, text: &str) -> bool {
        if self.substring {
            text.contains(&self.needle)
        } else {
            contains_whole_word(text, &self.needle)
        }
    }
}

/// Rules ready for matching. Built once per refresh cycle (or per one-off
/// store / apply call), never per article.
#[derive(Debug, Clone, Default)]
pub struct CompiledMuteRules {
    rules: Vec<CompiledRule>,
}

/// One article's normalized text, built lazily (description only when a
/// rule in scope asks for it).
struct ArticleText<'a> {
    title_raw: &'a str,
    description_raw: &'a str,
    title: Option<String>,
    description: Option<String>,
}

impl<'a> ArticleText<'a> {
    fn new(title: &'a str, description: &'a str) -> Self {
        Self {
            title_raw: title,
            description_raw: description,
            title: None,
            description: None,
        }
    }

    fn title(&mut self) -> &str {
        self.title
            .get_or_insert_with(|| normalize_text(self.title_raw, true))
    }

    fn description(&mut self) -> &str {
        self.description
            .get_or_insert_with(|| normalize_text(self.description_raw, true))
    }
}

impl CompiledMuteRules {
    /// `station_feed_ids` maps station name → member feed ids; only stations
    /// used by rules need to be present.
    pub fn compile(rules: &[MuteRule], station_feed_ids: &HashMap<String, Vec<String>>) -> Self {
        let compiled = rules
            .iter()
            .take(MAX_MUTE_RULES)
            .filter_map(|rule| {
                let needle = normalize_text(&rule.text, false);
                if needle.is_empty() {
                    return None;
                }
                let feed_ids = match &rule.scope {
                    MuteRuleScope::All => None,
                    MuteRuleScope::Feed { id } => Some(HashSet::from([id.clone()])),
                    MuteRuleScope::Station { name } => Some(
                        station_feed_ids
                            .get(name)
                            .map(|ids| ids.iter().cloned().collect())
                            .unwrap_or_default(),
                    ),
                };
                Some(CompiledRule {
                    substring: needle.chars().any(is_cjk),
                    needle,
                    match_description: rule.match_description,
                    feed_ids,
                })
            })
            .collect();
        Self { rules: compiled }
    }

    /// Reads station membership for the station-scoped rules (one indexed
    /// lookup per distinct station), then compiles.
    pub fn compile_with_connection(
        connection: &Connection,
        rules: &[MuteRule],
    ) -> Result<Self, String> {
        let mut station_feed_ids: HashMap<String, Vec<String>> = HashMap::new();
        for rule in rules {
            let MuteRuleScope::Station { name } = &rule.scope else {
                continue;
            };
            if station_feed_ids.contains_key(name) {
                continue;
            }
            let mut statement = connection
                .prepare_cached("SELECT feed_id FROM feed_tags WHERE tag_name = ?1")
                .map_err(|error| format!("Failed to prepare station lookup: {error}"))?;
            let ids = statement
                .query_map(params![name], |row| row.get::<_, String>(0))
                .map_err(|error| format!("Failed to read station feeds: {error}"))?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|error| format!("Failed to read station feeds: {error}"))?;
            station_feed_ids.insert(name.clone(), ids);
        }
        Ok(Self::compile(rules, &station_feed_ids))
    }

    pub fn is_empty(&self) -> bool {
        self.rules.is_empty()
    }

    fn rules_for<'s>(&'s self, feed_ids: &[&str]) -> Vec<&'s CompiledRule> {
        self.rules
            .iter()
            .filter(|rule| rule.applies_to_any(feed_ids.iter().copied()))
            .collect()
    }

    fn any_rule_matches(rules: &[&CompiledRule], text: &mut ArticleText<'_>) -> bool {
        rules.iter().any(|rule| {
            rule.matches_text(text.title())
                || (rule.match_description && rule.matches_text(text.description()))
        })
    }

    /// True when any rule scoped to one of `feed_ids` matches the article.
    pub fn matches(&self, feed_ids: &[&str], title: &str, description: &str) -> bool {
        let rules = self.rules_for(feed_ids);
        !rules.is_empty() && Self::any_rule_matches(&rules, &mut ArticleText::new(title, description))
    }

    /// Store-time step: marks matching, not-yet-read articles of one feed as
    /// read before they are inserted. Returns how many were muted.
    pub fn apply_to_new_articles(&self, feed_id: &str, articles: &mut [ArticleRecord]) -> usize {
        let rules = self.rules_for(&[feed_id]);
        if rules.is_empty() {
            return 0;
        }
        let mut muted = 0;
        for article in articles.iter_mut().filter(|article| !article.read) {
            let mut text = ArticleText::new(&article.title, &article.description);
            if Self::any_rule_matches(&rules, &mut text) {
                article.read = true;
                muted += 1;
            }
        }
        muted
    }

    fn uses_description(&self) -> bool {
        self.rules.iter().any(|rule| rule.match_description)
    }
}

/// Compiles the saved rules, or `None` when there are none (the common case
/// costs one settings snapshot and no DB read).
pub async fn load_compiled_mute_rules(
    app: &AppHandle,
    db: &DbState,
) -> Option<Arc<CompiledMuteRules>> {
    let settings = app.try_state::<Arc<SettingsState>>()?;
    compile_saved_rules(settings.inner(), db).await
}

/// Also used by the renderer-driven store command (one feed per call).
pub(crate) async fn compile_saved_rules(
    settings: &SettingsState,
    db: &DbState,
) -> Option<Arc<CompiledMuteRules>> {
    let rules = settings.snapshot().ok()?.mute_rules;
    if rules.is_empty() {
        return None;
    }
    match db
        .read(move |connection| CompiledMuteRules::compile_with_connection(connection, &rules))
        .await
    {
        Ok(compiled) if !compiled.is_empty() => Some(Arc::new(compiled)),
        Ok(_) => None,
        Err(error) => {
            // Muting is best effort: a failed compile must never block a refresh.
            eprintln!("[KiJi] Failed to compile mute rules: {error}");
            None
        }
    }
}

/* ── Preview and apply-to-existing ────────────────────────────────────────── */

const FEED_IDS_SEPARATOR: char = '\u{1f}';

/// Newest articles first, via `idx_articles_effective_date`. Each row carries
/// every subscription the article belongs to, so scopes see shared articles.
pub(crate) const PREVIEW_SQL: &str = "SELECT a.title, a.description, \
     COALESCE((SELECT group_concat(afi.feed_id, char(31)) FROM article_feed_items afi \
               WHERE afi.article_hash = a.hash), a.feed_id) \
     FROM articles a \
     ORDER BY COALESCE(a.published_date, a.fetched_date) DESC \
     LIMIT ?1";

/// Unread articles via `idx_articles_read`; description only when needed.
const UNREAD_SCAN_SQL_WITH_DESCRIPTION: &str = "SELECT a.hash, a.title, a.description, \
     COALESCE((SELECT group_concat(afi.feed_id, char(31)) FROM article_feed_items afi \
               WHERE afi.article_hash = a.hash), a.feed_id) \
     FROM articles a WHERE a.read = 0";
const UNREAD_SCAN_SQL_TITLE_ONLY: &str = "SELECT a.hash, a.title, '', \
     COALESCE((SELECT group_concat(afi.feed_id, char(31)) FROM article_feed_items afi \
               WHERE afi.article_hash = a.hash), a.feed_id) \
     FROM articles a WHERE a.read = 0";

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MuteRulePreview {
    pub matched: i64,
    pub scanned: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MuteApplyResult {
    pub marked_count: i64,
    pub feeds: Vec<FeedArticleCounts>,
}

pub fn preview_mute_rule(connection: &Connection, rule: &MuteRule) -> Result<MuteRulePreview, String> {
    let compiled = CompiledMuteRules::compile_with_connection(connection, std::slice::from_ref(rule))?;
    let mut statement = connection
        .prepare(PREVIEW_SQL)
        .map_err(|error| format!("Failed to prepare mute preview: {error}"))?;
    let mut rows = statement
        .query(params![MUTE_PREVIEW_ARTICLE_LIMIT])
        .map_err(|error| format!("Failed to run mute preview: {error}"))?;
    let mut preview = MuteRulePreview { matched: 0, scanned: 0 };
    while let Some(row) = rows
        .next()
        .map_err(|error| format!("Failed to read mute preview: {error}"))?
    {
        let title: String = row.get(0).map_err(|error| error.to_string())?;
        let description: String = row.get(1).map_err(|error| error.to_string())?;
        let feeds: String = row.get(2).map_err(|error| error.to_string())?;
        let feed_ids: Vec<&str> = feeds.split(FEED_IDS_SEPARATOR).collect();
        preview.scanned += 1;
        if !compiled.is_empty() && compiled.matches(&feed_ids, &title, &description) {
            preview.matched += 1;
        }
    }
    Ok(preview)
}

/// Marks every unread article matched by the rules as read and re-syncs the
/// counts of the feeds they belong to, in ONE transaction.
pub fn apply_mute_rules_to_existing(
    connection: &Connection,
    compiled: &CompiledMuteRules,
) -> Result<MuteApplyResult, String> {
    if compiled.is_empty() {
        return Ok(MuteApplyResult { marked_count: 0, feeds: vec![] });
    }
    with_savepoint(connection, "mute_apply_existing", |connection| {
        let sql = if compiled.uses_description() {
            UNREAD_SCAN_SQL_WITH_DESCRIPTION
        } else {
            UNREAD_SCAN_SQL_TITLE_ONLY
        };
        let mut matched_hashes = Vec::new();
        let mut affected_feeds = HashSet::new();
        {
            let mut statement = connection
                .prepare(sql)
                .map_err(|error| format!("Failed to prepare unread scan: {error}"))?;
            let mut rows = statement
                .query([])
                .map_err(|error| format!("Failed to scan unread articles: {error}"))?;
            while let Some(row) = rows
                .next()
                .map_err(|error| format!("Failed to read unread articles: {error}"))?
            {
                let hash: String = row.get(0).map_err(|error| error.to_string())?;
                let title: String = row.get(1).map_err(|error| error.to_string())?;
                let description: String = row.get(2).map_err(|error| error.to_string())?;
                let feeds: String = row.get(3).map_err(|error| error.to_string())?;
                let feed_ids: Vec<&str> = feeds.split(FEED_IDS_SEPARATOR).collect();
                if compiled.matches(&feed_ids, &title, &description) {
                    affected_feeds.extend(feed_ids.iter().map(|id| id.to_string()));
                    matched_hashes.push(hash);
                }
            }
        }

        {
            let mut update = connection
                .prepare("UPDATE articles SET read = 1 WHERE hash = ?1 AND read = 0")
                .map_err(|error| format!("Failed to prepare mute update: {error}"))?;
            for hash in &matched_hashes {
                update
                    .execute(params![hash])
                    .map_err(|error| format!("Failed to mark muted article read: {error}"))?;
            }
        }

        let mut feed_ids: Vec<String> = affected_feeds.into_iter().collect();
        feed_ids.sort();
        let feeds = sync_feed_article_counts_batch(connection, &feed_ids)?;
        Ok(MuteApplyResult {
            marked_count: matched_hashes.len() as i64,
            feeds,
        })
    })
}

/* ── Commands ─────────────────────────────────────────────────────────────── */

#[tauri::command(rename_all = "camelCase")]
pub fn mute_rules_get(settings: State<'_, Arc<SettingsState>>) -> Result<Vec<MuteRule>, String> {
    Ok(settings.snapshot()?.mute_rules)
}

#[tauri::command(rename_all = "camelCase")]
pub fn mute_rules_set(
    rules: Vec<MuteRule>,
    settings: State<'_, Arc<SettingsState>>,
) -> Result<Vec<MuteRule>, String> {
    settings.set_mute_rules(rules)
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mute_rules_preview(
    rule: MuteRule,
    state: State<'_, DbState>,
) -> Result<MuteRulePreview, String> {
    let db = state.inner().clone();
    db.read(move |connection| preview_mute_rule(connection, &rule))
        .await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn mute_rules_apply_to_existing(
    settings: State<'_, Arc<SettingsState>>,
    state: State<'_, DbState>,
) -> Result<MuteApplyResult, String> {
    let rules = settings.snapshot()?.mute_rules;
    let db = state.inner().clone();
    db.write(move |connection| {
        let compiled = CompiledMuteRules::compile_with_connection(connection, &rules)?;
        apply_mute_rules_to_existing(connection, &compiled)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(text: &str) -> MuteRule {
        MuteRule {
            id: text.to_string(),
            text: text.to_string(),
            match_description: false,
            scope: MuteRuleScope::All,
            action: MuteRuleAction::MarkRead,
        }
    }

    fn compile(rules: &[MuteRule]) -> CompiledMuteRules {
        CompiledMuteRules::compile(rules, &HashMap::new())
    }

    #[test]
    fn matches_case_insensitively() {
        let compiled = compile(&[rule("Crypto")]);
        assert!(compiled.matches(&["f"], "CRYPTO prices fall", ""));
        assert!(compiled.matches(&["f"], "Why crypto matters", ""));
    }

    #[test]
    fn latin_rules_match_whole_words_only() {
        let compiled = compile(&[rule("ai")]);
        assert!(compiled.matches(&["f"], "New AI tools", ""));
        assert!(compiled.matches(&["f"], "AI: what next", ""));
        assert!(!compiled.matches(&["f"], "She said hello", ""));
        assert!(!compiled.matches(&["f"], "Mountain trails", ""));
        // A miss earlier in the title does not hide a later whole-word hit.
        assert!(compiled.matches(&["f"], "Mail about AI", ""));
    }

    #[test]
    fn phrases_match_across_collapsed_whitespace() {
        let compiled = compile(&[rule("machine   learning")]);
        assert!(compiled.matches(&["f"], "Intro to Machine\n Learning", ""));
        assert!(!compiled.matches(&["f"], "machine learnings", ""));
    }

    #[test]
    fn symbol_edges_do_not_need_word_boundaries() {
        let compiled = compile(&[rule("c++")]);
        assert!(compiled.matches(&["f"], "Modern C++ tips", ""));
    }

    #[test]
    fn cjk_rules_match_as_substrings() {
        let compiled = compile(&[rule("比特币")]);
        assert!(compiled.matches(&["f"], "今日比特币价格上涨", ""));
        let japanese = compile(&[rule("ニュース")]);
        assert!(japanese.matches(&["f"], "今日のニュースまとめ", ""));
        // A Latin rule still matches next to CJK text.
        let latin = compile(&[rule("apple")]);
        assert!(latin.matches(&["f"], "Apple发布新品", ""));
    }

    #[test]
    fn description_is_checked_only_when_asked_and_ignores_markup() {
        let title_only = compile(&[rule("sponsored")]);
        assert!(!title_only.matches(&["f"], "Weekly links", "<p>Sponsored post</p>"));
        let with_description = compile(&[MuteRule { match_description: true, ..rule("sponsored") }]);
        assert!(with_description.matches(&["f"], "Weekly links", "<p>Sponsored post</p>"));
        let markup = compile(&[MuteRule { match_description: true, ..rule("href") }]);
        assert!(!markup.matches(&["f"], "Links", "<a href=\"x\">read</a>"));
    }

    #[test]
    fn scope_limits_rules_to_a_feed_or_station() {
        let feed_rule = MuteRule {
            scope: MuteRuleScope::Feed { id: "feed-a".to_string() },
            ..rule("sports")
        };
        let station_rule = MuteRule {
            id: "station".to_string(),
            scope: MuteRuleScope::Station { name: "News".to_string() },
            ..rule("weather")
        };
        let stations = HashMap::from([("News".to_string(), vec!["feed-b".to_string()])]);
        let compiled = CompiledMuteRules::compile(&[feed_rule, station_rule], &stations);
        assert!(compiled.matches(&["feed-a"], "Sports roundup", ""));
        assert!(!compiled.matches(&["feed-b"], "Sports roundup", ""));
        assert!(compiled.matches(&["feed-b"], "Weather today", ""));
        assert!(!compiled.matches(&["feed-a"], "Weather today", ""));
        // A shared article matches when any of its feeds is in scope.
        assert!(compiled.matches(&["feed-c", "feed-b"], "Weather today", ""));
    }

    #[test]
    fn normalize_trims_drops_blank_and_caps_rules() {
        let normalized = normalize_mute_rules(vec![
            MuteRule { text: "  crypto ".to_string(), ..rule("a") },
            MuteRule { id: "b".to_string(), text: "   ".to_string(), ..rule("b") },
        ])
        .unwrap();
        assert_eq!(normalized.len(), 1);
        assert_eq!(normalized[0].text, "crypto");

        let too_many = (0..=MAX_MUTE_RULES).map(|i| rule(&format!("w{i}"))).collect();
        assert!(normalize_mute_rules(too_many).is_err());
        assert!(normalize_mute_rules(vec![rule("x"), rule("x")]).is_err());
    }

    #[test]
    fn rules_round_trip_with_defaults() {
        let parsed: MuteRule = serde_json::from_str(r#"{"id":"1","text":"crypto"}"#).unwrap();
        assert_eq!(parsed.scope, MuteRuleScope::All);
        assert_eq!(parsed.action, MuteRuleAction::MarkRead);
        let station: MuteRule = serde_json::from_str(
            r#"{"id":"2","text":"x","matchDescription":true,"scope":{"kind":"station","name":"News"},"action":"mark-read"}"#,
        )
        .unwrap();
        assert_eq!(station.scope, MuteRuleScope::Station { name: "News".to_string() });
        assert!(station.match_description);
    }
}
