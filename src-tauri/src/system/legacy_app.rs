//! Up to 1.9 the app was `KiJi.app`. Installing `Yomi Reader.app` leaves two
//! copies on one library, so first launch offers once to move the old copy to
//! the Trash. The bundle identifier never changed: that is why the library
//! carries over, and how the old copy is recognized here.
//!
//! The 2.0.0 release also shipped a `KiJi-2.0.0` disk image whose bundle kept the
//! old name, and it was offered to 1.9 apps for a while. A copy from that image
//! renames itself to `Yomi Reader.app` on first launch, with no prompt.

#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::{Path, PathBuf};

const LEGACY_APP_NAME: &str = "KiJi.app";
const APP_NAME: &str = "Yomi Reader.app";
const PROMPTED_MARKER: &str = "legacy-app-prompted";
/// macOS makes the first button the default, so Return must never trash anything.
const KEEP_LABEL: &str = "Keep It";
const TRASH_LABEL: &str = "Move to Trash";

/// `<folder>/KiJi.app` when this binary runs from a bundle with the old name.
fn running_legacy_bundle(current_exe: &Path) -> Option<PathBuf> {
    let bundle = current_exe.ancestors().nth(3)?;
    (bundle.file_name()? == LEGACY_APP_NAME).then(|| bundle.to_path_buf())
}

/// Where to rename the bundle, unless macOS is running it from a temporary
/// location or a copy with the new name is already there.
fn rename_target(bundle: &Path) -> Option<PathBuf> {
    if bundle.to_string_lossy().contains("/AppTranslocation/") {
        return None;
    }
    let target = bundle.with_file_name(APP_NAME);
    (!target.exists()).then_some(target)
}

/// Renames the old bundle and starts the renamed copy. True means this process
/// should exit straight away, before it opens the library.
fn rename_and_relaunch(current_exe: &Path, args: &[std::ffi::OsString]) -> bool {
    let Some(bundle) = running_legacy_bundle(current_exe) else {
        return false;
    };
    let Some(target) = rename_target(&bundle) else {
        return false;
    };
    // A read-only location such as a mounted disk image: keep running as is.
    if std::fs::rename(&bundle, &target).is_err() {
        return false;
    }
    let Some(binary) = current_exe.file_name() else {
        return false;
    };
    let relaunched = std::process::Command::new(target.join("Contents/MacOS").join(binary))
        .args(args)
        .spawn();
    if relaunched.is_err() {
        let _ = std::fs::rename(&target, &bundle);
        return false;
    }
    true
}

pub fn relaunch_under_new_name() -> bool {
    if !cfg!(target_os = "macos") {
        return false;
    }
    let Ok(current_exe) = std::env::current_exe() else {
        return false;
    };
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    rename_and_relaunch(&current_exe, &args)
}

fn legacy_app_candidates(home: Option<&Path>) -> Vec<PathBuf> {
    let mut candidates = vec![Path::new("/Applications").join(LEGACY_APP_NAME)];
    if let Some(home) = home {
        candidates.push(home.join("Applications").join(LEGACY_APP_NAME));
    }
    candidates
}

fn is_same_app(bundle: &Path, identifier: &str) -> bool {
    std::fs::read_to_string(bundle.join("Contents/Info.plist"))
        .map(|plist| plist.contains(&format!("<string>{identifier}</string>")))
        .unwrap_or(false)
}

/// The first old copy, skipping another app that happens to share the file
/// name and the copy this process is running from.
fn find_legacy_app(candidates: &[PathBuf], identifier: &str, current_exe: &Path) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|bundle| !current_exe.starts_with(bundle) && is_same_app(bundle, identifier))
        .cloned()
}

#[cfg(target_os = "macos")]
fn move_to_trash(path: &Path) -> Result<(), String> {
    use objc2_foundation::{NSFileManager, NSString, NSURL};

    let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, None)
        .map_err(|error| error.localizedDescription().to_string())
}

