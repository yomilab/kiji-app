use crate::db::ArticleRecord;
use crate::feeds::article_hash::generate_article_hash;
use crate::feeds::types::{NativeEnclosure, NativeFeedAuthor, NativeFeedItem, NativeMediaThumbnail};
use chrono::{DateTime, Duration, Utc};
use serde_json::{json, Map, Value as JsonValue};
use url::Url;

pub struct ConvertContext<'a> {
    pub feed_id: &'a str,
    pub feed_url: &'a str,
    pub feed_title: Option<&'a str>,
    pub feed_favicon: Option<&'a str>,
    pub feed_favicon_has_transparency: Option<bool>,
    pub feed_favicon_bg_light: Option<&'a str>,
    pub feed_favicon_bg_dark: Option<&'a str>,
    pub feed_image: Option<&'a str>,
    pub fetch_time: DateTime<Utc>,
}

pub fn convert_feed_items_to_articles(
    items: &[NativeFeedItem],
    context: &ConvertContext<'_>,
) -> Vec<ArticleRecord> {
    let now = Utc::now();
    let fallback_base_time = if context.fetch_time <= now {
        context.fetch_time
    } else {
        now
    };

    items
        .iter()
        .enumerate()
        .map(|(index, item)| {
            convert_feed_item(item, index, context, now, fallback_base_time)
        })
        .collect()
}

fn convert_feed_item(
    item: &NativeFeedItem,
    index: usize,
    context: &ConvertContext<'_>,
    now: DateTime<Utc>,
    fallback_base_time: DateTime<Utc>,
) -> ArticleRecord {
    let hash = generate_article_hash(item);
    let published_date = normalize_published_date(item.published_date.as_deref(), now)
        .or_else(|| normalize_published_date(item.updated_date.as_deref(), now))
        .unwrap_or_else(|| {
            (fallback_base_time - Duration::milliseconds(index as i64))
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
        });
    let processed = process_article_content(item, context.feed_url);

    ArticleRecord {
        hash,
        feed_id: context.feed_id.to_string(),
        title: processed.title,
        description: processed.description,
        content: processed.content,
        link: item.link.clone(),
        author: item
            .author
            .clone()
            .or_else(|| {
                item.authors
                    .as_ref()
                    .and_then(|authors| authors.first())
                    .map(|author| author.name.clone())
                    .filter(|name| !name.trim().is_empty())
            }),
        published_date: Some(published_date),
        fetched_date: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        read: false,
        starred: false,
        saved: false,
        saved_article_id: None,
        last_read_at: None,
        metadata: build_metadata(item),
        feed_url: Some(context.feed_url.to_string()),
        feed_title: context.feed_title.map(str::to_string),
        feed_favicon: context.feed_favicon.map(str::to_string),
        feed_favicon_has_transparency: context.feed_favicon_has_transparency,
        feed_favicon_bg_light: context.feed_favicon_bg_light.map(str::to_string),
        feed_favicon_bg_dark: context.feed_favicon_bg_dark.map(str::to_string),
        feed_image: context.feed_image.map(str::to_string),
    }
}

fn normalize_published_date(value: Option<&str>, now: DateTime<Utc>) -> Option<String> {
    let trimmed = value?.trim();
    if trimmed.is_empty() {
        return None;
    }

    let parsed = DateTime::parse_from_rfc3339(trimmed)
        .ok()
        .map(|timestamp| timestamp.with_timezone(&Utc))
        .or_else(|| trimmed.parse::<DateTime<Utc>>().ok())?;

    let capped = if parsed <= now { parsed } else { now };
    Some(capped.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))
}

struct ProcessedArticleContent {
    title: String,
    content: String,
    description: String,
}

