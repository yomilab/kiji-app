//! The article open in each KiJi window, pushed by the article view.
//! Held in memory only; the most recently focused window wins.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// Bodies pushed from the webview (temporary or reader-mode articles) are
/// capped so a huge page cannot pin memory.
pub const MAX_PUSHED_BODY_BYTES: usize = 2 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CurrentArticleKind {
    /// A feed article stored in `kiji.db`.
    Feed,
    /// A saved snapshot (read from `saved_articles`).
    Saved,
    /// Loaded from the clipboard; exists only in the window.
    Temporary,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentArticleInput {
    pub kind: CurrentArticleKind,
    pub hash: Option<String>,
    pub saved_id: Option<String>,
    pub title: Option<String>,
    pub link: Option<String>,
    pub feed_title: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    /// Rendered body when the stored content is not what the user sees
    /// (temporary article, or reader mode on).
    pub body_html: Option<String>,
    pub reader_mode: Option<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct CurrentArticle {
    pub window_label: String,
    pub kind: CurrentArticleKind,
    pub hash: Option<String>,
    pub saved_id: Option<String>,
    pub title: String,
    pub link: Option<String>,
    pub feed_title: Option<String>,
    pub author: Option<String>,
    pub published_date: Option<String>,
    pub body_html: Option<String>,
    pub reader_mode: bool,
    pub opened_at: String,
}

impl CurrentArticle {
    pub fn from_input(window_label: &str, input: CurrentArticleInput, opened_at: String) -> Result<Self, String> {
        let hash = input.hash.filter(|value| !value.trim().is_empty());
        let saved_id = input.saved_id.filter(|value| !value.trim().is_empty());
        match input.kind {
            CurrentArticleKind::Feed if hash.is_none() => {
                return Err("A feed article needs its hash.".to_string())
            }
            CurrentArticleKind::Saved if saved_id.is_none() && hash.is_none() => {
                return Err("A saved article needs its id.".to_string())
            }
            CurrentArticleKind::Temporary if input.body_html.is_none() => {
                return Err("A temporary article needs its body.".to_string())
            }
            _ => {}
        }
        let body_html = input.body_html.map(|body| cap_body(body));
        Ok(Self {
            window_label: window_label.to_string(),
            kind: input.kind,
            hash,
            saved_id,
            title: input.title.unwrap_or_default(),
            link: input.link.filter(|value| !value.trim().is_empty()),
            feed_title: input.feed_title.filter(|value| !value.trim().is_empty()),
            author: input.author.filter(|value| !value.trim().is_empty()),
            published_date: input.published_date,
            body_html,
            reader_mode: input.reader_mode.unwrap_or(false),
            opened_at,
        })
    }

    /// Same article and same visible body (used to skip duplicate pushes).
    fn same_view(&self, other: &Self) -> bool {
        self.kind == other.kind
            && self.hash == other.hash
            && self.saved_id == other.saved_id
            && self.reader_mode == other.reader_mode
            && self.title == other.title
            && self.link == other.link
            && self.body_html.as_ref().map(String::len) == other.body_html.as_ref().map(String::len)
    }
}

fn cap_body(mut body: String) -> String {
    if body.len() <= MAX_PUSHED_BODY_BYTES {
        return body;
    }
    let mut end = MAX_PUSHED_BODY_BYTES;
    while end > 0 && !body.is_char_boundary(end) {
        end -= 1;
    }
    body.truncate(end);
    body
}

#[derive(Default)]
struct Inner {
    /// One entry per window that currently shows an article.
    entries: Vec<CurrentArticle>,
    /// Window labels, most recently focused last.
    focus_order: Vec<String>,
    /// Windows hidden but still alive (main window kept running in the
    /// background): their article isn't "what the user is reading".
    hidden: Vec<String>,
}

#[derive(Default)]
pub struct CurrentArticleRegistry {
    inner: Mutex<Inner>,
}

impl CurrentArticleRegistry {
    /// Stores the article for a window. Returns true when what the agent
    /// would see changed.
    pub fn set(&self, article: CurrentArticle) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        let label = article.window_label.clone();
        match inner.entries.iter_mut().find(|entry| entry.window_label == label) {
            Some(entry) if entry.same_view(&article) => {}
            Some(entry) => *entry = article,
            None => inner.entries.push(article),
        }
        if !inner.focus_order.contains(&label) {
            // A window that pushes before any focus event counts as focused.
            inner.focus_order.push(label);
        }
        current_changed(&before, current_of(&inner))
    }

    pub fn clear(&self, window_label: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        inner.entries.retain(|entry| entry.window_label != window_label);
        current_changed(&before, current_of(&inner))
    }

    pub fn window_focused(&self, window_label: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        inner.focus_order.retain(|label| label != window_label);
        inner.focus_order.push(window_label.to_string());
        current_changed(&before, current_of(&inner))
    }

    pub fn window_destroyed(&self, window_label: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        inner.entries.retain(|entry| entry.window_label != window_label);
        inner.focus_order.retain(|label| label != window_label);
        inner.hidden.retain(|label| label != window_label);
        current_changed(&before, current_of(&inner))
    }

    pub fn window_hidden(&self, window_label: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        if !inner.hidden.iter().any(|label| label == window_label) {
            inner.hidden.push(window_label.to_string());
        }
        current_changed(&before, current_of(&inner))
    }

    pub fn window_shown(&self, window_label: &str) -> bool {
        let Ok(mut inner) = self.inner.lock() else { return false };
        let before = current_of(&inner).cloned();
        inner.hidden.retain(|label| label != window_label);
        current_changed(&before, current_of(&inner))
    }

    pub fn clear_all(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.entries.clear();
        }
    }

    pub fn current(&self) -> Option<CurrentArticle> {
        self.inner.lock().ok().and_then(|inner| current_of(&inner).cloned())
    }
}

