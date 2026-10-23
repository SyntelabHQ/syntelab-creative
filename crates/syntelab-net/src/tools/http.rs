//! One request to a server, as the user wrote it, and what came back.
//!
//! The method, the address, the headers and the body are the user's. The
//! only things added are those HTTP itself needs (Host, Content-Length) and,
//! unless the user gives their own, a `User-Agent` that is the same for
//! everyone and an `Accept` of anything. No cookies are kept from one
//! request to the next. The answer is read as it comes: shown when it is
//! small enough, written straight to a file when one is named, so its size
//! has no most.

use std::io::{Read, Write};
use std::time::{Duration, Instant};

use ureq::http::{HeaderName, HeaderValue, Method, Request, Uri};
use ureq::tls::{RootCerts, TlsConfig};
use ureq::{Agent, ResponseExt};

use super::ToolError;

/// The same for every user and every version: it identifies nobody. Sent only when the user names no other.
const USER_AGENT: &str = "Syntelab Creative";

pub struct HttpRequest {
    pub method: String,
    pub url: String,
    /// As the user wrote them, in their order.
    pub headers: Vec<(String, String)>,
    pub body: Option<Vec<u8>>,
    /// A file sent as the body, read from where it is as it is sent (so its size has no most); it goes before `body`.
    pub body_file: Option<std::path::PathBuf>,
    /// How many times the request is sent on to where the server points; 0 shows the first answer as it is.
    pub redirects: u32,
    /// A certificate the computer does not trust ends the request. Turned off for servers of one's own.
    pub verify_tls: bool,
    /// For the whole of it, from the connection to the last byte; none waits as long as it takes.
    pub timeout: Option<Duration>,
}

/// What became of the body of the answer.
#[derive(Debug, PartialEq, Eq)]
pub enum Body {
    /// Read whole, to be shown.
    Shown(Vec<u8>),
    /// Written to the file that was named.
    Saved,
    /// Larger than what is shown, and no file was named: only its beginning was read.
    TooLarge(Vec<u8>),
}

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub reason: String,
    /// `HTTP/1.1`
    pub version: String,
    pub headers: Vec<(String, String)>,
    /// The address that answered, and those the request was sent on from before it.
    pub url: String,
    pub sent_on_from: Vec<String>,
    pub body: Body,
    /// Bytes of the body as they were read (after they were unpacked, when the server packed them).
    pub size: u64,
    /// Until the headers of the answer were there, and until its last byte.
    pub ms_to_headers: u64,
    pub ms: u64,
}

fn failed(error: ureq::Error) -> ToolError {
    use ureq::Error;
    let code = match &error {
        Error::BadUri(_) => "bad-url",
        Error::HostNotFound => "no-such-host",
        Error::ConnectionFailed => "no-connection",
        Error::Timeout(_) => "timeout",
        Error::Tls(_) | Error::Rustls(_) => "tls",
        Error::Io(io) => match io.kind() {
            std::io::ErrorKind::ConnectionRefused | std::io::ErrorKind::ConnectionReset | std::io::ErrorKind::ConnectionAborted => "no-connection",
            std::io::ErrorKind::TimedOut => "timeout",
            // The server went away in the middle of what it was saying.
            std::io::ErrorKind::UnexpectedEof => "cut-short",
            _ => "failed",
        },
        Error::RedirectFailed => "bad-redirect",
        Error::Protocol(_) | Error::Http(_) => "bad-answer",
        _ => "failed",
    };
    ToolError::new(code, error)
}

