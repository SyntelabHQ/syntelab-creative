//! Results of the program's own: where the result of a file is written while it is only being looked at.
//!
//! A tool that works on a file from disk writes its result to a file. Until
//! the user says where it goes, that file is one of the program's own, in a
//! folder of the app's cache: the interface shows its start, or a preview of
//! its bytes, and Save copies it to where the user chose. Such a file is
//! deleted when the interface no longer shows it (another result took its
//! place, the tool was burnt), and what an earlier run of the program left
//! behind is deleted when it starts.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub struct Results {
    root: PathBuf,
    next: AtomicU64,
}

impl Results {
    /// The results kept in `root`, which is emptied first.
    pub fn new(root: PathBuf) -> Self {
        // What an earlier run left behind is of no use to anyone. Files another running copy of the program still
        // reads cannot be deleted, and stay.
        std::fs::remove_dir_all(&root).ok();
        Results { root, next: AtomicU64::new(1) }
    }

    /// A name for a new result, in a folder that exists. Nothing is written there yet.
    pub fn make(&self) -> io::Result<PathBuf> {
        std::fs::create_dir_all(&self.root)?;
        let number = self.next.fetch_add(1, Ordering::Relaxed);
        Ok(self.root.join(format!("result-{}-{number}", std::process::id())))
    }

    /// True when a path is that of a result of the program's own: a file right in the folder, by a name it made.
    pub fn holds(&self, path: &Path) -> bool {
        let named = path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("result-"));
        named && path.parent() == Some(self.root.as_path())
    }

    /// Copies a result to where the user chose. Answers how many bytes were written.
    pub fn keep(&self, result: &Path, to: &Path) -> io::Result<u64> {
        if !self.holds(result) {
            return Err(io::ErrorKind::PermissionDenied.into());
        }
        std::fs::copy(result, to)
    }

    /// Deletes a result that is no longer shown. One that is already gone is no matter.
    pub fn forget(&self, result: &Path) {
        if self.holds(result) {
            std::fs::remove_file(result).ok();
        }
    }
}

impl Default for Results {
    /// Results kept in a folder of the system's own for passing files, for a program that was given no cache.
    fn default() -> Self {
        Results { root: std::env::temp_dir().join(format!("syntelab-dev-results-{}", std::process::id())), next: AtomicU64::new(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_result_is_kept_where_asked_and_then_forgotten() {
        let root = std::env::temp_dir().join(format!("dev-results-own-{}", std::process::id()));
        std::fs::create_dir_all(&root).expect("a folder");
        std::fs::write(root.join("left-behind"), b"old").expect("written");
        let results = Results::new(root.clone());
        // What was there before is gone.
        assert!(!root.exists());
        let first = results.make().expect("a name");
        let second = results.make().expect("a name");
        assert_ne!(first, second);
        std::fs::write(&first, b"made").expect("written");
        let to = std::env::temp_dir().join(format!("dev-results-kept-{}", std::process::id()));
        assert_eq!(results.keep(&first, &to).expect("kept"), 4);
        assert_eq!(std::fs::read(&to).expect("read"), b"made");
        // Only a result of its own is copied or deleted: never a file of the user's.
        assert!(results.keep(&to, &root.join("result-other")).is_err());
        results.forget(&to);
        assert!(to.exists());
        assert!(!results.holds(&root.join("..").join("result-1")));
        results.forget(&first);
        assert!(!first.exists());
        results.forget(&first);
        std::fs::remove_file(to).ok();
        std::fs::remove_dir_all(root).ok();
    }
}
