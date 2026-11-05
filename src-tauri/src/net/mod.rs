mod accept_language;
mod errors;

use accept_language::browser_accept_language;
use errors::{
    feed_body_too_large_error, feed_http_status_error, feed_network_error,
    feed_request_cancelled_error,
};
use futures_util::{future::{AbortHandle, Abortable}, StreamExt};
use once_cell::sync::Lazy;
use reqwest::{
    header::{
        HeaderMap, HeaderValue, ACCEPT, ACCEPT_ENCODING, ACCEPT_LANGUAGE, CACHE_CONTROL,
        CONTENT_TYPE, ETAG, IF_MODIFIED_SINCE, IF_NONE_MATCH, LAST_MODIFIED, PRAGMA,
        UPGRADE_INSECURE_REQUESTS, USER_AGENT,
    },
    StatusCode,
};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Mutex, time::Duration};

static ACTIVE_REQUESTS: Lazy<Mutex<HashMap<String, AbortHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

const DEFAULT_TIMEOUT_MS: u64 = 15_000;
const FEED_FETCH_DEFAULT_TIMEOUT_MS: u64 = 5_000;
const MAX_DATA_URL_BYTES: u64 = 1024 * 1024;
const MAX_PDF_INLINE_BYTES: u64 = 25 * 1024 * 1024;
const FEED_BODY_HARD_CAP_BYTES: u64 = 32 * 1024 * 1024;
const FEED_BODY_SOFT_WARN_BYTES: u64 = 10 * 1024 * 1024;
const PDF_MAGIC: &[u8] = b"%PDF-";
const CHROME_LIKE_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 YomiReader/0.1";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedFetchWithCacheRequest {
    pub url: String,
    pub request_id: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedFetchWithCacheResponse {
    pub data: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub not_modified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub byte_length: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_length_header: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetch_duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exceeded_soft_warn: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedFetchDataUrlResponse {
    pub data_url: String,
    pub content_type: String,
    pub byte_length: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ResourceType {
    Html,
    Pdf,
    Unsupported,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchHtmlSafeResponse {
    pub resource_type: ResourceType,
    pub content_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub html: Option<String>,
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_fetch(url: String, request_id: Option<String>) -> Result<String, String> {
    let response = fetch_with_cache(FeedFetchWithCacheRequest {
        url,
        request_id,
        etag: None,
        last_modified: None,
        timeout: None,
    })
    .await?;

    Ok(response.data.unwrap_or_default())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_fetch_with_cache(
    url: String,
    request_id: Option<String>,
    etag: Option<String>,
    last_modified: Option<String>,
    timeout: Option<u64>,
) -> Result<FeedFetchWithCacheResponse, String> {
    fetch_with_cache(FeedFetchWithCacheRequest {
        url,
        request_id,
        etag,
        last_modified,
        timeout,
    })
    .await
}

#[tauri::command(rename_all = "camelCase")]
pub fn feeds_abort_request(request_id: String) -> Result<(), String> {
    let abort_handle = ACTIVE_REQUESTS
        .lock()
        .map_err(|_| "Failed to lock feed request registry.".to_string())?
        .remove(&request_id);

    if let Some(abort_handle) = abort_handle {
        abort_handle.abort();
    }

    Ok(())
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_fetch_data_url(
    url: String,
    request_id: Option<String>,
    timeout: Option<u64>,
) -> Result<FeedFetchDataUrlResponse, String> {
    fetch_data_url(url, request_id, timeout).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_fetch_pdf_data_url(
    url: String,
    request_id: Option<String>,
    timeout: Option<u64>,
) -> Result<FeedFetchDataUrlResponse, String> {
    fetch_pdf_data_url(url, request_id, timeout).await
}

#[tauri::command(rename_all = "camelCase")]
pub async fn feeds_fetch_html_safe(
    url: String,
    timeout: Option<u64>,
) -> Result<FetchHtmlSafeResponse, String> {
    fetch_html_safe(url, timeout).await
}

fn categorize_content_type(content_type: &str) -> ResourceType {
    let content_type = content_type.to_lowercase();
    if content_type.contains("text/html")
        || content_type.contains("application/xhtml")
        || content_type.contains("text/xml")
        || content_type.contains("application/xml")
    {
        return ResourceType::Html;
    }
    if content_type.contains("application/pdf") {
        return ResourceType::Pdf;
    }
    ResourceType::Unsupported
}

fn url_suggests_pdf(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back())
                .map(|segment| segment.to_ascii_lowercase())
        })
        .is_some_and(|file_name| file_name.ends_with(".pdf"))
}

fn resolve_resource_type(content_type: &str, url: &str) -> ResourceType {
    if content_type.is_empty() {
        if url_suggests_pdf(url) {
            return ResourceType::Pdf;
        }
        return ResourceType::Html;
    }

    let categorized = categorize_content_type(content_type);
    if categorized == ResourceType::Unsupported {
        let lowered = content_type.to_ascii_lowercase();
        if (lowered.contains("octet-stream") || lowered.contains("binary"))
            && url_suggests_pdf(url)
        {
            return ResourceType::Pdf;
        }
    }
    categorized
}

async fn drain_response_body(response: reqwest::Response) -> Result<(), String> {
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        chunk.map_err(|error| format!("Failed to drain HTTP response body: {error}"))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy)]
struct FeedBodyLimits {
    hard_cap_bytes: u64,
    soft_warn_bytes: u64,
}

#[derive(Debug)]
enum FeedBodyReadError {
    TooLarge {
        bytes_read: u64,
        cap_reason: &'static str,
    },
    Network(String),
}

fn feed_body_limits() -> FeedBodyLimits {
    FeedBodyLimits {
        hard_cap_bytes: read_env_u64("KIJI_FEED_BODY_HARD_CAP_BYTES", FEED_BODY_HARD_CAP_BYTES),
        soft_warn_bytes: read_env_u64("KIJI_FEED_BODY_SOFT_WARN_BYTES", FEED_BODY_SOFT_WARN_BYTES),
    }
}

fn read_env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(default)
}

fn would_exceed_cap(current_len: usize, chunk_len: usize, hard_cap: u64) -> bool {
    current_len as u64 + chunk_len as u64 > hard_cap
}

async fn read_feed_body_with_limits(
    response: reqwest::Response,
    content_length_header: Option<u64>,
    hard_cap: u64,
) -> Result<(Vec<u8>, u64), FeedBodyReadError> {
    if let Some(content_length) = content_length_header {
        if content_length > hard_cap {
            if let Err(error) = drain_response_body(response).await {
                return Err(FeedBodyReadError::Network(error));
            }
            return Err(FeedBodyReadError::TooLarge {
                bytes_read: content_length,
                cap_reason: "content-length-header",
            });
        }
    }

    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                return Err(FeedBodyReadError::Network(format!(
                    "Failed to read HTTP response body: {error}"
                )));
            }
        };
        if would_exceed_cap(body.len(), chunk.len(), hard_cap) {
            while let Some(rest) = stream.next().await {
                if let Err(error) = rest {
                    return Err(FeedBodyReadError::Network(format!(
                        "Failed to drain HTTP response body: {error}"
                    )));
                }
            }
            return Err(FeedBodyReadError::TooLarge {
                bytes_read: body.len() as u64 + chunk.len() as u64,
                cap_reason: "streaming-body",
            });
        }
        body.extend_from_slice(&chunk);
    }

    let bytes_read = body.len() as u64;
    Ok((body, bytes_read))
}

