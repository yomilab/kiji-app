//! `kiji-app --mcp`: stdio bridge for MCP clients. Forwards newline-delimited
//! JSON-RPC between the client's stdin/stdout and Yomi Reader's local socket (or
//! named pipe). Runs without Tauri and never opens the database.
//!
//! While Yomi Reader is closed (or assistant access is off) the bridge still
//! answers `initialize` and the list methods, and tells the agent to open
//! Yomi Reader on tool calls. Once Yomi Reader is reachable it reconnects, replaying the
//! client's `initialize` so the session continues.

use super::{endpoint, protocol, transport::read_message};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::sync::mpsc;

const REPLAY_INITIALIZE_ID: &str = "kiji-bridge-replay-initialize";
/// How long the bridge waits for in-flight answers after stdin closes.
const DRAIN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// Ids of messages the bridge itself sends on reconnect; their responses are
/// dropped.
const REPLAY_ID_PREFIX: &str = "kiji-bridge-replay";
pub const OFFLINE_MESSAGE: &str =
    "Yomi Reader isn't open, or assistant access is off. Ask the user to open Yomi Reader and turn on Settings -> Assistant -> \"Let assistants read your Yomi Reader library\", then try again.";

type BoxedWriter = Box<dyn AsyncWrite + Send + Unpin>;
type BoxedReader = Box<dyn AsyncRead + Send + Unpin>;

pub fn run_stdio_bridge() -> i32 {
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("yomi-reader-mcp: failed to start: {error}");
            return 1;
        }
    };
    runtime.block_on(bridge_main(tokio::io::stdin(), tokio::io::stdout(), connect_local))
}

struct Upstream {
    writer: BoxedWriter,
    alive: Arc<std::sync::atomic::AtomicBool>,
    reader_task: tokio::task::JoinHandle<()>,
}

impl Drop for Upstream {
    fn drop(&mut self) {
        // The reader holds a stdout sender; stop it so shutdown never waits
        // on a socket that stays open.
        self.reader_task.abort();
    }
}

type Pending = Arc<Mutex<HashSet<String>>>;