fn process_article_content(item: &NativeFeedItem, feed_url: &str) -> ProcessedArticleContent {
    let content_base_url = item.link.as_deref().unwrap_or(feed_url);
    let content = inject_lead_image(&item.content, pick_primary_image(item, content_base_url));

    if !item.title.trim().is_empty() {
        let summary_text = to_display_text(item.summary.as_deref().unwrap_or(""));
        let description_source = if summary_text.chars().count() >= 90 {
            item.summary.as_deref().unwrap_or(&item.content)
        } else {
            &item.content
        };
        return ProcessedArticleContent {
            title: to_display_text(&item.title),
            content,
            description: generate_description(description_source),
        };
    }

    let fallback_title = to_display_text(item.summary.as_deref().unwrap_or(&item.content))
        .chars()
        .take(120)
        .collect::<String>()
        .trim()
        .to_string();

    ProcessedArticleContent {
        title: if fallback_title.is_empty() {
            "(No Title)".to_string()
        } else {
            fallback_title
        },
        content,
        description: generate_description(item.summary.as_deref().unwrap_or(&item.content)),
    }
}

fn to_display_text(raw: &str) -> String {
    decode_html_entities(&strip_html_tags(raw))
}

fn decode_html_entities(raw: &str) -> String {
    let mut decoded = raw.to_string();
    for _ in 0..3 {
        let next = decode_html_entities_once(&decoded);
        if next == decoded {
            break;
        }
        decoded = next;
    }
    decoded
}

fn decode_html_entities_once(input: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();

    while let Some(ch) = chars.next() {
        if ch != '&' {
            result.push(ch);
            continue;
        }

        let mut entity = String::from('&');
        let mut terminated = false;
        while let Some(&next) = chars.peek() {
            if next == ';' {
                entity.push(chars.next().unwrap());
                terminated = true;
                break;
            }
            if entity.len() >= 16 || (!next.is_ascii_alphanumeric() && next != '#') {
                break;
            }
            entity.push(chars.next().unwrap());
        }

        if terminated {
            if let Some(decoded) = decode_entity_reference(&entity) {
                result.push(decoded);
                continue;
            }
        }

        result.push_str(&entity);
    }

    result
}

fn decode_entity_reference(entity: &str) -> Option<char> {
    let body = entity.strip_prefix('&')?.strip_suffix(';')?;
    if body.is_empty() {
        return None;
    }

    if let Some(codepoint) = body.strip_prefix('#') {
        let value = if let Some(hex) = codepoint.strip_prefix('x').or_else(|| codepoint.strip_prefix('X')) {
            u32::from_str_radix(hex, 16).ok()?
        } else {
            codepoint.parse::<u32>().ok()?
        };
        return char::from_u32(value);
    }

    match body {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{00A0}'),
        _ => None,
    }
}

fn strip_html_tags(raw: &str) -> String {
    let without_scripts = strip_tag_block(raw, "script");
    let without_styles = strip_tag_block(&without_scripts, "style");
    let mut result = String::new();
    let mut in_tag = false;

    for ch in without_styles.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => {
                if ch.is_whitespace() {
                    if result.is_empty() || result.ends_with(' ') {
                        continue;
                    }
                    result.push(' ');
                } else {
                    result.push(ch);
                }
            }
            _ => {}
        }
    }

    result.trim().to_string()
}

fn strip_tag_block(raw: &str, tag: &str) -> String {
    let mut result = String::new();
    let mut cursor = 0;
    let lower_raw = raw.to_ascii_lowercase();
    let open_needle = format!("<{tag}");
    let close_needle = format!("</{tag}>");

    while cursor < raw.len() {
        let remaining = &lower_raw[cursor..];
        if let Some(open_offset) = remaining.find(&open_needle) {
            let open_index = cursor + open_offset;
            result.push_str(&raw[cursor..open_index]);
            let after_open = &lower_raw[open_index..];
            if let Some(close_offset) = after_open.find(&close_needle) {
                cursor = open_index + close_offset + close_needle.len();
                continue;
            }
            return result;
        }

        result.push_str(&raw[cursor..]);
        break;
    }

    result
}

fn generate_description(content: &str) -> String {
    let text = to_display_text(content);
    if text.chars().count() <= 320 {
        return text;
    }

    let trimmed: String = text.chars().take(320).collect();
    let last_space = trimmed.rfind(' ').unwrap_or(trimmed.len());
    let end = if last_space > 224 { last_space } else { trimmed.len() };
    format!("{}...", trimmed[..end].trim())
}

