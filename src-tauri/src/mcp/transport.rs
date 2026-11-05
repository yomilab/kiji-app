//! Local stream transport: newline-delimited JSON-RPC, one MCP session per
//! connection; `kiji-app --mcp` bridges a client's stdio to it.
//!
//! - macOS/Linux: Unix socket (mode 0600, peer uid checked).
//! - Windows: loopback TCP on a random port. The port and a fresh per-launch
//!   key are written to `mcp-endpoint.json` in the user's own app-data
//!   folder; a client must send `{"kijiBridgeKey": "<key>"}` as its first
//!   line. Named pipes were avoided: their names are machine-global and
//!   their default ACL lets other users read.

use super::{endpoint, protocol, settings, AssistantState, ListenerState, TransportKind};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::{mpsc, watch};

/// Largest single JSON-RPC message accepted on a stream.
pub const MAX_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
/// Responses and notifications queued per connection before backpressure.
const OUTGOING_QUEUE: usize = 64;
const AUTH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
const CONNECTION_FAILED: &str = "Yomi Reader couldn't start assistant access. Try turning it off and on again.";
const ALREADY_SHARING: &str = "Another copy of Yomi Reader is already sharing with assistants.";

pub(super) fn spawn_local_listener(
    state: Arc<AssistantState>,
    shutdown: watch::Receiver<bool>,
    generation: u64,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        if let Err(message) = run_local_listener(Arc::clone(&state), shutdown, generation).await {
            eprintln!("[Yomi Reader] Assistant connection point failed: {message}");
            state.set_local_status(generation, ListenerState::Error(CONNECTION_FAILED.to_string()));
        }
    })
}

#[cfg(unix)]
async fn run_local_listener(
    state: Arc<AssistantState>,
    mut shutdown: watch::Receiver<bool>,
    generation: u64,
) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    use tokio::net::{UnixListener, UnixStream};

    let path = endpoint::local_endpoint().ok_or("No home folder for the assistant socket.")?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create socket folder: {error}"))?;
    }
    if path.exists() {
        if UnixStream::connect(&path).await.is_ok() {
            state.set_local_status(generation, ListenerState::Error(ALREADY_SHARING.to_string()));
            return Ok(());
        }
        let _ = std::fs::remove_file(&path);
    }
    let listener = UnixListener::bind(&path).map_err(|error| format!("bind socket: {error}"))?;
    settings::restrict_to_owner(&path);
    let bound_inode = std::fs::metadata(&path).map(|metadata| metadata.ino()).ok();
    state.set_local_status(generation, ListenerState::Ready);

    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => {
                    if !peer_is_same_user(&stream) {
                        continue;
                    }
                    tauri::async_runtime::spawn(serve_stream(Arc::clone(&state), stream));
                }
                Err(error) => {
                    eprintln!("[Yomi Reader] Assistant connection failed: {error}");
                    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                }
            }
        }
    }
    drop(listener);
    // Remove only the socket this task created, never a newer one.
    let current_inode = std::fs::metadata(&path).map(|metadata| metadata.ino()).ok();
    if bound_inode.is_some() && current_inode == bound_inode {
        let _ = std::fs::remove_file(&path);
    }
    Ok(())
}

#[cfg(unix)]
fn peer_is_same_user(stream: &tokio::net::UnixStream) -> bool {
    // The socket is 0600 already; the peer check guards against a socket
    // file whose permissions were changed behind our back.
    // SAFETY: getuid has no preconditions and cannot fail.
    let own_uid = unsafe { libc::getuid() };
    stream.peer_cred().map(|cred| cred.uid() == own_uid).unwrap_or(false)
}

#[cfg(not(unix))]
async fn run_local_listener(
    state: Arc<AssistantState>,
    shutdown: watch::Receiver<bool>,
    generation: u64,
) -> Result<(), String> {
    let file = endpoint::local_endpoint().ok_or("No app data folder for assistant access.")?;
    run_tcp_listener(state, shutdown, generation, file).await
}

