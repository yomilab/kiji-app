use std::collections::HashMap;

use crate::db::FeedRecord;
use crate::scheduler::priority::compute_priority;
use crate::scheduler::refresh_policy::is_scheduler_entry_in_backoff;
use crate::scheduler::types::{
    SchedulerBoost, SchedulerCreateRunPlanRequest, SchedulerFeedEntry,
    SchedulerRunPlan, SchedulerRunPlanOptions,
};

pub fn scheduler_feed_entry_from_record(feed: &FeedRecord) -> SchedulerFeedEntry {
    SchedulerFeedEntry {
        feed_id: feed.id.clone(),
        feed_url: feed.url.clone(),
        feed_title: feed.title.clone(),
        last_fetched_ms: parse_timestamp_ms(feed.last_fetched.as_deref()),
        last_failed_fetch_at_ms: parse_timestamp_ms(feed.last_failed_fetch_at.as_deref()),
        sort_order: feed.sort_order,
        update_frequency_score: feed.update_frequency_score,
        consecutive_failures: feed.consecutive_failures,
    }
}

pub fn create_scheduler_run_plan(
    entries: &[SchedulerFeedEntry],
    total_feeds: usize,
    boosts: &HashMap<String, i64>,
    now_ms: i64,
    options: &SchedulerRunPlanOptions,
) -> SchedulerRunPlan {
    let mut prioritized = Vec::new();
    let mut skipped_backoff_count = 0;
    let mut skipped_suppressed_count = 0;

    for entry in entries {
        if contains_id(options.only_feed_ids.as_ref(), &entry.feed_id) == Some(false) {
            continue;
        }

        if contains_id(options.exclude_feed_ids.as_ref(), &entry.feed_id) == Some(true) {
            continue;
        }

        if contains_id(options.skip_feed_ids_for_this_cycle.as_ref(), &entry.feed_id) == Some(true)
        {
            skipped_suppressed_count += 1;
            continue;
        }

        if is_scheduler_entry_in_backoff(entry, now_ms)
            && !contains_id(options.force_refresh_feed_ids.as_ref(), &entry.feed_id)
                .unwrap_or(false)
        {
            skipped_backoff_count += 1;
            continue;
        }

        prioritized.push(compute_priority(
            entry.clone(),
            total_feeds as i64,
            boosts.get(&entry.feed_id).copied(),
            now_ms,
        ));
    }

    prioritized.sort_by(|left, right| {
        let left_frontloaded = is_frontloaded(options, &left.entry.feed_id);
        let right_frontloaded = is_frontloaded(options, &right.entry.feed_id);
        match left_frontloaded.cmp(&right_frontloaded).reverse() {
            std::cmp::Ordering::Equal => right
                .score
                .partial_cmp(&left.score)
                .unwrap_or(std::cmp::Ordering::Equal),
            other => other,
        }
    });

    SchedulerRunPlan {
        prioritized,
        skipped_backoff_count,
        skipped_suppressed_count,
    }
}

pub fn create_scheduler_run_plan_from_request(
    request: SchedulerCreateRunPlanRequest,
) -> SchedulerRunPlan {
    let now_ms = request.now_ms.unwrap_or_else(current_time_ms);
    let boosts = boosts_to_map(request.boosts);
    let options = request.options.unwrap_or_default();
    let total_feeds = request.entries.len();

    create_scheduler_run_plan(
        &request.entries,
        total_feeds,
        &boosts,
        now_ms,
        &options,
    )
}

pub fn boosts_to_map(boosts: Vec<SchedulerBoost>) -> HashMap<String, i64> {
    boosts
        .into_iter()
        .map(|boost| (boost.feed_id, boost.boost_until_ms))
        .collect()
}

fn is_frontloaded(options: &SchedulerRunPlanOptions, feed_id: &str) -> bool {
    contains_id(options.frontload_feed_ids.as_ref(), feed_id) == Some(true)
}

fn contains_id(ids: Option<&Vec<String>>, feed_id: &str) -> Option<bool> {
    ids.map(|values| values.iter().any(|value| value == feed_id))
}

fn parse_timestamp_ms(value: Option<&str>) -> Option<i64> {
    let value = value?.trim();
    if value.is_empty() {
        return None;
    }

    chrono::DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|timestamp| timestamp.timestamp_millis())
        .or_else(|| {
            value
                .parse::<chrono::DateTime<chrono::Utc>>()
                .ok()
                .map(|timestamp| timestamp.timestamp_millis())
        })
}