fn pick_primary_image(item: &NativeFeedItem, base_url: &str) -> Option<String> {
    let mut candidates = Vec::new();
    if let Some(thumbnail) = item.thumbnail.as_ref() {
        candidates.push(thumbnail.url.as_str());
    }
    if let Some(images) = item.images.as_ref() {
        for image in images {
            candidates.push(image.as_str());
        }
    }
    if let Some(preview_image) = item.preview_image.as_ref() {
        candidates.push(preview_image.as_str());
    }

    for candidate in candidates {
        if let Some(resolved) = resolve_url(candidate, base_url) {
            return Some(resolved);
        }
    }
    None
}

fn resolve_url(url: &str, base_url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }

    let candidate = if trimmed.starts_with("//") {
        format!("https:{trimmed}")
    } else {
        trimmed.to_string()
    };

    Url::parse(&candidate)
        .or_else(|_| Url::parse(base_url).and_then(|base| base.join(&candidate)))
        .ok()
        .map(|parsed| parsed.to_string())
        .or(Some(candidate))
}

fn inject_lead_image(content: &str, image_url: Option<String>) -> String {
    let Some(image_url) = image_url else {
        return content.to_string();
    };
    if content.to_ascii_lowercase().contains("<img") {
        return content.to_string();
    }

    format!(
        r#"<figure class="article-lead-image"><img src="{}" alt="" /></figure>{}"#,
        escape_attribute(&image_url),
        content
    )
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
}

fn build_metadata(item: &NativeFeedItem) -> Option<JsonValue> {
    let mut map = Map::new();
    insert_optional_string(&mut map, "updatedDate", item.updated_date.as_deref());
    insert_optional_string(&mut map, "summary", item.summary.as_deref());
    insert_optional_string(&mut map, "guid", item.guid.as_deref());
    insert_optional_string(&mut map, "previewImage", item.preview_image.as_deref());
    if let Some(thumbnail) = item.thumbnail.as_ref() {
        map.insert("thumbnail".to_string(), thumbnail_to_json(thumbnail));
    }
    if let Some(images) = item.images.as_ref() {
        map.insert("images".to_string(), json!(images));
    }
    if let Some(enclosures) = item.enclosures.as_ref() {
        map.insert("enclosures".to_string(), enclosures_to_json(enclosures));
    }
    if let Some(categories) = item.categories.as_ref() {
        map.insert("categories".to_string(), json!(categories));
    }
    if let Some(authors) = item.authors.as_ref() {
        map.insert("authors".to_string(), authors_to_json(authors));
    }
    if let Some(duration) = item.duration {
        map.insert("duration".to_string(), json!(duration));
    }
    if let Some(episode_number) = item.episode_number {
        map.insert("episodeNumber".to_string(), json!(episode_number));
    }
    if let Some(season_number) = item.season_number {
        map.insert("seasonNumber".to_string(), json!(season_number));
    }

    if map.is_empty() {
        None
    } else {
        Some(JsonValue::Object(map))
    }
}

fn insert_optional_string(map: &mut Map<String, JsonValue>, key: &str, value: Option<&str>) {
    if let Some(value) = value.filter(|entry| !entry.is_empty()) {
        map.insert(key.to_string(), json!(value));
    }
}

fn thumbnail_to_json(thumbnail: &NativeMediaThumbnail) -> JsonValue {
    json!({
        "url": thumbnail.url,
        "width": thumbnail.width,
        "height": thumbnail.height,
    })
}

const DEFAULT_ENCLOSURE_MIME_TYPE: &str = "application/octet-stream";

fn enclosure_mime_type(mime_type: &Option<String>) -> &str {
    mime_type
        .as_deref()
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_ENCLOSURE_MIME_TYPE)
}

fn enclosures_to_json(enclosures: &[NativeEnclosure]) -> JsonValue {
    JsonValue::Array(
        enclosures
            .iter()
            .map(|enclosure| {
                json!({
                    "url": enclosure.url,
                    "type": enclosure_mime_type(&enclosure.mime_type),
                    "length": enclosure.length,
                    "duration": enclosure.duration,
                })
            })
            .collect(),
    )
}

