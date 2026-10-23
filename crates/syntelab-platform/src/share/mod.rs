//! The system's "Share" window: send a file with another app (mail, nearby
//! devices, messaging…). The user chooses where it goes; the program only
//! offers the file.
//!
//! Two steps, because they belong to different threads:
//! 1. [`prepare`] finds the file. It waits on the system, so it runs on a
//!    worker thread.
//! 2. [`Shareable::show`] opens the window. It runs on the thread that owns
//!    the program's window.

use std::fmt;
use std::path::Path;

#[cfg(windows)]
#[path = "windows.rs"]
mod system;
#[cfg(not(windows))]
#[path = "unsupported.rs"]
mod system;

pub use system::Shareable;

/// Why a file could not be shared.
#[derive(Debug)]
pub enum ShareError {
    /// This system has no share window the program can open.
    Unsupported,
    /// The system refused (file missing, no share window on this Windows…).
    Failed(String),
}

impl fmt::Display for ShareError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(formatter, "unsupported"),
            Self::Failed(detail) => write!(formatter, "sharing failed: {detail}"),
        }
    }
}

impl std::error::Error for ShareError {}

/// Finds the file and gets it ready to be offered. Blocks briefly; call it
/// from a worker thread.
pub fn prepare(path: &Path) -> Result<Shareable, ShareError> {
    system::prepare(path)
}
