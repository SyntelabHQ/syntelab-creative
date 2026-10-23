//! Running a recipe (a chain of operations) on files.
//!
//! Each file is read with the encoding and the line endings it has, changed,
//! and written the same way: over itself when asked, or under its own name
//! in another folder, where a file that is already there is never written
//! over.

use std::fs;
use std::path::{Path, PathBuf};

use crate::files::{self, FileError, WriteAs};
use crate::ops::{self, OpError, Operation};

/// Where the results go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// Each file is written over itself.
    InPlace,
    /// Each result is written in this folder, under the file's own name (and its own folders, when it came with some).
    Folder(PathBuf),
}

/// A file to work on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub path: PathBuf,
    /// The folders it lies under, below the folder it was taken from, joined with `/`; kept in the results folder.
    pub under: String,
}

/// How one file went.
#[derive(Debug, PartialEq, Eq)]
pub enum Ran {
    /// Written (to this path), with how much the operations changed.
    Done { written: PathBuf, changed: usize },
    /// The operations change nothing in it; in place it is not written again.
    Unchanged,
    /// Not written; the code says why (`cannot-open`, `not-text`, `cannot-encode`, `cannot-save`, `destination-exists`).
    Failed(&'static str),
}

fn run_one(source: &Source, operations: &[Operation], target: &Target) -> Ran {
    let read = match files::read_text(&source.path, None) {
        Ok(read) => read,
        Err(FileError::NotText) => return Ran::Failed("not-text"),
        Err(_) => return Ran::Failed("cannot-open"),
    };
    let Ok(outcome) = ops::apply_all(&read.text, operations) else {
        return Ran::Failed("cannot-save");
    };
    let destination = match target {
        Target::InPlace => {
            if outcome.text == read.text {
                return Ran::Unchanged;
            }
            source.path.clone()
        }
        Target::Folder(folder) => {
            let Some(name) = source.path.file_name() else {
                return Ran::Failed("cannot-save");
            };
            // The folders a file came with are made again; anything that would lead out of the results folder is not followed.
            let mut into = folder.clone();
            for part in source.under.split('/').filter(|part| !part.is_empty() && *part != "." && *part != "..") {
                into.push(part);
            }
            if fs::create_dir_all(&into).is_err() {
                return Ran::Failed("cannot-save");
            }
            let destination = into.join(name);
            if destination.exists() {
                return Ran::Failed("destination-exists");
            }
            destination
        }
    };
    match files::write_text(&destination, &outcome.text, WriteAs { encoding: read.encoding, mark: read.mark, line_ending: read.line_ending }) {
        Ok(()) => Ran::Done { written: destination, changed: outcome.changed },
        Err(FileError::CannotEncode(_)) => Ran::Failed("cannot-encode"),
        Err(_) => Ran::Failed("cannot-save"),
    }
}

/// Runs the operations on each file. A recipe that cannot run at all (a
/// pattern that is not valid) is refused before any file is touched; a file
/// that fails is left as it was and the others go on.
pub fn run_on_files(sources: &[Source], operations: &[Operation], target: &Target) -> Result<Vec<(PathBuf, Ran)>, OpError> {
    // Tried on nothing first: what is wrong with the recipe itself shows here.
    ops::apply_all("", operations)?;
    if let Target::Folder(folder) = target {
        if sources.iter().any(|source| source.path.parent().is_some_and(|parent| same_folder(parent, folder)) && source.under.is_empty()) {
            // The results folder is where the files are: each would be asked to take its own place.
            return Ok(sources.iter().map(|source| (source.path.clone(), Ran::Failed("destination-exists"))).collect());
        }
    }
    Ok(sources.iter().map(|source| (source.path.clone(), run_one(source, operations, target))).collect())
}

fn same_folder(one: &Path, other: &Path) -> bool {
    match (fs::canonicalize(one), fs::canonicalize(other)) {
        (Ok(one), Ok(other)) => one == other,
        _ => one == other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scribe-recipes-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("in/sub")).expect("folders");
        fs::write(dir.join("in/a.txt"), "pear \r\napple\r\npear\r\n").expect("file");
        fs::write(dir.join("in/sub/b.txt"), "b\na\n").expect("file");
        fs::write(dir.join("in/c.bin"), [0_u8, 1, 0, 0, 2, 0, 0, 0]).expect("file");
        dir
    }

