use tauri::Monitor;

pub const MAIN_WINDOW_MIN_WIDTH: u32 = 600;
pub const MAIN_WINDOW_MIN_HEIGHT: u32 = 400;
const WORK_AREA_MARGIN: f64 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LogicalRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SavedWindowBounds {
    pub width: u32,
    pub height: u32,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FittedWindowBounds {
    pub width: u32,
    pub height: u32,
    pub x: i32,
    pub y: i32,
    pub adjusted: bool,
}

pub fn monitor_work_area_logical(monitor: &Monitor) -> LogicalRect {
    let scale = monitor.scale_factor().max(1.0);
    let work_area = monitor.work_area();

    LogicalRect {
        x: work_area.position.x as f64 / scale,
        y: work_area.position.y as f64 / scale,
        width: work_area.size.width as f64 / scale,
        height: work_area.size.height as f64 / scale,
    }
}

pub fn fit_window_bounds_to_displays(
    saved: SavedWindowBounds,
    work_areas: &[LogicalRect],
    primary: Option<LogicalRect>,
    min_width: u32,
    min_height: u32,
) -> FittedWindowBounds {
    let fallback_area = primary
        .or_else(|| work_areas.first().copied())
        .unwrap_or(LogicalRect {
            x: 0.0,
            y: 0.0,
            width: saved.width as f64,
            height: saved.height as f64,
        });

    let target_area = select_target_work_area(saved, work_areas, fallback_area);
    let max_width = (target_area.width - WORK_AREA_MARGIN * 2.0).max(min_width as f64);
    let max_height = (target_area.height - WORK_AREA_MARGIN * 2.0).max(min_height as f64);

    let width = clamp_dimension(saved.width, min_width, max_width);
    let height = clamp_dimension(saved.height, min_height, max_height);
    let width_f = width as f64;
    let height_f = height as f64;

    let (x, y) = if let (Some(saved_x), Some(saved_y)) = (saved.x, saved.y) {
        let candidate = LogicalRect {
            x: saved_x as f64,
            y: saved_y as f64,
            width: width_f,
            height: height_f,
        };

        if work_areas
            .iter()
            .any(|area| rects_intersect(candidate, *area))
        {
            clamp_position(
                saved_x as f64,
                saved_y as f64,
                width_f,
                height_f,
                target_area,
            )
        } else {
            center_in_area(width_f, height_f, fallback_area)
        }
    } else {
        center_in_area(width_f, height_f, target_area)
    };

    let adjusted = width != saved.width
        || height != saved.height
        || saved.x != Some(x.round() as i32)
        || saved.y != Some(y.round() as i32);

    FittedWindowBounds {
        width,
        height,
        x: x.round() as i32,
        y: y.round() as i32,
        adjusted,
    }
}

fn select_target_work_area(
    saved: SavedWindowBounds,
    work_areas: &[LogicalRect],
    fallback_area: LogicalRect,
) -> LogicalRect {
    let Some((saved_x, saved_y)) = saved.x.zip(saved.y) else {
        return fallback_area;
    };

    if work_areas.is_empty() {
        return fallback_area;
    }

    let candidate = LogicalRect {
        x: saved_x as f64,
        y: saved_y as f64,
        width: saved.width as f64,
        height: saved.height as f64,
    };

    work_areas
        .iter()
        .copied()
        .max_by(|left, right| {
            rect_intersection_area(candidate, *left)
                .partial_cmp(&rect_intersection_area(candidate, *right))
                .unwrap_or(std::cmp::Ordering::Equal)
        })
        .filter(|area| rects_intersect(candidate, *area))
        .unwrap_or(fallback_area)
}

fn clamp_dimension(value: u32, min: u32, max: f64) -> u32 {
    (value as f64).clamp(min as f64, max.max(min as f64)).round() as u32
}

fn center_in_area(width: f64, height: f64, area: LogicalRect) -> (f64, f64) {
    (
        area.x + (area.width - width) / 2.0,
        area.y + (area.height - height) / 2.0,
    )
}

fn clamp_position(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    area: LogicalRect,
) -> (f64, f64) {
    let max_x = area.x + (area.width - width).max(0.0);
    let max_y = area.y + (area.height - height).max(0.0);
    (x.clamp(area.x, max_x), y.clamp(area.y, max_y))
}

fn rects_intersect(left: LogicalRect, right: LogicalRect) -> bool {
    left.x < right.x + right.width
        && left.x + left.width > right.x
        && left.y < right.y + right.height
        && left.y + left.height > right.y
}

fn rect_intersection_area(left: LogicalRect, right: LogicalRect) -> f64 {
    let overlap_width =
        (left.x + left.width).min(right.x + right.width) - left.x.max(right.x);
    let overlap_height =
        (left.y + left.height).min(right.y + right.height) - left.y.max(right.y);

    if overlap_width <= 0.0 || overlap_height <= 0.0 {
        0.0
    } else {
        overlap_width * overlap_height
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAPTOP: LogicalRect = LogicalRect {
        x: 0.0,
        y: 0.0,
        width: 1440.0,
        height: 900.0,
    };

    const EXTERNAL: LogicalRect = LogicalRect {
        x: 1440.0,
        y: 0.0,
        width: 2560.0,
        height: 1440.0,
    };

    #[test]
    fn keeps_saved_bounds_when_still_on_screen() {
        let fitted = fit_window_bounds_to_displays(
            SavedWindowBounds {
                width: 1200,
                height: 800,
                x: Some(120),
                y: Some(80),
            },
            &[LAPTOP],
            Some(LAPTOP),
            MAIN_WINDOW_MIN_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        );

        assert_eq!(
            fitted,
            FittedWindowBounds {
                width: 1200,
                height: 800,
                x: 120,
                y: 80,
                adjusted: false,
            }
        );
    }

    #[test]
    fn recenters_and_clamps_when_external_monitor_is_gone() {
        let fitted = fit_window_bounds_to_displays(
            SavedWindowBounds {
                width: 2200,
                height: 1300,
                x: Some(1800),
                y: Some(120),
            },
            &[LAPTOP],
            Some(LAPTOP),
            MAIN_WINDOW_MIN_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        );

        assert!(fitted.adjusted);
        assert_eq!(fitted.width, 1424);
        assert_eq!(fitted.height, 884);
        assert_eq!(fitted.x, 8);
        assert_eq!(fitted.y, 8);
    }

    #[test]
    fn clamps_oversized_window_on_current_monitor() {
        let fitted = fit_window_bounds_to_displays(
            SavedWindowBounds {
                width: 3000,
                height: 1800,
                x: Some(20),
                y: Some(20),
            },
            &[LAPTOP],
            Some(LAPTOP),
            MAIN_WINDOW_MIN_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        );

        assert!(fitted.adjusted);
        assert_eq!(fitted.width, 1424);
        assert_eq!(fitted.height, 884);
        assert_eq!(fitted.x, 16);
        assert_eq!(fitted.y, 16);
    }

    #[test]
    fn centers_when_position_was_not_saved() {
        let fitted = fit_window_bounds_to_displays(
            SavedWindowBounds {
                width: 1000,
                height: 700,
                x: None,
                y: None,
            },
            &[LAPTOP],
            Some(LAPTOP),
            MAIN_WINDOW_MIN_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        );

        assert_eq!(fitted.width, 1000);
        assert_eq!(fitted.height, 700);
        assert_eq!(fitted.x, 220);
        assert_eq!(fitted.y, 100);
        assert!(fitted.adjusted);
    }

    #[test]
    fn keeps_dual_monitor_position_when_that_display_is_still_present() {
        let fitted = fit_window_bounds_to_displays(
            SavedWindowBounds {
                width: 1800,
                height: 1000,
                x: Some(1600),
                y: Some(120),
            },
            &[LAPTOP, EXTERNAL],
            Some(LAPTOP),
            MAIN_WINDOW_MIN_WIDTH,
            MAIN_WINDOW_MIN_HEIGHT,
        );

        assert_eq!(fitted.width, 1800);
        assert_eq!(fitted.height, 1000);
        assert_eq!(fitted.x, 1600);
        assert_eq!(fitted.y, 120);
        assert!(!fitted.adjusted);
    }
}
