//! Asking a time-stamping authority (TSA, RFC 3161) for a time stamp, when the
//! user signs a PDF with a time stamp or adds one to a document.
//!
//! What is sent is the request the caller made: a fingerprint (SHA-256) of the
//! signature or of the document, a number for the request, and nothing about the
//! user. The document itself never goes. The authority is the one the user has
//! in PDF Organizer's settings (DigiCert's, unless changed). Its answer is
//! checked by the caller, not here.

use std::time::Duration;

use ureq::http::Uri;
use ureq::Agent;

use crate::error::NetError;

/// The same for every user and every version: it identifies nobody.
const USER_AGENT: &str = "Syntelab Creative";
/// An authority answers in a moment; a slow one is given time, but not for ever.
const TIME_LIMIT: Duration = Duration::from_secs(30);
/// An answer is a time stamp with the authority's certificates: a few kilobytes.
const SIZE_LIMIT: u64 = 256 * 1024;

/// True for an address an authority can be at: `http://` or `https://`, with a host and without a name or password in it.
/// Authorities are often asked over plain HTTP: what they answer is signed, and is checked whatever way it came.
pub fn is_time_stamp_address(url: &str) -> bool {
    let Ok(uri) = url.trim().parse::<Uri>() else {
        return false;
    };
    let scheme = matches!(uri.scheme_str(), Some("http" | "https"));
    let host = uri.host().is_some_and(|host| !host.is_empty());
    let plain = uri.authority().is_some_and(|authority| !authority.as_str().contains('@'));
    scheme && host && plain
}

/// Sends `query` (a `TimeStampReq`) to the authority at `url` and answers with what it sends back (a `TimeStampResp`).
///
/// Blocks until the answer arrives or the time limit passes; call it from a worker thread.
pub fn time_stamp(url: &str, query: &[u8]) -> Result<Vec<u8>, NetError> {
    let url = url.trim();
    if !is_time_stamp_address(url) {
        return Err(NetError::NotAllowed(url.to_owned()));
    }
    let agent: Agent = Agent::config_builder()
        .user_agent(USER_AGENT)
        .timeout_global(Some(TIME_LIMIT))
        // An authority answers where it is asked; an answer that sends elsewhere is no time stamp.
        .max_redirects(0)
        .build()
        .into();
    let mut response = agent
        .post(url)
        .header("content-type", "application/timestamp-query")
        .header("accept", "application/timestamp-reply")
        .send(query)
        .map_err(|error| NetError::Request(error.to_string()))?;
    if !response.status().is_success() {
        return Err(NetError::Request(format!("the time-stamping authority answered {}", response.status())));
    }
    response.body_mut().with_config().limit(SIZE_LIMIT).read_to_vec().map_err(|error| NetError::Request(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    /// A server that answers one request with `answer`, and hands back the request it read.
    fn server(answer: &'static [u8]) -> (String, std::thread::JoinHandle<(String, Vec<u8>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let address = format!("http://{}/tsa", listener.local_addr().expect("an address"));
        let served = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("a connection");
            let mut reader = BufReader::new(stream);
            let mut head = String::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).expect("a line");
                if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                    length = value.trim().parse().expect("a length");
                }
                head.push_str(&line);
                if line == "\r\n" || line.is_empty() {
                    break;
                }
            }
            let mut body = vec![0u8; length];
            reader.read_exact(&mut body).expect("a body");
            reader.get_mut().write_all(answer).expect("answered");
            (head, body)
        });
        (address, served)
    }

    #[test]
    fn sends_the_request_as_it_is_and_reads_the_answer() {
        let (address, served) = server(b"HTTP/1.1 200 OK\r\nContent-Type: application/timestamp-reply\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x30\x01\x00");
        let answer = time_stamp(&address, &[0x30, 0x02, 0x05, 0x00]).expect("answered");
        assert_eq!(answer, [0x30, 0x01, 0x00]);
        let (head, body) = served.join().expect("the server");
        assert_eq!(body, [0x30, 0x02, 0x05, 0x00]);
        let lower = head.to_ascii_lowercase();
        assert!(lower.starts_with("post /tsa http/1.1\r\n"), "{head}");
        assert!(lower.contains("content-type: application/timestamp-query\r\n") && lower.contains("user-agent: syntelab creative\r\n"), "{head}");
        assert!(!lower.contains("cookie") && !lower.contains("referer"), "{head}");
    }

    #[test]
    fn an_authority_that_refuses_is_an_error() {
        let (address, served) = server(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(matches!(time_stamp(&address, &[0x30, 0x00]), Err(NetError::Request(_))));
        served.join().expect("the server");
    }

    #[test]
    fn asks_only_at_addresses_an_authority_can_be_at() {
        assert!(is_time_stamp_address("http://timestamp.digicert.com"));
        assert!(is_time_stamp_address("https://freetsa.org/tsr"));
        assert!(is_time_stamp_address(" http://tsa.example.com:8080/stamp "));
        for wrong in ["", "timestamp.digicert.com", "file:///etc/passwd", "ftp://tsa.example.com", "http://user:secret@tsa.example.com", "http://"] {
            assert!(!is_time_stamp_address(wrong), "{wrong}");
            assert!(matches!(time_stamp(wrong, &[]), Err(NetError::NotAllowed(_))), "{wrong}");
        }
    }
}