/// Contents of `mcp-endpoint.json` (Windows transport).
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TcpEndpoint {
    pub port: u16,
    pub key: String,
}

#[cfg_attr(unix, allow(dead_code))]
pub(crate) fn write_endpoint_file(path: &Path, endpoint: &TcpEndpoint) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| format!("create endpoint folder: {error}"))?;
    }
    let raw = serde_json::to_string(endpoint).map_err(|error| error.to_string())?;
    settings::write_private_file(path, raw.as_bytes())
}

#[cfg_attr(unix, allow(dead_code))]
pub(crate) fn read_endpoint_file(path: &Path) -> Option<TcpEndpoint> {
    serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok()
}

#[cfg_attr(unix, allow(dead_code))]
pub(crate) async fn run_tcp_listener(
    state: Arc<AssistantState>,
    mut shutdown: watch::Receiver<bool>,
    generation: u64,
    endpoint_file: PathBuf,
) -> Result<(), String> {
    use tokio::net::{TcpListener, TcpStream};

    if let Some(existing) = read_endpoint_file(&endpoint_file) {
        if TcpStream::connect(("127.0.0.1", existing.port)).await.is_ok()
            && probe_kiji(existing.port, &existing.key).await
        {
            state.set_local_status(generation, ListenerState::Error(ALREADY_SHARING.to_string()));
            return Ok(());
        }
    }
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.map_err(|error| format!("bind: {error}"))?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let key = settings::generate_access_key();
    write_endpoint_file(&endpoint_file, &TcpEndpoint { port, key: key.clone() })?;
    state.set_local_status(generation, ListenerState::Ready);

    loop {
        tokio::select! {
            _ = shutdown.changed() => break,
            accepted = listener.accept() => {
                let Ok((stream, peer)) = accepted else { continue };
                if !peer.ip().is_loopback() {
                    continue;
                }
                let state = Arc::clone(&state);
                let key = key.clone();
                tauri::async_runtime::spawn(async move {
                    let mut reader = BufReader::new(stream);
                    if authenticate(&mut reader, &key).await {
                        serve_stream(state, reader).await;
                    }
                });
            }
        }
    }
    drop(listener);
    // Remove only our own endpoint file.
    if read_endpoint_file(&endpoint_file).map(|current| current.key == key).unwrap_or(false) {
        let _ = std::fs::remove_file(&endpoint_file);
    }
    Ok(())
}

/// First line must carry the per-launch key.
async fn authenticate<R: AsyncBufRead + Unpin>(reader: &mut R, key: &str) -> bool {
    let mut buffer = Vec::new();
    let read = tokio::time::timeout(AUTH_TIMEOUT, read_message(reader, &mut buffer)).await;
    let Ok(Ok(count)) = read else { return false };
    if count == 0 {
        return false;
    }
    serde_json::from_slice::<Value>(&buffer)
        .ok()
        .and_then(|value| value.get("kijiBridgeKey").and_then(Value::as_str).map(str::to_string))
        .map(|candidate| super::constant_time_eq(key.as_bytes(), candidate.as_bytes()))
        .unwrap_or(false)
}

/// Whether a live Yomi Reader answers on this port with this key.
async fn probe_kiji(port: u16, key: &str) -> bool {
    let Ok(Ok(mut stream)) = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        tokio::net::TcpStream::connect(("127.0.0.1", port)),
    )
    .await
    else {
        return false;
    };
    let hello = format!(
        "{}\n{}\n",
        serde_json::json!({ "kijiBridgeKey": key }),
        serde_json::json!({ "jsonrpc": "2.0", "id": "probe", "method": "ping" })
    );
    if stream.write_all(hello.as_bytes()).await.is_err() {
        return false;
    }
    let mut reader = BufReader::new(stream);
    let mut buffer = Vec::new();
    matches!(
        tokio::time::timeout(std::time::Duration::from_millis(500), read_message(&mut reader, &mut buffer)).await,
        Ok(Ok(count)) if count > 0
    )
}

