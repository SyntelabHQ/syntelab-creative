//! Files too large for the editor: read a page of lines at a time.
//!
//! The file is gone through once, to learn where its lines start (every
//! `STEP`-th line is remembered); a page is then read from the nearest
//! remembered line. Nothing here holds the whole file, and nothing changes it.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE};

use crate::files::{self, FileError};
use crate::folders::{shown, Match};
use crate::ops::replace::{self, Replacement};
use crate::ops::OpError;

/// The start of every so many lines is remembered.
const STEP: u64 = 1000;
/// How much of the start of a file is looked at to learn its encoding.
const LOOKED_AT: usize = 1024 * 1024;
/// A line longer than this is shown cut: no page is ever larger than a screen can use.
const LONGEST_SHOWN: usize = 4000;

#[derive(Debug)]
pub enum LargeError {
    File(FileError),
    /// The file is written two bytes to a letter (UTF-16): its lines cannot be found a byte at a time.
    NotPaged,
    Pattern(OpError),
}

impl From<io::Error> for LargeError {
    fn from(error: io::Error) -> Self {
        LargeError::File(FileError::Io(error))
    }
}

/// Where the lines of a file start: what reading a page of it needs.
#[derive(Debug)]
pub struct LineIndex {
    pub path: PathBuf,
    /// The size of the file, in bytes, and when it was last written: an index is of the file as it was then.
    pub size: u64,
    pub modified: Option<SystemTime>,
    pub encoding: &'static Encoding,
    /// How many lines it has.
    pub lines: u64,
    /// Where line 0, `STEP`, 2 × `STEP`… start, in bytes.
    starts: Vec<u64>,
}

/// Goes through a file once and learns where its lines start.
pub fn index(path: &Path) -> Result<LineIndex, LargeError> {
    let mut file = File::open(path)?;
    let facts = file.metadata()?;
    let mut start = vec![0u8; LOOKED_AT.min(facts.len() as usize)];
    file.read_exact(&mut start)?;
    // Whole lines only: a letter cut in two at the end would look like damage.
    let whole = start.iter().rposition(|byte| *byte == b'\n').map_or(start.len(), |at| at + 1);
    let (encoding, mark) = files::sniff(&start[..whole]).map_err(LargeError::File)?;
    if encoding == UTF_16LE || encoding == UTF_16BE {
        return Err(LargeError::NotPaged);
    }

    file.seek(SeekFrom::Start(mark as u64))?;
    let mut starts = vec![mark as u64];
    let (mut at, mut lines) = (mark as u64, 0u64);
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut ended_with_newline = true;
    loop {
        let block = reader.fill_buf()?;
        if block.is_empty() {
            break;
        }
        for (offset, byte) in block.iter().enumerate() {
            if *byte == b'\n' {
                lines += 1;
                if lines % STEP == 0 {
                    starts.push(at + offset as u64 + 1);
                }
            }
        }
        ended_with_newline = block.last() == Some(&b'\n');
        let length = block.len();
        at += length as u64;
        reader.consume(length);
    }
    // What follows the last line ending is a line too, when there is something there.
    if !ended_with_newline {
        lines += 1;
    }
    // A start remembered at the very end of the file is the start of no line.
    if starts.len() > 1 && starts.last() == Some(&at) {
        starts.pop();
    }
    Ok(LineIndex { path: path.to_owned(), size: facts.len(), modified: facts.modified().ok(), encoding, lines, starts })
}

/// A line as it is shown: without its ending, cut when it is very long.
fn line_of(bytes: &[u8], encoding: &'static Encoding) -> String {
    let body = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    let body = body.strip_suffix(b"\r").unwrap_or(body);
    let (text, _) = encoding.decode_without_bom_handling(body);
    if text.chars().count() <= LONGEST_SHOWN {
        return text.into_owned();
    }
    let mut cut: String = text.chars().take(LONGEST_SHOWN).collect();
    cut.push('…');
    cut
}