fn log_feed_fetch_attribution(
    url: &str,
    status: u16,
    content_length_header: Option<u64>,
    bytes_read: u64,
    duration_ms: u64,
    cap_reason: Option<&str>,
    soft_warn: bool,
) {
    eprintln!(
        "[FeedFetchAttribution] url={url} status={status} contentLengthHeader={content_length_header:?} bytesRead={bytes_read} durationMs={duration_ms} capReason={} softWarn={soft_warn}",
        cap_reason.unwrap_or("none")
    );
}

async fn read_html_safe_body(response: reqwest::Response) -> Result<(ResourceType, String), String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| format!("Failed to read HTTP response body: {error}"))?;
        if body.is_empty() && chunk.len() >= PDF_MAGIC.len() && chunk.starts_with(PDF_MAGIC) {
            while let Some(rest) = stream.next().await {
                let _ = rest.map_err(|error| format!("Failed to drain HTTP response body: {error}"))?;
            }
            return Ok((ResourceType::Pdf, String::new()));
        }
        body.extend_from_slice(&chunk);
    }

    let html = decode_body_text(body, None, BodyKind::Html);
    Ok((ResourceType::Html, html))
}

const XML_DECLARATION_SNIFF_BYTES: usize = 1024;
const HTML_META_SNIFF_BYTES: usize = 2048;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BodyKind {
    Xml,
    Html,
}

/// Decodes an HTTP body to UTF-8. Precedence: BOM, Content-Type charset,
/// in-document declaration (XML declaration / HTML meta), then UTF-8.
/// Never fails: malformed sequences become U+FFFD. For XML, a declaration
/// naming a non-UTF-8 encoding is rewritten to UTF-8 because the returned
/// text is UTF-8 and feed-rs (quick-xml `encoding`) would otherwise re-decode
/// it with the stale declared encoding.
fn decode_body_text(body: Vec<u8>, content_type: Option<&str>, kind: BodyKind) -> String {
    use crate::diagnostics::robustness::{record, RobustnessCounter};

    let (encoding, bom_len) = match encoding_rs::Encoding::for_bom(&body) {
        Some((encoding, bom_len)) => (encoding, bom_len),
        None => (
            content_type
                .and_then(charset_from_content_type)
                .or_else(|| sniff_document_charset(&body, kind))
                .unwrap_or(encoding_rs::UTF_8),
            0,
        ),
    };

    let (mut text, lossy) = if encoding == encoding_rs::UTF_8 {
        let mut body = body;
        body.drain(..bom_len);
        match String::from_utf8(body) {
            Ok(text) => (text, false),
            Err(error) => (String::from_utf8_lossy(error.as_bytes()).into_owned(), true),
        }
    } else {
        let (text, had_errors) = encoding.decode_without_bom_handling(&body[bom_len..]);
        (text.into_owned(), had_errors)
    };

    if encoding != encoding_rs::UTF_8 {
        record(RobustnessCounter::BodyDecodedNonUtf8);
    }
    if lossy {
        record(RobustnessCounter::BodyDecodedLossy);
    }
    if kind == BodyKind::Xml {
        rewrite_xml_declaration_to_utf8(&mut text);
    }
    text
}

