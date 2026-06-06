use std::collections::HashMap;

use crate::db::SavedArticleRecord;

pub const SAVED_ARTICLES_MARKDOWN_INDEX_FILE: &str = "articles.md";
pub const SAVED_ARTICLES_MARKDOWN_ARTICLES_DIR: &str = "articles";

const DEFAULT_TITLE: &str = "Untitled";
const MAX_TITLE_LENGTH: usize = 180;
const MAX_FILENAME_LENGTH: usize = 180;

pub struct SavedArticleIndexEntry {
    pub title: String,
    pub file_name: String,
}

pub fn normalize_title(title: Option<&str>) -> String {
    let raw = title.unwrap_or(DEFAULT_TITLE).trim();
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.len() <= MAX_TITLE_LENGTH {
        return collapsed;
    }

    format!(
        "{}...",
        collapsed
            .chars()
            .take(MAX_TITLE_LENGTH.saturating_sub(3))
            .collect::<String>()
            .trim_end()
    )
}

pub fn sanitize_filename(name: &str) -> String {
    let normalized = normalize_title(Some(name));
    let mut sanitized = normalized.replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");

    sanitized.retain(|character| !character.is_control());
    sanitized = sanitized.trim().trim_end_matches('.').to_string();

    if is_windows_reserved_name(&sanitized) {
        sanitized = format!("{sanitized}_file");
    }

    if sanitized.len() > MAX_FILENAME_LENGTH {
        sanitized = sanitized
            .chars()
            .take(MAX_FILENAME_LENGTH)
            .collect::<String>()
            .trim_end()
            .trim_end_matches('.')
            .to_string();
    }

    if sanitized.is_empty() {
        return DEFAULT_TITLE.to_lowercase();
    }

    sanitized
}

pub fn create_saved_article_markdown_file_name(
    title: Option<&str>,
    used_names: &mut HashMap<String, u32>,
) -> (String, String) {
    let normalized_title = normalize_title(title);
    let base_name = sanitize_filename(&normalized_title);
    let current = used_names.entry(base_name.clone()).or_insert(0);
    *current += 1;

    let file_name = if *current == 1 {
        format!("{base_name}.md")
    } else {
        format!("{base_name}-{current}.md")
    };

    (normalized_title, file_name)
}

pub fn create_saved_article_markdown(article: &SavedArticleRecord) -> String {
    let title = normalize_title(article.title.as_deref());
    let content = article
        .content
        .as_deref()
        .or(article.description.as_deref())
        .unwrap_or("");
    let markdown_body = content_to_markdown_body(content);

    format!(
        "# {title}\nSource: {}\n\n---\n\n{markdown_body}",
        article.link.as_deref().unwrap_or("unknown")
    )
}

/// Mirror Electron `savedArticlesExportFormat.createSavedArticleMarkdown`:
/// convert stored HTML bodies to markdown before writing `.md` export/sync files.
fn content_to_markdown_body(content: &str) -> String {
    if content.is_empty() {
        return String::new();
    }

    if content_looks_like_html(content) {
        return html2md::parse_html(content);
    }

    content.to_string()
}

fn content_looks_like_html(content: &str) -> bool {
    let trimmed = content.trim_start();
    trimmed.starts_with('<') || trimmed.contains("</")
}

pub fn build_saved_articles_index_markdown(entries: &[SavedArticleIndexEntry]) -> String {
    let mut lines = vec!["# Saved Articles".to_string(), String::new()];

    for entry in entries {
        let encoded_path = entry
            .file_name
            .split('/')
            .map(encode_path_segment)
            .collect::<Vec<_>>()
            .join("/");
        let escaped_title = escape_markdown_link_text(&entry.title);
        lines.push(format!("- [{escaped_title}](./articles/{encoded_path})"));
    }

    lines.push(String::new());
    lines.join("\n")
}

pub fn format_csv_value(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn encode_path_segment(segment: &str) -> String {
    segment
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || "-._~".contains(character) {
                character.to_string()
            } else {
                format!("%{:02X}", character as u32)
            }
        })
        .collect()
}

fn escape_markdown_link_text(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('[', "\\[")
        .replace(']', "\\]")
}

fn is_windows_reserved_name(name: &str) -> bool {
    matches!(
        name.to_uppercase().as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_filename_replaces_reserved_characters() {
        assert_eq!(sanitize_filename("Hello: World?"), "Hello_ World_");
    }

    #[test]
    fn deduplicates_markdown_file_names() {
        let mut used_names = HashMap::new();
        let (_, first) = create_saved_article_markdown_file_name(Some("Title"), &mut used_names);
        let (_, second) = create_saved_article_markdown_file_name(Some("Title"), &mut used_names);
        assert_eq!(first, "Title.md");
        assert_eq!(second, "Title-2.md");
    }

    #[test]
    fn converts_html_article_content_to_markdown() {
        let article = SavedArticleRecord {
            id: "saved-1".to_string(),
            article_hash: "hash-1".to_string(),
            title: Some("Sample".to_string()),
            description: None,
            content: Some("<p>Hello <strong>world</strong></p>".to_string()),
            link: Some("https://example.com/post".to_string()),
            author: None,
            published_date: None,
            saved_date: "2026-01-01T00:00:00.000Z".to_string(),
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
            highlights: Vec::new(),
            notes: None,
        };

        let markdown = create_saved_article_markdown(&article);

        assert!(markdown.contains("# Sample"));
        assert!(markdown.contains("**world**"));
        assert!(!markdown.contains("<p>"));
        assert!(!markdown.contains("<strong>"));
    }

    #[test]
    fn preserves_plain_text_article_content() {
        let article = SavedArticleRecord {
            id: "saved-2".to_string(),
            article_hash: "hash-2".to_string(),
            title: Some("Plain".to_string()),
            description: None,
            content: Some("Already plain text.".to_string()),
            link: None,
            author: None,
            published_date: None,
            saved_date: "2026-01-01T00:00:00.000Z".to_string(),
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
            highlights: Vec::new(),
            notes: None,
        };

        let markdown = create_saved_article_markdown(&article);
        assert!(markdown.ends_with("Already plain text."));
    }
}