impl LineIndex {
    /// True while the file is as it was when its lines were found.
    pub fn is_current(&self) -> bool {
        std::fs::metadata(&self.path).is_ok_and(|facts| facts.len() == self.size && facts.modified().ok() == self.modified)
    }

    /// A reader standing at the start of a line (from 0); None when the file has no such line.
    fn reader_at(&self, line: u64) -> Result<Option<BufReader<File>>, LargeError> {
        if line >= self.lines {
            return Ok(None);
        }
        let known = (line / STEP) as usize;
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(self.starts[known.min(self.starts.len() - 1)]))?;
        let mut reader = BufReader::with_capacity(256 * 1024, file);
        let mut passed = Vec::new();
        for _ in 0..line - (known.min(self.starts.len() - 1) as u64) * STEP {
            passed.clear();
            if reader.read_until(b'\n', &mut passed)? == 0 {
                return Ok(None);
            }
        }
        Ok(Some(reader))
    }

    /// `count` lines from line `from` (from 0); fewer at the end of the file.
    pub fn lines(&self, from: u64, count: usize) -> Result<Vec<String>, LargeError> {
        let Some(mut reader) = self.reader_at(from)? else {
            return Ok(Vec::new());
        };
        let mut lines = Vec::with_capacity(count);
        let mut bytes = Vec::new();
        while lines.len() < count {
            bytes.clear();
            if reader.read_until(b'\n', &mut bytes)? == 0 {
                break;
            }
            lines.push(line_of(&bytes, self.encoding));
        }
        Ok(lines)
    }

    /// The places a pattern is found, from line `from` (from 0) on: about `most` (a line is always finished), then where to go on from.
    pub fn find(&self, what: &Replacement, from: u64, most: usize) -> Result<FoundInLarge, LargeError> {
        let pattern = replace::pattern(what).map_err(LargeError::Pattern)?;
        let mut found = FoundInLarge { matches: Vec::new(), next: None };
        let Some(mut reader) = self.reader_at(from)? else {
            return Ok(found);
        };
        let mut bytes = Vec::new();
        let mut number = from;
        loop {
            bytes.clear();
            if reader.read_until(b'\n', &mut bytes)? == 0 {
                return Ok(found);
            }
            let body = bytes.strip_suffix(b"\n").unwrap_or(&bytes);
            let body = body.strip_suffix(b"\r").unwrap_or(body);
            // Stopped between lines, never inside one: the next search starts at a line none was taken from.
            if found.matches.len() >= most {
                found.next = Some(number);
                return Ok(found);
            }
            let (line, _) = self.encoding.decode_without_bom_handling(body);
            for place in pattern.find_iter(&line) {
                let (text, from, to) = shown(&line, place.start(), place.end());
                found.matches.push(Match { line: number as usize + 1, text, from, to });
            }
            number += 1;
        }
    }
}

