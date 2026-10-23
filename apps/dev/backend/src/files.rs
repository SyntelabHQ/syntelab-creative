//! Files a tool reads from and writes to.
//!
//! A file small enough is handed to the interface whole, to be shown and
//! changed there. A larger one stays on disk: the interface gets its size and
//! its first lines, and the tools read it from where it is, a piece at a
//! time. Nothing here is a most for what a tool can work on.

use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

/// The largest file handed to the interface whole. Larger ones are worked on from disk.
pub const LARGEST_SHOWN: u64 = 16 * 1024 * 1024;

/// How much of a file that stays on disk is shown, from its start.
pub const HEAD: usize = 64 * 1024;

/// The mark some programs put at the start of a UTF-8 file. It is not part of the text.
const MARK: &[u8] = &[0xEF, 0xBB, 0xBF];

#[derive(Debug)]
pub enum FileError {
    Io(io::Error),
    /// The bytes of the file are not text written as UTF-8.
    NotUtf8,
    /// The computer has no memory left for the file.
    NoMemory,
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        FileError::Io(error)
    }
}

/// A file as the interface is given it.
#[derive(Debug, PartialEq, Eq)]
pub enum Opened {
    /// `encoding`: how its bytes were written, when that is not UTF-8 (`UTF-16LE`, `windows-1252`…).
    Whole { text: String, size: u64, encoding: Option<&'static str> },
    /// Too large to be shown whole: its start, and whether that start is all text.
    Large { head: String, size: u64 },
}

/// The start of some bytes as text: cut where the last whole letter ends, without the mark.
fn head_of(bytes: &[u8]) -> String {
    let bytes = bytes.strip_prefix(MARK).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        // The cut fell inside a letter, or the file is not text: what is text before that is shown.
        Err(error) => String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned(),
    }
}

/// The first part of a file, as text.
pub fn head(path: &Path) -> Result<String, FileError> {
    let mut bytes = vec![0; HEAD];
    let mut file = File::open(path)?;
    let mut filled = 0;
    while filled < bytes.len() {
        match file.read(&mut bytes[filled..]) {
            Ok(0) => break,
            Ok(read) => filled += read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(head_of(&bytes[..filled]))
}

/// Reads a file for the interface: whole when it is small enough, else its start. `any_text`: a file that is
/// text in another encoding than UTF-8 is read as text too (by its mark, or by a guess); without it, such a file
/// is not text (for a tool that takes bytes, which works on them as they are).
pub fn open(path: &Path, any_text: bool) -> Result<Opened, FileError> {
    let size = std::fs::metadata(path)?.len();
    if size > LARGEST_SHOWN {
        return Ok(Opened::Large { head: head(path)?, size });
    }
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(size as usize + 1).is_err() {
        return Err(FileError::NoMemory);
    }
    File::open(path)?.read_to_end(&mut bytes)?;
    if bytes.starts_with(MARK) {
        bytes.drain(..MARK.len());
    }
    match String::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => Ok(Opened::Whole { text, size, encoding: None }),
        // Not UTF-8 (or UTF-16 of plain letters, which is valid UTF-8 full of zeros): read by its mark or by a guess, when it is text at all.
        other if any_text => {
            let bytes = other.map(String::into_bytes).unwrap_or_else(|error| error.into_bytes());
            let read = syntelab_encoding::read(&bytes).ok_or(FileError::NotUtf8)?;
            Ok(Opened::Whole { text: read.text, size, encoding: Some(read.encoding).filter(|name| *name != "UTF-8") })
        }
        _ => Err(FileError::NotUtf8),
    }
}

/// True when two paths name the same file on disk. A path that names nothing yet is no file's twin.
pub fn same_file(first: &Path, second: &Path) -> bool {
    match (std::fs::canonicalize(first), std::fs::canonicalize(second)) {
        (Ok(first), Ok(second)) => first == second,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> std::path::PathBuf {
        let folder = std::env::temp_dir().join(format!("dev-files-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        folder
    }

    #[test]
    fn a_small_file_is_given_whole_without_its_mark() {
        let folder = folder("small");
        let path = folder.join("a.json");
        std::fs::write(&path, b"\xEF\xBB\xBF{\"a\": \"\xC3\xA9\"}").expect("written");
        assert_eq!(open(&path, true).expect("opened"), Opened::Whole { text: "{\"a\": \"é\"}".into(), size: 14, encoding: None });
        // Text that is not UTF-8 is read all the same, and said to be what it is: by its mark, or by a guess.
        std::fs::write(&path, b"\xff\xfe{\x00").expect("written");
        assert_eq!(open(&path, true).expect("opened"), Opened::Whole { text: "{".into(), size: 4, encoding: Some("UTF-16LE") });
        std::fs::write(&path, b"{\"ville\": \"Orl\xE9ans, pr\xE8s de la for\xEAt, un tr\xE8s bel \xE9t\xE9 fran\xE7ais\"}").expect("written");
        let Opened::Whole { text, encoding, .. } = open(&path, true).expect("opened") else { panic!("whole") };
        assert_eq!(encoding, Some("windows-1252"));
        assert!(text.contains("Orléans") && text.contains("français"));
        // What is no text at all is still refused.
        std::fs::write(&path, b"\x00\x01\x02PK\x03\x04\xff\x00\x00\x07junk\x00").expect("written");
        assert!(matches!(open(&path, true), Err(FileError::NotUtf8)));
        // A tool that takes bytes is not given a guess: text of another encoding is bytes to it.
        std::fs::write(&path, b"\xff\xfe{\x00").expect("written");
        assert!(matches!(open(&path, false), Err(FileError::NotUtf8)));
        assert!(same_file(&path, &folder.join(".").join("a.json")));
        assert!(!same_file(&path, &folder.join("not-there.json")));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn the_head_is_cut_at_a_whole_letter() {
        let mut bytes = vec![b'a'; HEAD - 1];
        bytes.extend_from_slice("é".as_bytes());
        assert_eq!(head_of(&bytes[..HEAD]).len(), HEAD - 1);
    }
}
