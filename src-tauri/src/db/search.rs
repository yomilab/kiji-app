use once_cell::sync::Lazy;
use std::collections::HashSet;

const FTS_MAX_CONTENT_TOKENS: usize = 8;
const FTS_PREFIX_MIN_LEN: usize = 4;

/// Snowball English stopwords. `see` is intentionally absent — it is a content
/// word (`"you can see everything"` must keep `see`).
static ENGLISH_STOPWORDS: Lazy<HashSet<&'static str>> = Lazy::new(|| {
    HashSet::from([
        "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any",
        "are", "as", "at", "be", "because", "been", "before", "being", "below", "between",
        "both", "but", "by", "can", "did", "do", "does", "doing", "down", "during", "each",
        "few", "for", "from", "further", "had", "has", "have", "having", "he", "her", "here",
        "hers", "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
        "its", "itself", "just", "me", "more", "most", "my", "myself", "no", "nor", "not",
        "now", "of", "off", "on", "once", "only", "or", "other", "our", "ours", "ourselves",
        "out", "over", "own", "same", "she", "should", "so", "some", "such", "than", "that",
        "the", "their", "theirs", "them", "themselves", "then", "there", "these", "they",
        "this", "those", "through", "to", "too", "under", "until", "up", "very", "was", "we",
        "were", "what", "when", "where", "which", "while", "who", "whom", "why", "will",
        "with", "you", "your", "yours", "yourself", "yourselves",
    ])
});

pub fn create_fts_prefix_query(search_text: &str) -> Option<String> {
    let raw_tokens = search_text
        .split(|character: char| !character.is_alphanumeric())
        .filter(|token| !token.is_empty() && token.chars().count() >= 2)
        .map(|token| token.to_string())
        .collect::<Vec<_>>();

    if raw_tokens.is_empty() {
        return None;
    }

    let content_tokens = raw_tokens
        .iter()
        .filter(|token| !is_english_stopword(token))
        .cloned()
        .collect::<Vec<_>>();
    let kept_tokens = if content_tokens.is_empty() {
        raw_tokens
    } else {
        content_tokens
    };
    if kept_tokens.len() > FTS_MAX_CONTENT_TOKENS {
        return None;
    }

    Some(
        kept_tokens
            .iter()
            .map(|token| format_fts_term(token))
            .collect::<Vec<_>>()
            .join(" AND "),
    )
}

fn is_english_stopword(token: &str) -> bool {
    ENGLISH_STOPWORDS.contains(token.to_ascii_lowercase().as_str())
}

fn format_fts_term(token: &str) -> String {
    let escaped = token.replace('"', "\"\"");
    let quoted = format!("\"{escaped}\"");
    if token.chars().count() >= FTS_PREFIX_MIN_LEN {
        format!("{quoted}*")
    } else {
        quoted
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn punctuation_only_is_none() {
        assert_eq!(create_fts_prefix_query("???"), None);
        assert_eq!(create_fts_prefix_query("   "), None);
        assert_eq!(create_fts_prefix_query("a"), None);
    }

    #[test]
    fn drops_one_character_tokens() {
        assert_eq!(create_fts_prefix_query("a bc"), Some("\"bc\"".to_string()));
    }

    #[test]
    fn two_and_three_char_tokens_are_exact() {
        assert_eq!(create_fts_prefix_query("sql"), Some("\"sql\"".to_string()));
        assert_eq!(create_fts_prefix_query("rss"), Some("\"rss\"".to_string()));
    }

    #[test]
    fn four_plus_char_tokens_are_prefixed() {
        assert_eq!(create_fts_prefix_query("feed"), Some("\"feed\"*".to_string()));
        assert_eq!(
            create_fts_prefix_query("everything"),
            Some("\"everything\"*".to_string())
        );
    }

    #[test]
    fn drops_stopwords_when_content_remains() {
        assert_eq!(
            create_fts_prefix_query("you can see everything"),
            Some("\"see\" AND \"everything\"*".to_string())
        );
    }

    #[test]
    fn keeps_stopwords_when_they_are_the_whole_query() {
        assert_eq!(create_fts_prefix_query("the"), Some("\"the\"".to_string()));
        assert_eq!(
            create_fts_prefix_query("the and"),
            Some("\"the\" AND \"and\"".to_string())
        );
    }

    #[test]
    fn more_than_eight_content_tokens_is_none() {
        assert_eq!(
            create_fts_prefix_query("one two three four five six seven eight nine"),
            None
        );
        assert_eq!(
            create_fts_prefix_query("one two three four five six seven eight"),
            Some(
                "\"one\" AND \"two\" AND \"three\"* AND \"four\"* AND \"five\"* AND \"six\" AND \"seven\"* AND \"eight\"*"
                    .to_string()
            )
        );
    }

    #[test]
    fn long_paste_does_not_and_the_first_n_tokens() {
        let paste = "Aggregator verdict is REVISED implement on fix article list search honest FTS token policy extra";
        assert_eq!(create_fts_prefix_query(paste), None);
    }
}
