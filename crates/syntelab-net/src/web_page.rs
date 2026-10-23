//! A web page the user asked for, saved as a PDF or read as its source: the
//! one time the program goes to an address that is not syntelab.com, and only
//! because the user typed that address and asked for the page.
//!
//! The page is fetched and laid out by the browser already installed on the
//! computer (Microsoft Edge on Windows; Chrome, Chromium or Edge elsewhere),
//! run without a window and with a profile of its own that is thrown away
//! afterwards: no cookies, no history, nothing of the user's own browser is
//! read or left behind. The program itself sends nothing.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::NetError;

/// A page that takes longer than this is given up on.
const TIME_LIMIT: Duration = Duration::from_secs(90);
/// How long a browser that has left may still be writing the file before it counts as failed.
const GIVE_UP_AFTER_LEAVING: Duration = Duration::from_secs(45);
/// Longer addresses than this are not real ones.
const MAX_ADDRESS_LENGTH: usize = 2000;

/// The address as it will be asked for: `http://` or `https://` only, with
/// `https://` put before an address typed without either (`example.com`).
pub fn web_address(typed: &str) -> Result<String, NetError> {
    let typed = typed.trim();
    let address = if typed.contains("://") { typed.to_owned() } else { format!("https://{typed}") };
    let lower = address.to_ascii_lowercase();
    let rest = lower.strip_prefix("https://").or_else(|| lower.strip_prefix("http://"));
    let host = rest.map(|rest| rest.split(['/', '?', '#']).next().unwrap_or(""));
    let plain = !address.chars().any(|letter| letter.is_whitespace() || letter.is_control() || letter == '"');
    match host {
        // A name with a dot in it, or a computer on the user's own network.
        Some(host) if plain && address.len() <= MAX_ADDRESS_LENGTH && !host.is_empty() && !host.starts_with('-') => Ok(address),
        _ => Err(NetError::NotAllowed(typed.to_owned())),
    }
}

/// Writes the page at `address` (see [`web_address`]) to `destination` as a
/// PDF. Blocks until it is written or the time limit passes; call it from a
/// worker thread.
pub fn save_as_pdf(address: &str, destination: &Path) -> Result<(), NetError> {
    let address = web_address(address)?;
    let browser = browsers().into_iter().find(|path| path.is_file()).ok_or(NetError::NoBrowser)?;
    // A profile of its own: the user's browser, open or not, is left alone.
    let profile = std::env::temp_dir().join(format!("syntelab-web-page-{}-{}", std::process::id(), stamp()));
    let _ = fs::remove_file(destination);

    let mut child = Command::new(browser)
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg("--disable-sync")
        .arg("--no-pdf-header-footer")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg(format!("--print-to-pdf={}", destination.display()))
        .arg(&address)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| NetError::Request(error.to_string()))?;

    // The browser hands the work to a process of its own and may leave before the file is there:
    // what is waited for is the file, whole (its size no longer growing).
    let started = Instant::now();
    let mut left = false;
    let mut last_size = 0;
    let mut written = false;
    while started.elapsed() < TIME_LIMIT {
        thread::sleep(Duration::from_millis(250));
        left = left || !matches!(child.try_wait(), Ok(None));
        let size = fs::metadata(destination).map(|file| file.len()).unwrap_or(0);
        if size > 0 && size == last_size && left {
            written = true;
            break;
        }
        // A browser that left without writing anything within a while has failed.
        if left && size == 0 && started.elapsed() > GIVE_UP_AFTER_LEAVING {
            break;
        }
        last_size = size;
    }
    if !left {
        let _ = child.kill();
    }
    let _ = child.wait();
    let _ = fs::remove_dir_all(&profile);

    if written {
        Ok(())
    } else if started.elapsed() >= TIME_LIMIT {
        let _ = fs::remove_file(destination);
        Err(NetError::Request("the page took too long".into()))
    } else {
        Err(NetError::Request("the page could not be reached or printed".into()))
    }
}

/// A page whose source is larger than this is not read: it is not a page of text.
const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