fn charset_from_content_type(content_type: &str) -> Option<&'static encoding_rs::Encoding> {
    content_type.split(';').skip(1).find_map(|param| {
        let (key, value) = param.split_once('=')?;
        if !key.trim().eq_ignore_ascii_case("charset") {
            return None;
        }
        let value = value.trim().trim_matches(|c| c == '"' || c == '\'');
        encoding_rs::Encoding::for_label(value.as_bytes())
    })
}

fn sniff_document_charset(body: &[u8], kind: BodyKind) -> Option<&'static encoding_rs::Encoding> {
    let declared = match kind {
        BodyKind::Xml => xml_declaration_encoding(body),
        BodyKind::Html => html_meta_charset(body).or_else(|| xml_declaration_encoding(body)),
    }?;
    // A declaration we could read with an ASCII scan is not UTF-16 (WHATWG).
    if declared == encoding_rs::UTF_16LE || declared == encoding_rs::UTF_16BE {
        return Some(encoding_rs::UTF_8);
    }
    Some(declared)
}

fn xml_declaration_encoding(body: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let (start, end) = xml_declaration_encoding_range(body)?;
    encoding_rs::Encoding::for_label(&body[start..end])
}

/// Byte range of the `encoding` value inside a leading `<?xml ... ?>`.
fn xml_declaration_encoding_range(body: &[u8]) -> Option<(usize, usize)> {
    let head = &body[..body.len().min(XML_DECLARATION_SNIFF_BYTES)];
    let offset = head.iter().position(|byte| !byte.is_ascii_whitespace())?;
    let rest = &head[offset..];
    if !rest.starts_with(b"<?xml") {
        return None;
    }
    let declaration = &rest[..find_bytes(rest, b"?>")?];
    let mut index = find_bytes(declaration, b"encoding")? + b"encoding".len();
    let skip_whitespace = |mut index: usize| {
        while declaration.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        index
    };
    index = skip_whitespace(index);
    if declaration.get(index) != Some(&b'=') {
        return None;
    }
    index = skip_whitespace(index + 1);
    let quote = *declaration.get(index).filter(|byte| **byte == b'"' || **byte == b'\'')?;
    let value_start = index + 1;
    let value_len = declaration[value_start..].iter().position(|byte| *byte == quote)?;
    Some((offset + value_start, offset + value_start + value_len))
}

fn html_meta_charset(body: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = body[..body.len().min(HTML_META_SNIFF_BYTES)].to_ascii_lowercase();
    let mut cursor = 0;
    while let Some(meta_start) = find_bytes(&head[cursor..], b"<meta") {
        let tag_start = cursor + meta_start;
        let tag_end = find_bytes(&head[tag_start..], b">").map_or(head.len(), |end| tag_start + end);
        let tag = &head[tag_start..tag_end];
        cursor = tag_end;
        // Covers both `<meta charset=x>` and `content="text/html; charset=x"`.
        let Some(charset_at) = find_bytes(tag, b"charset") else {
            continue;
        };
        let mut index = charset_at + b"charset".len();
        while tag.get(index).is_some_and(u8::is_ascii_whitespace) {
            index += 1;
        }
        if tag.get(index) != Some(&b'=') {
            continue;
        }
        index += 1;
        while tag
            .get(index)
            .is_some_and(|byte| byte.is_ascii_whitespace() || matches!(byte, b'"' | b'\''))
        {
            index += 1;
        }
        let label = &tag[index..];
        let label_len = label
            .iter()
            .position(|byte| byte.is_ascii_whitespace() || matches!(byte, b'"' | b'\'' | b';' | b'/'))
            .unwrap_or(label.len());
        if let Some(encoding) = encoding_rs::Encoding::for_label(&label[..label_len]) {
            return Some(encoding);
        }
    }
    None
}