fn current_of(inner: &Inner) -> Option<&CurrentArticle> {
    inner
        .focus_order
        .iter()
        .rev()
        .filter(|label| !inner.hidden.contains(label))
        .find_map(|label| inner.entries.iter().find(|entry| &entry.window_label == label))
}

fn current_changed(before: &Option<CurrentArticle>, after: Option<&CurrentArticle>) -> bool {
    match (before, after) {
        (None, None) => false,
        (Some(before), Some(after)) => before != after,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(label: &str, hash: &str) -> CurrentArticle {
        CurrentArticle::from_input(
            label,
            CurrentArticleInput {
                kind: CurrentArticleKind::Feed,
                hash: Some(hash.into()),
                saved_id: None,
                title: Some(format!("Title {hash}")),
                link: None,
                feed_title: None,
                author: None,
                published_date: None,
                body_html: None,
                reader_mode: None,
            },
            "2026-10-19T00:00:00.000Z".into(),
        )
        .unwrap()
    }

    #[test]
    fn most_recently_focused_window_wins() {
        let registry = CurrentArticleRegistry::default();
        assert!(registry.set(feed("main", "a")));
        assert!(registry.set(feed("article-1", "b")));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("b"));
        assert!(registry.window_focused("main"));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("a"));
        // Focusing a window without an article keeps the previous one.
        assert!(!registry.window_focused("settings"));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("a"));
    }

    #[test]
    fn closing_falls_back_to_the_next_window() {
        let registry = CurrentArticleRegistry::default();
        registry.set(feed("main", "a"));
        registry.set(feed("article-1", "b"));
        assert!(registry.window_destroyed("article-1"));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("a"));
        assert!(registry.clear("main"));
        assert!(registry.current().is_none());
    }

    #[test]
    fn hidden_windows_are_not_what_the_user_is_reading() {
        let registry = CurrentArticleRegistry::default();
        registry.set(feed("main", "a"));
        assert!(registry.window_hidden("main"));
        assert!(registry.current().is_none());
        // Another visible window still counts.
        registry.set(feed("article-1", "b"));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("b"));
        registry.window_destroyed("article-1");
        assert!(registry.window_shown("main"));
        assert_eq!(registry.current().unwrap().hash.as_deref(), Some("a"));
    }

    #[test]
    fn duplicate_pushes_do_not_report_changes() {
        let registry = CurrentArticleRegistry::default();
        assert!(registry.set(feed("main", "a")));
        assert!(!registry.set(feed("main", "a")));
        assert!(registry.set(feed("main", "c")));
    }

    #[test]
    fn input_validation_and_body_cap() {
        let temporary = CurrentArticleInput {
            kind: CurrentArticleKind::Temporary,
            hash: None,
            saved_id: None,
            title: Some("Clip".into()),
            link: Some("https://example.com".into()),
            feed_title: None,
            author: None,
            published_date: None,
            body_html: None,
            reader_mode: None,
        };
        assert!(CurrentArticle::from_input("article-1", temporary.clone(), String::new()).is_err());

        let big = "é".repeat(MAX_PUSHED_BODY_BYTES);
        let article = CurrentArticle::from_input(
            "article-1",
            CurrentArticleInput { body_html: Some(big), ..temporary },
            String::new(),
        )
        .unwrap();
        let body = article.body_html.unwrap();
        assert!(body.len() <= MAX_PUSHED_BODY_BYTES);
        assert!(body.is_char_boundary(body.len()));
    }
}
