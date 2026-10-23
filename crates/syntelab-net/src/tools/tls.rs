//! The certificates a site shows when a secure connection is made to it.
//!
//! A connection is opened and the handshake of TLS done, and nothing more:
//! no request is sent. A service that begins in the clear and is asked to go
//! over to TLS (mail servers, FTP) is asked so first, in the few words its
//! protocol has for it, and nothing else is said to it. The certificates are taken as the site gave them,
//! whether or not they can be trusted, and whether the computer trusts them
//! is told beside them, with the reason when it does not.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, ClientConnection, DigitallySignedStruct, SignatureScheme};

use super::{is_host, ToolError};

/// What a site showed.
#[derive(Debug)]
pub struct SiteCertificates {
    /// The address the connection was made to.
    pub address: SocketAddr,
    /// `TLSv1_3`
    pub protocol: String,
    pub cipher: String,
    /// The protocol the two agreed to speak over the connection (`h2`, `http/1.1`), when they did.
    pub alpn: Option<String>,
    /// The certificates in DER, the site's own first.
    pub chain: Vec<Vec<u8>>,
    /// Why the computer does not trust them (in English, as the library says it); none when it does.
    pub not_trusted: Option<String>,
    pub ms: u64,
}

/// How a connection comes to TLS.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Begin {
    /// TLS from the first byte (HTTPS, and the ports of mail that are TLS throughout).
    Tls,
    /// In the clear first, then asked to go over to TLS, as each protocol asks it.
    Smtp,
    Imap,
    Pop3,
    Ftp,
}

impl Begin {
    /// By its name in any case; `auto` goes by the port.
    pub fn of(name: &str, port: u16) -> Option<Begin> {
        Some(match name.to_ascii_lowercase().as_str() {
            "tls" => Begin::Tls,
            "smtp" => Begin::Smtp,
            "imap" => Begin::Imap,
            "pop3" => Begin::Pop3,
            "ftp" => Begin::Ftp,
            "" | "auto" => match port {
                25 | 587 => Begin::Smtp,
                143 => Begin::Imap,
                110 => Begin::Pop3,
                21 => Begin::Ftp,
                _ => Begin::Tls,
            },
            _ => return None,
        })
    }
}

/// The most that is read of what a service says in the clear before TLS.
const CLEAR_MOST: usize = 64 * 1024;

/// Reads lines until one begins with one of `ends` (the last line of an answer). An answer that says no (a line
/// that begins with one of `refuses`) ends the reading too, as a refusal.
fn read_until(stream: &mut TcpStream, ends: &[&str], refuses: &[&str]) -> Result<(), ToolError> {
    let mut read = Vec::new();
    let mut byte = [0u8; 1];
    let mut line_start = 0;
    loop {
        match stream.read(&mut byte) {
            Ok(0) => return Err(ToolError::plain("no-starttls")),
            Ok(_) => read.push(byte[0]),
            Err(error) if matches!(error.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock) => return Err(ToolError::plain("timeout")),
            Err(error) => return Err(ToolError::new("no-connection", error)),
        }
        if read.len() > CLEAR_MOST {
            return Err(ToolError::plain("no-starttls"));
        }
        if byte[0] == b'\n' {
            let line = String::from_utf8_lossy(&read[line_start..]).trim_end().to_owned();
            line_start = read.len();
            let upper = line.to_ascii_uppercase();
            if ends.iter().any(|end| upper.starts_with(end)) {
                return Ok(());
            }
            if refuses.iter().any(|refuse| upper.starts_with(refuse)) {
                return Err(ToolError::new("no-starttls", line));
            }
        }
    }
}

