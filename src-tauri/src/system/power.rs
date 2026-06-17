use tauri::{AppHandle, Emitter};

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
        if let Err(error) = sleep_app.emit(SCHEDULER_SYSTEM_SLEEP_EVENT, ()) {
            eprintln!("[Power] Failed to emit scheduler sleep event: {error}");
        }
    });

    let wake_app = app.clone();
    let wake_block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Err(error) = wake_app.emit(SCHEDULER_SYSTEM_RESUME_EVENT, ()) {
            eprintln!("[Power] Failed to emit scheduler wake event: {error}");
        }
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
