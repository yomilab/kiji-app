use crate::feeds::types::NativeFeedItem;
use sha2::{Digest, Sha256};
use url::Url;

const TRACKING_PARAMS: &[&str] = &[
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "utm_cid",
    "utm_reader",
    "utm_social",
    "utm_social-type",
    "rb_clickid",
    "s_kwcid",
    "gclid",
    "fbclid",
    "ref",
    "source",
    "rss",
    "fb_action_ids",
    "fb_action_types",
    "fb_source",
    "fb_ref",
    "_hsenc",
    "_hsmi",
    "mc_cid",
    "mc_eid",
    "mkt_tok",
    "assetId",
    "assetType",
    "recipientId",
    "campaignId",
    "pk_campaign",
    "pk_kwd",
    "piwik_campaign",
    "piwik_kwd",
    "yclid",
];

pub fn generate_article_hash(item: &NativeFeedItem) -> String {
    let input = build_hash_input(item);
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn build_hash_input(item: &NativeFeedItem) -> String {
    if let Some(normalized_link) = normalize_link(item.link.as_deref()) {
        return normalized_link;
    }

    if let Some(guid) = item.guid.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        return guid.to_string();
    }

    if let Some(normalized_title) = normalize_title(item.title.as_str()) {
        return normalized_title;
    }

    extract_words(&item.content, 100).join(" ")
}

fn normalize_link(link: Option<&str>) -> Option<String> {
    let trimmed = link?.trim();
    if trimmed.is_empty() {
        return None;
    }

    if let Ok(mut parsed) = Url::parse(trimmed) {
        parsed.set_fragment(None);
        if let Some(query) = parsed.query() {
            let retained: Vec<(String, String)> = url::form_urlencoded::parse(query.as_bytes())
                .filter(|(key, _)| !TRACKING_PARAMS.contains(&key.as_ref()))
                .map(|(key, value)| (key.into_owned(), value.into_owned()))
                .collect();
            parsed.set_query(None);
            if retained.is_empty() {
                parsed.set_query(None);
            } else {
                let mut serializer = url::form_urlencoded::Serializer::new(String::new());
                for (key, value) in retained {
                    serializer.append_pair(&key, &value);
                }
                parsed.set_query(Some(&serializer.finish()));
            }
        }
        let path = parsed.path().to_string();
        if path.len() > 1 && path.ends_with('/') {
            let trimmed_path = path.trim_end_matches('/');
            parsed.set_path(trimmed_path);
        }
        return Some(parsed.to_string());
    }

    let without_query = trimmed.split(['?', '#']).next().unwrap_or(trimmed);
    Some(without_query.trim_end_matches('/').to_string())
}

fn normalize_title(title: &str) -> Option<String> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_lowercase())
    }
}

fn extract_words(text: &str, max_words: usize) -> Vec<String> {
    strip_html_tags(text)
        .split_whitespace()
        .map(str::to_string)
        .take(max_words)
        .collect()
}

fn strip_html_tags(raw: &str) -> String {
    let mut result = String::new();
    let mut in_tag = false;
    for ch in raw.chars() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::types::NativeFeedItem;

    fn sample_item(overrides: NativeFeedItem) -> NativeFeedItem {
        overrides
    }

    fn base_item() -> NativeFeedItem {
        NativeFeedItem {
            id: "test-id".to_string(),
            title: String::new(),
            content: String::new(),
            link: None,
            author: None,
            published_date: None,
            feed_id: "feed-1".to_string(),
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
        }
    }

    #[test]
    fn prefers_normalized_link_over_guid() {
        let item = sample_item(NativeFeedItem {
            guid: Some("unique-guid".to_string()),
            title: "Title".to_string(),
            content: "Body".to_string(),
            link: Some("https://example.com/article".to_string()),
            ..base_item()
        });
        let hash = generate_article_hash(&item);
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn same_link_produces_same_hash_regardless_of_guid() {
        let item_a = sample_item(NativeFeedItem {
            guid: Some("guid-1".to_string()),
            link: Some("https://example.com/article".to_string()),
            ..base_item()
        });
        let item_b = sample_item(NativeFeedItem {
            guid: Some("guid-2".to_string()),
            link: Some("https://example.com/article".to_string()),
            ..base_item()
        });
        assert_eq!(generate_article_hash(&item_a), generate_article_hash(&item_b));
    }

    #[test]
    fn strips_tracking_params_from_link_hash_input() {
        let clean = sample_item(NativeFeedItem {
            link: Some("https://example.com/article".to_string()),
            ..base_item()
        });
        let tracked = sample_item(NativeFeedItem {
            link: Some("https://example.com/article?utm_source=newsletter".to_string()),
            ..base_item()
        });
        assert_eq!(generate_article_hash(&clean), generate_article_hash(&tracked));
    }

    #[test]
    fn falls_back_to_guid_when_link_missing() {
        let item = sample_item(NativeFeedItem {
            guid: Some("stable-guid".to_string()),
            title: "Title".to_string(),
            ..base_item()
        });
        assert_eq!(generate_article_hash(&item).len(), 64);
    }

    #[test]
    fn falls_back_to_lowercased_title() {
        let item = sample_item(NativeFeedItem {
            title: "Hello World".to_string(),
            ..base_item()
        });
        let item_variant = sample_item(NativeFeedItem {
            title: "hello world".to_string(),
            ..base_item()
        });
        assert_eq!(generate_article_hash(&item), generate_article_hash(&item_variant));
    }
}
