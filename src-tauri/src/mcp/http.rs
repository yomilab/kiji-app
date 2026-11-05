//! Loopback Streamable HTTP endpoint (`POST /mcp`) for clients that only
//! take a URL. Binds 127.0.0.1 only, requires the bearer access key, rejects
//! browser origins and foreign Host headers (DNS rebinding), and answers with
//! plain JSON (no server-initiated stream).

use super::{protocol, AssistantState, ListenerState, TransportKind};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::watch;

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = super::transport::MAX_MESSAGE_BYTES;
const READ_TIMEOUT: Duration = Duration::from_secs(15);
const SESSION_IDLE_LIMIT: Duration = Duration::from_secs(60 * 60);
const MAX_CONNECTIONS: usize = 32;
/// Whole request/response budget (reading, the query, writing).
const HANDLER_TIMEOUT: Duration = Duration::from_secs(30);

pub(super) fn spawn_http_listener(
    state: Arc<AssistantState>,
    port: u16,
    shutdown: watch::Receiver<bool>,
    generation: u64,
) -> tauri::async_runtime::JoinHandle<()> {
    tauri::async_runtime::spawn(async move {
        let listener = match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(listener) => listener,
            Err(error) => {
                eprintln!("[Yomi Reader] Assistant web address failed to start on port {port}: {error}");
                state.set_http_status(generation, ListenerState::Error(format!(
                    "Port {port} is in use by another app. Choose a different port."
                )));
                return;
            }
        };
        state.set_http_status(generation, ListenerState::Ready);
        let sessions = Arc::new(HttpSessions::default());
        let slots = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));
        let mut shutdown = shutdown;
        loop {
            tokio::select! {
                _ = shutdown.changed() => break,
                accepted = listener.accept() => {
                    let Ok((stream, peer)) = accepted else { continue };
                    if !peer.ip().is_loopback() {
                        continue;
                    }
                    // Over the cap: refuse instead of queueing.
                    let Ok(permit) = Arc::clone(&slots).try_acquire_owned() else { continue };
                    let state = Arc::clone(&state);
                    let sessions = Arc::clone(&sessions);
                    tauri::async_runtime::spawn(async move {
                        let _ = tokio::time::timeout(
                            HANDLER_TIMEOUT,
                            handle_connection(state, sessions, stream, port),
                        )
                        .await;
                        drop(permit);
                    });
                }
            }
        }
        sessions.drop_all(&state);
    })
}

/// HTTP session id (`Mcp-Session-Id`) → registered assistant session id.
#[derive(Default)]
struct HttpSessions {
    map: Mutex<BTreeMap<String, (u64, Instant)>>,
}

impl HttpSessions {
    fn create(&self, state: &AssistantState) -> (String, u64) {
        let (id, _, _) = state.register_session(TransportKind::Url, None);
        let key = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut map) = self.map.lock() {
            map.insert(key.clone(), (id, Instant::now()));
            self.expire(&mut map, state);
        }
        (key, id)
    }

    fn touch(&self, key: &str, state: &AssistantState) -> Option<u64> {
        let mut map = self.map.lock().ok()?;
        self.expire(&mut map, state);
        let entry = map.get_mut(key)?;
        entry.1 = Instant::now();
        Some(entry.0)
    }

    fn remove(&self, key: &str, state: &AssistantState) {
        if let Ok(mut map) = self.map.lock() {
            if let Some((id, _)) = map.remove(key) {
                state.unregister_session(id);
            }
        }
    }

    fn expire(&self, map: &mut BTreeMap<String, (u64, Instant)>, state: &AssistantState) {
        map.retain(|_, (id, last)| {
            let keep = last.elapsed() < SESSION_IDLE_LIMIT;
            if !keep {
                state.unregister_session(*id);
            }
            keep
        });
    }

    fn drop_all(&self, state: &AssistantState) {
        if let Ok(mut map) = self.map.lock() {
            for (id, _) in map.values() {
                state.unregister_session(*id);
            }
            map.clear();
        }
    }
}

#[derive(Debug, PartialEq)]
pub(crate) struct Request {
    pub method: String,
    pub path: String,
    pub headers: BTreeMap<String, String>,
    pub body: Vec<u8>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(String::as_str)
    }
}

pub(crate) struct Response {
    status: u16,
    reason: &'static str,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Response {
    fn empty(status: u16, reason: &'static str) -> Self {
        Self { status, reason, headers: Vec::new(), body: Vec::new() }
    }

