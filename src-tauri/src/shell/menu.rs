use super::window::open_settings_window;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Emitter, Manager, State, Wry,
};
use tauri_plugin_opener::OpenerExt;

const APP_NAME: &str = "KiJi";
const CONTACT_EMAIL: &str = "hello@yomilab.app";
const APP_WEBSITE_URL: &str = "https://kiji.yomilab.app";

const MENU_SETTINGS: &str = "menu-settings";
const MENU_CHECK_UPDATES: &str = "menu-check-updates";
const MENU_EXPORT_FEEDS: &str = "menu-export-feeds";
const MENU_EXPORT_SAVED: &str = "menu-export-saved";
const MENU_CLEAR_FEEDS: &str = "menu-clear-feeds";
const MENU_CLEAR_SAVED: &str = "menu-clear-saved";
const MENU_CLEAR_OLD_1M: &str = "menu-clear-old-1m";
const MENU_CLEAR_OLD_3M: &str = "menu-clear-old-3m";
const MENU_CLEAR_ALL_ARTICLES: &str = "menu-clear-all-articles";
const MENU_THEME_AUTO: &str = "menu-theme-auto";
const MENU_THEME_LIGHT: &str = "menu-theme-light";
const MENU_THEME_DARK: &str = "menu-theme-dark";
const MENU_LIBRARY_SAVED: &str = "menu-library-saved";
const MENU_LIBRARY_UNREAD: &str = "menu-library-unread";
const MENU_LIBRARY_ALL: &str = "menu-library-all";
const MENU_ADD_SUBSCRIPTION: &str = "menu-add-subscription";
const MENU_IMPORT_FEEDS: &str = "menu-import-feeds";
const MENU_HELP_SUPPORT: &str = "menu-help-support";
const MENU_HELP_WEBSITE: &str = "menu-help-website";

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AppMenuCommand {
    OpenAddSubscription,
    ImportFeeds,
    CheckUpdates,
    ExportFeeds,
    ExportSavedArticles,
    ClearFeeds,
    ClearSavedArticles,
    ClearArticles,
    ClearArticlesOlderThan {
        months: u8,
    },
    SetTheme {
        theme: String,
    },
    SelectLibraryView {
        #[serde(rename = "libraryView")]
        library_view: String,
    },
}

#[derive(Clone, Debug, Default)]
struct AppMenuRuntimeState {
    theme: String,
    library_view: Option<String>,
}

pub struct ApplicationMenu {
    runtime: Mutex<AppMenuRuntimeState>,
    theme_auto: CheckMenuItem<Wry>,
    theme_light: CheckMenuItem<Wry>,
    theme_dark: CheckMenuItem<Wry>,
    library_saved: CheckMenuItem<Wry>,
    library_unread: CheckMenuItem<Wry>,
    library_all: CheckMenuItem<Wry>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AppMenuStatePatch {
    pub theme: Option<String>,
    pub library_view: Option<Option<String>>,
}

impl ApplicationMenu {
    pub fn install(app: &AppHandle) -> Result<(), String> {
        let (menu, handles) = Self::build_menu(app)?;
        app.set_menu(menu)
            .map_err(|error| format!("Failed to install the application menu: {error}"))?;
        app.manage(handles);

        let app_handle = app.clone();
        app.on_menu_event(move |app, event| {
            if let Some(menu) = app.try_state::<ApplicationMenu>() {
                menu.handle_event(&app_handle, event.id().as_ref());
            }
        });

        Ok(())
    }