/// Reads one `\n`-terminated message, rejecting oversized ones.
pub async fn read_message<R: AsyncBufRead + Unpin>(reader: &mut R, buffer: &mut Vec<u8>) -> std::io::Result<usize> {
    buffer.clear();
    let read = (&mut *reader).take(MAX_MESSAGE_BYTES as u64 + 1).read_until(b'\n', buffer).await?;
    if buffer.len() > MAX_MESSAGE_BYTES && !buffer.ends_with(b"\n") {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "message too large"));
    }
    Ok(read)
}

pub(super) async fn serve_stream<S>(state: Arc<AssistantState>, stream: S)
where
    S: AsyncRead + AsyncWrite + Send + 'static,
{
    let (read_half, mut write_half) = tokio::io::split(stream);
    let (sender, mut receiver) = mpsc::channel::<String>(OUTGOING_QUEUE);
    let (session_id, session, close) = state.register_session(TransportKind::Local, Some(sender.clone()));

    let writer = tauri::async_runtime::spawn(async move {
        while let Some(mut line) = receiver.recv().await {
            line.push('\n');
            if write_half.write_all(line.as_bytes()).await.is_err() || write_half.flush().await.is_err() {
                break;
            }
        }
    });

    let mut reader = BufReader::new(read_half);
    let mut buffer = Vec::new();
    loop {
        let read = tokio::select! {
            _ = close.notified() => break,
            read = read_message(&mut reader, &mut buffer) => read,
        };
        match read {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&buffer);
        let text = text.trim();
        if text.is_empty() {
            continue;
        }
        let response = match serde_json::from_str::<Value>(text) {
            Ok(message) => state.handle(&session, message).await,
            Err(_) => Some(protocol::parse_error_response()),
        };
        if let Some(response) = response {
            // Awaiting gives backpressure: a client that stops reading stops
            // being served instead of growing memory.
            if sender.send(response.to_string()).await.is_err() {
                break;
            }
        }
    }

    state.unregister_session(session_id);
    drop(sender);
    let _ = writer.await;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn read_message_splits_lines_and_rejects_huge_messages() {
        let input = b"{\"a\":1}\n{\"b\":2}\n".to_vec();
        let mut reader = BufReader::new(&input[..]);
        let mut buffer = Vec::new();
        assert!(read_message(&mut reader, &mut buffer).await.unwrap() > 0);
        assert_eq!(buffer, b"{\"a\":1}\n");
        read_message(&mut reader, &mut buffer).await.unwrap();
        assert_eq!(buffer, b"{\"b\":2}\n");
        assert_eq!(read_message(&mut reader, &mut buffer).await.unwrap(), 0);

        let huge = vec![b'x'; MAX_MESSAGE_BYTES + 10];
        let mut reader = BufReader::new(&huge[..]);
        assert!(read_message(&mut reader, &mut buffer).await.is_err());
    }

    #[tokio::test]
    async fn authentication_requires_the_exact_key() {
        let good = b"{\"kijiBridgeKey\":\"kiji_secret\"}\n".to_vec();
        assert!(authenticate(&mut BufReader::new(&good[..]), "kiji_secret").await);
        let bad = b"{\"kijiBridgeKey\":\"kiji_wrong!\"}\n".to_vec();
        assert!(!authenticate(&mut BufReader::new(&bad[..]), "kiji_secret").await);
        let missing = b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n".to_vec();
        assert!(!authenticate(&mut BufReader::new(&missing[..]), "kiji_secret").await);
        assert!(!authenticate(&mut BufReader::new(&b""[..]), "kiji_secret").await);
    }

    #[test]
    fn endpoint_file_round_trips_privately() {
        let dir = std::env::temp_dir().join(format!("kiji-endpoint-{}", uuid::Uuid::new_v4()));
        let path = dir.join("mcp-endpoint.json");
        let endpoint = TcpEndpoint { port: 50123, key: "kiji_abc".into() };
        write_endpoint_file(&path, &endpoint).unwrap();
        assert_eq!(read_endpoint_file(&path), Some(endpoint));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