    fn json(status: u16, value: &Value) -> Self {
        Self {
            status,
            reason: if status == 200 { "OK" } else { "Error" },
            headers: vec![("Content-Type".into(), "application/json".into())],
            body: value.to_string().into_bytes(),
        }
    }

    fn text(status: u16, reason: &'static str, text: &str) -> Self {
        Self {
            status,
            reason,
            headers: vec![("Content-Type".into(), "text/plain; charset=utf-8".into())],
            body: text.as_bytes().to_vec(),
        }
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut head = format!("HTTP/1.1 {} {}\r\n", self.status, self.reason);
        for (name, value) in &self.headers {
            head.push_str(&format!("{name}: {value}\r\n"));
        }
        head.push_str(&format!("Content-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n", self.body.len()));
        let mut bytes = head.into_bytes();
        bytes.extend_from_slice(&self.body);
        bytes
    }
}

async fn handle_connection(
    state: Arc<AssistantState>,
    sessions: Arc<HttpSessions>,
    mut stream: TcpStream,
    port: u16,
) -> std::io::Result<()> {
    let request = match tokio::time::timeout(READ_TIMEOUT, read_request(&mut stream, &state, port)).await {
        Ok(Ok(Some(request))) => request,
        Ok(Ok(None)) => return Ok(()),
        Ok(Err(response)) => {
            stream.write_all(&response.to_bytes()).await?;
            return Ok(());
        }
        Err(_) => return Ok(()),
    };
    let response = route(&state, &sessions, request).await;
    stream.write_all(&response.to_bytes()).await?;
    stream.shutdown().await
}

async fn read_request(stream: &mut TcpStream, state: &AssistantState, port: u16) -> Result<Option<Request>, Response> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 8192];
    let header_end = loop {
        let read = stream.read(&mut chunk).await.map_err(|_| Response::empty(400, "Bad Request"))?;
        if read == 0 {
            return Ok(None);
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(position) = find_header_end(&buffer) {
            break position;
        }
        if buffer.len() > MAX_HEADER_BYTES {
            return Err(Response::empty(431, "Request Header Fields Too Large"));
        }
    };
    let mut request = parse_head(&buffer[..header_end]).ok_or_else(|| Response::empty(400, "Bad Request"))?;
    // Path, Host, Origin and key are checked before any body is read.
    if let Some(response) = reject_before_body(&request, state, port) {
        return Err(response);
    }
    if request.header("transfer-encoding").is_some() {
        return Err(Response::empty(411, "Length Required"));
    }
    let length: usize = match request.header("content-length") {
        Some(raw) => raw.trim().parse().map_err(|_| Response::empty(400, "Bad Request"))?,
        None => 0,
    };
    if length > MAX_BODY_BYTES {
        return Err(Response::empty(413, "Payload Too Large"));
    }
    let mut body = buffer[header_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut chunk).await.map_err(|_| Response::empty(400, "Bad Request"))?;
        if read == 0 {
            return Err(Response::empty(400, "Bad Request"));
        }
        body.extend_from_slice(&chunk[..read]);
    }
    body.truncate(length);
    request.body = body;
    Ok(Some(request))
}

fn find_header_end(buffer: &[u8]) -> Option<usize> {
    buffer.windows(4).position(|window| window == b"\r\n\r\n")
}