#[derive(Debug, Default)]
pub struct FoundInLarge {
    pub matches: Vec<Match>,
    /// The line (from 0) to search on from, when the search stopped at its most; None when it reached the end.
    pub next: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn file(name: &str, bytes: &[u8]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scribe-large-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).expect("folder");
        let path = dir.join(name);
        File::create(&path).expect("file").write_all(bytes).expect("written");
        path
    }

    fn plain(find: &str) -> Replacement {
        Replacement { find: find.to_owned(), with: String::new(), regex: false, case_sensitive: false, whole_word: false, keep_case: false, fill: false, today: String::new(), now: String::new() }
    }

    #[test]
    fn reads_any_page_of_a_long_file() {
        let mut text = String::new();
        for number in 0..3500 {
            text.push_str(&format!("rândul {number}\r\n"));
        }
        let path = file("long.txt", text.as_bytes());
        let index = index(&path).expect("indexed");
        assert_eq!((index.lines, index.encoding.name(), index.size), (3500, "UTF-8", text.len() as u64));
        assert_eq!(index.lines(0, 2).expect("read"), ["rândul 0", "rândul 1"]);
        assert_eq!(index.lines(999, 3).expect("read"), ["rândul 999", "rândul 1000", "rândul 1001"]);
        assert_eq!(index.lines(3498, 10).expect("read"), ["rândul 3498", "rândul 3499"]);
        assert!(index.lines(3500, 10).expect("read").is_empty());
        assert!(index.is_current());
    }

    #[test]
    fn counts_a_last_line_without_an_ending_and_passes_a_mark() {
        let path = file("mark.txt", b"\xEF\xBB\xBFunu\ndoi");
        let index = index(&path).expect("indexed");
        assert_eq!(index.lines, 2);
        assert_eq!(index.lines(0, 5).expect("read"), ["unu", "doi"]);
        let empty = super::index(&file("empty.txt", b"")).expect("indexed");
        assert_eq!((empty.lines, empty.lines(0, 5).expect("read").len()), (0, 0));
        // A file of exactly so many lines, each ended: no line starts at its end.
        let even = "x\n".repeat(2000);
        let index = super::index(&file("even.txt", even.as_bytes())).expect("indexed");
        assert_eq!((index.lines, index.lines(1999, 5).expect("read")), (2000, vec!["x".to_owned()]));
    }

    #[test]
    fn reads_old_encodings_and_cuts_very_long_lines() {
        // "žluťoučký" in windows-1250, many times, so the guess has enough to go by.
        let mut bytes = Vec::new();
        for _ in 0..50 {
            bytes.extend_from_slice(b"\x9elu\x9dou\xe8k\xfd k\xf9\xf2 \xfap\xecl \xef\xe1belsk\xe9 \xf3dy\n");
        }
        let index = index(&file("czech.txt", &bytes)).expect("indexed");
        assert_eq!(index.encoding.name(), "windows-1250");
        assert!(index.lines(49, 1).expect("read")[0].starts_with("žluťoučký kůň"));

        let long = "a".repeat(LONGEST_SHOWN + 50);
        let index = super::index(&file("wide.txt", long.as_bytes())).expect("indexed");
        let shown = &index.lines(0, 1).expect("read")[0];
        assert_eq!(shown.chars().count(), LONGEST_SHOWN + 1);
        assert!(shown.ends_with('…'));
    }

    #[test]
    fn finds_a_few_at_a_time_and_goes_on_from_there() {
        let mut text = String::new();
        for number in 0..2500 {
            text.push_str(if number % 500 == 0 { "aici este Ana și iar ANA\n" } else { "nimic\n" });
        }
        let index = index(&file("find.txt", text.as_bytes())).expect("indexed");
        let first = index.find(&plain("ana"), 0, 3).expect("found");
        assert_eq!(first.matches.iter().map(|found| found.line).collect::<Vec<_>>(), [1, 1, 501, 501]);
        assert_eq!(first.next, Some(501));
        let rest = index.find(&plain("ana"), 1000, 100).expect("found");
        assert_eq!(rest.matches.len(), 6);
        assert_eq!(rest.next, None);
        assert!(matches!(index.find(&Replacement { regex: true, ..plain("(") }, 0, 3), Err(LargeError::Pattern(_))));
    }

    #[test]
    fn refuses_what_it_cannot_page() {
        let wide: Vec<u8> = "unu\ndoi\n".encode_utf16().flat_map(u16::to_le_bytes).collect();
        let mut marked = vec![0xFF, 0xFE];
        marked.extend_from_slice(&wide);
        assert!(matches!(index(&file("wide16.txt", &marked)), Err(LargeError::NotPaged)));
        assert!(matches!(index(&file("picture.bin", &[0, 1, 2, 3, 0, 0, 0, 0, 255, 254, 0, 0])), Err(LargeError::File(FileError::NotText))));
        assert!(matches!(index(Path::new("no such file")), Err(LargeError::File(FileError::Io(_)))));
    }
}