/// Sends the request and reads the answer. A body of up to `shown_most` bytes is given back to be shown; with
/// `out`, it is written there instead, however large. `watch` is told how many bytes of the body were read, and of
/// how many when the server said; it stops the reading by answering false.
pub fn send(request: &HttpRequest, out: Option<&mut dyn Write>, shown_most: usize, watch: &mut dyn FnMut(u64, Option<u64>) -> bool) -> Result<HttpResponse, ToolError> {
    let uri: Uri = request.url.trim().parse().map_err(|error| ToolError::new("bad-url", error))?;
    if !matches!(uri.scheme_str(), Some("http" | "https")) || uri.host().is_none_or(str::is_empty) {
        return Err(ToolError::plain("bad-url"));
    }
    let method = Method::from_bytes(request.method.trim().to_ascii_uppercase().as_bytes()).map_err(|_| ToolError::plain("bad-method"))?;
    let mut built = Request::builder().method(method).uri(uri);
    let named = |name: &str| request.headers.iter().any(|(known, _)| known.trim().eq_ignore_ascii_case(name));
    for (name, value) in &request.headers {
        let name = HeaderName::from_bytes(name.trim().as_bytes()).map_err(|_| ToolError::new("bad-header", name))?;
        let value = HeaderValue::from_str(value.trim()).map_err(|_| ToolError::new("bad-header", &name))?;
        built = built.header(name, value);
    }
    if !named("user-agent") {
        built = built.header("user-agent", USER_AGENT);
    }
    if !named("accept") {
        built = built.header("accept", "*/*");
    }

    let config = Agent::config_builder()
        // An answer of 404 or 500 is an answer, and is shown.
        .http_status_as_error(false)
        .max_redirects(request.redirects)
        .max_redirects_will_error(false)
        .save_redirect_history(true)
        .allow_non_standard_methods(true)
        .timeout_global(request.timeout)
        // Trusted when the computer trusts it: the roots of the system, with those the user or their company added.
        .tls_config(TlsConfig::builder().root_certs(RootCerts::PlatformVerifier).disable_verification(!request.verify_tls).build())
        .build();
    let agent: Agent = config.into();

    let started = Instant::now();
    let response = match (&request.body_file, &request.body) {
        (Some(path), _) => {
            let file = std::fs::File::open(path).map_err(|error| ToolError::new("cannot-open", error))?;
            agent.run(built.body(file).map_err(|error| ToolError::new("bad-header", error))?)
        }
        (None, Some(body)) => agent.run(built.body(body.as_slice()).map_err(|error| ToolError::new("bad-header", error))?),
        (None, None) => agent.run(built.body(()).map_err(|error| ToolError::new("bad-header", error))?),
    }
    .map_err(failed)?;
    let ms_to_headers = started.elapsed().as_millis() as u64;

    let url = response.get_uri().to_string();
    let mut sent_on_from: Vec<String> = response.get_redirect_history().map(|history| history.iter().map(ToString::to_string).collect()).unwrap_or_default();
    // The last of them is the one that answered.
    sent_on_from.pop();
    let (parts, body) = response.into_parts();
    let headers: Vec<(String, String)> = parts.headers.iter().map(|(name, value)| (name.as_str().to_owned(), String::from_utf8_lossy(value.as_bytes()).into_owned())).collect();
    let total = body.content_length();

    let mut reader = body.into_with_config().limit(u64::MAX).reader();
    let mut piece = vec![0u8; 64 * 1024];
    let mut shown = Vec::new();
    let mut size = 0u64;
    let mut too_large = false;
    let mut out = out;
    loop {
        let read = match reader.read(&mut piece) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == std::io::ErrorKind::TimedOut => return Err(ToolError::plain("timeout")),
            Err(error) => return Err(ToolError::new("cut-short", error)),
        };
        size += read as u64;
        match out.as_mut() {
            Some(out) => out.write_all(&piece[..read]).map_err(|error| ToolError::new("cannot-save", error))?,
            None => {
                let room = shown_most.saturating_sub(shown.len()).min(read);
                shown.try_reserve(room).map_err(|_| ToolError::plain("no-memory"))?;
                shown.extend_from_slice(&piece[..room]);
                if room < read {
                    // The rest is not read: it would only be thrown away.
                    too_large = true;
                    break;
                }
            }
        }
        if !watch(size, total) {
            return Err(ToolError::plain("stopped"));
        }
    }
    let body = if out.is_some() {
        Body::Saved
    } else if too_large {
        Body::TooLarge(shown)
    } else {
        Body::Shown(shown)
    };
    Ok(HttpResponse {
        status: parts.status.as_u16(),
        reason: parts.status.canonical_reason().unwrap_or_default().to_owned(),
        version: format!("{:?}", parts.version),
        headers,
        url,
        sent_on_from,
        body,
        size,
        ms_to_headers,
        ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader};
    use std::net::TcpListener;

    /// A server that answers each connection once, with what `answer` makes of the request it read.
    fn server(connections: usize, answer: fn(&str) -> String) -> (String, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let address = format!("http://{}", listener.local_addr().expect("an address"));
        let served = std::thread::spawn(move || {
            let mut asked = Vec::new();
            for _ in 0..connections {
                let (stream, _) = listener.accept().expect("a connection");
                let mut reader = BufReader::new(stream);
                let mut request = String::new();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    reader.read_line(&mut line).expect("a line");
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().expect("a length");
                    }
                    request.push_str(&line);
                    if line == "\r\n" || line.is_empty() {
                        break;
                    }
                }
                let mut body = vec![0u8; length];
                reader.read_exact(&mut body).expect("a body");
                request.push_str(&String::from_utf8_lossy(&body));
                reader.get_mut().write_all(answer(&request).as_bytes()).expect("answered");
                asked.push(request);
            }
            asked
        });
        (address, served)
    }

    fn request(method: &str, url: &str) -> HttpRequest {
        HttpRequest { method: method.into(), url: url.into(), headers: Vec::new(), body: None, body_file: None, redirects: 5, verify_tls: true, timeout: Some(Duration::from_secs(10)) }
    }

    fn on(_: u64, _: Option<u64>) -> bool {
        true
    }

    #[test]
    fn sends_what_the_user_wrote_and_reads_the_answer() {
        let (address, served) = server(1, |_| "HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Twice: a\r\nX-Twice: b\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}".to_owned());
        let mut asked = request("post", &format!("{address}/things?x=1"));
        asked.headers = vec![("Content-Type".into(), "application/json".into()), ("X-Mine".into(), " yes ".into())];
        asked.body = Some(b"{\"a\":1}".to_vec());
        let answer = send(&asked, None, 1024, &mut on).expect("answered");
        assert_eq!((answer.status, answer.reason.as_str(), answer.version.as_str()), (201, "Created", "HTTP/1.1"));
        assert_eq!(answer.body, Body::Shown(b"{\"ok\":true}".to_vec()));
        assert_eq!(answer.size, 11);
        assert_eq!(answer.headers.iter().filter(|(name, _)| name == "x-twice").map(|(_, value)| value.as_str()).collect::<Vec<_>>(), ["a", "b"]);
        assert!(answer.sent_on_from.is_empty());
        let sent = served.join().expect("the server").remove(0);
        assert!(sent.starts_with("POST /things?x=1 HTTP/1.1\r\n"), "{sent}");
        let lower = sent.to_ascii_lowercase();
        assert!(lower.contains("x-mine: yes\r\n") && lower.contains("content-type: application/json\r\n") && lower.contains("user-agent: syntelab creative\r\n") && lower.contains("accept: */*\r\n"), "{sent}");
        // Nothing of the user or the computer is added: no cookie, no other header that tells them apart.
        assert!(!lower.contains("cookie") && !lower.contains("referer"), "{sent}");
        assert!(sent.ends_with("{\"a\":1}"));
    }

    #[test]
    fn sends_a_file_as_the_body_from_where_it_is() {
        let (address, served) = server(1, |_| "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n".to_owned());
        let path = std::env::temp_dir().join(format!("syntelab-net-body-{}.bin", std::process::id()));
        std::fs::write(&path, "a file of its own").expect("written");
        let mut asked = request("PUT", &format!("{address}/upload"));
        asked.body_file = Some(path.clone());
        let answer = send(&asked, None, 1024, &mut on).expect("answered");
        assert_eq!((answer.status, &answer.body), (204, &Body::Shown(Vec::new())));
        let sent = served.join().expect("the server").remove(0);
        assert!(sent.to_ascii_lowercase().contains("content-length: 17\r\n") && sent.ends_with("a file of its own"), "{sent}");
        std::fs::remove_file(&path).ok();
        asked.body_file = Some(path);
        assert_eq!(send(&asked, None, 10, &mut on).err().map(|error| error.code), Some("cannot-open"));
    }

    #[test]
    fn sends_the_user_agent_the_user_names_and_shows_an_answer_that_is_an_error() {
        let (address, served) = server(1, |_| "HTTP/1.1 404 Not Found\r\nContent-Length: 4\r\nConnection: close\r\n\r\nnope".to_owned());
        let mut asked = request("GET", &address);
        asked.headers = vec![("User-Agent".into(), "mine/1.0".into())];
        let answer = send(&asked, None, 1024, &mut on).expect("answered");
        assert_eq!((answer.status, &answer.body), (404, &Body::Shown(b"nope".to_vec())));
        let sent = served.join().expect("the server").remove(0).to_ascii_lowercase();
        assert!(sent.contains("user-agent: mine/1.0\r\n") && !sent.contains("syntelab"), "{sent}");
    }

    #[test]
    fn follows_where_the_server_points_only_when_asked_to() {
        let pointing = |request: &str| if request.starts_with("GET /old") { "HTTP/1.1 302 Found\r\nLocation: /new\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_owned() } else { "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nnew".to_owned() };
        let (address, served) = server(2, pointing);
        let answer = send(&request("GET", &format!("{address}/old")), None, 1024, &mut on).expect("answered");
        assert_eq!((answer.status, answer.url.as_str(), &answer.body), (200, format!("{address}/new").as_str(), &Body::Shown(b"new".to_vec())));
        assert_eq!(answer.sent_on_from, [format!("{address}/old")]);
        served.join().expect("the server");

        let (address, served) = server(1, pointing);
        let mut asked = request("GET", &format!("{address}/old"));
        asked.redirects = 0;
        let answer = send(&asked, None, 1024, &mut on).expect("answered");
        assert_eq!(answer.status, 302);
        assert!(answer.headers.contains(&("location".to_owned(), "/new".to_owned())));
        served.join().expect("the server");
    }

    #[test]
    fn writes_a_large_answer_to_a_file_and_shows_only_the_start_of_one_without() {
        let large = |_: &str| format!("HTTP/1.1 200 OK\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n{}", "x".repeat(5000));
        let (address, served) = server(1, large);
        let mut file = Vec::new();
        let mut told = Vec::new();
        let answer = send(&request("GET", &address), Some(&mut file), 100, &mut |done, total| {
            told.push((done, total));
            true
        })
        .expect("answered");
        assert_eq!((answer.body, answer.size, file.len()), (Body::Saved, 5000, 5000));
        assert_eq!(told.last(), Some(&(5000, Some(5000))));
        served.join().expect("the server");

        let (address, served) = server(1, large);
        let answer = send(&request("GET", &address), None, 100, &mut on).expect("answered");
        assert_eq!(answer.body, Body::TooLarge(vec![b'x'; 100]));
        served.join().expect("the server");
    }

    #[test]
    fn refuses_what_is_no_request_and_tells_a_server_that_is_not_there() {
        let code = |asked: HttpRequest| send(&asked, None, 10, &mut on).err().map(|error| error.code);
        assert_eq!(code(request("GET", "ftp://example.com/")), Some("bad-url"));
        assert_eq!(code(request("GET", "not an address")), Some("bad-url"));
        assert_eq!(code(request("GET", "/only/a/path")), Some("bad-url"));
        assert_eq!(code(request("G E T", "http://127.0.0.1:9/")), Some("bad-method"));
        let mut bad = request("GET", "http://127.0.0.1:9/");
        bad.headers = vec![("Bad Name".into(), "x".into())];
        assert_eq!(code(bad), Some("bad-header"));
        // A port that was just let go: nothing listens there.
        let free = TcpListener::bind("127.0.0.1:0").expect("a port").local_addr().expect("an address").port();
        assert_eq!(code(request("GET", &format!("http://127.0.0.1:{free}/"))), Some("no-connection"));
    }

    #[test]
    fn stops_reading_when_asked() {
        let (address, served) = server(1, |_| format!("HTTP/1.1 200 OK\r\nContent-Length: 500000\r\nConnection: close\r\n\r\n{}", "x".repeat(500_000)));
        let stopped = send(&request("GET", &address), Some(&mut Vec::new()), 100, &mut |_, _| false).err().map(|error| error.code);
        assert_eq!(stopped, Some("stopped"));
        // The server may find the connection closed under it: that is the stop.
        let _ = served.join();
    }
}
