use crate::scheduler::webview_delivery::{
    emit_scheduler_event_to_main_webview, RESUME_WAKE_SCRIPT, SLEEP_WAKE_SCRIPT,
};
use tauri::AppHandle;

pub const SCHEDULER_SYSTEM_SLEEP_EVENT: &str = "scheduler:system-sleep";
pub const SCHEDULER_SYSTEM_RESUME_EVENT: &str = "scheduler:system-resume";

pub fn start_system_power_watch(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        start_macos_power_watch(app)?;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn start_macos_power_watch(app: &AppHandle) -> Result<(), String> {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{
        NSWorkspace, NSWorkspaceDidWakeNotification, NSWorkspaceWillSleepNotification,
    };
    use objc2_foundation::{NSNotification, NSOperationQueue};

    let workspace = NSWorkspace::sharedWorkspace();
    let center = workspace.notificationCenter();

    let sleep_app = app.clone();
    let sleep_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        emit_scheduler_power_event(&sleep_app, SCHEDULER_SYSTEM_SLEEP_EVENT, SLEEP_WAKE_SCRIPT);
    });

    let wake_app = app.clone();
    let wake_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        emit_scheduler_power_event(&wake_app, SCHEDULER_SYSTEM_RESUME_EVENT, RESUME_WAKE_SCRIPT);
    });

    unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceWillSleepNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &sleep_block,
        );
        center.addObserverForName_object_queue_usingBlock(
            Some(NSWorkspaceDidWakeNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &wake_block,
        );
    }

    // Observers live for the process lifetime.
    std::mem::forget((sleep_block, wake_block));

    Ok(())
}

fn emit_scheduler_power_event(app: &AppHandle, event: &str, wake_script: &str) {
    emit_scheduler_event_to_main_webview(app, event, wake_script, "Power");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scheduler::webview_delivery::{RESUME_WAKE_SCRIPT, SLEEP_WAKE_SCRIPT};

    #[test]
    fn power_events_use_main_webview_wake_scripts() {
        assert_eq!(SCHEDULER_SYSTEM_SLEEP_EVENT, "scheduler:system-sleep");
        assert_eq!(SCHEDULER_SYSTEM_RESUME_EVENT, "scheduler:system-resume");
        assert!(SLEEP_WAKE_SCRIPT.contains("__kijiSchedulerSleep"));
        assert!(RESUME_WAKE_SCRIPT.contains("__kijiSchedulerResume"));
    }
}
