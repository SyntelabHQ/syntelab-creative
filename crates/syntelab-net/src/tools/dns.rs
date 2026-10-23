//! A question put to a name server, and its answer read.
//!
//! The question is written and the answer read here (RFC 1035), so every
//! kind of record can be asked for, which the system's own way of finding
//! an address does not give. It goes to the name server the computer is set
//! to use, or to one the user names; over UDP, and over TCP when the answer
//! does not fit. Or, when the user chooses so, to a resolver that is asked
//! over HTTPS (RFC 8484): the same question, as the body of a request.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream, UdpSocket};
use std::time::{Duration, Instant};

use super::ToolError;

/// The kinds of record that are asked for, with the number each has.
pub const KINDS: [(&str, u16); 12] = [("A", 1), ("AAAA", 28), ("CNAME", 5), ("MX", 15), ("NS", 2), ("TXT", 16), ("SOA", 6), ("PTR", 12), ("SRV", 33), ("CAA", 257), ("DS", 43), ("DNSKEY", 48)];

/// The number of a kind of record, by its name in any case.
pub fn kind_of(name: &str) -> Option<u16> {
    KINDS.iter().find(|(known, _)| known.eq_ignore_ascii_case(name)).map(|(_, number)| *number)
}

fn kind_name(number: u16) -> String {
    KINDS.iter().find(|(_, known)| *known == number).map(|(name, _)| (*name).to_owned()).unwrap_or_else(|| format!("TYPE{number}"))
}

/// One record of an answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    pub name: String,
    pub kind: String,
    /// How long it may be kept, in seconds.
    pub ttl: u32,
    /// What it says, written as zone files write it.
    pub data: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Answer {
    /// The name that was asked for (an address is asked for by the name its reverse record has).
    pub name: String,
    /// The name server that was asked: its address, or the web address of a resolver asked over HTTPS.
    pub server: String,
    /// `NOERROR`, `NXDOMAIN`, `SERVFAIL`…
    pub code: String,
    pub answers: Vec<Record>,
    /// When there is no answer: who would know (the SOA of the zone).
    pub authority: Vec<Record>,
    /// The server answers for this zone itself, not from what it remembers.
    pub authoritative: bool,
    /// The answer did not fit in one UDP packet and was asked again over TCP.
    pub over_tcp: bool,
    pub ms: u64,
}

/// The name an address is asked for by: `4.3.2.1.in-addr.arpa`, or the nibbles of an IPv6 address under `ip6.arpa`.
pub fn reverse_name(address: IpAddr) -> String {
    match address {
        IpAddr::V4(address) => {
            let [a, b, c, d] = address.octets();
            format!("{d}.{c}.{b}.{a}.in-addr.arpa")
        }
        IpAddr::V6(address) => {
            let mut name = String::with_capacity(72);
            for byte in address.octets().iter().rev() {
                name.push_str(&format!("{:x}.{:x}.", byte & 15, byte >> 4));
            }
            name + "ip6.arpa"
        }
    }
}

/// The question as it is sent: a header, the name as labels, the kind, the class IN.
fn question(id: u16, name: &str, kind: u16) -> Result<Vec<u8>, ToolError> {
    // Recursion desired: the server is asked to find the answer, not only to say what it holds.
    let mut packet = vec![(id >> 8) as u8, id as u8, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0];
    for label in name.trim_end_matches('.').split('.') {
        if label.is_empty() || label.len() > 63 || !label.is_ascii() {
            return Err(ToolError::plain("bad-name"));
        }
        packet.push(label.len() as u8);
        packet.extend_from_slice(label.as_bytes());
    }
    if packet.len() > 12 + 254 {
        return Err(ToolError::plain("bad-name"));
    }
    packet.push(0);
    packet.extend_from_slice(&kind.to_be_bytes());
    packet.extend_from_slice(&[0, 1]);
    Ok(packet)
}

