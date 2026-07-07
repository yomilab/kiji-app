use reqwest::StatusCode;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FeedCommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
}

impl FeedCommandError {
    pub fn to_invoke_error(self) -> String {
        serde_json::to_string(&self).unwrap_or(self.message)
    }
}

pub fn feed_http_status_error(status: StatusCode) -> String {
    FeedCommandError {
        code: "FEED_HTTP_STATUS".to_string(),
        message: format!("HTTP request failed with status {status}."),
        http_status: Some(status.as_u16()),
    }
    .to_invoke_error()
}

pub fn feed_request_cancelled_error() -> String {
    FeedCommandError {
        code: "FEED_REQUEST_CANCELLED".to_string(),
        message: "Feed request was cancelled.".to_string(),
        http_status: None,
    }
    .to_invoke_error()
}

pub fn feed_network_error(error: reqwest::Error) -> String {
    let code = if error.is_timeout() {
        "FEED_NETWORK_TIMEOUT"
    } else if error.is_connect() {
        "FEED_NETWORK_CONNECT"
    } else {
        "FEED_NETWORK_ERROR"
    };

    FeedCommandError {
        code: code.to_string(),
        message: format!("Failed to fetch URL: {error}"),
        http_status: None,
    }
    .to_invoke_error()
}

pub fn feed_body_too_large_error(
    bytes_read: u64,
    cap_bytes: u64,
    content_length_header: Option<u64>,
) -> String {
    FeedCommandError {
        code: "FEED_BODY_TOO_LARGE".to_string(),
        message: format!(
            "Feed response exceeded the {cap_bytes} byte limit after reading {bytes_read} bytes (content-length header: {content_length_header:?})."
        ),
        http_status: None,
    }
    .to_invoke_error()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_http_status_errors_with_code_and_status() {
        let payload = feed_http_status_error(StatusCode::NOT_FOUND);
        let parsed: FeedCommandError = serde_json::from_str(&payload).expect("json error");
        assert_eq!(parsed.code, "FEED_HTTP_STATUS");
        assert_eq!(parsed.http_status, Some(404));
    }

    #[test]
    fn serializes_cancelled_errors_with_code() {
        let payload = feed_request_cancelled_error();
        let parsed: FeedCommandError = serde_json::from_str(&payload).expect("json error");
        assert_eq!(parsed.code, "FEED_REQUEST_CANCELLED");
        assert!(parsed.http_status.is_none());
    }

    #[test]
    fn serializes_body_too_large_errors_with_code() {
        let payload = feed_body_too_large_error(33_554_432, 32_000_000, Some(40_000_000));
        let parsed: FeedCommandError = serde_json::from_str(&payload).expect("json error");
        assert_eq!(parsed.code, "FEED_BODY_TOO_LARGE");
        assert!(parsed.http_status.is_none());
        assert!(parsed.message.contains("32000000"));
    }
}
