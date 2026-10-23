//! Whether ports of a host take connections (TCP).
//!
//! Each port is tried with one connection, closed as soon as it is made:
//! nothing is sent over it. Many ports are tried side by side, and the
//! trying can be stopped.

use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use super::{is_host, ToolError};

/// How a port answered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// A connection was made.
    Open,
    /// The host refused the connection: nothing listens there.
    Closed,
    /// No answer in the time given: something on the way drops what is sent there, or the host is not there.
    NoAnswer,
    /// The system could not try (no way to the host, no right to).
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Checked {
    pub port: u16,
    pub state: State,
    /// How long the answer took, in milliseconds.
    pub ms: u64,
}

/// The host as it was found, and how its ports answered, in the order they were asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// The address that was tried: the first the name has.
    pub address: IpAddr,
    /// Every address the name has.
    pub addresses: Vec<IpAddr>,
    pub ports: Vec<Checked>,
    pub stopped: bool,
}

/// The most ports tried at the same moment.
const SIDE_BY_SIDE: usize = 512;

/// Ports as they are typed: numbers and ranges, with commas or spaces between (`22, 80, 443, 8000-8010`).
/// Each port once, in the order it is first named. None when something is no port.
pub fn ports_of(typed: &str) -> Option<Vec<u16>> {
    let mut ports = Vec::new();
    let mut seen = vec![false; 65_536];
    for part in typed.split(|letter: char| letter == ',' || letter == ';' || letter.is_whitespace()).filter(|part| !part.is_empty()) {
        let (from, to) = match part.split_once('-') {
            Some((from, to)) => (from.trim().parse::<u16>().ok()?, to.trim().parse::<u16>().ok()?),
            None => {
                let port = part.parse::<u16>().ok()?;
                (port, port)
            }
        };
        if from == 0 || to < from {
            return None;
        }
        for port in from..=to {
            if !std::mem::replace(&mut seen[usize::from(port)], true) {
                ports.push(port);
            }
        }
    }
    (!ports.is_empty()).then_some(ports)
}

fn one(address: IpAddr, port: u16, timeout: Duration) -> Checked {
    let started = Instant::now();
    let state = match TcpStream::connect_timeout(&SocketAddr::new(address, port), timeout) {
        Ok(_) => State::Open,
        Err(error) => match error.kind() {
            std::io::ErrorKind::ConnectionRefused => State::Closed,
            std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock => State::NoAnswer,
            _ => State::Failed,
        },
    };
    Checked { port, state, ms: started.elapsed().as_millis() as u64 }
}

/// Tries each of the ports of a host. `watch` is told how many are done, and stops the trying by answering false.
pub fn check(host: &str, ports: &[u16], timeout: Duration, watch: &mut dyn FnMut(usize) -> bool) -> Result<Check, ToolError> {
    if !is_host(host) {
        return Err(ToolError::plain("bad-host"));
    }
    let name = host.trim_start_matches('[').trim_end_matches(']');
    let addresses: Vec<IpAddr> = (name, 0).to_socket_addrs().map_err(|error| ToolError::new("no-such-host", error))?.map(|address| address.ip()).collect();
    let address = *addresses.first().ok_or_else(|| ToolError::plain("no-such-host"))?;

    let next = AtomicUsize::new(0);
    let stop = AtomicBool::new(false);
    let mut found: Vec<Option<Checked>> = vec![None; ports.len()];
    let mut stopped = false;
    std::thread::scope(|scope| {
        let (send, receive) = mpsc::channel::<(usize, Checked)>();
        for _ in 0..ports.len().min(SIDE_BY_SIDE) {
            let send = send.clone();
            let (next, stop) = (&next, &stop);
            scope.spawn(move || loop {
                let index = next.fetch_add(1, Ordering::Relaxed);
                if index >= ports.len() || stop.load(Ordering::Relaxed) {
                    break;
                }
                if send.send((index, one(address, ports[index], timeout))).is_err() {
                    break;
                }
            });
        }
        drop(send);
        let mut done = 0;
        for (index, checked) in receive {
            found[index] = Some(checked);
            done += 1;
            if !watch(done) {
                stopped = true;
                stop.store(true, Ordering::Relaxed);
            }
        }
    });
    Ok(Check { address, addresses, ports: found.into_iter().flatten().collect(), stopped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn reads_ports_as_they_are_typed() {
        assert_eq!(ports_of("22, 80,443"), Some(vec![22, 80, 443]));
        assert_eq!(ports_of("8000-8003 80 8002"), Some(vec![8000, 8001, 8002, 8003, 80]));
        assert_eq!(ports_of("1-65535").map(|ports| ports.len()), Some(65_535));
        for wrong in ["", "http", "0", "70000", "90-80", "80-", "-80"] {
            assert_eq!(ports_of(wrong), None, "{wrong}");
        }
    }

    #[test]
    fn tells_a_port_that_listens_from_one_that_does_not() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let open = listener.local_addr().expect("an address").port();
        // A port that was just let go: nothing listens there.
        let closed = TcpListener::bind("127.0.0.1:0").expect("a port").local_addr().expect("an address").port();
        let check = check("127.0.0.1", &[open, closed], Duration::from_secs(3), &mut |_| true).expect("checked");
        assert_eq!(check.address, IpAddr::from([127, 0, 0, 1]));
        assert_eq!(check.ports.iter().map(|port| (port.port, port.state)).collect::<Vec<_>>(), [(open, State::Open), (closed, State::Closed)]);
        assert!(!check.stopped);
        assert_eq!(super::check("not a host", &[80], Duration::from_secs(1), &mut |_| true).err().map(|error| error.code), Some("bad-host"));
    }

    #[test]
    fn stops_when_asked() {
        let ports: Vec<u16> = (20_000..22_000).collect();
        let check = check("127.0.0.1", &ports, Duration::from_millis(200), &mut |done| done < 5).expect("checked");
        assert!(check.stopped);
        assert!(check.ports.len() < ports.len());
    }
}