fn rewrite_xml_declaration_to_utf8(text: &mut String) {
    let Some((start, end)) = xml_declaration_encoding_range(text.as_bytes()) else {
        return;
    };
    let declared = encoding_rs::Encoding::for_label(&text.as_bytes()[start..end]);
    if declared.is_some_and(|encoding| encoding != encoding_rs::UTF_8) {
        text.replace_range(start..end, "UTF-8");
    }
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn html_fetch_headers() -> HeaderMap {
    let mut headers = chrome_like_headers();
    headers.insert(
        ACCEPT,
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            .parse()
            .expect("static html accept header is valid"),
    );
    headers
}

async fn fetch_html_safe(url: String, timeout: Option<u64>) -> Result<FetchHtmlSafeResponse, String> {
    validate_http_url(&url)?;

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let response = client
        .get(&url)
        .headers(html_fetch_headers())
        .timeout(Duration::from_millis(timeout.unwrap_or(DEFAULT_TIMEOUT_MS)))
        .send()
        .await
        .map_err(feed_network_error)?;

    let status = response.status();
    if !status.is_success() {
        return Err(feed_http_status_error(status));
    }

    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_default();

    let resource_type = resolve_resource_type(&content_type, &url);

    if resource_type != ResourceType::Html {
        drain_response_body(response).await?;
        return Ok(FetchHtmlSafeResponse {
            resource_type,
            content_type,
            html: None,
        });
    }

    if content_type.is_empty() {
        let (resolved, html) = read_html_safe_body(response).await?;
        return Ok(FetchHtmlSafeResponse {
            resource_type: resolved,
            content_type,
            html: if resolved == ResourceType::Html {
                Some(html)
            } else {
                None
            },
        });
    }

    let body = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read HTTP response body: {error}"))?;
    let html = decode_body_text(Vec::from(body), Some(&content_type), BodyKind::Html);

    Ok(FetchHtmlSafeResponse {
        resource_type: ResourceType::Html,
        content_type,
        html: Some(html),
    })
}

pub async fn fetch_with_cache(
    request: FeedFetchWithCacheRequest,
) -> Result<FeedFetchWithCacheResponse, String> {
    validate_http_url(&request.url)?;

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    if let Some(request_id) = &request.request_id {
        ACTIVE_REQUESTS
            .lock()
            .map_err(|_| "Failed to lock feed request registry.".to_string())?
            .insert(request_id.clone(), abort_handle);
    }

    let request_id_for_cleanup = request.request_id.clone();
    let fetch_future = async move { execute_fetch(request).await };
    let result = Abortable::new(fetch_future, abort_registration).await;

    if let Some(request_id) = request_id_for_cleanup {
        let _ = ACTIVE_REQUESTS
            .lock()
            .map(|mut requests| requests.remove(&request_id));
    }

    match result {
        Ok(result) => result,
        Err(_) => Err(feed_request_cancelled_error()),
    }
}

async fn execute_fetch(
    request: FeedFetchWithCacheRequest,
) -> Result<FeedFetchWithCacheResponse, String> {
    let started_at = std::time::Instant::now();
    let limits = feed_body_limits();
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let timeout = Duration::from_millis(
        request
            .timeout
            .unwrap_or(FEED_FETCH_DEFAULT_TIMEOUT_MS),
    );
    let mut request_builder = client
        .get(&request.url)
        .headers(chrome_like_headers())
        .timeout(timeout);

    if let Some(etag) = request.etag {
        request_builder = request_builder.header(IF_NONE_MATCH, etag);
    }
    if let Some(last_modified) = request.last_modified {
        request_builder = request_builder.header(IF_MODIFIED_SINCE, last_modified);
    }

    let response = request_builder
        .send()
        .await
        .map_err(feed_network_error)?;
    let status = response.status();
    let headers = response.headers().clone();
    let etag = headers
        .get(ETAG)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let last_modified = headers
        .get(LAST_MODIFIED)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let content_length_header = response.content_length();
    let duration_ms = started_at.elapsed().as_millis() as u64;

    if status == StatusCode::NOT_MODIFIED {
        log_feed_fetch_attribution(
            &request.url,
            status.as_u16(),
            content_length_header,
            0,
            duration_ms,
            None,
            false,
        );
        return Ok(FeedFetchWithCacheResponse {
            data: None,
            etag,
            last_modified,
            not_modified: true,
            byte_length: Some(0),
            content_length_header,
            fetch_duration_ms: Some(duration_ms),
            exceeded_soft_warn: Some(false),
        });
    }

    if !status.is_success() {
        return Err(feed_http_status_error(status));
    }

    let (body, bytes_read) = match read_feed_body_with_limits(
        response,
        content_length_header,
        limits.hard_cap_bytes,
    )
    .await
    {
        Ok(result) => result,
        Err(FeedBodyReadError::Network(message)) => return Err(message),
        Err(FeedBodyReadError::TooLarge { bytes_read, cap_reason }) => {
            log_feed_fetch_attribution(
                &request.url,
                status.as_u16(),
                content_length_header,
                bytes_read,
                duration_ms,
                Some(cap_reason),
                false,
            );
            return Err(feed_body_too_large_error(
                bytes_read,
                limits.hard_cap_bytes,
                content_length_header,
            ));
        }
    };

    let exceeded_soft_warn = bytes_read > limits.soft_warn_bytes;
    log_feed_fetch_attribution(
        &request.url,
        status.as_u16(),
        content_length_header,
        bytes_read,
        duration_ms,
        None,
        exceeded_soft_warn,
    );

    let content_type = headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok());
    let data = decode_body_text(body, content_type, BodyKind::Xml);

    Ok(FeedFetchWithCacheResponse {
        data: Some(data),
        etag,
        last_modified,
        not_modified: false,
        byte_length: Some(bytes_read as usize),
        content_length_header,
        fetch_duration_ms: Some(duration_ms),
        exceeded_soft_warn: Some(exceeded_soft_warn),
    })
}

