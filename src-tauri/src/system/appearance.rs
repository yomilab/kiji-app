use serde::Deserialize;
use tauri::AppHandle;

use crate::settings::Theme;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ResolvedAppearance {
    Light,
    Dark,
    System,
}

impl ResolvedAppearance {
    pub fn from_theme(theme: Theme) -> Self {
        match theme {
            Theme::Light => Self::Light,
            Theme::Dark => Self::Dark,
            Theme::Auto => Self::System,
        }
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn system_appearance_set(
    app: AppHandle,
    appearance: ResolvedAppearance,
) -> Result<(), String> {
    apply_app_appearance(&app, appearance)
}

pub fn apply_app_appearance(
    app: &AppHandle,
    appearance: ResolvedAppearance,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || set_macos_app_appearance(appearance))
            .map_err(|error| format!("Failed to schedule macOS appearance update: {error}"))?;
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        let _ = appearance;
    }

    Ok(())
}

#[cfg(target_os = "macos")]
fn set_macos_app_appearance(appearance: ResolvedAppearance) {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{
        NSAppearance, NSAppearanceNameAqua, NSAppearanceNameDarkAqua, NSApplication,
    };

    unsafe {
        let mtm = MainThreadMarker::new_unchecked();
        let application = NSApplication::sharedApplication(mtm);
        let value = match appearance {
            ResolvedAppearance::Light => NSAppearance::appearanceNamed(NSAppearanceNameAqua),
            ResolvedAppearance::Dark => NSAppearance::appearanceNamed(NSAppearanceNameDarkAqua),
            ResolvedAppearance::System => None,
        };
        application.setAppearance(value.as_deref());
    }
}

#[cfg(test)]
mod tests {
    use super::ResolvedAppearance;
    use crate::settings::Theme;

    #[test]
    fn theme_maps_to_resolved_appearance() {
        assert_eq!(
            ResolvedAppearance::from_theme(Theme::Light),
            ResolvedAppearance::Light
        );
        assert_eq!(
            ResolvedAppearance::from_theme(Theme::Dark),
            ResolvedAppearance::Dark
        );
        assert_eq!(
            ResolvedAppearance::from_theme(Theme::Auto),
            ResolvedAppearance::System
        );
    }

    #[test]
    fn appearance_deserializes_kebab_case() {
        let parsed: ResolvedAppearance =
            serde_json::from_str(r#""system""#).expect("system should deserialize");
        assert_eq!(parsed, ResolvedAppearance::System);
    }
}
