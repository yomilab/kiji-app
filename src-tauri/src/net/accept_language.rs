use once_cell::sync::Lazy;
use std::collections::HashSet;

static BROWSER_ACCEPT_LANGUAGE: Lazy<String> =
    Lazy::new(|| build_accept_language_from_locales(sys_locale::get_locales()));

/// Broad fallback locales appended after OS preferences (not domain-specific).
const BROAD_FALLBACK_LOCALES: &[&str] = &[
    "en-US", "en", "zh-CN", "zh-TW", "zh", "ja-JP", "ja", "ko-KR", "ko", "de-DE", "de", "fr-FR",
    "fr", "es-ES", "es", "pt-BR", "pt", "it-IT", "it", "ru-RU", "ru", "ar", "hi-IN", "hi",
    "nl-NL", "nl", "pl-PL", "pl", "tr-TR", "tr", "vi-VN", "vi", "th-TH", "th", "id-ID", "id",
    "sv-SE", "sv", "da-DK", "da", "fi-FI", "fi", "nb-NO", "nb", "he-IL", "he", "uk-UA", "uk",
    "cs-CZ", "cs", "el-GR", "el", "ro-RO", "ro", "hu-HU", "hu",
];

/// Returns a browser-style `Accept-Language` header derived from OS preferences.
pub fn browser_accept_language() -> &'static str {
    BROWSER_ACCEPT_LANGUAGE.as_str()
}

fn base_language_tag(locale: &str) -> Option<&str> {
    locale.split(['-', '_']).next().filter(|base| !base.is_empty())
}

fn push_accept_language_tag(
    parts: &mut Vec<String>,
    seen: &mut HashSet<String>,
    tag: &str,
    q: Option<f32>,
) {
    let normalized = tag.trim();
    if normalized.is_empty() {
        return;
    }
    let key = normalized.to_ascii_lowercase();
    if !seen.insert(key) {
        return;
    }
    match q {
        Some(value) => parts.push(format!("{normalized};q={value:.1}")),
        None => parts.push(normalized.to_string()),
    }
}

pub fn build_accept_language_from_locales(
    locales: impl IntoIterator<Item = impl AsRef<str>>,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut seen = HashSet::new();

    for (index, locale) in locales.into_iter().enumerate().take(8) {
        let locale = locale.as_ref().trim();
        if locale.is_empty() {
            continue;
        }

        if index == 0 {
            push_accept_language_tag(&mut parts, &mut seen, locale, None);
            if let Some(base) = base_language_tag(locale) {
                if base.len() < locale.len() {
                    push_accept_language_tag(&mut parts, &mut seen, base, Some(0.9));
                }
            }
            continue;
        }

        let q = (0.8_f32 - ((index - 1) as f32 * 0.1)).max(0.1);
        push_accept_language_tag(&mut parts, &mut seen, locale, Some(q));
    }

    let mut fallback_q = 0.5_f32;
    for locale in BROAD_FALLBACK_LOCALES {
        if seen.contains(&locale.to_ascii_lowercase()) {
            continue;
        }

        if parts.is_empty() {
            push_accept_language_tag(&mut parts, &mut seen, locale, None);
            if locale == &"en-US" {
                push_accept_language_tag(&mut parts, &mut seen, "en", Some(0.9));
            }
            continue;
        }

        push_accept_language_tag(&mut parts, &mut seen, locale, Some(fallback_q));
        fallback_q = (fallback_q - 0.05).max(0.1);
    }

    if parts.is_empty() {
        return "en-US,en;q=0.9,*;q=0.1".to_string();
    }

    push_accept_language_tag(&mut parts, &mut seen, "*", Some(0.1));
    parts.join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn orders_primary_locale_first_with_base_language_and_wildcard() {
        let header = build_accept_language_from_locales(["zh-CN", "en-US"]);
        assert!(header.starts_with("zh-CN,"));
        assert!(header.contains("zh;q=0.9"));
        assert!(header.contains("en-US;q=0.8"));
        assert!(header.contains("ja-JP;q="));
        assert!(header.ends_with("*;q=0.1"));
    }

    #[test]
    fn appends_broad_fallbacks_when_no_os_locales() {
        let header = build_accept_language_from_locales(std::iter::empty::<&str>());
        assert!(header.starts_with("en-US,"));
        assert!(header.contains("ja-JP;q="));
        assert!(header.contains("fr-FR;q="));
        assert!(header.ends_with("*;q=0.1"));
    }

    #[test]
    fn uses_system_locales_when_available() {
        let header = browser_accept_language();
        assert!(!header.is_empty());
        assert!(header.contains("*;q=0.1"));
        assert!(header.contains("ja") || header.contains("de") || header.contains("fr"));
    }
}