#[cfg(target_os = "macos")]
pub fn offer_to_remove_legacy_app<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
    use tauri::Manager;

    // A dialog would block unattended test runs.
    if std::env::var_os("KIJI_E2E_DIR").is_some() {
        return;
    }
    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let marker = config_dir.join(PROMPTED_MARKER);
    if marker.exists() {
        return;
    }
    let Ok(current_exe) = std::env::current_exe() else {
        return;
    };
    let home = std::env::var_os("HOME").map(PathBuf::from);
    let candidates = legacy_app_candidates(home.as_deref());
    let identifier = app.config().identifier.clone();
    let Some(legacy) = find_legacy_app(&candidates, &identifier, &current_exe) else {
        return;
    };

    std::thread::spawn(move || {
        let answer = MessageDialog::new()
            .set_level(MessageLevel::Info)
            .set_title("KiJi is now Yomi Reader")
            .set_description(
                "Your feeds and articles are already here. Move the old KiJi app to the Trash?",
            )
            .set_buttons(MessageButtons::OkCancelCustom(
                KEEP_LABEL.to_string(),
                TRASH_LABEL.to_string(),
            ))
            .show();
        // Ask only once, whatever the answer.
        if let Err(error) = std::fs::create_dir_all(&config_dir)
            .and_then(|()| std::fs::write(&marker, b""))
        {
            eprintln!("[Yomi Reader] Failed to remember the old app prompt: {error}");
        }
        if matches!(answer, MessageDialogResult::Custom(ref label) if label == TRASH_LABEL) {
            if let Err(error) = move_to_trash(&legacy) {
                eprintln!("[Yomi Reader] Failed to move the old app to the Trash: {error}");
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
pub fn offer_to_remove_legacy_app<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) {}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    const IDENTIFIER: &str = "com.yomilab.kiji";

    fn fake_bundle(root: &Path, name: &str, identifier: &str) -> PathBuf {
        let bundle = root.join(name);
        std::fs::create_dir_all(bundle.join("Contents")).unwrap();
        std::fs::write(
            bundle.join("Contents/Info.plist"),
            format!("<key>CFBundleIdentifier</key>\n<string>{identifier}</string>"),
        )
        .unwrap();
        bundle
    }

    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!("legacy-app-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn finds_the_old_copy_when_running_from_the_new_one() {
        let root = temp_root();
        let legacy = fake_bundle(&root, "KiJi.app", IDENTIFIER);
        let exe = root.join("Yomi Reader.app/Contents/MacOS/kiji-app");
        assert_eq!(find_legacy_app(&[legacy.clone()], IDENTIFIER, &exe), Some(legacy));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ignores_another_app_with_the_same_file_name() {
        let root = temp_root();
        let other = fake_bundle(&root, "KiJi.app", "com.example.other");
        let exe = root.join("Yomi Reader.app/Contents/MacOS/kiji-app");
        assert_eq!(find_legacy_app(&[other], IDENTIFIER, &exe), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn never_offers_to_trash_the_running_copy() {
        let root = temp_root();
        let legacy = fake_bundle(&root, "KiJi.app", IDENTIFIER);
        let exe = legacy.join("Contents/MacOS/kiji-app");
        assert_eq!(find_legacy_app(&[legacy], IDENTIFIER, &exe), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_copy_is_not_an_error() {
        let root = temp_root();
        let exe = root.join("Yomi Reader.app/Contents/MacOS/kiji-app");
        assert_eq!(find_legacy_app(&[root.join("KiJi.app")], IDENTIFIER, &exe), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn only_the_old_bundle_name_is_renamed() {
        assert_eq!(
            running_legacy_bundle(Path::new("/Applications/KiJi.app/Contents/MacOS/kiji-app")),
            Some(PathBuf::from("/Applications/KiJi.app"))
        );
        assert_eq!(
            running_legacy_bundle(Path::new("/Applications/Yomi Reader.app/Contents/MacOS/kiji-app")),
            None
        );
        assert_eq!(running_legacy_bundle(Path::new("/usr/bin/kiji-app")), None);
    }

    #[test]
    fn leaves_translocated_copies_and_existing_new_copies_alone() {
        assert_eq!(
            rename_target(Path::new("/private/var/folders/x/AppTranslocation/y/d/KiJi.app")),
            None
        );
        let root = temp_root();
        let legacy = fake_bundle(&root, "KiJi.app", IDENTIFIER);
        assert_eq!(rename_target(&legacy), Some(root.join("Yomi Reader.app")));
        fake_bundle(&root, "Yomi Reader.app", IDENTIFIER);
        assert_eq!(rename_target(&legacy), None);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn renames_the_bundle_and_starts_the_renamed_copy() {
        use std::os::unix::fs::PermissionsExt;

        let root = temp_root();
        let legacy = fake_bundle(&root, "KiJi.app", IDENTIFIER);
        let binary = legacy.join("Contents/MacOS/kiji-app");
        std::fs::create_dir_all(binary.parent().unwrap()).unwrap();
        let started = root.join("started");
        std::fs::write(&binary, format!("#!/bin/sh\ntouch '{}'\n", started.display())).unwrap();
        std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(rename_and_relaunch(&binary, &[]));
        assert!(!legacy.exists());
        assert!(root.join("Yomi Reader.app/Contents/MacOS/kiji-app").exists());
        for _ in 0..100 {
            if started.exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(started.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn keeps_the_old_name_when_the_renamed_copy_cannot_start() {
        let root = temp_root();
        let legacy = fake_bundle(&root, "KiJi.app", IDENTIFIER);
        let missing_binary = legacy.join("Contents/MacOS/kiji-app");

        assert!(!rename_and_relaunch(&missing_binary, &[]));
        assert!(legacy.exists());
        assert!(!root.join("Yomi Reader.app").exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn looks_in_both_applications_folders() {
        let candidates = legacy_app_candidates(Some(Path::new("/Users/someone")));
        assert_eq!(
            candidates,
            vec![
                PathBuf::from("/Applications/KiJi.app"),
                PathBuf::from("/Users/someone/Applications/KiJi.app"),
            ]
        );
    }

    /// Changing these strands existing users: the identifier names the library
    /// folder, and the rest is what lets a new install replace an old one.
    #[test]
    fn upgrade_identifiers_stay_pinned() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../../tauri.conf.json")).unwrap();
        assert_eq!(config["productName"], "Yomi Reader");
        assert_eq!(config["identifier"], IDENTIFIER);
        assert_eq!(
            config["bundle"]["windows"]["wix"]["upgradeCode"],
            "DB5CC356-37B3-51DC-AA1E-D7EA8134702E"
        );
        assert_eq!(config["bundle"]["linux"]["deb"]["replaces"][0], "ki-ji");
        assert_eq!(config["bundle"]["linux"]["rpm"]["obsoletes"][0], "ki-ji");
    }
}
