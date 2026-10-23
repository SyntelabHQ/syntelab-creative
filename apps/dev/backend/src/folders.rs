//! Two folders compared: which files only one of them has, which both have and are the same, which differ.
//!
//! Files are matched by where they stand under their folder. Two files of different sizes differ without being
//! read; two of the same size are read side by side, a piece at a time, until a byte differs or both end. Nothing
//! is held of a file, and neither how many files nor how large has a most.

use std::collections::HashMap;
use std::fs::File;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::batch;
use crate::codec::CodecError;

/// What is known of a file without reading it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Facts {
    /// In bytes.
    pub size: u64,
    /// When it was last changed, in seconds since 1970; 0 when the system does not say.
    pub modified: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    OnlyLeft,
    OnlyRight,
    Same,
    Different,
    /// Both have it, and one of the two could not be read.
    Unread,
}

impl State {
    pub fn name(self) -> &'static str {
        match self {
            State::OnlyLeft => "only-left",
            State::OnlyRight => "only-right",
            State::Same => "same",
            State::Different => "different",
            State::Unread => "unread",
        }
    }
}

/// A file of one folder or of both.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Where it stands under its folder, with `/` between the folders.
    pub path: String,
    pub state: State,
    pub left: Option<Facts>,
    pub right: Option<Facts>,
}

pub struct Compared {
    pub left: PathBuf,
    pub right: PathBuf,
    /// In the order of their paths.
    pub entries: Vec<Entry>,
}

impl Compared {
    pub fn count(&self, state: State) -> usize {
        self.entries.iter().filter(|entry| entry.state == state).count()
    }

    /// The file an entry is on a side: its folder and where it stands under it.
    pub fn file(&self, entry: &Entry, right: bool) -> PathBuf {
        entry.path.split('/').fold(if right { self.right.clone() } else { self.left.clone() }, |path, part| path.join(part))
    }
}