fn authors_to_json(authors: &[NativeFeedAuthor]) -> JsonValue {
    JsonValue::Array(
        authors
            .iter()
            .map(|author| {
                json!({
                    "name": author.name,
                    "email": author.email,
                    "uri": author.uri,
                })
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_numeric_entities_in_description() {
        let item = NativeFeedItem {
            id: "204".to_string(),
            title: "#204 始于冷血 终于无耻".to_string(),
            content: String::new(),
            link: None,
            author: None,
            published_date: None,
            feed_id: "feed".to_string(),
            updated_date: None,
            summary: Some(
                "&#25298;&#32477;&#20013;&#22269;&#38712;&#20940;&#65306;&#26085;&#26412;&#22269;&#27665;&#38598;&#20307;&#25674;&#29260;".to_string(),
            ),
            guid: None,
            preview_image: None,
            thumbnail: None,
            images: None,
            enclosures: None,
            categories: None,
            authors: None,
            duration: None,
            episode_number: None,
            season_number: None,
        };
        let record = convert_feed_items_to_articles(
            &[item],
            &ConvertContext {
                feed_id: "feed-1",
                feed_url: "https://example.com/rss",
                feed_title: Some("Example"),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                fetch_time: Utc::now(),
            },
        )[0]
        .clone();

        assert!(record.description.contains('拒'));
        assert!(record.description.contains('中'));
        assert!(!record.description.contains("&#"));
    }

    #[test]
    fn generates_description_with_ellipsis_for_long_content() {
        let long_body = "word ".repeat(120);
        let item = NativeFeedItem {
            id: "1".to_string(),
            title: "Title".to_string(),
            content: long_body,
            link: None,
            author: None,
            published_date: None,
            feed_id: "feed".to_string(),
            updated_date: None,
            summary: None,
            guid: None,
            preview_image: None,
            thumbnail: None,
            images: None,
            enclosures: None,
            categories: None,
            authors: None,
            duration: None,
            episode_number: None,
            season_number: None,
        };
        let record = convert_feed_items_to_articles(
            &[item],
            &ConvertContext {
                feed_id: "feed-1",
                feed_url: "https://example.com/rss",
                feed_title: Some("Example"),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                fetch_time: Utc::now(),
            },
        )[0]
        .clone();

        assert!(record.description.ends_with("..."));
        assert!(record.description.chars().count() <= 324);
    }

    #[test]
    fn defaults_missing_enclosure_mime_type() {
        let item = NativeFeedItem {
            id: "pod-1".to_string(),
            title: "Episode".to_string(),
            content: String::new(),
            link: None,
            author: None,
            published_date: None,
            feed_id: "feed".to_string(),
            updated_date: None,
            summary: None,
            guid: None,
            preview_image: None,
            thumbnail: None,
            images: None,
            enclosures: Some(vec![NativeEnclosure {
                url: "https://example.com/episode.mp3".to_string(),
                mime_type: None,
                length: None,
                duration: Some(3600.0),
            }]),
            categories: None,
            authors: None,
            duration: None,
            episode_number: None,
            season_number: None,
        };
        let record = convert_feed_items_to_articles(
            &[item],
            &ConvertContext {
                feed_id: "feed-1",
                feed_url: "https://example.com/rss",
                feed_title: Some("Example"),
                feed_favicon: None,
                feed_favicon_has_transparency: None,
                feed_favicon_bg_light: None,
                feed_favicon_bg_dark: None,
                feed_image: None,
                fetch_time: Utc::now(),
            },
        )[0]
        .clone();

        let metadata = record
            .metadata
            .as_ref()
            .expect("metadata should include enclosures");
        let enclosures = metadata
            .get("enclosures")
            .and_then(|value| value.as_array())
            .expect("enclosures array");
        assert_eq!(
            enclosures[0].get("type").and_then(|value| value.as_str()),
            Some(DEFAULT_ENCLOSURE_MIME_TYPE)
        );
    }
}