fn current_time_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_entry(_feed_id: &str, overrides: SchedulerFeedEntry) -> SchedulerFeedEntry {
        overrides
    }

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
    fn filters_active_backoff_feeds_before_queueing() {
        let now = parse_ms("2026-05-09T12:00:00.000Z");
        let runnable = base_entry("runnable");
        let blocked = create_entry(
            "blocked",
            SchedulerFeedEntry {
                consecutive_failures: 3,
                last_failed_fetch_at_ms: Some(now - 10 * 60_000),
                ..base_entry("blocked")
            },
        );
        let expired = create_entry(
            "expired",
            SchedulerFeedEntry {
                consecutive_failures: 1,
                last_failed_fetch_at_ms: Some(now - 6 * 60_000),
                ..base_entry("expired")
            },
        );

        let plan = create_scheduler_run_plan(
            &[blocked, runnable, expired],
            3,
            &HashMap::new(),
            now,
            &SchedulerRunPlanOptions::default(),
        );

        assert_eq!(plan.skipped_backoff_count, 1);
        let mut feed_ids = plan
            .prioritized
            .iter()
            .map(|entry| entry.entry.feed_id.as_str())
            .collect::<Vec<_>>();
        feed_ids.sort_unstable();
        assert_eq!(feed_ids, vec!["expired", "runnable"]);
    }

    #[test]
    fn front_loads_active_station_feeds_inside_score_partitions() {
        let high_rest = create_entry(
            "high-rest",
            SchedulerFeedEntry {
                update_frequency_score: 1.0,
                sort_order: 0,
                ..base_entry("high-rest")
            },
        );
        let low_station = create_entry(
            "low-station",
            SchedulerFeedEntry {
                update_frequency_score: 0.1,
                sort_order: 2,
                ..base_entry("low-station")
            },
        );
        let high_station = create_entry(
            "high-station",
            SchedulerFeedEntry {
                update_frequency_score: 0.9,
                sort_order: 1,
                ..base_entry("high-station")
            },
        );
        let low_rest = create_entry(
            "low-rest",
            SchedulerFeedEntry {
                update_frequency_score: 0.1,
                sort_order: 3,
                ..base_entry("low-rest")
            },
        );

        let plan = create_scheduler_run_plan(
            &[high_rest, low_station, high_station, low_rest],
            4,
            &HashMap::new(),
            current_time_ms(),
            &SchedulerRunPlanOptions {
                frontload_feed_ids: Some(vec![
                    "low-station".to_string(),
                    "high-station".to_string(),
                ]),
                ..SchedulerRunPlanOptions::default()
            },
        );

        assert_eq!(
            plan.prioritized
                .iter()
                .map(|entry| entry.entry.feed_id.as_str())
                .collect::<Vec<_>>(),
            vec!["high-station", "low-station", "high-rest", "low-rest"]
        );
    }

    #[test]
    fn suppresses_refreshed_station_feeds_for_one_cycle() {
        let plan = create_scheduler_run_plan(
            &[
                base_entry("station-1"),
                base_entry("station-2"),
                base_entry("other"),
            ],
            3,
            &HashMap::new(),
            current_time_ms(),
            &SchedulerRunPlanOptions {
                frontload_feed_ids: Some(vec!["station-1".to_string(), "station-2".to_string()]),
                skip_feed_ids_for_this_cycle: Some(vec![
                    "station-1".to_string(),
                    "station-2".to_string(),
                ]),
                ..SchedulerRunPlanOptions::default()
            },
        );

        assert_eq!(plan.skipped_suppressed_count, 2);
        assert_eq!(
            plan.prioritized
                .iter()
                .map(|entry| entry.entry.feed_id.as_str())
                .collect::<Vec<_>>(),
            vec!["other"]
        );
    }

    #[test]
    fn applies_opml_boost_priority_when_scores_are_otherwise_equal() {
        let boosted = create_entry(
            "boosted",
            SchedulerFeedEntry {
                update_frequency_score: 0.5,
                ..base_entry("boosted")
            },
        );
        let plain = create_entry(
            "plain",
            SchedulerFeedEntry {
                update_frequency_score: 0.5,
                sort_order: 1,
                ..base_entry("plain")
            },
        );
        let now = current_time_ms();
        let mut boosts = HashMap::new();
        boosts.insert("boosted".to_string(), now + 60_000);

        let plan = create_scheduler_run_plan(
            &[plain, boosted],
            2,
            &boosts,
            now,
            &SchedulerRunPlanOptions::default(),
        );

        assert_eq!(
            plan.prioritized
                .iter()
                .map(|entry| entry.entry.feed_id.as_str())
                .collect::<Vec<_>>(),
            vec!["boosted", "plain"]
        );
    }

    #[test]
    fn bypasses_backoff_for_force_refresh_feed_ids() {
        let now = current_time_ms();
        let failing = SchedulerFeedEntry {
            consecutive_failures: 3,
            last_failed_fetch_at_ms: Some(now - 60_000),
            ..base_entry("failing")
        };

        let blocked = create_scheduler_run_plan(
            &[failing.clone()],
            1,
            &HashMap::new(),
            now,
            &SchedulerRunPlanOptions::default(),
        );
        assert_eq!(blocked.prioritized.len(), 0);
        assert_eq!(blocked.skipped_backoff_count, 1);

        let forced = create_scheduler_run_plan(
            &[failing],
            1,
            &HashMap::new(),
            now,
            &SchedulerRunPlanOptions {
                force_refresh_feed_ids: Some(vec!["failing".to_string()]),
                ..SchedulerRunPlanOptions::default()
            },
        );
        assert_eq!(forced.skipped_backoff_count, 0);
        assert_eq!(forced.prioritized.len(), 1);
    }
}