/// Reads an answer: where it is in the packet, moving on as it reads.
struct Reader<'a> {
    packet: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn bytes(&mut self, count: usize) -> Option<&'a [u8]> {
        let bytes = self.packet.get(self.at..self.at.checked_add(count)?)?;
        self.at += count;
        Some(bytes)
    }

    fn u8(&mut self) -> Option<u8> {
        self.bytes(1).map(|bytes| bytes[0])
    }

    fn u16(&mut self) -> Option<u16> {
        self.bytes(2).map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
    }

    fn u32(&mut self) -> Option<u32> {
        self.bytes(4).map(|bytes| u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
    }

    /// A name: labels, the last of which may point back into the packet at labels written before.
    fn name(&mut self) -> Option<String> {
        let mut name = String::new();
        let mut at = self.at;
        let mut jumped = false;
        // A packet that points at itself in a circle is not followed for ever.
        for _ in 0..128 {
            let length = usize::from(*self.packet.get(at)?);
            if length & 0xc0 == 0xc0 {
                let to = (length & 0x3f) << 8 | usize::from(*self.packet.get(at + 1)?);
                if !jumped {
                    self.at = at + 2;
                    jumped = true;
                }
                at = to;
            } else if length == 0 {
                if !jumped {
                    self.at = at + 1;
                }
                return Some(if name.is_empty() { ".".to_owned() } else { name });
            } else {
                let label = self.packet.get(at + 1..at + 1 + length)?;
                if !name.is_empty() {
                    name.push('.');
                }
                // What is no letter of a name is written with its number, as zone files do.
                for &byte in label {
                    if byte.is_ascii_graphic() && byte != b'.' && byte != b'\\' {
                        name.push(char::from(byte));
                    } else {
                        name.push_str(&format!("\\{byte:03}"));
                    }
                }
                at += 1 + length;
            }
        }
        None
    }

    /// A text of a record: bytes with their count before them, written between quotes.
    fn text(&mut self) -> Option<String> {
        let length = usize::from(self.u8()?);
        let mut text = String::from("\"");
        for &byte in self.bytes(length)? {
            match byte {
                b'"' | b'\\' => {
                    text.push('\\');
                    text.push(char::from(byte));
                }
                0x20..=0x7e => text.push(char::from(byte)),
                _ => text.push_str(&format!("\\{byte:03}")),
            }
        }
        text.push('"');
        Some(text)
    }

    fn record(&mut self) -> Option<Record> {
        let name = self.name()?;
        let kind = self.u16()?;
        let _class = self.u16()?;
        let ttl = self.u32()?;
        let length = usize::from(self.u16()?);
        let end = self.at.checked_add(length)?;
        if end > self.packet.len() {
            return None;
        }
        let hex = |bytes: &[u8]| bytes.iter().map(|byte| format!("{byte:02X}")).collect::<String>();
        let data = match kind {
            1 if length == 4 => Ipv4Addr::from(<[u8; 4]>::try_from(self.bytes(4)?).ok()?).to_string(),
            28 if length == 16 => Ipv6Addr::from(<[u8; 16]>::try_from(self.bytes(16)?).ok()?).to_string(),
            2 | 5 | 12 => self.name()?,
            15 => format!("{} {}", self.u16()?, self.name()?),
            6 => format!("{} {} {} {} {} {} {}", self.name()?, self.name()?, self.u32()?, self.u32()?, self.u32()?, self.u32()?, self.u32()?),
            33 => format!("{} {} {} {}", self.u16()?, self.u16()?, self.u16()?, self.name()?),
            16 => {
                let mut texts = Vec::new();
                while self.at < end {
                    texts.push(self.text()?);
                }
                texts.join(" ")
            }
            257 => {
                let flags = self.u8()?;
                let tag_length = usize::from(self.u8()?);
                let tag = String::from_utf8_lossy(self.bytes(tag_length)?).into_owned();
                let value = String::from_utf8_lossy(self.bytes(end.checked_sub(self.at)?)?).into_owned();
                format!("{flags} {tag} \"{value}\"")
            }
            43 if length >= 4 => format!("{} {} {} {}", self.u16()?, self.u8()?, self.u8()?, hex(self.bytes(end - self.at)?)),
            _ => format!("\\# {length} {}", hex(self.bytes(length)?)),
        };
        // Whatever a record held beyond what was read of it is passed over.
        self.at = end;
        Some(Record { name, kind: kind_name(kind), ttl, data })
    }
}

/// What a packet of answer says. `truncated` when it did not fit and must be asked for again over TCP.
struct Parsed {
    code: u8,
    authoritative: bool,
    truncated: bool,
    answers: Vec<Record>,
    authority: Vec<Record>,
}

