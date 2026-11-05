//! Setup snippets and install links for each AI client, built from the
//! running app's real path (the app may not live in /Applications).

use super::settings::AssistantSettings;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use serde_json::json;

pub const SERVER_NAME: &str = "yomi-reader";
pub const BRIDGE_ARG: &str = "--mcp";

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ClientSetup {
    pub client: String,
    /// Text to copy (command, JSON, TOML).
    pub text: String,
    /// Where the snippet goes, in plain words.
    pub hint: String,
    /// True when an "Add to …" button can open an install link.
    pub has_install_link: bool,
}

pub fn launcher_path() -> Result<String, String> {
    let path = std::env::current_exe().map_err(|_| "Yomi Reader couldn't find its own location.".to_string())?;
    // Resolve symlinks so configs keep working from the real bundle path.
    let path = std::fs::canonicalize(&path).unwrap_or(path);
    Ok(path.to_string_lossy().to_string())
}

fn server_json(launcher: &str) -> serde_json::Value {
    json!({ "command": launcher, "args": [BRIDGE_ARG] })
}

fn shell_quote(value: &str) -> String {
    if cfg!(windows) {
        format!("\"{value}\"")
    } else {
        format!("'{}'", value.replace('\'', r"'\''"))
    }
}

pub fn build(client: &str, settings: &AssistantSettings) -> Result<ClientSetup, String> {
    build_for(client, settings, &launcher_path()?)
}

pub(crate) fn build_for(client: &str, settings: &AssistantSettings, launcher: &str) -> Result<ClientSetup, String> {
    let pretty = |value: serde_json::Value| serde_json::to_string_pretty(&value).unwrap_or_default();
    let (text, hint, has_install_link) = match client {
        "claude-code" => (
            format!("claude mcp add --scope user {SERVER_NAME} -- {} {BRIDGE_ARG}", shell_quote(launcher)),
            "Run this once in Terminal.".to_string(),
            false,
        ),
        "claude-desktop" => (
            pretty(json!({ "mcpServers": { SERVER_NAME: server_json(launcher) } })),
            "Or add this to Claude Desktop's settings file (Settings → Developer → Edit Config), then restart Claude.".to_string(),
            false,
        ),
        "cursor" => (
            pretty(json!({ "mcpServers": { SERVER_NAME: server_json(launcher) } })),
            "Or add this to ~/.cursor/mcp.json.".to_string(),
            true,
        ),
        "vscode" => (
            pretty(json!({ "servers": { SERVER_NAME: { "type": "stdio", "command": launcher, "args": [BRIDGE_ARG] } } })),
            "Or add this to your VS Code mcp.json (Command Palette → MCP: Open User Configuration).".to_string(),
            true,
        ),
        "codex" => (
            format!(
                "[mcp_servers.{SERVER_NAME}]\ncommand = {}\nargs = [\"{BRIDGE_ARG}\"]",
                toml_string(launcher)
            ),
            "Add this to ~/.codex/config.toml.".to_string(),
            false,
        ),
        "url" => {
            if !settings.http_enabled {
                return Err("Turn on “Allow connections by web address” first.".to_string());
            }
            (
                pretty(json!({
                    "url": format!("http://127.0.0.1:{}/mcp", settings.http_port),
                    "headers": { "Authorization": format!("Bearer {}", settings.access_key) }
                })),
                "For apps that connect by web address. This key lets anyone on this Mac read what you share — keep it private; Reset access to revoke it.".to_string(),
                false,
            )
        }
        "command" => (
            format!("{} {BRIDGE_ARG}", shell_quote(launcher)),
            "Command for any other assistant app that runs a local tool.".to_string(),
            false,
        ),
        other => return Err(format!("Unknown assistant app `{other}`.")),
    };
    Ok(ClientSetup { client: client.to_string(), text, hint, has_install_link })
}

fn toml_string(value: &str) -> String {
    format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
}

pub fn install_link(client: &str) -> Result<String, String> {
    install_link_for(client, &launcher_path()?)
}

pub(crate) fn install_link_for(client: &str, launcher: &str) -> Result<String, String> {
    match client {
        "cursor" => {
            let config = STANDARD.encode(server_json(launcher).to_string());
            Ok(format!(
                "cursor://anysphere.cursor-deeplink/mcp/install?name={SERVER_NAME}&config={}",
                url::form_urlencoded::byte_serialize(config.as_bytes()).collect::<String>()
            ))
        }
        "vscode" => {
            let config = json!({ "name": SERVER_NAME, "type": "stdio", "command": launcher, "args": [BRIDGE_ARG] });
            Ok(format!(
                "vscode:mcp/install?{}",
                super::protocol::encode_segment(&config.to_string())
            ))
        }
        other => Err(format!("No install link for `{other}`.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LAUNCHER: &str = "/Applications/Yomi Reader.app/Contents/MacOS/kiji-app";

    #[test]
    fn stdio_snippets_point_at_the_bridge() {
        let settings = AssistantSettings::default();
        let code = build_for("claude-code", &settings, LAUNCHER).unwrap();
        assert_eq!(code.text, format!("claude mcp add --scope user yomi-reader -- '{LAUNCHER}' --mcp"));

        let desktop = build_for("claude-desktop", &settings, LAUNCHER).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&desktop.text).unwrap();
        assert_eq!(parsed["mcpServers"]["yomi-reader"]["command"], LAUNCHER);
        assert_eq!(parsed["mcpServers"]["yomi-reader"]["args"][0], "--mcp");

        let codex = build_for("codex", &settings, LAUNCHER).unwrap();
        assert!(codex.text.contains("[mcp_servers.yomi-reader]"));
        assert!(build_for("nope", &settings, LAUNCHER).is_err());
    }

    #[test]
    fn url_setup_needs_http_and_carries_the_key() {
        let mut settings = AssistantSettings::default();
        settings.ensure_access_key();
        assert!(build_for("url", &settings, LAUNCHER).is_err());
        settings.http_enabled = true;
        let setup = build_for("url", &settings, LAUNCHER).unwrap();
        assert!(setup.text.contains("http://127.0.0.1:47615/mcp"));
        assert!(setup.text.contains(&settings.access_key));
    }

    #[test]
    fn install_links_encode_the_config() {
        let cursor = install_link_for("cursor", LAUNCHER).unwrap();
        assert!(cursor.starts_with("cursor://anysphere.cursor-deeplink/mcp/install?name=yomi-reader&config="));
        let encoded = cursor.split("config=").nth(1).unwrap();
        let decoded: String = url::form_urlencoded::parse(format!("c={encoded}").as_bytes())
            .next()
            .map(|(_, value)| value.into_owned())
            .unwrap();
        let config: serde_json::Value = serde_json::from_slice(&STANDARD.decode(decoded).unwrap()).unwrap();
        assert_eq!(config["command"], LAUNCHER);

        let vscode = install_link_for("vscode", LAUNCHER).unwrap();
        assert!(vscode.starts_with("vscode:mcp/install?%7B"));
        assert!(install_link_for("claude-code", LAUNCHER).is_err());
    }
}