fn chrome_like_headers() -> HeaderMap {
    let mut headers = HeaderMap::new();
    headers.insert(
        USER_AGENT,
        CHROME_LIKE_USER_AGENT
            .parse()
            .expect("static user agent is valid"),
    );
    headers.insert(
        ACCEPT,
        "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.9,application/atom+xml;q=0.9,*/*;q=0.8"
            .parse()
            .expect("static accept header is valid"),
    );
    headers.insert(
        ACCEPT_LANGUAGE,
        browser_accept_language()
            .parse()
            .expect("accept-language header is valid"),
    );
    headers.insert(
        ACCEPT_ENCODING,
        "gzip, deflate, br"
            .parse()
            .expect("static accept-encoding header is valid"),
    );
    headers.insert(
        CACHE_CONTROL,
        "no-cache".parse().expect("static cache-control is valid"),
    );
    headers.insert(PRAGMA, "no-cache".parse().expect("static pragma is valid"));
    headers.insert(
        UPGRADE_INSECURE_REQUESTS,
        "1".parse().expect("static upgrade header is valid"),
    );
    headers.insert(
        "sec-ch-ua",
        "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\""
            .parse()
            .expect("static sec-ch-ua is valid"),
    );
    headers.insert(
        "sec-ch-ua-mobile",
        "?0".parse().expect("static sec-ch-ua-mobile is valid"),
    );
    headers.insert(
        "sec-ch-ua-platform",
        "\"macOS\""
            .parse()
            .expect("static sec-ch-ua-platform is valid"),
    );
    headers.insert(
        "Sec-Fetch-Dest",
        "document".parse().expect("static sec-fetch-dest is valid"),
    );
    headers.insert(
        "Sec-Fetch-Mode",
        "navigate".parse().expect("static sec-fetch-mode is valid"),
    );
    headers.insert(
        "Sec-Fetch-Site",
        "none".parse().expect("static sec-fetch-site is valid"),
    );
    headers
}

async fn fetch_data_url(
    url: String,
    request_id: Option<String>,
    timeout: Option<u64>,
) -> Result<FeedFetchDataUrlResponse, String> {
    validate_http_url(&url)?;

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    if let Some(request_id) = &request_id {
        ACTIVE_REQUESTS
            .lock()
            .map_err(|_| "Failed to lock feed request registry.".to_string())?
            .insert(request_id.clone(), abort_handle);
    }

    let request_id_for_cleanup = request_id.clone();
    let fetch_future =
        async move { execute_data_url_fetch(url, timeout, MAX_DATA_URL_BYTES).await };
    let result = Abortable::new(fetch_future, abort_registration).await;

    if let Some(request_id) = request_id_for_cleanup {
        let _ = ACTIVE_REQUESTS
            .lock()
            .map(|mut requests| requests.remove(&request_id));
    }

    match result {
        Ok(result) => result,
        Err(_) => Err(feed_request_cancelled_error()),
    }
}

async fn fetch_pdf_data_url(
    url: String,
    request_id: Option<String>,
    timeout: Option<u64>,
) -> Result<FeedFetchDataUrlResponse, String> {
    validate_http_url(&url)?;

    let (abort_handle, abort_registration) = AbortHandle::new_pair();
    if let Some(request_id) = &request_id {
        ACTIVE_REQUESTS
            .lock()
            .map_err(|_| "Failed to lock feed request registry.".to_string())?
            .insert(request_id.clone(), abort_handle);
    }

    let request_id_for_cleanup = request_id.clone();
    let fetch_future =
        async move { execute_data_url_fetch(url, timeout, MAX_PDF_INLINE_BYTES).await };
    let result = Abortable::new(fetch_future, abort_registration).await;

    if let Some(request_id) = request_id_for_cleanup {
        let _ = ACTIVE_REQUESTS
            .lock()
            .map(|mut requests| requests.remove(&request_id));
    }

    match result {
        Ok(result) => result,
        Err(_) => Err(feed_request_cancelled_error()),
    }
}

async fn execute_data_url_fetch(
    url: String,
    timeout: Option<u64>,
    max_bytes: u64,
) -> Result<FeedFetchDataUrlResponse, String> {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;
    let response = client
        .get(&url)
        .headers(chrome_like_headers())
        .timeout(Duration::from_millis(timeout.unwrap_or(DEFAULT_TIMEOUT_MS)))
        .send()
        .await
        .map_err(feed_network_error)?;

    let status = response.status();
    if !status.is_success() {
        return Err(feed_http_status_error(status));
    }

    if let Some(content_length) = response.content_length() {
        if content_length > max_bytes {
            return Err("HTTP response is too large for a data URL.".to_string());
        }
    }

    let mut content_type =
        content_type_from_headers(response.headers()).unwrap_or_else(|| mime_type_from_url(&url));
    if max_bytes > MAX_DATA_URL_BYTES && !content_type.contains("pdf") {
        content_type = "application/pdf".to_string();
    }
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read HTTP response body: {error}"))?;

    if bytes.len() as u64 > max_bytes {
        return Err("HTTP response is too large for a data URL.".to_string());
    }

    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(FeedFetchDataUrlResponse {
        data_url: format!("data:{content_type};base64,{encoded}"),
        content_type,
        byte_length: bytes.len(),
    })
}

fn content_type_from_headers(headers: &HeaderMap<HeaderValue>) -> Option<String> {
    headers
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn mime_type_from_url(url: &str) -> String {
    let extension = reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| {
            parsed
                .path_segments()
                .and_then(|mut segments| segments.next_back().map(ToOwned::to_owned))
        })
        .and_then(|file_name| {
            file_name
                .rsplit_once('.')
                .map(|(_, extension)| extension.to_ascii_lowercase())
        });

    match extension.as_deref() {
        Some("ico") => "image/x-icon",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        _ => "image/png",
    }
    .to_string()
}

