//! What the program is started with: files to open, or an entry of the file
//! manager's right-click menu with the file it was chosen on.
//!
//! `syntelab-creative [--app <app id> --action <entry id>] <file>…`
//! `syntelab-creative --app <app id> [<file>…]`: the shortcut of an app, which opens the program in that app.
//!
//! Only one copy of the program runs: a second one hands what it was started
//! with to the first (see `main.rs`) and leaves. The interface asks for what
//! is waiting when it starts, and hears of what comes later.
//!
//! The file manager starts one copy per file chosen, all at the same moment.
//! They take turns (`wait_for_turn`) until one of them is ready to take the
//! others' starts; then each of the others finds it and hands its start over.

use std::fs::{File, OpenOptions, TryLockError};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;

/// The name the interface hears of a new request by.
pub const EVENT: &str = "launch-request";

/// One start of the program with something to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LaunchRequest {
    /// The app the entry belongs to, and which entry; both absent for files that are simply opened. An app without
    /// an entry is the shortcut of that app: the program opens in it.
    pub app: Option<String>,
    pub action: Option<String>,
    pub files: Vec<PathBuf>,
}

/// Requests the interface has not taken yet.
#[derive(Default)]
pub struct Waiting(Mutex<Vec<LaunchRequest>>);

impl Waiting {
    pub fn add(&self, request: LaunchRequest) {
        if let Ok(mut waiting) = self.0.lock() {
            waiting.push(request);
        }
    }
}

/// What the arguments of a start ask for; `None` when they name no file and no app to open in.
/// `arguments` are those after the program's own name; a file named without
/// its folder is looked for in `folder`. Only files that exist count (and
/// folders, for an entry of the menu): nothing else on a command line is
/// taken for one.
pub fn request_of(arguments: &[String], folder: &Path) -> Option<LaunchRequest> {
    let (mut app, mut action, mut files) = (None, None, Vec::new());
    let mut rest = arguments.iter();
    while let Some(argument) = rest.next() {
        match argument.as_str() {
            "--app" => app = rest.next().filter(|name| is_plain(name)).cloned(),
            "--action" => action = rest.next().filter(|name| is_plain(name)).cloned(),
            other if other.starts_with("--") => {}
            file => {
                let path = Path::new(file);
                let path = if path.is_absolute() { path.to_path_buf() } else { folder.join(path) };
                // A folder counts too, for an entry of the menu that was chosen on one.
                if path.is_file() || path.is_dir() {
                    files.push(path);
                }
            }
        }
    }
    // An entry of the menu needs both its app and its name; an app alone is the shortcut of that app.
    let (app, action) = match (app, action) {
        (Some(app), Some(action)) => (Some(app), Some(action)),
        (Some(app), None) => (Some(app), None),
        _ => (None, None),
    };
    // Only an entry of the menu is chosen on folders: what is simply opened is a file.
    if action.is_none() {
        files.retain(|path| path.is_file());
    }
    let shortcut = app.is_some() && action.is_none();
    (shortcut || !files.is_empty()).then_some(LaunchRequest { app, action, files })
}

/// Ids are lowercase words joined by hyphens; anything else is not one.
fn is_plain(name: &str) -> bool {
    !name.is_empty() && name.len() <= 64 && name.chars().all(|letter| letter.is_ascii_lowercase() || letter.is_ascii_digit() || letter == '-')
}

/// How long a copy waits for its turn before it starts all the same.
pub const TURN_LIMIT: Duration = Duration::from_secs(15);

/// Waits until no other copy of the program is starting, and keeps the others waiting while this one starts:
/// until what is returned is let go, or the copy ends. Without a turn, copies started together could each
/// find no other running and open a window each. After `limit`, or when the turn cannot be had at all, the copy
/// starts without one (`None`). `name` tells the program apart: its identifier.
pub fn wait_for_turn(name: &str, limit: Duration) -> Option<File> {
    // The user's own folder for such files where there is one; on Windows the temporary folder is the user's own.
    let folder = std::env::var_os("XDG_RUNTIME_DIR").map(PathBuf::from).filter(|folder| folder.is_dir()).unwrap_or_else(std::env::temp_dir);
    let file = OpenOptions::new().create(true).truncate(false).write(true).open(folder.join(format!("{name}.starting"))).ok()?;
    let until = Instant::now() + limit;
    loop {
        match file.try_lock() {
            Ok(()) => return Some(file),
            Err(TryLockError::WouldBlock) if Instant::now() < until => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => return None,
        }
    }
}