    fn build_menu(app: &AppHandle) -> Result<(Menu<Wry>, ApplicationMenu), String> {
        let theme_auto = menu_check(app, MENU_THEME_AUTO, "Automatic", true)?;
        let theme_light = menu_check(app, MENU_THEME_LIGHT, "Light", false)?;
        let theme_dark = menu_check(app, MENU_THEME_DARK, "Dark", false)?;
        let library_saved = menu_check(app, MENU_LIBRARY_SAVED, "Saved", false)?;
        let library_unread = menu_check(app, MENU_LIBRARY_UNREAD, "Unread", false)?;
        let library_all = menu_check(app, MENU_LIBRARY_ALL, "All Items", false)?;

        let handles = ApplicationMenu {
            runtime: Mutex::new(AppMenuRuntimeState {
                theme: "auto".to_string(),
                library_view: None,
            }),
            theme_auto,
            theme_light,
            theme_dark,
            library_saved,
            library_unread,
            library_all,
        };

        let settings_item =
            MenuItem::with_id(app, MENU_SETTINGS, "Settings...", true, Some("CmdOrCtrl+,"))
                .map_err(menu_error)?;

        let app_submenu = if cfg!(target_os = "macos") {
            Submenu::with_items(
                app,
                APP_NAME,
                true,
                &[
                    &PredefinedMenuItem::about(app, Some(APP_NAME), None).map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &settings_item,
                    &MenuItem::with_id(
                        app,
                        MENU_CHECK_UPDATES,
                        "Check Updates",
                        true,
                        None::<&str>,
                    )
                    .map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &PredefinedMenuItem::services(app, None).map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &PredefinedMenuItem::hide(app, None).map_err(menu_error)?,
                    &PredefinedMenuItem::hide_others(app, None).map_err(menu_error)?,
                    &PredefinedMenuItem::show_all(app, None).map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &PredefinedMenuItem::quit(app, None).map_err(menu_error)?,
                ],
            )
            .map_err(menu_error)?
        } else {
            Submenu::with_items(
                app,
                APP_NAME,
                true,
                &[
                    &MenuItem::with_id(app, "menu-about", "About KiJi", true, None::<&str>)
                        .map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &settings_item,
                    &MenuItem::with_id(
                        app,
                        MENU_CHECK_UPDATES,
                        "Check Updates",
                        true,
                        None::<&str>,
                    )
                    .map_err(menu_error)?,
                    &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                    &PredefinedMenuItem::quit(app, Some(&format!("Quit {APP_NAME}")))
                        .map_err(menu_error)?,
                ],
            )
            .map_err(menu_error)?
        };

        let file_submenu = Submenu::with_items(
            app,
            "File",
            true,
            &[
                &PredefinedMenuItem::close_window(app, None).map_err(menu_error)?,
                &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                &menu_command_item(app, MENU_EXPORT_FEEDS, "Export Feeds")?,
                &menu_command_item(app, MENU_EXPORT_SAVED, "Export Saved Articles")?,
                &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                &menu_command_item(app, MENU_CLEAR_FEEDS, "Clear Feeds")?,
                &menu_command_item(app, MENU_CLEAR_SAVED, "Clear Saved Articles")?,
                &menu_command_item(app, MENU_CLEAR_OLD_1M, "Clear Articles Older Than 1 Month")?,
                &menu_command_item(app, MENU_CLEAR_OLD_3M, "Clear Articles Older Than 3 Months")?,
                &menu_command_item(app, MENU_CLEAR_ALL_ARTICLES, "Clear All Articles")?,
            ],
        )
        .map_err(menu_error)?;

        let theme_submenu = Submenu::with_items(
            app,
            "Theme",
            true,
            &[
                &handles.theme_auto,
                &handles.theme_light,
                &handles.theme_dark,
            ],
        )
        .map_err(menu_error)?;

        let library_submenu = Submenu::with_items(
            app,
            "Library",
            true,
            &[
                &handles.library_saved,
                &handles.library_unread,
                &handles.library_all,
            ],
        )
        .map_err(menu_error)?;

        let view_submenu =
            Submenu::with_items(app, "View", true, &[&theme_submenu, &library_submenu])
                .map_err(menu_error)?;

        let subscriptions_submenu = Submenu::with_items(
            app,
            "Subscriptions",
            true,
            &[
                &MenuItem::with_id(
                    app,
                    MENU_ADD_SUBSCRIPTION,
                    "Add Subscription",
                    true,
                    Some("CmdOrCtrl+N"),
                )
                .map_err(menu_error)?,
                &MenuItem::with_id(app, MENU_IMPORT_FEEDS, "Import Feeds", true, None::<&str>)
                    .map_err(menu_error)?,
            ],
        )
        .map_err(menu_error)?;

        let help_submenu = Submenu::with_items(
            app,
            "Help",
            true,
            &[
                &MenuItem::with_id(app, MENU_HELP_SUPPORT, "Support", true, None::<&str>)
                    .map_err(menu_error)?,
                &MenuItem::with_id(
                    app,
                    MENU_HELP_WEBSITE,
                    "Visit Our Website",
                    true,
                    None::<&str>,
                )
                .map_err(menu_error)?,
            ],
        )
        .map_err(menu_error)?;

        let mut top_level: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
            vec![&app_submenu, &file_submenu];

        let edit_submenu = if cfg!(target_os = "macos") {
            Some(
                Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::redo(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                        &PredefinedMenuItem::cut(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::copy(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::paste(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::select_all(app, None).map_err(menu_error)?,
                    ],
                )
                .map_err(menu_error)?,
            )
        } else {
            None
        };

        let window_submenu = if cfg!(target_os = "macos") {
            Some(
                Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[
                        &PredefinedMenuItem::minimize(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::maximize(app, None).map_err(menu_error)?,
                        &PredefinedMenuItem::separator(app).map_err(menu_error)?,
                        &PredefinedMenuItem::close_window(app, None).map_err(menu_error)?,
                    ],
                )
                .map_err(menu_error)?,
            )
        } else {
            None
        };

        if let Some(edit_submenu) = &edit_submenu {
            top_level.push(edit_submenu);
        }

        top_level.push(&view_submenu);
        top_level.push(&subscriptions_submenu);

        if let Some(window_submenu) = &window_submenu {
            top_level.push(window_submenu);
        }

        top_level.push(&help_submenu);

        let menu = Menu::with_items(app, &top_level).map_err(menu_error)?;
        Ok((menu, handles))
    }

    fn handle_event(&self, app: &AppHandle, menu_id: &str) {
        match menu_id {
            MENU_SETTINGS => {
                let _ = open_settings_window(app);
            }
            MENU_CHECK_UPDATES => {
                emit_menu_command(app, AppMenuCommand::CheckUpdates);
            }
            MENU_EXPORT_FEEDS => emit_menu_command(app, AppMenuCommand::ExportFeeds),
            MENU_EXPORT_SAVED => emit_menu_command(app, AppMenuCommand::ExportSavedArticles),
            MENU_CLEAR_FEEDS => emit_menu_command(app, AppMenuCommand::ClearFeeds),
            MENU_CLEAR_SAVED => emit_menu_command(app, AppMenuCommand::ClearSavedArticles),
            MENU_CLEAR_OLD_1M => {
                emit_menu_command(app, AppMenuCommand::ClearArticlesOlderThan { months: 1 })
            }
            MENU_CLEAR_OLD_3M => {
                emit_menu_command(app, AppMenuCommand::ClearArticlesOlderThan { months: 3 })
            }
            MENU_CLEAR_ALL_ARTICLES => emit_menu_command(app, AppMenuCommand::ClearArticles),
            MENU_THEME_AUTO => {
                self.set_theme("auto");
                emit_menu_command(
                    app,
                    AppMenuCommand::SetTheme {
                        theme: "auto".into(),
                    },
                );
            }
            MENU_THEME_LIGHT => {
                self.set_theme("light");
                emit_menu_command(
                    app,
                    AppMenuCommand::SetTheme {
                        theme: "light".into(),
                    },
                );
            }
            MENU_THEME_DARK => {
                self.set_theme("dark");
                emit_menu_command(
                    app,
                    AppMenuCommand::SetTheme {
                        theme: "dark".into(),
                    },
                );
            }
            MENU_LIBRARY_SAVED => {
                self.set_library_view(Some("saved".into()));
                emit_menu_command(
                    app,
                    AppMenuCommand::SelectLibraryView {
                        library_view: "saved".into(),
                    },
                );
            }
            MENU_LIBRARY_UNREAD => {
                self.set_library_view(Some("unread".into()));
                emit_menu_command(
                    app,
                    AppMenuCommand::SelectLibraryView {
                        library_view: "unread".into(),
                    },
                );
            }
            MENU_LIBRARY_ALL => {
                self.set_library_view(Some("all".into()));
                emit_menu_command(
                    app,
                    AppMenuCommand::SelectLibraryView {
                        library_view: "all".into(),
                    },
                );
            }
            MENU_ADD_SUBSCRIPTION => emit_menu_command(app, AppMenuCommand::OpenAddSubscription),
            MENU_IMPORT_FEEDS => emit_menu_command(app, AppMenuCommand::ImportFeeds),
            MENU_HELP_SUPPORT => {
                let subject = format!("{APP_NAME} Support");
                let url = format!(
                    "mailto:{CONTACT_EMAIL}?{}",
                    form_urlencoded(&[("subject", subject.as_str())])
                );
                let _ = app.opener().open_url(url, None::<&str>);
            }
            MENU_HELP_WEBSITE => {
                let _ = app.opener().open_url(APP_WEBSITE_URL, None::<&str>);
            }
            _ => {}
        }
    }

    fn set_library_view(&self, library_view: Option<String>) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.library_view = library_view.clone();
        }
        let _ = self
            .library_saved
            .set_checked(library_view.as_deref() == Some("saved"));
        let _ = self
            .library_unread
            .set_checked(library_view.as_deref() == Some("unread"));
        let _ = self
            .library_all
            .set_checked(library_view.as_deref() == Some("all"));
    }