fn validate_http_url(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| format!("Invalid URL: {error}"))?;
    match parsed.scheme() {
        "http" | "https" => Ok(()),
        scheme => Err(format!("Unsupported HTTP URL scheme: {scheme}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_urls() {
        assert!(validate_http_url("file:///tmp/feed.xml").is_err());
        assert!(validate_http_url("https://example.com/feed.xml").is_ok());
    }

    #[test]
    fn chrome_headers_include_cache_and_client_hints() {
        let headers = chrome_like_headers();
        assert!(headers.contains_key(USER_AGENT));
        assert!(headers.contains_key("sec-ch-ua"));
        assert_eq!(headers.get(CACHE_CONTROL).unwrap(), "no-cache");
        assert_eq!(
            headers.get(ACCEPT_LANGUAGE).unwrap(),
            browser_accept_language()
        );
        assert!(browser_accept_language().ends_with("*;q=0.1"));
    }

    #[test]
    fn accept_language_prefers_system_primary_locale() {
        use accept_language::build_accept_language_from_locales;

        let header = build_accept_language_from_locales(["ja-JP", "en-US"]);
        assert!(header.starts_with("ja-JP,"));
        assert!(header.contains("ja;q=0.9"));
        assert!(header.contains("en-US;q=0.8"));
    }

    #[test]
    fn categorizes_html_and_pdf_content_types() {
        assert_eq!(
            categorize_content_type("text/html; charset=utf-8"),
            ResourceType::Html
        );
        assert_eq!(
            categorize_content_type("application/pdf"),
            ResourceType::Pdf
        );
        assert_eq!(
            categorize_content_type("application/zip"),
            ResourceType::Unsupported
        );
        assert_eq!(categorize_content_type(""), ResourceType::Unsupported);
    }

    #[test]
    fn url_suggests_pdf_from_path_extension() {
        assert!(url_suggests_pdf(
            "https://example.com/files/system-card.pdf"
        ));
        assert!(!url_suggests_pdf("https://example.com/article"));
    }

    #[test]
    fn resolve_resource_type_handles_missing_and_octet_stream_pdf_urls() {
        assert_eq!(
            resolve_resource_type("", "https://example.com/doc.pdf"),
            ResourceType::Pdf
        );
        assert_eq!(
            resolve_resource_type("", "https://example.com/article"),
            ResourceType::Html
        );
        assert_eq!(
            resolve_resource_type(
                "application/octet-stream",
                "https://example.com/report.pdf"
            ),
            ResourceType::Pdf
        );
        assert_eq!(
            resolve_resource_type("application/zip", "https://example.com/report.pdf"),
            ResourceType::Unsupported
        );
    }

    #[test]
    fn derives_image_mime_type_from_url() {
        assert_eq!(
            mime_type_from_url("https://example.com/favicon.ico"),
            "image/x-icon"
        );
        assert_eq!(
            mime_type_from_url("https://example.com/icon.webp"),
            "image/webp"
        );
        assert_eq!(mime_type_from_url("https://example.com/icon"), "image/png");
    }

    #[test]
    fn would_exceed_cap_detects_overflow() {
        assert!(!would_exceed_cap(10, 5, 20));
        assert!(would_exceed_cap(10, 11, 20));
    }

    #[test]
    fn feed_body_limits_use_defaults_without_env() {
        let limits = feed_body_limits();
        assert_eq!(limits.hard_cap_bytes, FEED_BODY_HARD_CAP_BYTES);
        assert_eq!(limits.soft_warn_bytes, FEED_BODY_SOFT_WARN_BYTES);
    }

    async fn serve_one_http_response(response: String) -> std::net::SocketAddr {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = socket.write_all(response.as_bytes()).await;
            }
        });
        addr
    }

    #[tokio::test]
    async fn read_feed_body_with_limits_reads_normal_body() {
        let body = "<feed>ok</feed>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/atom+xml\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let addr = serve_one_http_response(response).await;
        let client = reqwest::Client::new();
        let http_response = client
            .get(format!("http://{addr}/feed.xml"))
            .send()
            .await
            .expect("request");

        let (bytes, bytes_read) = read_feed_body_with_limits(
            http_response,
            Some(body.len() as u64),
            1024,
        )
        .await
        .expect("read body");

        assert_eq!(bytes_read, body.len() as u64);
        assert_eq!(String::from_utf8(bytes).expect("utf8"), body);
    }

    #[tokio::test]
    async fn read_feed_body_with_limits_reads_body_without_content_length() {
        let body = "<feed>no-length</feed>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/atom+xml\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let addr = serve_one_http_response(response).await;
        let client = reqwest::Client::new();
        let http_response = client
            .get(format!("http://{addr}/feed.xml"))
            .send()
            .await
            .expect("request");

        let (_, bytes_read) = read_feed_body_with_limits(http_response, None, 1024)
            .await
            .expect("read body");

        assert_eq!(bytes_read, body.len() as u64);
    }

    #[tokio::test]
    async fn read_feed_body_with_limits_rejects_oversized_content_length() {
        let body = "small";
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let addr = serve_one_http_response(response).await;
        let client = reqwest::Client::new();
        let http_response = client
            .get(format!("http://{addr}/feed.xml"))
            .send()
            .await
            .expect("request");

        let error = read_feed_body_with_limits(http_response, Some(999_999), 1024)
            .await
            .expect_err("expected cap error");

        assert!(matches!(
            error,
            FeedBodyReadError::TooLarge {
                cap_reason: "content-length-header",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn read_feed_body_with_limits_rejects_oversized_streaming_body() {
        let body = "x".repeat(64);
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let addr = serve_one_http_response(response).await;
        let client = reqwest::Client::new();
        let http_response = client
            .get(format!("http://{addr}/feed.xml"))
            .send()
            .await
            .expect("request");

        let error = read_feed_body_with_limits(http_response, None, 32)
            .await
            .expect_err("expected cap error");

        assert!(matches!(
            error,
            FeedBodyReadError::TooLarge {
                cap_reason: "streaming-body",
                ..
            }
        ));
    }

    #[tokio::test]
    async fn execute_fetch_returns_http_status_error() {
        let response = "HTTP/1.1 404 Not Found\r\n\r\n".to_string();
        let addr = serve_one_http_response(response).await;
        let error = execute_fetch(FeedFetchWithCacheRequest {
            url: format!("http://{addr}/missing.xml"),
            request_id: None,
            etag: None,
            last_modified: None,
            timeout: Some(5_000),
        })
        .await
        .expect_err("expected http error");

        let parsed: errors::FeedCommandError =
            serde_json::from_str(&error).expect("structured error");
        assert_eq!(parsed.code, "FEED_HTTP_STATUS");
        assert_eq!(parsed.http_status, Some(404));
    }

    #[tokio::test]
    async fn execute_fetch_returns_timeout_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            if listener.accept().await.is_ok() {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });

        let error = execute_fetch(FeedFetchWithCacheRequest {
            url: format!("http://{addr}/slow.xml"),
            request_id: None,
            etag: None,
            last_modified: None,
            timeout: Some(100),
        })
        .await
        .expect_err("expected timeout");

        let parsed: errors::FeedCommandError =
            serde_json::from_str(&error).expect("structured error");
        assert!(
            parsed.code == "FEED_NETWORK_TIMEOUT" || parsed.code == "FEED_NETWORK_ERROR",
            "expected timeout-class error, got {}",
            parsed.code
        );
    }

    #[tokio::test]
    async fn execute_fetch_preserves_etag_and_last_modified() {
        let body = "<feed>etag</feed>";
        let response = format!(
            "HTTP/1.1 200 OK\r\nETag: \"etag-1\"\r\nLast-Modified: Tue, 22 Jun 2026 00:00:00 GMT\r\nContent-Length: {}\r\n\r\n{body}",
            body.len()
        );
        let addr = serve_one_http_response(response).await;
        let result = execute_fetch(FeedFetchWithCacheRequest {
            url: format!("http://{addr}/feed.xml"),
            request_id: None,
            etag: None,
            last_modified: None,
            timeout: Some(5_000),
        })
        .await
        .expect("fetch");

        assert_eq!(result.etag.as_deref(), Some("\"etag-1\""));
        assert_eq!(
            result.last_modified.as_deref(),
            Some("Tue, 22 Jun 2026 00:00:00 GMT")
        );
        assert_eq!(result.byte_length, Some(body.len()));
    }

    // --- body charset decoding ---

    use crate::diagnostics::robustness::snapshot as robustness_snapshot;
    use crate::feeds::feeds_parse_preview as parse_feed_preview;

    const JA_TITLE: &str = "日本語のフィード";
    const JA_ITEM: &str = "こんにちは世界";

    fn ja_rss(declared_encoding: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="{declared_encoding}"?>
<rss version="2.0"><channel><title>{JA_TITLE}</title><link>https://example.jp/</link>
<item><title>{JA_ITEM}</title><link>https://example.jp/1</link></item>
</channel></rss>"#
        )
    }

    fn encode(encoding: &'static encoding_rs::Encoding, text: &str) -> Vec<u8> {
        let (bytes, _, had_errors) = encoding.encode(text);
        assert!(!had_errors, "fixture must be representable");
        bytes.into_owned()
    }

    async fn serve_one_http_body(head: &str, body: Vec<u8>) -> std::net::SocketAddr {
        let mut response = format!(
            "HTTP/1.1 200 OK\r\n{head}Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .into_bytes();
        response.extend_from_slice(&body);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind test listener");
        let addr = listener.local_addr().expect("listener addr");
        tokio::spawn(async move {
            use tokio::io::AsyncWriteExt;
            if let Ok((mut socket, _)) = listener.accept().await {
                let _ = socket.write_all(&response).await;
            }
        });
        addr
    }

    async fn fetch_feed_text(head: &str, body: Vec<u8>) -> Result<String, String> {
        let addr = serve_one_http_body(head, body).await;
        execute_fetch(FeedFetchWithCacheRequest {
            url: format!("http://{addr}/feed.xml"),
            request_id: None,
            etag: None,
            last_modified: None,
            timeout: Some(5_000),
        })
        .await
        .map(|response| response.data.expect("feed body"))
    }

    #[tokio::test]
    async fn decodes_shift_jis_feed_from_content_type_charset() {
        let before = robustness_snapshot();
        let body = encode(encoding_rs::SHIFT_JIS, &ja_rss("Shift_JIS"));
        let text = fetch_feed_text("Content-Type: application/rss+xml; charset=Shift_JIS\r\n", body)
            .await
            .expect("shift_jis feed decodes");

        assert!(text.contains(JA_TITLE) && text.contains(JA_ITEM));
        assert!(text.starts_with(r#"<?xml version="1.0" encoding="UTF-8"?>"#));
        assert!(robustness_snapshot().body_decoded_non_utf8 > before.body_decoded_non_utf8);
    }

    #[test]
    fn decodes_gbk_feed_declared_only_in_xml_declaration() {
        let title = "中文订阅源";
        let raw = format!(
            "<?xml version='1.0' encoding='GBK'?><rss version=\"2.0\"><channel><title>{title}</title></channel></rss>"
        );
        let text = decode_body_text(
            encode(encoding_rs::GBK, &raw),
            Some("application/rss+xml"),
            BodyKind::Xml,
        );

        assert!(text.contains(title));
        assert!(text.starts_with("<?xml version='1.0' encoding='UTF-8'?>"));
    }

    #[tokio::test]
    async fn fetch_html_safe_decodes_latin1_meta_charset() {
        let html = encode(
            encoding_rs::WINDOWS_1252,
            r#"<html><head><meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><link rel="icon" href="/f.ico"></head><body>Café déjà vu</body></html>"#,
        );
        for head in ["Content-Type: text/html\r\n", ""] {
            let addr = serve_one_http_body(head, html.clone()).await;
            let response = fetch_html_safe(format!("http://{addr}/"), Some(5_000))
                .await
                .expect("latin-1 html decodes");
            let decoded = response.html.expect("html body");
            assert!(decoded.contains("Café déjà vu"), "head={head:?} got {decoded}");
        }
    }

    #[tokio::test]
    async fn utf8_feed_with_one_invalid_byte_decodes_lossily() {
        let before = robustness_snapshot();
        let mut body = b"<rss><channel><title>ok ".to_vec();
        body.push(0xFF);
        body.extend_from_slice(b" ok</title></channel></rss>");
        let text = fetch_feed_text("Content-Type: application/rss+xml\r\n", body)
            .await
            .expect("lossy decode instead of error");

        assert_eq!(text, "<rss><channel><title>ok \u{FFFD} ok</title></channel></rss>");
        assert!(robustness_snapshot().body_decoded_lossy > before.body_decoded_lossy);
    }

    #[test]
    fn plain_utf8_body_is_unchanged() {
        let raw = ja_rss("utf-8");
        assert_eq!(
            decode_body_text(raw.clone().into_bytes(), Some("application/rss+xml; charset=utf-8"), BodyKind::Xml),
            raw
        );
        let mut with_bom = vec![0xEF, 0xBB, 0xBF];
        with_bom.extend_from_slice(raw.as_bytes());
        assert_eq!(decode_body_text(with_bom, None, BodyKind::Xml), raw);
    }

    #[test]
    fn bom_wins_over_declared_charset() {
        let raw = ja_rss("UTF-16");
        let mut body = vec![0xFF, 0xFE];
        for unit in raw.encode_utf16() {
            body.extend_from_slice(&unit.to_le_bytes());
        }
        let text = decode_body_text(body, Some("text/xml; charset=iso-8859-1"), BodyKind::Xml);
        assert_eq!(text, ja_rss("UTF-8"));
    }

    #[tokio::test]
    async fn shift_jis_feed_parses_end_to_end_with_japanese_title() {
        let body = encode(encoding_rs::SHIFT_JIS, &ja_rss("Shift_JIS"));
        let text = fetch_feed_text("Content-Type: application/rss+xml; charset=Shift_JIS\r\n", body)
            .await
            .expect("shift_jis feed decodes");
        let preview = parse_feed_preview(text, "https://example.jp/feed".to_string())
            .expect("decoded feed parses");

        assert_eq!(preview.items[0].title, JA_ITEM);
    }

    #[test]
    fn feed_rs_honours_stale_declaration_on_utf8_text() {
        // Why the declaration is rewritten: feed-rs (quick-xml `encoding`)
        // re-decodes UTF-8 text with the declared encoding.
        let stale = parse_feed_preview(ja_rss("Shift_JIS"), "https://example.jp/feed".to_string());
        assert!(stale.map_or(true, |preview| preview.items[0].title != JA_ITEM));

        let mut rewritten = ja_rss("Shift_JIS");
        rewrite_xml_declaration_to_utf8(&mut rewritten);
        let preview = parse_feed_preview(rewritten, "https://example.jp/feed".to_string())
            .expect("rewritten declaration parses");
        assert_eq!(preview.items[0].title, JA_ITEM);
    }

    #[test]
    fn charset_sniffing_helpers() {
        assert_eq!(
            charset_from_content_type("text/xml; Charset=\"EUC-JP\""),
            Some(encoding_rs::EUC_JP)
        );
        assert_eq!(charset_from_content_type("text/xml"), None);
        assert_eq!(
            html_meta_charset(b"<html><head><META CHARSET=big5>"),
            Some(encoding_rs::BIG5)
        );
        assert_eq!(html_meta_charset(b"<meta name=\"charset\">"), None);
        // In-document UTF-16 labels on ASCII-readable bytes mean UTF-8.
        assert_eq!(
            sniff_document_charset(b"<meta charset=\"utf-16\">", BodyKind::Html),
            Some(encoding_rs::UTF_8)
        );
        assert_eq!(xml_declaration_encoding(b"<rss encoding=\"gbk\">"), None);
    }
}