/// The source (HTML) of the page at `address` (see [`web_address`]), as the browser has it once the page is
/// loaded: what scripts wrote into the page is there too. Blocks until it is read or the time limit passes; call
/// it from a worker thread.
pub fn source(address: &str) -> Result<String, NetError> {
    let address = web_address(address)?;
    let browser = browsers().into_iter().find(|path| path.is_file()).ok_or(NetError::NoBrowser)?;
    // A profile of its own: the user's browser, open or not, is left alone.
    let profile = std::env::temp_dir().join(format!("syntelab-web-page-{}-{}", std::process::id(), stamp()));

    // The browser writes the page into a file of ours: on Windows it gives nothing to a pipe.
    let written = std::env::temp_dir().join(format!("syntelab-web-page-{}-{}.html", std::process::id(), stamp()));
    let into = fs::File::create(&written).map_err(|error| NetError::Request(error.to_string()))?;

    let mut command = Command::new(browser);
    command
        .arg("--headless=new")
        .arg("--disable-gpu")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-extensions")
        .arg("--disable-sync")
        .arg(format!("--user-data-dir={}", profile.display()))
        .arg("--dump-dom")
        .arg(&address)
        .stdin(Stdio::null())
        .stdout(Stdio::from(into))
        .stderr(Stdio::null())
        // Windows may have marked the program that starts the browser as one run in a compatibility mode; a
        // browser that inherits the mark starts itself again without it and writes nothing to the file given here.
        .env_remove("__COMPAT_LAYER");
    let child = command.spawn();
    // The file is the browser's from here on: held here too, it would never be seen as let go of.
    drop(command);
    let mut child = child.map_err(|error| NetError::Request(error.to_string()))?;

    // A page that never ends, or one that grows without end, is given up on. The browser that was started may
    // hand the work to another of its processes and leave at once, so what is waited for is the file, let go of.
    let started = Instant::now();
    let mut left = false;
    let mut too_large = false;
    while started.elapsed() < TIME_LIMIT && !left && !too_large {
        thread::sleep(Duration::from_millis(100));
        left = !matches!(child.try_wait(), Ok(None)) && let_go(&written);
        too_large = fs::metadata(&written).is_ok_and(|file| file.len() > MAX_SOURCE_BYTES);
    }
    if !left {
        let _ = child.kill();
    }
    let _ = child.wait();
    let bytes = fs::read(&written);
    let _ = fs::remove_file(&written);
    let _ = fs::remove_dir_all(&profile);

    match bytes {
        _ if too_large => Err(NetError::Request("the page is too large".into())),
        _ if !left => Err(NetError::Request("the page took too long".into())),
        Ok(bytes) if !bytes.iter().all(u8::is_ascii_whitespace) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
        _ => Err(NetError::Request("the page could not be reached".into())),
    }
}

/// Whether no process writes into `file` any longer.
#[cfg(windows)]
fn let_go(file: &Path) -> bool {
    use std::os::windows::fs::OpenOptionsExt;
    // Opened sharing it with nobody: refused for as long as the browser holds it.
    fs::OpenOptions::new().read(true).share_mode(0).open(file).is_ok()
}

/// Whether no process writes into `file` any longer: elsewhere the browser started is the one that writes.
#[cfg(not(windows))]
fn let_go(_file: &Path) -> bool {
    true
}

fn stamp() -> u128 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|since| since.as_nanos()).unwrap_or(0)
}

/// Where a browser that can print to PDF without a window may be installed.
fn browsers() -> Vec<PathBuf> {
    let mut places = Vec::new();
    if cfg!(target_os = "windows") {
        let roots = ["ProgramFiles(x86)", "ProgramFiles", "LocalAppData"];
        let programs = ["Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe"];
        for program in programs {
            for root in roots {
                if let Some(root) = std::env::var_os(root) {
                    places.push(PathBuf::from(root).join(program));
                }
            }
        }
    } else if cfg!(target_os = "macos") {
        for name in ["Google Chrome", "Microsoft Edge", "Chromium"] {
            places.push(PathBuf::from(format!("/Applications/{name}.app/Contents/MacOS/{name}")));
        }
    } else {
        for name in ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"] {
            places.push(PathBuf::from("/usr/bin").join(name));
            places.push(PathBuf::from("/snap/bin").join(name));
        }
    }
    places
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_web_addresses_as_people_type_them() {
        assert_eq!(web_address(" example.com/page ").unwrap(), "https://example.com/page");
        assert_eq!(web_address("http://example.com").unwrap(), "http://example.com");
        assert_eq!(web_address("HTTPS://Example.com/A?b=c#d").unwrap(), "HTTPS://Example.com/A?b=c#d");
    }

    #[test]
    fn refuses_what_is_not_a_page_on_the_web() {
        for typed in ["", "file:///C:/secret.txt", "javascript://alert(1)", "https://", "https://exa mple.com", "https://-flag", "ftp://example.com/file", "example.com/\"quote"] {
            assert!(web_address(typed).is_err(), "{typed}");
        }
    }
}
