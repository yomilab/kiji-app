use crate::scheduler::types::SchedulerFeedEntry;

pub const FEED_FAILURE_BACKOFF_BASE_MS: i64 = 5 * 60_000;
pub const FEED_FAILURE_BACKOFF_MAX_MS: i64 = 60 * 60_000;

const FEED_FAILURE_BACKOFF_MAX_BY_FREQUENCY: [(f64, i64); 2] =
    [(1.0, 10 * 60_000), (0.75, 40 * 60_000)];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeedRefreshBlockKind {
    Cooldown,
    Backoff,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FeedRefreshBlock {
    pub kind: FeedRefreshBlockKind,
    pub wait_ms: i64,
    pub failure_count: Option<i64>,
}

pub fn get_feed_failure_backoff_max_ms(update_frequency_score: f64) -> i64 {
    FEED_FAILURE_BACKOFF_MAX_BY_FREQUENCY
        .iter()
        .find(|(minimum_score, _)| update_frequency_score >= *minimum_score)
        .map(|(_, max_ms)| *max_ms)
        .unwrap_or(FEED_FAILURE_BACKOFF_MAX_MS)
}

pub fn get_feed_failure_backoff_ms(failures: i64, update_frequency_score: f64) -> i64 {
    if failures <= 0 {
        return 0;
    }

    let max_ms = get_feed_failure_backoff_max_ms(update_frequency_score);
    let exponential = FEED_FAILURE_BACKOFF_BASE_MS * 2_i64.pow((failures - 1) as u32);
    exponential.min(max_ms)
}

pub fn get_feed_refresh_block(
    entry: &SchedulerFeedEntry,
    cooldown_ms: i64,
    include_backoff: bool,
    now_ms: i64,
) -> Option<FeedRefreshBlock> {
    let failures = entry.consecutive_failures;
    let failure_anchor_ms = entry
        .last_failed_fetch_at_ms
        .or(entry.last_fetched_ms);

    if include_backoff && failures > 0 {
        if let Some(anchor_ms) = failure_anchor_ms {
            let backoff_ms = get_feed_failure_backoff_ms(failures, entry.update_frequency_score);
            let retry_at = anchor_ms + backoff_ms;
            if retry_at > now_ms {
                return Some(FeedRefreshBlock {
                    kind: FeedRefreshBlockKind::Backoff,
                    wait_ms: retry_at - now_ms,
                    failure_count: Some(failures),
                });
            }
        }
    }

    if let Some(last_fetched_ms) = entry.last_fetched_ms {
        let next_allowed_at = last_fetched_ms + cooldown_ms;
        if next_allowed_at > now_ms {
            return Some(FeedRefreshBlock {
                kind: FeedRefreshBlockKind::Cooldown,
                wait_ms: next_allowed_at - now_ms,
                failure_count: None,
            });
        }
    }

    None
}

pub fn is_scheduler_entry_in_backoff(entry: &SchedulerFeedEntry, now_ms: i64) -> bool {
    matches!(
        get_feed_refresh_block(entry, 0, true, now_ms),
        Some(block) if block.kind == FeedRefreshBlockKind::Backoff
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::types::SchedulerFeedEntry;

    fn base_entry(feed_id: &str) -> SchedulerFeedEntry {
        SchedulerFeedEntry {
            feed_id: feed_id.to_string(),
            feed_url: format!("https://{feed_id}.example.com/feed.xml"),
            feed_title: format!("Feed {feed_id}"),
            last_fetched_ms: Some(parse_ms("2026-05-09T00:00:00.000Z")),
            last_failed_fetch_at_ms: None,
            sort_order: 0,
            update_frequency_score: 0.5,
            consecutive_failures: 0,
        }
    }

    fn parse_ms(value: &str) -> i64 {
        chrono::DateTime::parse_from_rfc3339(value)
            .expect("parse timestamp")
            .timestamp_millis()
    }

    #[test]
    fn blocks_feed_inside_failure_backoff_window() {
        let now = parse_ms("2026-05-09T12:00:00.000Z");
        let blocked = SchedulerFeedEntry {
                consecutive_failures: 2,
                last_failed_fetch_at_ms: Some(now - 5 * 60_000),
                ..base_entry("blocked")
            };

        assert!(is_scheduler_entry_in_backoff(&blocked, now));
    }

    #[test]
    fn high_frequency_feeds_use_shorter_backoff_cap() {
        let now = parse_ms("2026-05-09T12:00:00.000Z");
        let active = SchedulerFeedEntry {
                consecutive_failures: 12,
                last_failed_fetch_at_ms: Some(now - 45 * 60_000),
                update_frequency_score: 1.0,
                ..base_entry("active")
            };

        assert!(!is_scheduler_entry_in_backoff(&active, now));
    }
}