/// Asks a service that begins in the clear to go over to TLS. Only what its protocol needs is said.
fn go_over(stream: &mut TcpStream, begin: Begin) -> Result<(), ToolError> {
    let say = |stream: &mut TcpStream, words: &str| stream.write_all(words.as_bytes()).map_err(|error| ToolError::new("no-connection", error));
    match begin {
        Begin::Tls => {}
        Begin::Smtp => {
            read_until(stream, &["220 "], &["4", "5"])?;
            // The name every computer has for itself: it tells nothing of this one.
            say(stream, "EHLO localhost\r\n")?;
            read_until(stream, &["250 "], &["4", "5"])?;
            say(stream, "STARTTLS\r\n")?;
            read_until(stream, &["220 "], &["4", "5"])?;
        }
        Begin::Imap => {
            read_until(stream, &["* OK", "* PREAUTH"], &["* BYE"])?;
            say(stream, "a1 STARTTLS\r\n")?;
            read_until(stream, &["A1 OK"], &["A1 NO", "A1 BAD", "* BYE"])?;
        }
        Begin::Pop3 => {
            read_until(stream, &["+OK"], &["-ERR"])?;
            say(stream, "STLS\r\n")?;
            read_until(stream, &["+OK"], &["-ERR"])?;
        }
        Begin::Ftp => {
            read_until(stream, &["220 "], &["4", "5"])?;
            say(stream, "AUTH TLS\r\n")?;
            read_until(stream, &["234 "], &["4", "5"])?;
        }
    }
    Ok(())
}

/// Lets the handshake go on whatever the certificates are, and keeps what the computer's own check said of them.
#[derive(Debug)]
struct Recording {
    trusting: Arc<dyn ServerCertVerifier>,
    said: Mutex<Option<String>>,
}

impl ServerCertVerifier for Recording {
    fn verify_server_cert(&self, end_entity: &CertificateDer<'_>, intermediates: &[CertificateDer<'_>], server_name: &ServerName<'_>, ocsp_response: &[u8], now: UnixTime) -> Result<ServerCertVerified, rustls::Error> {
        if let Err(error) = self.trusting.verify_server_cert(end_entity, intermediates, server_name, ocsp_response, now) {
            if let Ok(mut said) = self.said.lock() {
                *said = Some(error.to_string());
            }
        }
        Ok(ServerCertVerified::assertion())
    }

    // That the site holds the key of its certificate is still checked: it is what makes the certificate the site's.
    fn verify_tls12_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.trusting.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(&self, message: &[u8], cert: &CertificateDer<'_>, dss: &DigitallySignedStruct) -> Result<HandshakeSignatureValid, rustls::Error> {
        self.trusting.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.trusting.supported_verify_schemes()
    }
}

