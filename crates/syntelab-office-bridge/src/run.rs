use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::BridgeError;

/// The longest an office suite is given for one document.
const TIME_LIMIT: Duration = Duration::from_secs(180);

/// Runs a prepared command without a window and waits for it, up to the time
/// limit. Returns what the program wrote as errors when it did not end well.
pub(crate) fn run(mut command: Command) -> Result<(), BridgeError> {
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up beside the program.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn().map_err(|_| BridgeError::NoOfficeSuite)?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => {
                let said = child.wait_with_output().map(|output| output.stderr).unwrap_or_default();
                return Err(BridgeError::Failed(String::from_utf8_lossy(&said).trim().to_owned()));
            }
            Ok(None) if started.elapsed() > TIME_LIMIT => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(BridgeError::TimedOut);
            }
            Ok(None) => thread::sleep(Duration::from_millis(100)),
            Err(error) => return Err(BridgeError::Failed(error.to_string())),
        }
    }
}
