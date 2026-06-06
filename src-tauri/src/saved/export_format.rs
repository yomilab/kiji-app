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
    let mut sanitized = normalized
        .replace(['<', '>', ':', '"', '/', '\\', '|', '?', '*'], "_");

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

    format!(
        "# {title}\nSource: {}\n\n---\n\n{content}",
        article.link.as_deref().unwrap_or("unknown")
    )
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
        lines.push(format!(
            "- [{escaped_title}](./articles/{encoded_path})"
        ));
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
        "CON" | "PRN" | "AUX" | "NUL"
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
}