fn parse(packet: &[u8], id: u16) -> Option<Parsed> {
    let mut reader = Reader { packet, at: 0 };
    if reader.u16()? != id {
        return None;
    }
    let flags = reader.u16()?;
    // Not an answer.
    if flags & 0x8000 == 0 {
        return None;
    }
    let (questions, answers, authority) = (reader.u16()?, reader.u16()?, reader.u16()?);
    reader.u16()?;
    for _ in 0..questions {
        reader.name()?;
        reader.bytes(4)?;
    }
    let truncated = flags & 0x0200 != 0;
    let mut read = |count: u16| -> Option<Vec<Record>> {
        let mut records = Vec::new();
        for _ in 0..count {
            match reader.record() {
                Some(record) => records.push(record),
                // A packet cut short gives what it has.
                None if truncated => break,
                None => return None,
            }
        }
        Some(records)
    };
    let answers = read(answers)?;
    let authority = if truncated { Vec::new() } else { read(authority)? };
    Some(Parsed { code: (flags & 15) as u8, authoritative: flags & 0x0400 != 0, truncated, answers, authority })
}

fn code_name(code: u8) -> String {
    match code {
        0 => "NOERROR".to_owned(),
        1 => "FORMERR".to_owned(),
        2 => "SERVFAIL".to_owned(),
        3 => "NXDOMAIN".to_owned(),
        4 => "NOTIMP".to_owned(),
        5 => "REFUSED".to_owned(),
        other => format!("RCODE{other}"),
    }
}

fn timed_out(error: &std::io::Error) -> bool {
    matches!(error.kind(), std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock)
}

fn over_udp(server: SocketAddr, question: &[u8], timeout: Duration) -> Result<Vec<u8>, ToolError> {
    let here: SocketAddr = if server.is_ipv4() { (Ipv4Addr::UNSPECIFIED, 0).into() } else { (Ipv6Addr::UNSPECIFIED, 0).into() };
    let socket = UdpSocket::bind(here).map_err(|error| ToolError::new("failed", error))?;
    socket.set_read_timeout(Some(timeout)).map_err(|error| ToolError::new("failed", error))?;
    // Only what this server sends is taken.
    socket.connect(server).map_err(|error| ToolError::new("no-server", error))?;
    socket.send(question).map_err(|error| ToolError::new("no-server", error))?;
    let mut answer = vec![0u8; 65_535];
    let length = socket.recv(&mut answer).map_err(|error| if timed_out(&error) { ToolError::plain("timeout") } else { ToolError::new("no-server", error) })?;
    answer.truncate(length);
    Ok(answer)
}

fn over_tcp(server: SocketAddr, question: &[u8], timeout: Duration) -> Result<Vec<u8>, ToolError> {
    let failed = |error: std::io::Error| if timed_out(&error) { ToolError::plain("timeout") } else { ToolError::new("no-server", error) };
    let mut stream = TcpStream::connect_timeout(&server, timeout).map_err(failed)?;
    stream.set_read_timeout(Some(timeout)).map_err(failed)?;
    stream.set_write_timeout(Some(timeout)).map_err(failed)?;
    // Over TCP a message has its length before it.
    let mut framed = (question.len() as u16).to_be_bytes().to_vec();
    framed.extend_from_slice(question);
    stream.write_all(&framed).map_err(failed)?;
    let mut length = [0u8; 2];
    stream.read_exact(&mut length).map_err(failed)?;
    let mut answer = vec![0u8; usize::from(u16::from_be_bytes(length))];
    stream.read_exact(&mut answer).map_err(failed)?;
    Ok(answer)
}

/// Asks a name server for the records of one kind that a name has. `name` may be an address when what is asked
/// for is its name (PTR). `server` is the one to ask, at its port 53 unless `port` says otherwise.
pub fn ask(name: &str, kind: u16, server: IpAddr, port: u16, timeout: Duration) -> Result<Answer, ToolError> {
    let name = match (kind, name.trim().parse::<IpAddr>()) {
        (12, Ok(address)) => reverse_name(address),
        _ => name.trim().trim_end_matches('.').to_ascii_lowercase(),
    };
    // A number no one can guess, so an answer that is not to this question is told apart.
    let id = RandomState::new().build_hasher().finish() as u16;
    let question = question(id, &name, kind)?;
    let server_at = SocketAddr::new(server, port);
    let started = Instant::now();
    let mut over_tcp_too = false;
    let mut parsed = parse(&over_udp(server_at, &question, timeout)?, id).ok_or_else(|| ToolError::plain("bad-answer"))?;
    if parsed.truncated {
        over_tcp_too = true;
        parsed = parse(&over_tcp(server_at, &question, timeout)?, id).ok_or_else(|| ToolError::plain("bad-answer"))?;
    }
    Ok(Answer { name, server: server.to_string(), code: code_name(parsed.code), answers: parsed.answers, authority: parsed.authority, authoritative: parsed.authoritative, over_tcp: over_tcp_too, ms: started.elapsed().as_millis() as u64 })
}

