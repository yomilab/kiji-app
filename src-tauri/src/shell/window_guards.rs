use std::{
    fs::{create_dir_all, OpenOptions},
    io::Write,
    path::PathBuf,
    sync::Mutex,
};

use chrono::Local;
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Manager, Runtime, Url, Webview,
};
use tauri_plugin_opener::OpenerExt;

const GUARD_LOG_PREFIX: &str = "kiji-guard";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("window-guards")
        .on_navigation(|webview, url| handle_navigation(webview, url))
        .build()
}

fn handle_navigation<R: Runtime>(webview: &Webview<R>, url: &Url) -> bool {
    if is_internal_app_url(url) {
        return true;
    }

    if is_youtube_embed_url(url) {
        write_guard_log(
            webview.app_handle(),
            &format!("WindowGuard:{}", webview.label()),
            "youtube-embed-allowed",
            Some(&url.to_string()),
        );
        return true;
    }

    let app = webview.app_handle();
    let scope = format!("WindowGuard:{}", webview.label());
    let url_string = url.to_string();

    match app.opener().open_url(&url_string, None::<&str>) {
        Ok(()) => write_guard_log(
            &app,
            &scope,
            "external-navigation-blocked",
            Some(&url_string),
        ),
        Err(error) => write_guard_log(
            &app,
            &scope,
            "external-navigation-open-failed",
            Some(&format!("{url_string} ({error})")),
        ),
    }

    false
}

fn is_internal_app_url(url: &Url) -> bool {
    if url.as_str().is_empty() || url.as_str() == "about:blank" {
        return true;
    }

    if url.scheme() == "tauri" {
        return true;
    }

    if url.scheme() == "file" {
        return true;
    }

    if url.scheme() == "http" || url.scheme() == "https" {
        if cfg!(debug_assertions) {
            return matches!(url.host_str(), Some("localhost") | Some("127.0.0.1"));
        }

        if url.host_str() == Some("tauri.localhost") {
            return true;
        }
    }

    false
}

fn is_youtube_embed_url(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };

    let host = host.to_lowercase();
    let is_youtube_host = matches!(
        host.as_str(),
        "www.youtube.com"
            | "youtube.com"
            | "www.youtube-nocookie.com"
            | "youtube-nocookie.com"
            | "m.youtube.com"
    );

    if !is_youtube_host {
        return false;
    }

    url.path()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .next()
        == Some("embed")
}

fn write_guard_log<R: Runtime>(app: &AppHandle<R>, scope: &str, message: &str, data: Option<&str>) {
    let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let line = match data {
        Some(value) => format!("[{timestamp}] [{scope}] {message} {value}\n"),
        None => format!("[{timestamp}] [{scope}] {message}\n"),
    };

    eprintln!("{}", line.trim());

    if let Ok(log_path) = guard_log_path(app) {
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(log_path) {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

fn guard_log_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    static LOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

    let mut cached = LOG_DIR
        .lock()
        .map_err(|_| "Guard log cache lock poisoned.".to_string())?;
    if let Some(path) = cached.clone() {
        return Ok(path);
    }

    let logs_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Failed to resolve app config dir: {error}"))?
        .join("logs");
    create_dir_all(&logs_dir)
        .map_err(|error| format!("Failed to create guard logs directory: {error}"))?;

    let log_date = Local::now().format("%Y-%m-%d").to_string();
    let path = logs_dir.join(format!("{GUARD_LOG_PREFIX}-{log_date}.log"));
    *cached = Some(path.clone());
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn internal_url_policy_allows_app_and_dev_origins() {
        assert!(is_internal_app_url(&Url::parse("about:blank").unwrap()));
        assert!(is_internal_app_url(
            &Url::parse("tauri://localhost").unwrap()
        ));
        assert!(is_internal_app_url(
            &Url::parse("http://localhost:1420/index.html").unwrap()
        ));
    }

    #[test]
    fn internal_url_policy_allows_inline_embed_shell_in_dev() {
        assert!(is_internal_app_url(
            &Url::parse("http://localhost:1420/youtube-embed.html?v=abc123").unwrap()
        ));
    }

    #[test]
    fn internal_url_policy_blocks_external_http() {
        assert!(!is_internal_app_url(
            &Url::parse("https://example.com/article").unwrap()
        ));
    }

    #[test]
    fn youtube_embed_urls_are_allowed_without_external_open() {
        assert!(is_youtube_embed_url(
            &Url::parse("https://www.youtube-nocookie.com/embed/_6wmFnY9NZ4?autoplay=1").unwrap()
        ));
        assert!(is_youtube_embed_url(
            &Url::parse("https://www.youtube.com/embed/_6wmFnY9NZ4?enablejsapi=1").unwrap()
        ));
    }

    #[test]
    fn youtube_watch_urls_remain_external() {
        assert!(!is_youtube_embed_url(
            &Url::parse("https://www.youtube.com/watch?v=_6wmFnY9NZ4").unwrap()
        ));
    }
}
