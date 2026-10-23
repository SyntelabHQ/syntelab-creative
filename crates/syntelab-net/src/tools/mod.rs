//! The network tools of Dev: a request to a server, a question to a name
//! server, whether ports are open, the certificate a site shows.
//!
//! They are the user's own instruments, and go where the user points them:
//! only when an address is typed and a button is pressed, only to that
//! address (and where it sends a request on, when the user lets it), never
//! on the program's own initiative and never in the background. What is
//! sent is what the user wrote, and nothing about the user or the computer
//! is added to it. See the README of this crate and decision 0004.

pub mod dns;
pub mod http;
pub mod port;
pub mod tls;

use std::fmt;

/// What went wrong with a tool: a code the interface has words for, and what the system or a library said (in English).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub code: &'static str,
    pub detail: String,
}

impl ToolError {
    pub(crate) fn new(code: &'static str, detail: impl fmt::Display) -> Self {
        Self { code, detail: detail.to_string() }
    }

    pub(crate) fn plain(code: &'static str) -> Self {
        Self { code, detail: String::new() }
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.detail.is_empty() {
            write!(formatter, "{}", self.code)
        } else {
            write!(formatter, "{}: {}", self.code, self.detail)
        }
    }
}

impl std::error::Error for ToolError {}

/// A name of a host as it may be asked for: letters, digits, hyphens, dots and underscores, or an address in
/// figures. Nothing else is handed to the system.
pub(crate) fn is_host(host: &str) -> bool {
    let name = host.strip_prefix('[').and_then(|host| host.strip_suffix(']')).unwrap_or(host);
    if name.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    !name.is_empty() && name.len() <= 253 && name.bytes().all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, b'-' | b'.' | b'_')) && !name.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_names_and_addresses_and_nothing_else() {
        for host in ["example.com", "localhost", "my-host_1.internal", "10.0.0.1", "::1", "[::1]", "xn--bcher-kva.example"] {
            assert!(is_host(host), "{host}");
        }
        for host in ["", "exa mple.com", "example.com/path", "user@example.com", "example.com:80", ".example.com", "bücher.example"] {
            assert!(!is_host(host), "{host}");
        }
    }
}