/// Asks a resolver over HTTPS (RFC 8484): the question is the body of a POST to its address, the answer the body
/// that comes back. Nothing else is in the request but what says the two are DNS messages.
pub fn ask_over_https(name: &str, kind: u16, resolver: &str, timeout: Duration) -> Result<Answer, ToolError> {
    use super::http::{send, Body, HttpRequest};
    if !resolver.starts_with("https://") {
        return Err(ToolError::plain("bad-server"));
    }
    let name = match (kind, name.trim().parse::<IpAddr>()) {
        (12, Ok(address)) => reverse_name(address),
        _ => name.trim().trim_end_matches('.').to_ascii_lowercase(),
    };
    // Over HTTPS the number of a question is 0, so the same question has the same bytes (and can be kept by a cache).
    let question = question(0, &name, kind)?;
    let request = HttpRequest {
        method: "POST".into(),
        url: resolver.to_owned(),
        headers: vec![("content-type".into(), "application/dns-message".into()), ("accept".into(), "application/dns-message".into())],
        body: Some(question),
        body_file: None,
        redirects: 0,
        verify_tls: true,
        timeout: Some(timeout),
    };
    let started = Instant::now();
    let response = send(&request, None, 65_535, &mut |_, _| true)?;
    let Body::Shown(packet) = response.body else {
        return Err(ToolError::plain("bad-answer"));
    };
    if response.status != 200 {
        return Err(ToolError::new("no-server", format!("{} {}", response.status, response.reason)));
    }
    let parsed = parse(&packet, 0).ok_or_else(|| ToolError::plain("bad-answer"))?;
    Ok(Answer { name, server: resolver.to_owned(), code: code_name(parsed.code), answers: parsed.answers, authority: parsed.authority, authoritative: parsed.authoritative, over_tcp: false, ms: started.elapsed().as_millis() as u64 })
}

/// The name servers the computer is set to use, in the order the system has them.
pub fn system_servers() -> Vec<IpAddr> {
    let mut servers = system::servers();
    // Addresses Windows lists for a network that has no name server of its own, which nothing answers at.
    servers.retain(|address| !matches!(address, IpAddr::V6(v6) if v6.segments()[0] == 0xfec0));
    let mut once = Vec::new();
    for server in servers {
        if !once.contains(&server) {
            once.push(server);
        }
    }
    once
}

#[cfg(windows)]
mod system {
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, ERROR_SUCCESS};
    use windows::Win32::NetworkManagement::IpHelper::{GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_FRIENDLY_NAME, GAA_FLAG_SKIP_MULTICAST, GAA_FLAG_SKIP_UNICAST, IP_ADAPTER_ADDRESSES_LH};
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6, AF_UNSPEC, SOCKADDR_IN, SOCKADDR_IN6};

    pub fn servers() -> Vec<IpAddr> {
        let flags = GAA_FLAG_SKIP_UNICAST | GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_FRIENDLY_NAME;
        let mut size = 16 * 1024u32;
        let mut found = Vec::new();
        for _ in 0..4 {
            // Kept in whole 64-bit words, so what the system writes there stands where its structures must.
            let mut room = vec![0u64; (size as usize).div_ceil(8)];
            let first = room.as_mut_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>();
            // SAFETY: `room` is at least `size` bytes, and the system says in `size` how many it needs when that is more.
            let answer = unsafe { GetAdaptersAddresses(u32::from(AF_UNSPEC.0), flags, None, Some(first), &mut size) };
            if answer == ERROR_BUFFER_OVERFLOW.0 {
                continue;
            }
            if answer != ERROR_SUCCESS.0 {
                break;
            }
            let mut adapter = first.cast_const();
            // SAFETY: the system filled `room` with a list of adapters, each pointing at the next or at nothing; every
            // pointer read here lies in `room`, which lives until the end of this turn of the loop.
            unsafe {
                while let Some(known) = adapter.as_ref() {
                    if known.OperStatus == IfOperStatusUp {
                        let mut server = known.FirstDnsServerAddress;
                        while let Some(listed) = server.as_ref() {
                            if let Some(address) = listed.Address.lpSockaddr.as_ref() {
                                if address.sa_family == AF_INET {
                                    let v4 = &*listed.Address.lpSockaddr.cast::<SOCKADDR_IN>();
                                    found.push(IpAddr::V4(Ipv4Addr::from(v4.sin_addr.S_un.S_addr.to_ne_bytes())));
                                } else if address.sa_family == AF_INET6 {
                                    let v6 = &*listed.Address.lpSockaddr.cast::<SOCKADDR_IN6>();
                                    found.push(IpAddr::V6(Ipv6Addr::from(v6.sin6_addr.u.Byte)));
                                }
                            }
                            server = listed.Next;
                        }
                    }
                    adapter = known.Next;
                }
            }
            break;
        }
        found
    }
}