/// Hands the interface everything that is waiting, once.
#[tauri::command]
pub fn take_launch_requests(waiting: tauri::State<'_, Waiting>) -> Vec<LaunchRequest> {
    waiting.0.lock().map(|mut waiting| std::mem::take(&mut *waiting)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(list: &[&str]) -> Vec<String> {
        list.iter().map(|argument| (*argument).to_owned()).collect()
    }

    #[test]
    fn reads_files_and_the_entry_they_were_chosen_with() {
        let folder = std::env::temp_dir().join(format!("syntelab-launch-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let (first, second) = (folder.join("a.pdf"), folder.join("b b.png"));
        std::fs::write(&first, b"x").expect("a file");
        std::fs::write(&second, b"x").expect("a file");

        // Files alone are opened; one named without its folder is found in the folder the start came from.
        let opened = request_of(&arguments(&[first.to_str().expect("text"), "b b.png", "missing.pdf"]), &folder).expect("a request");
        assert_eq!(opened, LaunchRequest { app: None, action: None, files: vec![first.clone(), second.clone()] });

        let entry = request_of(&arguments(&["--app", "pdf-organizer", "--action", "combine-to-pdf", first.to_str().expect("text")]), &folder).expect("a request");
        assert_eq!((entry.app.as_deref(), entry.action.as_deref()), (Some("pdf-organizer"), Some("combine-to-pdf")));

        // Half an entry, or names that are no ids, leave the files to be opened.
        let half = request_of(&arguments(&["--action", "combine-to-pdf", "a.pdf"]), &folder).expect("a request");
        assert_eq!((half.app, half.action), (None, None));
        let odd = request_of(&arguments(&["--app", "../x", "--action", "Do It", "a.pdf"]), &folder).expect("a request");
        assert_eq!((odd.app, odd.action), (None, None));

        // An entry may be chosen on a folder; a folder is not something to open.
        let on_folder = request_of(&arguments(&["--app", "dev", "--action", "checksum", folder.to_str().expect("text")]), &folder).expect("a request");
        assert_eq!(on_folder.files, vec![folder.clone()]);
        assert_eq!(request_of(&arguments(&[folder.to_str().expect("text")]), &folder), None);

        // The shortcut of an app: the app alone, or with files to open in it; never a folder.
        let shortcut = request_of(&arguments(&["--app", "units"]), &folder).expect("a request");
        assert_eq!(shortcut, LaunchRequest { app: Some("units".into()), action: None, files: vec![] });
        let with_file = request_of(&arguments(&["--app", "scribe", first.to_str().expect("text"), folder.to_str().expect("text")]), &folder).expect("a request");
        assert_eq!(with_file, LaunchRequest { app: Some("scribe".into()), action: None, files: vec![first.clone()] });
        assert_eq!(request_of(&arguments(&["--app", "../x"]), &folder), None);

        // Nothing to do without a file; other switches are passed over.
        assert_eq!(request_of(&arguments(&["--app", "pdf-organizer", "--action", "combine-to-pdf"]), &folder), None);
        assert_eq!(request_of(&arguments(&["--remote-debugging-port=9333"]), &folder), None);
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn copies_started_together_take_turns() {
        let name = format!("syntelab-turn-test-{}", std::process::id());
        let first = wait_for_turn(&name, Duration::ZERO).expect("the first copy has its turn at once");
        // Another copy waits while the first starts, and starts all the same once it has waited long enough.
        let started = Instant::now();
        assert!(wait_for_turn(&name, Duration::from_millis(100)).is_none());
        assert!(started.elapsed() >= Duration::from_millis(100));
        // Its turn comes when the first is ready.
        let waiting = std::thread::spawn({
            let name = name.clone();
            move || wait_for_turn(&name, Duration::from_secs(10)).is_some()
        });
        std::thread::sleep(Duration::from_millis(50));
        drop(first);
        assert!(waiting.join().expect("the copy waited"));
    }
}
