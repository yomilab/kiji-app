mod errors;

use errors::{feed_http_status_error, feed_network_error, feed_request_cancelled_error};
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
const MAX_DATA_URL_BYTES: u64 = 1024 * 1024;
const PDF_MAGIC: &[u8] = b"%PDF-";
const CHROME_LIKE_USER_AGENT: &str =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 KiJi/0.1";

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

    let html = String::from_utf8(body)
        .map_err(|error| format!("Failed to decode HTML response body: {error}"))?;
    Ok((ResourceType::Html, html))
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

    let html = response
        .text()
        .await
        .map_err(|error| format!("Failed to read HTTP response body: {error}"))?;

    Ok(FetchHtmlSafeResponse {
        resource_type: ResourceType::Html,
        content_type,
        html: Some(html),
    })
}

async fn fetch_with_cache(
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
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|error| format!("Failed to create HTTP client: {error}"))?;

    let timeout = Duration::from_millis(request.timeout.unwrap_or(DEFAULT_TIMEOUT_MS));
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

    if status == StatusCode::NOT_MODIFIED {
        return Ok(FeedFetchWithCacheResponse {
            data: None,
            etag,
            last_modified,
            not_modified: true,
        });
    }

    if !status.is_success() {
        return Err(feed_http_status_error(status));
    }

    let data = response
        .text()
        .await
        .map_err(|error| format!("Failed to read HTTP response body: {error}"))?;

    Ok(FeedFetchWithCacheResponse {
        data: Some(data),
        etag,
        last_modified,
        not_modified: false,
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
        "en-US,en;q=0.9"
            .parse()
            .expect("static accept-language header is valid"),
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
    let fetch_future = async move { execute_data_url_fetch(url, timeout).await };
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
        if content_length > MAX_DATA_URL_BYTES {
            return Err("HTTP response is too large for a data URL.".to_string());
        }
    }

    let content_type =
        content_type_from_headers(response.headers()).unwrap_or_else(|| mime_type_from_url(&url));
    let bytes = response
        .bytes()
        .await
        .map_err(|error| format!("Failed to read HTTP response body: {error}"))?;

    if bytes.len() as u64 > MAX_DATA_URL_BYTES {
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
}