/// Connects to a host at a port, does the handshake of TLS, and gives the certificates the site showed.
/// `name` is the name asked for in the handshake when it is not the host (a site behind an address). `begin`: how
/// the connection comes to TLS.
pub fn certificates(host: &str, port: u16, name: Option<&str>, begin: Begin, timeout: Duration) -> Result<SiteCertificates, ToolError> {
    let host = host.trim().trim_start_matches('[').trim_end_matches(']');
    let asked = name.map(str::trim).filter(|name| !name.is_empty()).unwrap_or(host);
    if !is_host(host) || !is_host(asked) {
        return Err(ToolError::plain("bad-host"));
    }
    let address = (host, port).to_socket_addrs().map_err(|error| ToolError::new("no-such-host", error))?.next().ok_or_else(|| ToolError::plain("no-such-host"))?;
    let server_name = ServerName::try_from(asked.to_owned()).map_err(|_| ToolError::plain("bad-host"))?;

    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let trusting: Arc<dyn ServerCertVerifier> = Arc::new(rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|error| ToolError::new("failed", error))?);
    let recording = Arc::new(Recording { trusting, said: Mutex::new(None) });
    let mut config = ClientConfig::builder_with_provider(provider as Arc<CryptoProvider>)
        .with_safe_default_protocol_versions()
        .map_err(|error| ToolError::new("failed", error))?
        .dangerous()
        .with_custom_certificate_verifier(recording.clone())
        .with_no_client_auth();
    // What a browser would offer: the answer tells which the site speaks.
    config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    let started = Instant::now();
    let failed = |error: std::io::Error| match error.kind() {
        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => ToolError::plain("timeout"),
        std::io::ErrorKind::ConnectionRefused => ToolError::new("no-connection", error),
        // What TLS itself found wrong comes wrapped as this.
        std::io::ErrorKind::InvalidData | std::io::ErrorKind::UnexpectedEof => ToolError::new("not-tls", error),
        _ => ToolError::new("no-connection", error),
    };
    let mut stream = TcpStream::connect_timeout(&address, timeout).map_err(failed)?;
    stream.set_read_timeout(Some(timeout)).map_err(failed)?;
    stream.set_write_timeout(Some(timeout)).map_err(failed)?;
    go_over(&mut stream, begin)?;
    let mut connection = ClientConnection::new(Arc::new(config), server_name).map_err(|error| ToolError::new("failed", error))?;
    while connection.is_handshaking() {
        connection.complete_io(&mut stream).map_err(failed)?;
    }
    let chain: Vec<Vec<u8>> = connection.peer_certificates().unwrap_or_default().iter().map(|certificate| certificate.as_ref().to_vec()).collect();
    let protocol = connection.protocol_version().map(|version| format!("{version:?}")).unwrap_or_default();
    let cipher = connection.negotiated_cipher_suite().map(|suite| format!("{:?}", suite.suite())).unwrap_or_default();
    let alpn = connection.alpn_protocol().map(|protocol| String::from_utf8_lossy(protocol).into_owned());
    // The connection is ended as TLS asks; whether the site hears it is no matter.
    connection.send_close_notify();
    let _ = connection.write_tls(&mut stream);
    let _ = stream.flush();
    let _ = stream.read(&mut [0u8; 1]);

    if chain.is_empty() {
        return Err(ToolError::plain("not-tls"));
    }
    let not_trusted = recording.said.lock().ok().and_then(|said| said.clone());
    Ok(SiteCertificates { address, protocol, cipher, alpn, chain, not_trusted, ms: started.elapsed().as_millis() as u64 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn refuses_what_is_no_host_and_tells_what_does_not_speak_tls() {
        let code = |host: &str, port: u16| certificates(host, port, None, Begin::Tls, Duration::from_secs(3)).err().map(|error| error.code);
        assert_eq!(code("not a host", 443), Some("bad-host"));
        assert_eq!(code("example.com/path", 443), Some("bad-host"));
        // Something that listens and says what no TLS says.
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("an address").port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a connection");
            let _ = stream.read(&mut [0u8; 512]);
            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        });
        assert_eq!(code("127.0.0.1", port), Some("not-tls"));
        server.join().expect("the server");
        // Nothing listens.
        let free = TcpListener::bind("127.0.0.1:0").expect("a port").local_addr().expect("an address").port();
        assert_eq!(code("127.0.0.1", free), Some("no-connection"));
    }

    #[test]
    fn asks_a_mail_server_to_go_over_to_tls_in_its_own_words() {
        use std::io::{BufRead, BufReader};
        // A server that speaks SMTP as far as STARTTLS, and then says what no TLS says.
        let serve = |agrees: bool| {
            let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
            let port = listener.local_addr().expect("an address").port();
            let server = std::thread::spawn(move || {
                let (stream, _) = listener.accept().expect("a connection");
                let mut reader = BufReader::new(stream);
                let mut heard = Vec::new();
                reader.get_mut().write_all(b"220-mail.test ESMTP\r\n220 ready\r\n").expect("said");
                let mut line = String::new();
                reader.read_line(&mut line).expect("heard");
                heard.push(line.trim().to_owned());
                reader.get_mut().write_all(b"250-mail.test\r\n250-SIZE 100\r\n250 STARTTLS\r\n").expect("said");
                line.clear();
                reader.read_line(&mut line).expect("heard");
                heard.push(line.trim().to_owned());
                reader.get_mut().write_all(if agrees { b"220 go ahead\r\n" } else { b"454 not now.\r\n" }).expect("said");
                if agrees {
                    let _ = reader.get_mut().read(&mut [0u8; 512]);
                    let _ = reader.get_mut().write_all(b"this is not TLS\r\n");
                }
                heard
            });
            (port, server)
        };
        let (port, server) = serve(true);
        assert_eq!(certificates("127.0.0.1", port, None, Begin::Smtp, Duration::from_secs(3)).err().map(|error| error.code), Some("not-tls"));
        assert_eq!(server.join().expect("the server"), ["EHLO localhost", "STARTTLS"]);
        let (port, server) = serve(false);
        let refused = certificates("127.0.0.1", port, None, Begin::Smtp, Duration::from_secs(3)).expect_err("refused");
        assert_eq!((refused.code, refused.detail.as_str()), ("no-starttls", "454 not now."));
        server.join().expect("the server");
        assert_eq!((Begin::of("auto", 587), Begin::of("", 443), Begin::of("IMAP", 1), Begin::of("nope", 1)), (Some(Begin::Smtp), Some(Begin::Tls), Some(Begin::Imap), None));
    }
}