    pub fn apply_patch(&self, patch: AppMenuStatePatch) -> Result<(), String> {
        if let Some(theme) = patch.theme {
            self.set_theme(&theme);
        }

        if let Some(library_view) = patch.library_view {
            self.set_library_view(library_view);
        }

        Ok(())
    }

    fn set_theme(&self, theme: &str) {
        if let Ok(mut runtime) = self.runtime.lock() {
            runtime.theme = theme.to_string();
        }
        let _ = self.theme_auto.set_checked(theme == "auto");
        let _ = self.theme_light.set_checked(theme == "light");
        let _ = self.theme_dark.set_checked(theme == "dark");
    }
}

#[tauri::command(rename_all = "camelCase")]
pub fn shell_menu_update_state(
    patch: AppMenuStatePatch,
    menu: State<'_, ApplicationMenu>,
) -> Result<(), String> {
    menu.apply_patch(patch)
}

fn emit_menu_command(app: &AppHandle, command: AppMenuCommand) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };

    let _ = main_window.show();
    let _ = main_window.set_focus();
    let _ = main_window.emit("app-menu:command", command);
}

fn menu_check(
    app: &AppHandle,
    id: &str,
    label: &str,
    checked: bool,
) -> Result<CheckMenuItem<Wry>, String> {
    CheckMenuItem::with_id(app, id, label, true, checked, None::<&str>).map_err(menu_error)
}

fn menu_command_item(app: &AppHandle, id: &str, label: &str) -> Result<MenuItem<Wry>, String> {
    MenuItem::with_id(app, id, label, true, None::<&str>).map_err(menu_error)
}

fn menu_error(error: tauri::Error) -> String {
    format!("Failed to build the application menu: {error}")
}

fn form_urlencoded(values: &[(&str, &str)]) -> String {
    values
        .iter()
        .map(|(key, value)| {
            format!(
                "{key}={}",
                value
                    .chars()
                    .map(|character| match character {
                        ' ' => "+".to_string(),
                        c if c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.' => {
                            c.to_string()
                        }
                        c => format!("%{:02X}", c as u8),
                    })
                    .collect::<String>()
            )
        })
        .collect::<Vec<_>>()
        .join("&")
}
