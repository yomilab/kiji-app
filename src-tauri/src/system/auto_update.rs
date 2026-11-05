//! Silent app updates: check in the background, download, and install when the
//! app quits, with no window. Where that can't happen without asking for a
//! password (deb and rpm packages, a folder this user can't write to), this
//! stays inactive and the sidebar's update badge offers the download instead.

use crate::settings::SettingsState;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::utils::config::BundleType;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};
use uuid::Uuid;

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(60);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

struct StagedUpdate {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct AutoUpdateState {
    staged: Mutex<Option<StagedUpdate>>,
    /// The last attempt failed, so the update badge should come back.
    failed: AtomicBool,
}

fn installs_without_a_password(bundle_type: Option<BundleType>, folder_writable: bool) -> bool {
    !matches!(bundle_type, Some(BundleType::Deb | BundleType::Rpm)) && folder_writable
}

fn is_writable_folder(folder: &Path) -> bool {
    let probe = folder.join(format!(".yomi-reader-write-check-{}", Uuid::new_v4()));
    match std::fs::write(&probe, b"") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// The folder an update has to write into.
fn install_folder() -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        return std::env::current_exe().ok()?.parent().map(Path::to_path_buf);
    }
    if cfg!(target_os = "linux") {
        return std::env::var_os("APPIMAGE")
            .map(PathBuf::from)
            .and_then(|path| path.parent().map(Path::to_path_buf));
    }
    let exe = std::env::current_exe().ok()?;
    if exe.to_string_lossy().contains("/AppTranslocation/") {
        return None;
    }
    // <folder>/<name>.app/Contents/MacOS/<binary>
    exe.ancestors().nth(4).map(Path::to_path_buf)
}

fn can_install_silently() -> bool {
    if cfg!(debug_assertions) || std::env::var_os("KIJI_E2E_DIR").is_some() {
        return false;
    }
    // Windows installs per user, so the folder check covers it too.
    let folder_writable = install_folder().is_some_and(|folder| is_writable_folder(&folder));
    installs_without_a_password(tauri::utils::platform::bundle_type(), folder_writable)
}

fn is_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    app.try_state::<Arc<SettingsState>>()
        .and_then(|settings| settings.snapshot().ok())
        .is_some_and(|settings| settings.auto_install_updates)
}

fn is_active<R: Runtime>(app: &AppHandle<R>) -> bool {
    is_enabled(app) && can_install_silently()
}

async fn check_and_download<R: Runtime>(app: &AppHandle<R>) -> Result<Option<StagedUpdate>, String> {
    let updater = app.updater().map_err(|error| error.to_string())?;
    let Some(update) = updater.check().await.map_err(|error| error.to_string())? else {
        return Ok(None);
    };
    let bytes = update
        .download(|_, _| {}, || {})
        .await
        .map_err(|error| error.to_string())?;
    Ok(Some(StagedUpdate { update, bytes }))
}

pub fn start_auto_update<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            let already_staged = app
                .try_state::<AutoUpdateState>()
                .is_some_and(|state| state.staged.lock().is_ok_and(|staged| staged.is_some()));
            if is_active(&app) && !already_staged {
                let result = check_and_download(&app).await;
                if let Some(state) = app.try_state::<AutoUpdateState>() {
                    state.failed.store(result.is_err(), Ordering::Relaxed);
                    match result {
                        Ok(Some(staged)) => {
                            if let Ok(mut slot) = state.staged.lock() {
                                *slot = Some(staged);
                            }
                        }
                        Ok(None) => {}
                        Err(error) => eprintln!("[Yomi Reader] Update check failed: {error}"),
                    }
                }
            }
            tokio::time::sleep(CHECK_INTERVAL).await;
        }
    });
}

/// Call last on exit: on Windows the install ends this process.
pub fn install_staged_update<R: Runtime>(app: &AppHandle<R>) {
    if !is_active(app) {
        return;
    }
    let Some(state) = app.try_state::<AutoUpdateState>() else {
        return;
    };
    let Some(staged) = state.staged.lock().ok().and_then(|mut slot| slot.take()) else {
        return;
    };
    // The person chose to quit, so an update mustn't reopen the app.
    let update = staged.update.restart_after_install(false);
    if let Err(error) = update.install(staged.bytes) {
        eprintln!("[Yomi Reader] Failed to install the update: {error}");
    }
}

/// True while updates install by themselves, so the update badge stays hidden.
#[tauri::command]
pub fn system_auto_update_active(
    app: AppHandle,
    state: tauri::State<'_, AutoUpdateState>,
) -> bool {
    is_active(&app) && !state.failed.load(Ordering::Relaxed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packages_that_need_a_password_never_install_silently() {
        assert!(!installs_without_a_password(Some(BundleType::Deb), true));
        assert!(!installs_without_a_password(Some(BundleType::Rpm), true));
    }

    #[test]
    fn a_folder_this_user_cannot_write_to_never_installs_silently() {
        assert!(!installs_without_a_password(Some(BundleType::App), false));
    }

    #[test]
    fn other_installs_can_update_silently() {
        assert!(installs_without_a_password(Some(BundleType::App), true));
        assert!(installs_without_a_password(Some(BundleType::Nsis), true));
        assert!(installs_without_a_password(Some(BundleType::AppImage), true));
    }

    #[test]
    fn write_check_leaves_nothing_behind() {
        let folder = std::env::temp_dir().join(format!("auto-update-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&folder).unwrap();
        assert!(is_writable_folder(&folder));
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0);
        assert!(!is_writable_folder(&folder.join("missing")));
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn updater_config_stays_quiet_and_signed() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        let updater = &config["plugins"]["updater"];
        assert_eq!(updater["windows"]["installMode"], "quiet");
        assert!(updater["pubkey"].as_str().is_some_and(|key| !key.is_empty()));
    }
}
