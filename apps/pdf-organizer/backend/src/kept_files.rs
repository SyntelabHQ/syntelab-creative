//! Files of the program's own that outlive the document they were made for:
//!
//! - drafts: PDFs that have no place of the user's choosing yet (pages taken
//!   out of a document, files combined into one, a picture turned into a PDF).
//!   A tab shows one like any other PDF; saving it asks where.
//! - received files: what the user dropped on the window or pasted. The
//!   interface only gets their content, not where they are, so the content is
//!   written here for the engine to open.
//!
//! Each file sits in a folder of its own, so it can keep the name the user
//! sees. Nothing is deleted while the program runs; what is older than a few
//! days goes when the program starts.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime};

/// Drafts stay this long, so that an unsaved document survives a crash or a restart.
const DRAFTS_KEPT: Duration = Duration::from_secs(14 * 24 * 3600);
/// Received files are only read while their tab is open.
const RECEIVED_KEPT: Duration = Duration::from_secs(3 * 24 * 3600);

pub struct KeptFiles {
    drafts_root: PathBuf,
    received_root: PathBuf,
    next_folder: AtomicU64,
}

impl KeptFiles {
    pub fn new(cache_dir: &Path) -> Self {
        let kept = Self {
            drafts_root: cache_dir.join("drafts"),
            received_root: cache_dir.join("received"),
            next_folder: AtomicU64::new(1),
        };
        remove_older_than(&kept.drafts_root, DRAFTS_KEPT);
        remove_older_than(&kept.received_root, RECEIVED_KEPT);
        kept
    }

    /// Where to write a new draft that is to be called `name`.
    pub fn draft(&self, name: &str) -> io::Result<PathBuf> {
        self.new_file(&self.drafts_root, name)
    }

    /// Where to write a file the interface hands over, called `name`.
    pub fn received(&self, name: &str) -> io::Result<PathBuf> {
        self.new_file(&self.received_root, name)
    }

    /// True for a file made at [`KeptFiles::received`] (and nothing else on the computer).
    pub fn is_received(&self, path: &Path) -> bool {
        let inside = path.parent().and_then(Path::parent).is_some_and(|root| root == self.received_root);
        inside && path.components().all(|part| !matches!(part, std::path::Component::ParentDir))
    }

    fn new_file(&self, root: &Path, name: &str) -> io::Result<PathBuf> {
        // A moment in the name keeps folders of different runs apart; the number, those of one run.
        let moment = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|since| since.as_millis()).unwrap_or(0);
        let number = self.next_folder.fetch_add(1, Ordering::Relaxed);
        let folder = root.join(format!("{moment}-{}-{number}", std::process::id()));
        fs::create_dir_all(&folder)?;
        Ok(folder.join(name))
    }
}

/// Removes the folders in `root` that were last written longer ago than `age`.
fn remove_older_than(root: &Path, age: Duration) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|facts| facts.modified())
            .ok()
            .and_then(|written| written.elapsed().ok())
            .is_some_and(|since| since > age);
        if old {
            let _ = fs::remove_dir_all(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gives_every_file_a_folder_of_its_own() {
        let root = std::env::temp_dir().join(format!("syntelab-kept-files-{}", std::process::id()));
        let kept = KeptFiles::new(&root);
        let first = kept.draft("pages_of_report.pdf").expect("a place");
        let second = kept.draft("pages_of_report.pdf").expect("a place");
        assert_ne!(first, second);
        assert_eq!(first.file_name().and_then(|name| name.to_str()), Some("pages_of_report.pdf"));
        assert!(first.parent().is_some_and(Path::is_dir));

        let received = kept.received("photo.png").expect("a place");
        assert!(kept.is_received(&received));
        assert!(!kept.is_received(&first));
        assert!(!kept.is_received(&received.join("..").join("..").join("elsewhere").join("x")));
        let _ = fs::remove_dir_all(&root);
    }
}
