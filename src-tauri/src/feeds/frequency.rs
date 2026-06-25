pub fn compute_frequency_from_dates(dates: &[String]) -> f64 {
    if dates.len() < 2 {
        return 0.1;
    }

    let mut intervals = Vec::new();
    for index in 0..dates.len().saturating_sub(1) {
        let newer = parse_timestamp_ms(&dates[index]);
        let older = parse_timestamp_ms(&dates[index + 1]);
        if let (Some(newer), Some(older)) = (newer, older) {
            let diff = newer - older;
            if diff > 0 {
                intervals.push(diff);
            }
        }
    }

    if intervals.is_empty() {
        return 0.1;
    }

    intervals.sort_unstable();
    let mid = intervals.len() / 2;
    let median_ms = if intervals.len() % 2 == 0 {
        (intervals[mid - 1] + intervals[mid]) as f64 / 2.0
    } else {
        intervals[mid] as f64
    };

    let ms_per_day = 86_400_000.0;
    let posts_per_day = ms_per_day / median_ms;

    if posts_per_day >= 5.0 {
        1.0
    } else if posts_per_day >= 1.0 {
        0.75
    } else if posts_per_day >= 1.0 / 7.0 {
        0.5
    } else if posts_per_day >= 1.0 / 30.0 {
        0.25
    } else {
        0.1
    }
}

fn parse_timestamp_ms(value: &str) -> Option<i64> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn returns_floor_score_for_single_date() {
        assert_eq!(compute_frequency_from_dates(&["2026-06-22T00:00:00.000Z".to_string()]), 0.1);
    }

    #[test]
    fn scores_daily_posts_at_point_seven_five() {
        let dates = vec![
            "2026-06-22T00:00:00.000Z".to_string(),
            "2026-06-21T00:00:00.000Z".to_string(),
            "2026-06-20T00:00:00.000Z".to_string(),
        ];
        assert_eq!(compute_frequency_from_dates(&dates), 0.75);
    }
}