#[cfg(not(windows))]
mod system {
    use std::net::IpAddr;

    /// The `nameserver` lines of `/etc/resolv.conf`.
    pub fn servers() -> Vec<IpAddr> {
        std::fs::read_to_string("/etc/resolv.conf")
            .map(|text| text.lines().filter_map(|line| line.trim().strip_prefix("nameserver")).filter_map(|address| address.trim().split('%').next()?.parse().ok()).collect())
            .unwrap_or_default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// An answer to `example.com A`, as a server writes it: the name of the answer points back at the question.
    fn answer(id: u16, flags: u16, records: &[&[u8]]) -> Vec<u8> {
        let mut packet = question(id, "example.com", 1).expect("a question");
        packet[2] = (flags >> 8) as u8;
        packet[3] = flags as u8;
        packet[7] = records.len() as u8;
        for record in records {
            packet.extend_from_slice(record);
        }
        packet
    }

    #[test]
    fn writes_a_question_as_the_standard_says() {
        let packet = question(0x1234, "Example.com.", 28).expect("a question");
        assert_eq!(packet, [0x12, 0x34, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 7, b'E', b'x', b'a', b'm', b'p', b'l', b'e', 3, b'c', b'o', b'm', 0, 0, 28, 0, 1]);
        assert_eq!(question(1, "a..b", 1).err().map(|error| error.code), Some("bad-name"));
        assert_eq!(question(1, &"a".repeat(64), 1).err().map(|error| error.code), Some("bad-name"));
        assert_eq!(question(1, "bücher.example", 1).err().map(|error| error.code), Some("bad-name"));
    }

    #[test]
    fn reads_records_of_each_kind() {
        // The name as a pointer to the question (offset 12), then kind, class, how long, length, data.
        let a: &[u8] = &[0xc0, 12, 0, 1, 0, 1, 0, 0, 1, 44, 0, 4, 93, 184, 216, 34];
        let mx: &[u8] = &[0xc0, 12, 0, 15, 0, 1, 0, 0, 0, 60, 0, 9, 0, 10, 4, b'm', b'a', b'i', b'l', 0xc0, 12];
        let txt: &[u8] = &[0xc0, 12, 0, 16, 0, 1, 0, 0, 0, 60, 0, 10, 4, b'v', b'=', b'"', b'1', 4, b'a', b' ', b'b', 0xff];
        let caa: &[u8] = &[0xc0, 12, 1, 1, 0, 1, 0, 0, 0, 60, 0, 12, 0, 5, b'i', b's', b's', b'u', b'e', b'l', b'e', b'.', b'o', b'r'];
        let odd: &[u8] = &[0xc0, 12, 0, 99, 0, 1, 0, 0, 0, 60, 0, 2, 0xab, 0xcd];
        let parsed = parse(&answer(7, 0x8580, &[a, mx, txt, caa, odd]), 7).expect("parsed");
        assert!(parsed.authoritative && !parsed.truncated);
        assert_eq!(parsed.code, 0);
        let told: Vec<_> = parsed.answers.iter().map(|record| (record.kind.as_str(), record.ttl, record.data.as_str())).collect();
        assert_eq!(told, [("A", 300, "93.184.216.34"), ("MX", 60, "10 mail.example.com"), ("TXT", 60, "\"v=\\\"1\" \"a b\\255\""), ("CAA", 60, "0 issue \"le.or\""), ("TYPE99", 60, "\\# 2 ABCD")]);
        assert_eq!(parsed.answers[0].name, "example.com");
    }

    #[test]
    fn refuses_an_answer_that_is_not_to_the_question_or_is_broken() {
        let a: &[u8] = &[0xc0, 12, 0, 1, 0, 1, 0, 0, 1, 44, 0, 4, 93, 184, 216, 34];
        assert!(parse(&answer(7, 0x8180, &[a]), 8).is_none());
        // Not marked as an answer.
        assert!(parse(&answer(7, 0x0100, &[a]), 7).is_none());
        // Cut in the middle of a record.
        let cut = answer(7, 0x8180, &[a]);
        assert!(parse(&cut[..cut.len() - 2], 7).is_none());
        // A name that points at itself.
        let circle: &[u8] = &[0xc0, 29, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0];
        assert!(parse(&answer(7, 0x8180, &[circle]), 7).is_none());
        // No such name: the code says so.
        assert_eq!(parse(&answer(7, 0x8183, &[]), 7).map(|parsed| code_name(parsed.code)), Some("NXDOMAIN".to_owned()));
    }

    #[test]
    fn asks_a_server_over_udp_and_again_over_tcp_when_the_answer_does_not_fit() {
        // A port that is free for both: the number the system gives for UDP may be taken for TCP by something else.
        let (udp, tcp, port) = (0..50)
            .find_map(|_| {
                let udp = UdpSocket::bind("127.0.0.1:0").ok()?;
                let port = udp.local_addr().ok()?.port();
                let tcp = std::net::TcpListener::bind(("127.0.0.1", port)).ok()?;
                Some((udp, tcp, port))
            })
            .expect("a port free for both");
        let a: &[u8] = &[0xc0, 12, 0, 1, 0, 1, 0, 0, 1, 44, 0, 4, 10, 1, 2, 3];
        let server = std::thread::spawn(move || {
            let mut asked = [0u8; 512];
            let (length, from) = udp.recv_from(&mut asked).expect("asked");
            let id = u16::from_be_bytes([asked[0], asked[1]]);
            assert_eq!(&asked[12..length], &question(id, "example.com", 1).expect("a question")[12..]);
            // Truncated: ask again over TCP.
            udp.send_to(&answer(id, 0x8380, &[]), from).expect("answered");
            let (mut stream, _) = tcp.accept().expect("asked again");
            let mut framed = [0u8; 2];
            stream.read_exact(&mut framed).expect("a length");
            let mut asked = vec![0u8; usize::from(u16::from_be_bytes(framed))];
            stream.read_exact(&mut asked).expect("a question");
            let whole = answer(id, 0x8180, &[a]);
            stream.write_all(&(whole.len() as u16).to_be_bytes()).expect("answered");
            stream.write_all(&whole).expect("answered");
        });
        let answer = ask("Example.COM.", 1, IpAddr::from([127, 0, 0, 1]), port, Duration::from_secs(5)).expect("answered");
        server.join().expect("the server");
        assert!(answer.over_tcp);
        assert_eq!((answer.name.as_str(), answer.code.as_str()), ("example.com", "NOERROR"));
        assert_eq!(answer.answers, [Record { name: "example.com".into(), kind: "A".into(), ttl: 300, data: "10.1.2.3".into() }]);
    }

    #[test]
    fn asks_a_resolver_over_https_only_at_a_secure_address() {
        assert_eq!(ask_over_https("example.com", 1, "http://127.0.0.1/dns-query", Duration::from_secs(1)).err().map(|error| error.code), Some("bad-server"));
        assert_eq!(ask_over_https("a..b", 1, "https://127.0.0.1/dns-query", Duration::from_secs(1)).err().map(|error| error.code), Some("bad-name"));
    }

    #[test]
    fn asks_for_an_address_by_its_reverse_name() {
        assert_eq!(reverse_name(IpAddr::from([192, 0, 2, 1])), "1.2.0.192.in-addr.arpa");
        assert_eq!(reverse_name("2001:db8::1".parse().expect("an address")), "1.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.8.b.d.0.1.0.0.2.ip6.arpa");
        assert_eq!(kind_of("aaaa"), Some(28));
        assert_eq!(kind_of("nope"), None);
    }

    #[test]
    fn lists_the_name_servers_of_the_computer_without_falling() {
        // What they are depends on the computer; that the list can be read is what is checked.
        let _ = system_servers();
    }
}