pub(crate) fn parse_head(head: &[u8]) -> Option<Request> {
    let text = std::str::from_utf8(head).ok()?;
    let mut lines = text.split("\r\n");
    let mut request_line = lines.next()?.split_whitespace();
    let method = request_line.next()?.to_string();
    let target = request_line.next()?;
    let version = request_line.next()?;
    if !version.starts_with("HTTP/1.") {
        return None;
    }
    let path = target.split('?').next().unwrap_or(target).to_string();
    let mut headers = BTreeMap::new();
    for line in lines {
        let (name, value) = line.split_once(':')?;
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    Some(Request { method, path, headers, body: Vec::new() })
}

/// Host must name this loopback endpoint (blocks DNS-rebinding pages).
pub(crate) fn host_allowed(host: Option<&str>, port: u16) -> bool {
    let Some(host) = host else { return false };
    let host = host.trim().to_ascii_lowercase();
    [format!("127.0.0.1:{port}"), format!("localhost:{port}"), format!("[::1]:{port}")].contains(&host)
}

/// Browsers always send Origin on cross-site POSTs; agents usually send none.
pub(crate) fn origin_allowed(origin: Option<&str>, port: u16) -> bool {
    match origin.map(|value| value.trim().to_ascii_lowercase()) {
        None => true,
        Some(origin) => origin == format!("http://127.0.0.1:{port}") || origin == format!("http://localhost:{port}"),
    }
}

fn reject_before_body(request: &Request, state: &AssistantState, port: u16) -> Option<Response> {
    if request.path != "/mcp" {
        return Some(Response::empty(404, "Not Found"));
    }
    if !host_allowed(request.header("host"), port) || !origin_allowed(request.header("origin"), port) {
        return Some(Response::text(403, "Forbidden", "Forbidden"));
    }
    let key = request
        .header("authorization")
        .and_then(|value| value.strip_prefix("Bearer ").or_else(|| value.strip_prefix("bearer ")))
        .map(str::trim);
    if !key.map(|key| state.access_key_matches(key)).unwrap_or(false) {
        let mut response = Response::text(401, "Unauthorized", "Unauthorized");
        response.headers.push(("WWW-Authenticate".into(), "Bearer".into()));
        return Some(response);
    }
    None
}

async fn route(state: &Arc<AssistantState>, sessions: &HttpSessions, request: Request) -> Response {
    match request.method.as_str() {
        "POST" => handle_post(state, sessions, &request).await,
        "DELETE" => {
            if let Some(session_key) = request.header("mcp-session-id") {
                sessions.remove(session_key, state);
            }
            Response::empty(200, "OK")
        }
        _ => {
            let mut response = Response::empty(405, "Method Not Allowed");
            response.headers.push(("Allow".into(), "POST, DELETE".into()));
            response
        }
    }
}

async fn handle_post(state: &Arc<AssistantState>, sessions: &HttpSessions, request: &Request) -> Response {
    let message: Value = match serde_json::from_slice(&request.body) {
        Ok(message) => message,
        Err(_) => return Response::json(400, &protocol::parse_error_response()),
    };
    let is_initialize = message.get("method").and_then(Value::as_str) == Some("initialize");
    let session_key = request.header("mcp-session-id").map(str::to_string);

    let (session_key, session_id) = match (&session_key, is_initialize) {
        (_, true) => {
            let (key, id) = sessions.create(state);
            (Some(key), id)
        }
        (Some(key), false) => match sessions.touch(key, state) {
            Some(id) => (None, id),
            None => return Response::text(404, "Not Found", "Session expired. Initialize again."),
        },
        // Lenient: clients that skip the session header get a throwaway session.
        (None, false) => {
            let (id, session, _) = state.register_session(TransportKind::Url, None);
            let response = state.handle(&session, message).await;
            state.unregister_session(id);
            return match response {
                Some(response) => Response::json(200, &response),
                None => Response::empty(202, "Accepted"),
            };
        }
    };

    let Some(session) = state.session_by_id(session_id) else {
        return Response::text(404, "Not Found", "Session expired. Initialize again.");
    };
    let mut response = match state.handle(&session, message).await {
        Some(response) => Response::json(200, &response),
        None => Response::empty(202, "Accepted"),
    };
    if let Some(key) = session_key {
        response.headers.push(("Mcp-Session-Id".into(), key));
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_head() {
        let head = b"POST /mcp?x=1 HTTP/1.1\r\nHost: 127.0.0.1:47615\r\nContent-Length: 2\r\nAuthorization: Bearer abc";
        let request = parse_head(head).unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(request.path, "/mcp");
        assert_eq!(request.header("Content-Length"), Some("2"));
        assert_eq!(request.header("authorization"), Some("Bearer abc"));
        assert!(parse_head(b"garbage").is_none());
    }

    #[test]
    fn host_and_origin_checks_block_rebinding_and_browsers() {
        assert!(host_allowed(Some("127.0.0.1:47615"), 47615));
        assert!(host_allowed(Some("localhost:47615"), 47615));
        assert!(!host_allowed(Some("evil.example:47615"), 47615));
        assert!(!host_allowed(Some("127.0.0.1:80"), 47615));
        assert!(!host_allowed(None, 47615));

        assert!(origin_allowed(None, 47615));
        assert!(origin_allowed(Some("http://localhost:47615"), 47615));
        assert!(!origin_allowed(Some("https://evil.example"), 47615));
        assert!(!origin_allowed(Some("null"), 47615));
    }
}