/// Reads until `buffer` is full or the file ends: how much was read.
fn fill(file: &mut File, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

/// Whether two files hold the same bytes. `read` is told of each piece compared, and stops the work by answering false.
fn same_bytes(one: &Path, other: &Path, read: &mut dyn FnMut(u64) -> bool) -> Result<bool, CodecError> {
    let (mut one, mut other) = (File::open(one)?, File::open(other)?);
    let (mut first, mut second) = (vec![0u8; 256 * 1024], vec![0u8; 256 * 1024]);
    loop {
        let (had, has) = (fill(&mut one, &mut first)?, fill(&mut other, &mut second)?);
        if had != has || first[..had] != second[..has] {
            return Ok(false);
        }
        if had == 0 {
            return Ok(true);
        }
        if !read(had as u64) {
            return Err(CodecError::Stopped);
        }
    }
}

/// The files under a folder, by where they stand under it.
fn under(folder: &Path, deep: bool, endings: &[String]) -> io::Result<Vec<(String, PathBuf, Facts)>> {
    let mut files = Vec::new();
    for found in batch::find(&[folder.to_path_buf()], deep, endings)? {
        let Ok(inside) = found.path.strip_prefix(folder) else { continue };
        let path = inside.components().map(|part| part.as_os_str().to_string_lossy().into_owned()).collect::<Vec<_>>().join("/");
        let modified = std::fs::metadata(&found.path).and_then(|known| known.modified()).ok().and_then(|when| when.duration_since(UNIX_EPOCH).ok()).map_or(0, |since| since.as_secs());
        files.push((path, found.path, Facts { size: found.size, modified }));
    }
    Ok(files)
}

/// Compares two folders. `deep`: with the folders under them. `endings`: only files that end so (none for every
/// file). `watch` is told how many bytes were compared, of how many, and stops the work by answering false.
pub fn compare(left: &Path, right: &Path, deep: bool, endings: &[String], watch: &mut dyn FnMut(u64, u64) -> bool) -> Result<Compared, CodecError> {
    let ours = under(left, deep, endings)?;
    let mut theirs: HashMap<String, (PathBuf, Facts)> = under(right, deep, endings)?.into_iter().map(|(path, file, facts)| (path, (file, facts))).collect();
    if !watch(0, 0) {
        return Err(CodecError::Stopped);
    }
    // Only pairs of the same size are read: what there is to read is known before the reading begins.
    let total: u64 = ours.iter().filter_map(|(path, _, facts)| theirs.get(path).filter(|(_, other)| other.size == facts.size).map(|_| facts.size)).sum();
    let mut done = 0u64;
    let mut entries = Vec::new();
    if entries.try_reserve(ours.len() + theirs.len()).is_err() {
        return Err(CodecError::NoMemory);
    }
    for (path, file, facts) in ours {
        let entry = match theirs.remove(&path) {
            None => Entry { path, state: State::OnlyLeft, left: Some(facts), right: None },
            Some((other, their_facts)) => {
                let state = if their_facts.size != facts.size {
                    State::Different
                } else {
                    let before = done;
                    let compared = same_bytes(&file, &other, &mut |read| {
                        done += read;
                        watch(done, total)
                    });
                    // What was not read of a pair that differs early is counted as done all the same.
                    done = before + facts.size;
                    match compared {
                        Ok(true) => State::Same,
                        Ok(false) => State::Different,
                        Err(CodecError::Stopped) => return Err(CodecError::Stopped),
                        Err(_) => State::Unread,
                    }
                };
                if !watch(done, total) {
                    return Err(CodecError::Stopped);
                }
                Entry { path, state, left: Some(facts), right: Some(their_facts) }
            }
        };
        entries.push(entry);
    }
    entries.extend(theirs.into_iter().map(|(path, (_, facts))| Entry { path, state: State::OnlyRight, left: None, right: Some(facts) }));
    entries.sort_by(|one, other| one.path.cmp(&other.path));
    Ok(Compared { left: left.to_path_buf(), right: right.to_path_buf(), entries })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn two_folders_are_compared_file_by_file() {
        let root = std::env::temp_dir().join(format!("syntelab-dev-folders-{}", std::process::id()));
        let (left, right) = (root.join("left"), root.join("right"));
        for (folder, files) in [(&left, vec![("same.txt", "one"), ("sub/changed.txt", "abc"), ("sub/longer.txt", "abcd"), ("gone.txt", "x"), ("skip.log", "l")]), (&right, vec![("same.txt", "one"), ("sub/changed.txt", "abd"), ("sub/longer.txt", "ab"), ("new/added.txt", "y"), ("skip.log", "r")])] {
            for (name, text) in files {
                let path = name.split('/').fold(folder.clone(), |path, part| path.join(part));
                std::fs::create_dir_all(path.parent().expect("a folder")).expect("folder");
                std::fs::write(path, text).expect("written");
            }
        }
        let mut told = (0, 0);
        let compared = compare(&left, &right, true, &["txt".to_string()], &mut |done, total| {
            told = (done, total);
            true
        })
        .expect("compared");
        let states: Vec<(&str, &str)> = compared.entries.iter().map(|entry| (entry.path.as_str(), entry.state.name())).collect();
        assert_eq!(states, [("gone.txt", "only-left"), ("new/added.txt", "only-right"), ("same.txt", "same"), ("sub/changed.txt", "different"), ("sub/longer.txt", "different")]);
        // Only the pairs of the same size were read.
        assert_eq!(told, (6, 6));
        assert_eq!((compared.count(State::Different), compared.entries[4].left.map(|facts| facts.size), compared.entries[4].right.map(|facts| facts.size)), (2, Some(4), Some(2)));
        assert_eq!(compared.file(&compared.entries[3], true), right.join("sub").join("changed.txt"));
        // Without the folders under them, and with every file.
        let shallow = compare(&left, &right, false, &[], &mut |_, _| true).expect("compared");
        assert_eq!(shallow.entries.iter().map(|entry| (entry.path.as_str(), entry.state.name())).collect::<Vec<_>>(), [("gone.txt", "only-left"), ("same.txt", "same"), ("skip.log", "different")]);
        assert!(matches!(compare(&left, &right, true, &[], &mut |_, _| false), Err(CodecError::Stopped)));
        assert!(matches!(compare(&root.join("none"), &right, true, &[], &mut |_, _| true), Err(CodecError::Io(_))));
        std::fs::remove_dir_all(root).ok();
    }
}
