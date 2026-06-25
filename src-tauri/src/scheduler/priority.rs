use crate::scheduler::refresh_policy::get_feed_refresh_block;
use crate::scheduler::types::{FeedPriorityEntry, SchedulerFeedEntry};

const WEIGHT_FREQUENCY: f64 = 0.40;
const WEIGHT_STALENESS: f64 = 0.35;
const WEIGHT_POSITION: f64 = 0.10;
const WEIGHT_BOOST: f64 = 0.15;

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

pub fn compute_staleness_score(last_fetched_ms: Option<i64>, frequency_score: f64, now_ms: i64) -> f64 {
    let Some(last_fetched_ms) = last_fetched_ms else {
        return 1.0;
    };

    let elapsed_ms = now_ms - last_fetched_ms;
    let expected_interval_ms = if frequency_score >= 1.0 {
        30 * 60_000
    } else if frequency_score >= 0.75 {
        2 * 3_600_000
    } else if frequency_score >= 0.5 {
        6 * 3_600_000
    } else if frequency_score >= 0.25 {
        12 * 3_600_000
    } else {
        24 * 3_600_000
    };

    clamp(elapsed_ms as f64 / expected_interval_ms as f64, 0.0, 1.0)
}

pub fn compute_position_score(sort_order: i64, total_feeds: i64) -> f64 {
    if total_feeds <= 1 {
        return 1.0;
    }

    clamp(1.0 - sort_order as f64 / (total_feeds - 1) as f64, 0.0, 1.0)
}

pub fn compute_manual_boost(boost_until_ms: Option<i64>, now_ms: i64) -> f64 {
    match boost_until_ms {
        Some(until) if now_ms < until => 1.0,
        _ => 0.0,
    }
}

pub fn compute_priority(
    entry: SchedulerFeedEntry,
    total_feeds: i64,
    boost_until_ms: Option<i64>,
    now_ms: i64,
) -> FeedPriorityEntry {
    let frequency = entry.update_frequency_score;
    let staleness = compute_staleness_score(entry.last_fetched_ms, frequency, now_ms);
    let position = compute_position_score(entry.sort_order, total_feeds);
    let boost = compute_manual_boost(boost_until_ms, now_ms);

    let raw_score = WEIGHT_FREQUENCY * frequency
        + WEIGHT_STALENESS * staleness
        + WEIGHT_POSITION * position
        + WEIGHT_BOOST * boost;

    let failure_penalty = 0.5_f64.powi(entry.consecutive_failures as i32);
    let backoff_multiplier = match get_feed_refresh_block(&entry, 0, true, now_ms) {
        Some(block) if block.kind == crate::scheduler::refresh_policy::FeedRefreshBlockKind::Backoff => {
            0.1
        }
        _ => 1.0,
    };
    let score = raw_score * failure_penalty * backoff_multiplier;

    FeedPriorityEntry { entry, score }
}