    fn recipe() -> Vec<Operation> {
        serde_json::from_value(json!([{ "kind": "trimLines" }, { "kind": "removeDuplicates" }, { "kind": "sortLines" }])).expect("operations")
    }

    fn source(path: PathBuf, under: &str) -> Source {
        Source { path, under: under.to_owned() }
    }

    #[test]
    fn writes_results_in_another_folder_with_the_folders_the_files_came_with() {
        let dir = folder("folder");
        let out = dir.join("out");
        let sources = [source(dir.join("in/a.txt"), ""), source(dir.join("in/sub/b.txt"), "sub"), source(dir.join("in/c.bin"), ""), source(dir.join("in/none.txt"), "")];
        let ran = run_on_files(&sources, &recipe(), &Target::Folder(out.clone())).expect("runs");
        assert!(matches!(&ran[0].1, Ran::Done { written, changed } if *written == out.join("a.txt") && *changed > 0));
        assert!(matches!(&ran[1].1, Ran::Done { written, .. } if *written == out.join("sub").join("b.txt")));
        assert_eq!((&ran[2].1, &ran[3].1), (&Ran::Failed("not-text"), &Ran::Failed("cannot-open")));
        // Windows line endings are kept; the files themselves are as they were.
        assert_eq!(fs::read(out.join("a.txt")).expect("reads"), b"apple\r\npear\r\n");
        assert_eq!(fs::read(dir.join("in/a.txt")).expect("reads"), b"pear \r\napple\r\npear\r\n");
        // Run again: nothing that is there is written over.
        let again = run_on_files(&sources[..1], &recipe(), &Target::Folder(out)).expect("runs");
        assert_eq!(again[0].1, Ran::Failed("destination-exists"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn writes_files_over_themselves_only_when_they_change() {
        let dir = folder("in-place");
        let sources = [source(dir.join("in/a.txt"), ""), source(dir.join("in/sub/b.txt"), "sub")];
        let ran = run_on_files(&sources, &recipe(), &Target::InPlace).expect("runs");
        assert!(matches!(&ran[0].1, Ran::Done { written, .. } if *written == dir.join("in/a.txt")));
        assert_eq!(fs::read_to_string(dir.join("in/sub/b.txt")).expect("reads"), "a\nb\n");
        let again = run_on_files(&sources, &recipe(), &Target::InPlace).expect("runs");
        assert_eq!((&again[0].1, &again[1].1), (&Ran::Unchanged, &Ran::Unchanged));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_recipe_that_cannot_run_before_touching_a_file() {
        let dir = folder("bad");
        let bad: Vec<Operation> = serde_json::from_value(json!([{ "kind": "replace", "find": "(", "regex": true }])).expect("operations");
        assert!(run_on_files(&[source(dir.join("in/a.txt"), "")], &bad, &Target::InPlace).is_err());
        assert_eq!(fs::read(dir.join("in/a.txt")).expect("reads"), b"pear \r\napple\r\npear\r\n");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_not_write_results_where_the_files_are() {
        let dir = folder("same");
        let ran = run_on_files(&[source(dir.join("in/a.txt"), "")], &recipe(), &Target::Folder(dir.join("in"))).expect("runs");
        assert_eq!(ran[0].1, Ran::Failed("destination-exists"));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_not_leave_the_results_folder() {
        let dir = folder("escape");
        let out = dir.join("out");
        let ran = run_on_files(&[source(dir.join("in/a.txt"), "../../elsewhere")], &recipe(), &Target::Folder(out.clone())).expect("runs");
        assert!(matches!(&ran[0].1, Ran::Done { written, .. } if *written == out.join("elsewhere").join("a.txt")));
        let _ = fs::remove_dir_all(&dir);
    }
}