pub(crate) async fn bridge_main<I, O, C, F>(stdin: I, stdout: O, connect: C) -> i32
where
    I: AsyncRead + Unpin,
    O: AsyncWrite + Send + Unpin + 'static,
    C: Fn() -> F,
    F: std::future::Future<Output = Option<(BoxedReader, BoxedWriter)>>,
{
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<String>();
    let writer = tokio::spawn(async move {
        let mut stdout = stdout;
        while let Some(mut line) = out_rx.recv().await {
            line.push('\n');
            if stdout.write_all(line.as_bytes()).await.is_err() || stdout.flush().await.is_err() {
                break;
            }
        }
    });

    let pending: Pending = Arc::new(Mutex::new(HashSet::new()));
    let mut upstream: Option<Upstream> = None;
    let mut saved_initialize: Option<Value> = None;
    // Resource subscriptions to restore after a reconnect.
    let mut subscriptions: Vec<String> = Vec::new();
    let mut reader = BufReader::new(stdin);
    let mut buffer = Vec::new();

    loop {
        match read_message(&mut reader, &mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&buffer).trim().to_string();
        if text.is_empty() {
            continue;
        }
        let message: Value = match serde_json::from_str(&text) {
            Ok(message) => message,
            Err(_) => {
                let _ = out_tx.send(protocol::parse_error_response().to_string());
                continue;
            }
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or_default().to_string();
        if method == "initialize" {
            saved_initialize = Some(message.clone());
        }
        let uri = message.pointer("/params/uri").and_then(Value::as_str).map(str::to_string);
        match (method.as_str(), uri) {
            ("resources/subscribe", Some(uri)) if !subscriptions.contains(&uri) => subscriptions.push(uri),
            ("resources/unsubscribe", Some(uri)) => subscriptions.retain(|existing| existing != &uri),
            _ => {}
        }

        let alive = upstream
            .as_ref()
            .map(|up| up.alive.load(std::sync::atomic::Ordering::Acquire))
            .unwrap_or(false);
        if !alive {
            upstream = None;
            if let Some((socket_reader, socket_writer)) = connect().await {
                let mut fresh = start_upstream(socket_reader, socket_writer, out_tx.clone(), Arc::clone(&pending));
                let replay_ok = match (&saved_initialize, method.as_str()) {
                    (Some(init), method) if method != "initialize" => {
                        replay_session(&mut fresh, init, &subscriptions).await
                    }
                    _ => true,
                };
                if replay_ok {
                    upstream = Some(fresh);
                }
            }
        }

        let id_key = message.get("id").map(Value::to_string);
        let mut forwarded = false;
        if let Some(up) = upstream.as_mut() {
            if let Some(key) = &id_key {
                pending.lock().map(|mut set| set.insert(key.clone())).ok();
            }
            let mut line = text.clone();
            line.push('\n');
            if up.writer.write_all(line.as_bytes()).await.is_ok() && up.writer.flush().await.is_ok() {
                forwarded = true;
            } else {
                if let Some(key) = &id_key {
                    pending.lock().map(|mut set| set.remove(key)).ok();
                }
                // Answer requests Yomi Reader will never reply to before dropping
                // the connection (dropping aborts its reader).
                fail_pending(&pending, &out_tx);
                upstream = None;
            }
        }
        if !forwarded {
            if let Some(response) = offline_response(&message) {
                let _ = out_tx.send(response.to_string());
            }
        }
    }

    // Input closed: give requests already sent to Yomi Reader a moment to answer
    // (e.g. `printf … | kiji-app --mcp`), then exit.
    if upstream.is_some() {
        let deadline = tokio::time::Instant::now() + DRAIN_TIMEOUT;
        while tokio::time::Instant::now() < deadline
            && upstream.as_ref().map(|up| up.alive.load(std::sync::atomic::Ordering::Acquire)).unwrap_or(false)
            && pending.lock().map(|set| !set.is_empty()).unwrap_or(false)
        {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    }
    drop(upstream);
    drop(out_tx);
    let _ = writer.await;
    0
}

async fn replay_session(upstream: &mut Upstream, init: &Value, subscriptions: &[String]) -> bool {
    let mut replay = init.clone();
    replay["id"] = Value::String(REPLAY_INITIALIZE_ID.to_string());
    let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
    let mut payload = format!("{replay}\n{initialized}\n");
    for (index, uri) in subscriptions.iter().enumerate() {
        let subscribe = json!({
            "jsonrpc": "2.0",
            "id": format!("{REPLAY_ID_PREFIX}-subscribe-{index}"),
            "method": "resources/subscribe",
            "params": { "uri": uri }
        });
        payload.push_str(&format!("{subscribe}\n"));
    }
    upstream.writer.write_all(payload.as_bytes()).await.is_ok() && upstream.writer.flush().await.is_ok()
}

fn fail_pending(pending: &Pending, out_tx: &mpsc::UnboundedSender<String>) {
    let waiting: Vec<String> = pending.lock().map(|mut set| set.drain().collect()).unwrap_or_default();
    for raw_id in waiting {
        let id: Value = serde_json::from_str(&raw_id).unwrap_or(Value::Null);
        let response = json!({
            "jsonrpc": "2.0", "id": id,
            "error": { "code": -32000, "message": "Yomi Reader closed before answering. Open Yomi Reader and try again." }
        });
        let _ = out_tx.send(response.to_string());
    }
}

fn start_upstream(
    socket_reader: BoxedReader,
    writer: BoxedWriter,
    out_tx: mpsc::UnboundedSender<String>,
    pending: Pending,
) -> Upstream {
    let alive = Arc::new(std::sync::atomic::AtomicBool::new(true));
    let reader_alive = Arc::clone(&alive);
    let reader_task = tokio::spawn(async move {
        let mut reader = BufReader::new(socket_reader);
        let mut buffer = Vec::new();
        loop {
            match read_message(&mut reader, &mut buffer).await {
                Ok(0) | Err(_) => break,
                Ok(_) => {}
            }
            let text = String::from_utf8_lossy(&buffer).trim().to_string();
            if text.is_empty() {
                continue;
            }
            if let Ok(message) = serde_json::from_str::<Value>(&text) {
                if message
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| id.starts_with(REPLAY_ID_PREFIX))
                    .unwrap_or(false)
                {
                    continue;
                }
                if let Some(id) = message.get("id") {
                    if message.get("method").is_none() {
                        pending.lock().map(|mut set| set.remove(&id.to_string())).ok();
                    }
                }
            }
            if out_tx.send(text).is_err() {
                break;
            }
        }
        reader_alive.store(false, std::sync::atomic::Ordering::Release);
        // Yomi Reader closed mid-request: answer whatever is still waiting.
        fail_pending(&pending, &out_tx);
    });
    Upstream { writer, alive, reader_task }
}

/// Answers while Yomi Reader can't be reached.
pub(crate) fn offline_response(message: &Value) -> Option<Value> {
    let id = message.get("id")?.clone();
    let method = message.get("method").and_then(Value::as_str).unwrap_or_default();
    let empty = json!({});
    let params = message.get("params").unwrap_or(&empty);
    let ok = |result: Value| json!({ "jsonrpc": "2.0", "id": id.clone(), "result": result });
    let err = |code: i64, text: &str| json!({ "jsonrpc": "2.0", "id": id.clone(), "error": { "code": code, "message": text } });
    Some(match method {
        "initialize" => ok(protocol::initialize_result(params)),
        "ping" => ok(json!({})),
        "tools/list" => ok(json!({ "tools": protocol::tool_definitions() })),
        "prompts/list" => ok(json!({ "prompts": protocol::prompt_definitions() })),
        "prompts/get" => match protocol::prompt_result(params) {
            Ok(result) => ok(result),
            Err((code, text)) => err(code, &text),
        },
        "resources/list" => ok(json!({ "resources": [] })),
        "resources/templates/list" => ok(json!({ "resourceTemplates": [] })),
        "tools/call" => ok(json!({ "content": [{ "type": "text", "text": OFFLINE_MESSAGE }], "isError": true })),
        "" => return None,
        _ => err(-32000, OFFLINE_MESSAGE),
    })
}

#[cfg(unix)]
async fn connect_local() -> Option<(BoxedReader, BoxedWriter)> {
    let path = endpoint::local_endpoint()?;
    let stream = tokio::net::UnixStream::connect(path).await.ok()?;
    let (reader, writer) = tokio::io::split(stream);
    Some((Box::new(reader), Box::new(writer)))
}

#[cfg(windows)]
async fn connect_local() -> Option<(BoxedReader, BoxedWriter)> {
    connect_tcp(&endpoint::local_endpoint()?).await
}

/// Windows transport: read port + key from the user's endpoint file and
/// send the key as the first line.
#[cfg_attr(unix, allow(dead_code))]
pub(crate) async fn connect_tcp(endpoint_file: &std::path::Path) -> Option<(BoxedReader, BoxedWriter)> {
    let endpoint = super::transport::read_endpoint_file(endpoint_file)?;
    let stream = tokio::time::timeout(
        std::time::Duration::from_secs(2),
        tokio::net::TcpStream::connect(("127.0.0.1", endpoint.port)),
    )
    .await
    .ok()?
    .ok()?;
    let (reader, mut writer) = tokio::io::split(stream);
    let hello = format!("{}\n", json!({ "kijiBridgeKey": endpoint.key }));
    writer.write_all(hello.as_bytes()).await.ok()?;
    Some((Box::new(reader), Box::new(writer)))
}

#[cfg(not(any(unix, windows)))]
async fn connect_local() -> Option<(BoxedReader, BoxedWriter)> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncBufReadExt};

    async fn run_offline(lines: &str) -> Vec<Value> {
        let (mut client_in, bridge_in) = duplex(64 * 1024);
        let (bridge_out, client_out) = duplex(64 * 1024);
        client_in.write_all(lines.as_bytes()).await.unwrap();
        drop(client_in);
        bridge_main(bridge_in, bridge_out, || async { None }).await;
        let mut reader = BufReader::new(client_out);
        let mut responses = Vec::new();
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap() > 0 {
            responses.push(serde_json::from_str(line.trim()).unwrap());
            line.clear();
        }
        responses
    }

    #[tokio::test]
    async fn answers_already_sent_requests_after_stdin_closes() {
        // Fake Yomi Reader that answers after a short delay.
        let (bridge_side, kiji_side) = duplex(64 * 1024);
        tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(kiji_side);
            let mut reader = BufReader::new(read_half);
            let mut line = String::new();
            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                let message: Value = serde_json::from_str(line.trim()).unwrap();
                if let Some(id) = message.get("id") {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": {} });
                    let _ = write_half.write_all(format!("{reply}\n").as_bytes()).await;
                }
                line.clear();
            }
        });
        let socket = Arc::new(Mutex::new(Some(bridge_side)));
        let connect = move || {
            let socket = Arc::clone(&socket);
            async move {
                let stream = socket.lock().unwrap().take()?;
                let (reader, writer) = tokio::io::split(stream);
                Some((Box::new(reader) as BoxedReader, Box::new(writer) as BoxedWriter))
            }
        };
        let (mut client_in, bridge_in) = duplex(64 * 1024);
        let (bridge_out, client_out) = duplex(64 * 1024);
        client_in.write_all(b"{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"ping\"}\n").await.unwrap();
        drop(client_in);
        bridge_main(bridge_in, bridge_out, connect).await;
        let mut line = String::new();
        BufReader::new(client_out).read_line(&mut line).await.unwrap();
        let reply: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(reply["id"], 9);
    }

    #[tokio::test]
    async fn offline_bridge_initializes_lists_tools_and_explains_tool_calls() {
        let responses = run_offline(concat!(
            r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#, "\n",
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, "\n",
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#, "\n",
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_stations"}}"#, "\n",
            "not json\n",
        ))
        .await;
        assert_eq!(responses.len(), 4);
        assert_eq!(responses[0]["result"]["protocolVersion"], "2025-06-18");
        assert!(responses[1]["result"]["tools"].as_array().unwrap().len() >= 8);
        assert_eq!(responses[2]["result"]["isError"], true);
        assert!(responses[2]["result"]["content"][0]["text"].as_str().unwrap().contains("open Yomi Reader"));
        assert_eq!(responses[3]["error"]["code"], -32700);
    }

    #[tokio::test]
    async fn bridge_forwards_to_kiji_and_replays_initialize_after_reconnect() {
        // Fake Yomi Reader: echoes every request id back as a result and records lines.
        let (bridge_side, kiji_side) = duplex(64 * 1024);
        let received = Arc::new(Mutex::new(Vec::<Value>::new()));
        let record = Arc::clone(&received);
        tokio::spawn(async move {
            let (read_half, mut write_half) = tokio::io::split(kiji_side);
            let mut reader = BufReader::new(read_half);
            let mut line = String::new();
            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                let message: Value = serde_json::from_str(line.trim()).unwrap();
                record.lock().unwrap().push(message.clone());
                if let Some(id) = message.get("id") {
                    let reply = json!({ "jsonrpc": "2.0", "id": id, "result": { "from": "kiji" } });
                    write_half.write_all(format!("{reply}\n").as_bytes()).await.unwrap();
                }
                line.clear();
            }
        });

        let socket = Arc::new(Mutex::new(Some(bridge_side)));
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let connect = {
            let socket = Arc::clone(&socket);
            let calls = Arc::clone(&calls);
            move || {
                let socket = Arc::clone(&socket);
                let calls = Arc::clone(&calls);
                async move {
                    // First attempt: Yomi Reader closed. Second: Yomi Reader is up.
                    if calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                        return None;
                    }
                    let stream = socket.lock().unwrap().take()?;
                    let (reader, writer) = tokio::io::split(stream);
                    Some((Box::new(reader) as BoxedReader, Box::new(writer) as BoxedWriter))
                }
            }
        };

        let (mut client_in, bridge_in) = duplex(64 * 1024);
        let (bridge_out, client_out) = duplex(64 * 1024);
        let bridge = tokio::spawn(bridge_main(bridge_in, bridge_out, connect));
        client_in
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{}}\n")
            .await
            .unwrap();
        let mut reader = BufReader::new(client_out);
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        let first: Value = serde_json::from_str(line.trim()).unwrap();
        assert!(first["result"]["protocolVersion"].is_string(), "offline initialize");

        client_in
            .write_all(b"{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}\n")
            .await
            .unwrap();
        line.clear();
        reader.read_line(&mut line).await.unwrap();
        let second: Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(second["id"], 2);
        assert_eq!(second["result"]["from"], "kiji", "forwarded once Yomi Reader is up");

        drop(client_in);
        bridge.await.unwrap();
        let received = received.lock().unwrap();
        assert_eq!(received[0]["id"], REPLAY_INITIALIZE_ID);
        assert_eq!(received[1]["method"], "notifications/initialized");
        assert_eq!(received[2]["id"], 2);
    }
}
