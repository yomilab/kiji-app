//! Builds a Claude Desktop extension (`.mcpb`): a zip with `manifest.json`,
//! a small launcher script that runs `kiji-app --mcp`, and the icon. The
//! release script (`scripts/build-mcpb.mjs`) packs the same templates.

use std::io::Write;
use std::path::Path;
use zip::write::SimpleFileOptions;

const MANIFEST_TEMPLATE: &str = include_str!("../../mcp/manifest.json");
const LAUNCHER_TEMPLATE: &str = include_str!("../../mcp/yomi-reader-mcp.sh");
const ICON_PNG: &[u8] = include_bytes!("../../icons/icon.png");

pub fn render_manifest(version: &str) -> String {
    MANIFEST_TEMPLATE.replace("__VERSION__", version)
}

pub fn render_launcher(launcher: &str) -> String {
    // The baked path is tried first (single-quoted, so `$`, backticks and
    // backslashes stay literal); the script falls back to the usual install
    // locations if the app moves.
    LAUNCHER_TEMPLATE.replace("__KIJI_LAUNCHER__", &launcher.replace('\'', r"'\''"))
}

pub fn build_extension_bytes(version: &str, launcher: &str) -> Result<Vec<u8>, String> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut zip = zip::ZipWriter::new(&mut cursor);
        let file = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        let write = |zip: &mut zip::ZipWriter<&mut std::io::Cursor<Vec<u8>>>, name: &str, options: SimpleFileOptions, bytes: &[u8]| {
            zip.start_file(name, options).map_err(|error| format!("Failed to build the extension: {error}"))?;
            zip.write_all(bytes).map_err(|error| format!("Failed to build the extension: {error}"))
        };
        write(&mut zip, "manifest.json", file.unix_permissions(0o644), render_manifest(version).as_bytes())?;
        write(&mut zip, "server/yomi-reader-mcp", file.unix_permissions(0o755), render_launcher(launcher).as_bytes())?;
        write(&mut zip, "icon.png", file.unix_permissions(0o644), ICON_PNG)?;
        zip.finish().map_err(|error| format!("Failed to build the extension: {error}"))?;
    }
    Ok(cursor.into_inner())
}

pub fn write_extension(path: &Path) -> Result<(), String> {
    let launcher = super::client_setup::launcher_path()?;
    let bytes = build_extension_bytes(env!("CARGO_PKG_VERSION"), &launcher)?;
    std::fs::write(path, bytes).map_err(|_| "Yomi Reader couldn't save the extension there. Try another folder.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    #[test]
    fn launcher_keeps_odd_paths_literal() {
        let script = render_launcher("/Users/o'neil/$HOME/`x`/Yomi Reader.app/Contents/MacOS/kiji-app");
        assert!(script.contains(r"'/Users/o'\''neil/$HOME/`x`/Yomi Reader.app/Contents/MacOS/kiji-app'"));
    }

    #[test]
    fn extension_contains_manifest_launcher_and_icon() {
        let bytes = build_extension_bytes("9.9.9", "/Apps/Yomi Reader.app/Contents/MacOS/kiji-app").unwrap();
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes)).unwrap();

        let mut manifest = String::new();
        archive.by_name("manifest.json").unwrap().read_to_string(&mut manifest).unwrap();
        let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
        assert_eq!(manifest["version"], "9.9.9");
        assert_eq!(manifest["server"]["entry_point"], "server/yomi-reader-mcp");
        let tool_names: Vec<&str> = manifest["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
        for tool in crate::mcp::protocol::tool_definitions().into_iter().chain(crate::mcp::write::tool_definitions()) {
            assert!(tool_names.contains(&tool["name"].as_str().unwrap()), "manifest lists {}", tool["name"]);
        }

        let mut launcher = String::new();
        let mut entry = archive.by_name("server/yomi-reader-mcp").unwrap();
        assert_eq!(entry.unix_mode().map(|mode| mode & 0o777), Some(0o755));
        entry.read_to_string(&mut launcher).unwrap();
        assert!(launcher.starts_with("#!/bin/sh"));
        assert!(launcher.contains("'/Apps/Yomi Reader.app/Contents/MacOS/kiji-app'"));
        assert!(launcher.contains("--mcp"));
        drop(entry);

        assert!(archive.by_name("icon.png").unwrap().size() > 1000);
    }
}
