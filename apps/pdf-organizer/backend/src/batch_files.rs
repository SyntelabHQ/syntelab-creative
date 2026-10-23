//! What batch processing needs of folders: the files of one with those under
//! it, a folder made for results, and the report of a run written as text.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// The most files one folder gives: a slip (a whole disk chosen) does not fill the list for ever.
pub const MOST_FILES: usize = 2000;
/// How far under the folder files are looked for.
const DEEPEST: usize = 16;

/// A file found under a folder.
#[derive(Debug, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    /// The folders between the chosen one and the file, joined with `/`; empty for a file right in it.
    pub under: String,
}

/// The files of `folder` and of the folders under it whose ending (without
/// the dot, any case) is one of `endings`, sorted by where they are. Folders
/// and files that cannot be read are passed over. The second answer says
/// whether there were more than [`MOST_FILES`].
pub fn list_folder(folder: &Path, endings: &[String]) -> io::Result<(Vec<Found>, bool)> {
    let mut found = Vec::new();
    let mut more = false;
    // Refused when the folder itself cannot be read; what is under it is read as far as it can be.
    fs::read_dir(folder)?;
    walk(folder, "", 0, endings, &mut found, &mut more);
    Ok((found, more))
}

fn walk(folder: &Path, under: &str, depth: usize, endings: &[String], found: &mut Vec<Found>, more: &mut bool) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    let mut entries: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect();
    entries.sort_by_key(|path| path.file_name().map(|name| name.to_string_lossy().to_lowercase()));
    // The files of a folder come before the folders in it.
    let (folders, files): (Vec<PathBuf>, Vec<PathBuf>) = entries.into_iter().partition(|path| path.is_dir());
    for path in files {
        let wanted = path.extension().and_then(|ending| ending.to_str()).is_some_and(|ending| endings.iter().any(|known| known.eq_ignore_ascii_case(ending)));
        if !wanted {
            continue;
        }
        if found.len() >= MOST_FILES {
            *more = true;
            return;
        }
        found.push(Found { path, under: under.to_owned() });
    }
    if depth >= DEEPEST {
        return;
    }
    for path in folders {
        let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let deeper = if under.is_empty() { name.to_owned() } else { format!("{under}/{name}") };
        walk(&path, &deeper, depth + 1, endings, found, more);
        if *more {
            return;
        }
    }
}

/// Writes `text` to a new file at `destination`. A file that is already there is left alone.
pub fn write_report(destination: &Path, text: &str) -> io::Result<()> {
    use io::Write;
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(destination)?;
    // Marked as UTF-8, so the names in it read right in any text program.
    file.write_all(b"\xEF\xBB\xBF")?;
    file.write_all(text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pdf-organizer-batch-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("b/deep")).expect("folders");
        fs::create_dir_all(dir.join("a")).expect("folders");
        for file in ["z.pdf", "Notes.TXT", "skip.exe", "a/one.pdf", "b/two.png", "b/deep/three.pdf"] {
            fs::write(dir.join(file), b"x").expect("file");
        }
        dir
    }

    #[test]
    fn lists_the_wanted_files_with_where_they_are() {
        let dir = folder("list");
        let (found, more) = list_folder(&dir, &["pdf".into(), "txt".into()]).expect("reads");
        assert!(!more);
        let said: Vec<(String, &str)> = found.iter().map(|file| (file.path.file_name().unwrap().to_string_lossy().into_owned(), file.under.as_str())).collect();
        assert_eq!(said, [("Notes.TXT".to_owned(), ""), ("z.pdf".to_owned(), ""), ("one.pdf".to_owned(), "a"), ("three.pdf".to_owned(), "b/deep")]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_what_is_not_a_folder() {
        assert!(list_folder(Path::new("no such folder anywhere"), &["pdf".into()]).is_err());
    }

    #[test]
    fn writes_a_report_once() {
        let dir = folder("report");
        let report = dir.join("report.txt");
        write_report(&report, "Făcut: 2").expect("writes");
        assert_eq!(fs::read(&report).expect("reads"), "\u{feff}Făcut: 2".as_bytes());
        assert!(write_report(&report, "again").is_err(), "a file that is there is left alone");
        let _ = fs::remove_dir_all(&dir);
    }
}
