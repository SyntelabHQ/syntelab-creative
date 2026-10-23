//! Asking the issuer of the user's certificate whether it is still good, when
//! the user signs a PDF with a time stamp: its answer is kept in the signature,
//! so the signature can be checked as good later without asking anyone.
//!
//! The addresses are those the certificate itself names (its issuer's OCSP
//! responder, its list of revoked certificates, its issuer's own certificate).
//! What is sent to a responder is the request the caller made: the
//! certificate's serial number and fingerprints of its issuer, nothing about the
//! user or the document. The rest is only downloaded. Answers are signed by the
//! issuer and are checked by whoever reads the signature, not here.

use std::time::Duration;

use ureq::Agent;

use crate::error::NetError;
use crate::time_stamp::is_time_stamp_address;

/// The same for every user and every version: it identifies nobody.
const USER_AGENT: &str = "Syntelab Creative";
/// An issuer answers in a moment; one that does not is given up on, and the signature is made without its word.
const TIME_LIMIT: Duration = Duration::from_secs(20);
/// An OCSP answer, or a certificate: a few kilobytes.
const ANSWER_LIMIT: u64 = 256 * 1024;
/// A list of revoked certificates can be long; one much longer than this is not kept in a signature.
const LIST_LIMIT: u64 = 8 * 1024 * 1024;

fn agent() -> Agent {
    Agent::config_builder()
        .user_agent(USER_AGENT)
        .timeout_global(Some(TIME_LIMIT))
        // Issuers often keep their files behind a redirect, to the same kind of address.
        .max_redirects(3)
        .build()
        .into()
}

fn checked(url: &str) -> Result<&str, NetError> {
    let url = url.trim();
    // The same kind of address an authority can be at: http(s), with a host, without a name or password.
    if is_time_stamp_address(url) {
        Ok(url)
    } else {
        Err(NetError::NotAllowed(url.to_owned()))
    }
}

/// Sends `request` (an `OCSPRequest`) to the responder at `url` and answers with its `OCSPResponse`.
///
/// Blocks until the answer arrives or the time limit passes; call it from a worker thread.
pub fn ask_issuer(url: &str, request: &[u8]) -> Result<Vec<u8>, NetError> {
    let url = checked(url)?;
    let mut response = agent()
        .post(url)
        .header("content-type", "application/ocsp-request")
        .header("accept", "application/ocsp-response")
        .send(request)
        .map_err(|error| NetError::Request(error.to_string()))?;
    if !response.status().is_success() {
        return Err(NetError::Request(format!("the issuer answered {}", response.status())));
    }
    response.body_mut().with_config().limit(ANSWER_LIMIT).read_to_vec().map_err(|error| NetError::Request(error.to_string()))
}

/// Downloads what a certificate points to at `url`: its issuer's list of revoked certificates (`list`), or its issuer's
/// own certificate.
///
/// Blocks until the answer arrives or the time limit passes; call it from a worker thread.
pub fn issuer_file(url: &str, list: bool) -> Result<Vec<u8>, NetError> {
    let url = checked(url)?;
    let mut response = agent().get(url).call().map_err(|error| NetError::Request(error.to_string()))?;
    if !response.status().is_success() {
        return Err(NetError::Request(format!("the issuer answered {}", response.status())));
    }
    let limit = if list { LIST_LIMIT } else { ANSWER_LIMIT };
    response.body_mut().with_config().limit(limit).read_to_vec().map_err(|error| NetError::Request(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;

    /// A server that answers one request with `answer`, and hands back the request it read.
    fn server(answer: &'static [u8]) -> (String, std::thread::JoinHandle<(String, Vec<u8>)>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let address = format!("http://{}/ocsp", listener.local_addr().expect("an address"));
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
    fn sends_the_question_as_it_is_and_reads_the_answer() {
        let (address, served) = server(b"HTTP/1.1 200 OK\r\nContent-Type: application/ocsp-response\r\nContent-Length: 3\r\nConnection: close\r\n\r\n\x30\x01\x00");
        assert_eq!(ask_issuer(&address, &[0x30, 0x00]).expect("answered"), [0x30, 0x01, 0x00]);
        let (head, body) = served.join().expect("the server");
        assert_eq!(body, [0x30, 0x00]);
        let lower = head.to_ascii_lowercase();
        assert!(lower.starts_with("post /ocsp http/1.1\r\n") && lower.contains("content-type: application/ocsp-request\r\n"), "{head}");
        assert!(!lower.contains("cookie") && !lower.contains("referer"), "{head}");
    }

    #[test]
    fn downloads_a_list_and_tells_a_refusal() {
        let (address, served) = server(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n\x30\x00");
        assert_eq!(issuer_file(&address, true).expect("downloaded"), [0x30, 0x00]);
        assert!(served.join().expect("the server").0.to_ascii_lowercase().starts_with("get /ocsp http/1.1\r\n"));
        let (address, served) = server(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        assert!(matches!(issuer_file(&address, false), Err(NetError::Request(_))));
        served.join().expect("the server");
    }

    #[test]
    fn goes_only_to_web_addresses() {
        for wrong in ["", "ldap://ldap.example.com/cn=CA", "file:///etc/passwd", "http://user:secret@ocsp.example.com"] {
            assert!(matches!(ask_issuer(wrong, &[]), Err(NetError::NotAllowed(_))), "{wrong}");
            assert!(matches!(issuer_file(wrong, true), Err(NetError::NotAllowed(_))), "{wrong}");
        }
    }
}
