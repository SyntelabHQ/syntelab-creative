//! Bytes shown as they are: what the hex viewer reads.
//!
//! A file is never read whole: it stays on disk, and the rows in sight are
//! read from where they are. A search goes through it a piece at a time,
//! forward or back, and can be stopped. So a file of any size is looked at
//! the same way as a small one. A text typed or pasted is held as its bytes
//! (UTF-8), in memory only.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::Mutex;

/// What is looked at.
pub enum Source {
    Bytes(Vec<u8>),
    File(PathBuf),
}

/// Bytes held to be shown a part at a time.
pub struct Held {
    bytes: Vec<u8>,
    /// The file, kept open: reading a part of it is a seek and a read.
    file: Option<Mutex<File>>,
    pub size: u64,
}

/// What a search or a long reading may end in, other than well.
#[derive(Debug)]
pub enum HexError {
    Io(io::Error),
    Stopped,
    NoMemory,
}

impl From<io::Error> for HexError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::OutOfMemory {
            HexError::NoMemory
        } else {
            HexError::Io(error)
        }
    }
}

/// A file is searched and copied in pieces of this size.
const PIECE: usize = 1024 * 1024;

/// A buffer of this size, or `NoMemory`: the program does not fall when there is none.
fn room(size: usize) -> Result<Vec<u8>, HexError> {
    let mut buffer = Vec::new();
    buffer.try_reserve_exact(size).map_err(|_| HexError::NoMemory)?;
    Ok(buffer)
}

impl Held {
    pub fn open(source: Source) -> io::Result<Held> {
        match source {
            Source::Bytes(bytes) => Ok(Held { size: bytes.len() as u64, bytes, file: None }),
            Source::File(path) => {
                let file = File::open(path)?;
                let size = file.metadata()?.len();
                Ok(Held { bytes: Vec::new(), file: Some(Mutex::new(file)), size })
            }
        }
    }

    /// Up to `count` bytes from `from` on; fewer at the end, none beyond it.
    pub fn read(&self, from: u64, count: usize) -> Result<Vec<u8>, HexError> {
        let from = from.min(self.size);
        let count = (count as u64).min(self.size - from) as usize;
        let Some(file) = &self.file else {
            let mut read = room(count)?;
            read.extend_from_slice(&self.bytes[from as usize..from as usize + count]);
            return Ok(read);
        };
        let mut read = room(count)?;
        read.resize(count, 0);
        let mut file = file.lock().map_err(|_| HexError::Io(io::ErrorKind::Other.into()))?;
        file.seek(SeekFrom::Start(from))?;
        let mut filled = 0;
        // A file that grew shorter since it was opened gives what it still has.
        while filled < count {
            match file.read(&mut read[filled..])? {
                0 => break,
                more => filled += more,
            }
        }
        read.truncate(filled);
        Ok(read)
    }

    /// Where `sought` is found: the first place at or after `from`, or, going `back`, the last one that begins
    /// before `from`. With `any_case`, the letters A to Z are the same in capitals and in small letters.
    /// `watch` is told how many bytes were gone through, and stops the search by answering false.
    pub fn find(&self, sought: &[u8], from: u64, back: bool, any_case: bool, watch: &mut dyn FnMut(u64) -> bool) -> Result<Option<u64>, HexError> {
        if sought.is_empty() || sought.len() as u64 > self.size {
            return Ok(None);
        }
        // What two pieces share, so something that lies across their meeting is found: one byte less than what is sought.
        let shared = sought.len() - 1;
        if back {
            // The last place something can begin before `from`, and end within the bytes.
            let mut end = from.min(self.size - shared as u64);
            while end > 0 {
                let start = end.saturating_sub(PIECE as u64);
                let piece = self.read(start, (end - start) as usize + shared)?;
                if let Some(at) = last(&piece, sought, any_case) {
                    return Ok(Some(start + at as u64));
                }
                end = start;
                if !watch(from.min(self.size) - end) {
                    return Err(HexError::Stopped);
                }
            }
            return Ok(None);
        }
        let mut start = from;
        while start + sought.len() as u64 <= self.size {
            let piece = self.read(start, PIECE + shared)?;
            if piece.len() < sought.len() {
                break;
            }
            if let Some(at) = first(&piece, sought, any_case) {
                return Ok(Some(start + at as u64));
            }
            start += (piece.len() - shared) as u64;
            if !watch(start - from) {
                return Err(HexError::Stopped);
            }
        }
        Ok(None)
    }

    /// Writes the bytes from `from` up to `to` (not with it) to `out`, a piece at a time. Returns how many were written.
    pub fn write_range(&self, from: u64, to: u64, out: &mut dyn Write, watch: &mut dyn FnMut(u64) -> bool) -> Result<u64, HexError> {
        let to = to.min(self.size);
        let mut at = from.min(to);
        while at < to {
            let piece = self.read(at, ((to - at) as usize).min(PIECE))?;
            if piece.is_empty() {
                break;
            }
            out.write_all(&piece)?;
            at += piece.len() as u64;
            if !watch(at - from) {
                return Err(HexError::Stopped);
            }
        }
        Ok(at - from.min(to))
    }
}

fn same(found: &[u8], sought: &[u8], any_case: bool) -> bool {
    if any_case {
        found.eq_ignore_ascii_case(sought)
    } else {
        found == sought
    }
}

/// The first place `sought` begins at in `piece`.
fn first(piece: &[u8], sought: &[u8], any_case: bool) -> Option<usize> {
    let lead = sought[0];
    let (small, capital) = if any_case { (lead.to_ascii_lowercase(), lead.to_ascii_uppercase()) } else { (lead, lead) };
    let last_start = piece.len().checked_sub(sought.len())?;
    let mut at = 0;
    while at <= last_start {
        // Only where the first byte is the one sought is the rest looked at.
        at += piece[at..=last_start].iter().position(|&byte| byte == small || byte == capital)?;
        if same(&piece[at..at + sought.len()], sought, any_case) {
            return Some(at);
        }
        at += 1;
    }
    None
}

/// The last place `sought` begins at in `piece`.
fn last(piece: &[u8], sought: &[u8], any_case: bool) -> Option<usize> {
    let lead = sought[0];
    let (small, capital) = if any_case { (lead.to_ascii_lowercase(), lead.to_ascii_uppercase()) } else { (lead, lead) };
    let mut end = piece.len().checked_sub(sought.len())? + 1;
    while end > 0 {
        let at = piece[..end].iter().rposition(|&byte| byte == small || byte == capital)?;
        if same(&piece[at..at + sought.len()], sought, any_case) {
            return Some(at);
        }
        end = at;
    }
    None
}

/// How bytes are written to be copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    /// `DE AD BE EF`
    Hex,
    /// `deadbeef`
    Plain,
    /// `0xDE, 0xAD, 0xBE, 0xEF`
    Code,
    Base64,
    /// As text written in UTF-8; what is no such text is shown by the sign that stands for it.
    Text,
}

impl Form {
    pub fn of(name: &str) -> Option<Form> {
        Some(match name {
            "hex" => Form::Hex,
            "plain" => Form::Plain,
            "code" => Form::Code,
            "base64" => Form::Base64,
            "text" => Form::Text,
            _ => return None,
        })
    }
}

/// The bytes written in a form, as a text. None when there is no memory for it.
pub fn written(bytes: &[u8], form: Form) -> Option<String> {
    const DIGITS: &[u8; 16] = b"0123456789ABCDEF";
    let each = match form {
        Form::Hex => 3,
        Form::Plain => 2,
        Form::Code => 6,
        Form::Base64 => return Some(crate::hash::base64(bytes)),
        Form::Text => return Some(String::from_utf8_lossy(bytes).into_owned()),
    };
    let mut text = String::new();
    text.try_reserve_exact(bytes.len().checked_mul(each)?).ok()?;
    for (index, byte) in bytes.iter().enumerate() {
        let (high, low) = (char::from(DIGITS[usize::from(byte >> 4)]), char::from(DIGITS[usize::from(byte & 15)]));
        match form {
            Form::Hex => {
                if index > 0 {
                    text.push(' ');
                }
                text.push(high);
                text.push(low);
            }
            Form::Plain => {
                text.push(high.to_ascii_lowercase());
                text.push(low.to_ascii_lowercase());
            }
            _ => {
                if index > 0 {
                    text.push_str(", ");
                }
                text.push_str("0x");
                text.push(high);
                text.push(low);
            }
        }
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on(_: u64) -> bool {
        true
    }

    fn held(bytes: &[u8]) -> Held {
        Held::open(Source::Bytes(bytes.to_vec())).expect("held")
    }

    #[test]
    fn reads_a_part_and_stops_at_the_end() {
        let held = held(b"0123456789");
        assert_eq!(held.size, 10);
        assert_eq!(held.read(2, 3).expect("read"), b"234");
        assert_eq!(held.read(8, 16).expect("read"), b"89");
        assert_eq!(held.read(10, 4).expect("read"), b"");
        assert_eq!(held.read(99, 4).expect("read"), b"");
    }

    #[test]
    fn finds_forward_and_back() {
        let held = held(b"abcABCabcabc");
        assert_eq!(held.find(b"abc", 0, false, false, &mut on).expect("sought"), Some(0));
        assert_eq!(held.find(b"abc", 1, false, false, &mut on).expect("sought"), Some(6));
        assert_eq!(held.find(b"abc", 1, false, true, &mut on).expect("sought"), Some(3));
        assert_eq!(held.find(b"abc", 10, false, false, &mut on).expect("sought"), None);
        // Going back: the last that begins before where the search starts.
        assert_eq!(held.find(b"abc", 12, true, false, &mut on).expect("sought"), Some(9));
        assert_eq!(held.find(b"abc", 9, true, false, &mut on).expect("sought"), Some(6));
        assert_eq!(held.find(b"abc", 6, true, true, &mut on).expect("sought"), Some(3));
        assert_eq!(held.find(b"abc", 0, true, false, &mut on).expect("sought"), None);
        assert_eq!(held.find(b"", 0, false, false, &mut on).expect("sought"), None);
        assert_eq!(held.find(b"abcABCabcabcd", 0, false, false, &mut on).expect("sought"), None);
        // Bytes that begin like what is sought, again and again.
        assert_eq!(self::held(b"aaaaab").find(b"aab", 0, false, false, &mut on).expect("sought"), Some(3));
        assert_eq!(self::held(b"baaaaa").find(b"baa", 6, true, false, &mut on).expect("sought"), Some(0));
    }

    #[test]
    fn finds_in_a_file_what_lies_across_two_pieces_and_can_be_stopped() {
        let path = std::env::temp_dir().join(format!("dev-hex-{}.bin", std::process::id()));
        let mut bytes = vec![0u8; PIECE * 2 + 100];
        // Across the meeting of the first two pieces, and at the very end.
        bytes[PIECE - 2..PIECE + 2].copy_from_slice(b"\xDE\xAD\xBE\xEF");
        let end = bytes.len() - 4;
        bytes[end..].copy_from_slice(b"\xCA\xFE\xBA\xBE");
        std::fs::write(&path, &bytes).expect("written");
        let held = Held::open(Source::File(path.clone())).expect("held");
        assert_eq!(held.size, bytes.len() as u64);
        assert_eq!(held.read(PIECE as u64 - 2, 4).expect("read"), b"\xDE\xAD\xBE\xEF");
        assert_eq!(held.find(b"\xDE\xAD\xBE\xEF", 0, false, false, &mut on).expect("sought"), Some(PIECE as u64 - 2));
        assert_eq!(held.find(b"\xCA\xFE\xBA\xBE", 0, false, false, &mut on).expect("sought"), Some(end as u64));
        assert_eq!(held.find(b"\xDE\xAD\xBE\xEF", held.size, true, false, &mut on).expect("sought"), Some(PIECE as u64 - 2));
        assert_eq!(held.find(b"\xCA\xFE\xBA\xBE", held.size, true, false, &mut on).expect("sought"), Some(end as u64));
        assert_eq!(held.find(b"\x01", 0, false, false, &mut on).expect("sought"), None);
        assert!(matches!(held.find(b"\x01", 0, false, false, &mut |_| false), Err(HexError::Stopped)));
        // A part of it written out.
        let mut out = Vec::new();
        assert_eq!(held.write_range(PIECE as u64 - 2, PIECE as u64 + 2, &mut out, &mut on).expect("written"), 4);
        assert_eq!(out, b"\xDE\xAD\xBE\xEF");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn writes_bytes_in_each_form() {
        let bytes = b"\xDE\xAD\x00a";
        assert_eq!(written(bytes, Form::Hex).as_deref(), Some("DE AD 00 61"));
        assert_eq!(written(bytes, Form::Plain).as_deref(), Some("dead0061"));
        assert_eq!(written(bytes, Form::Code).as_deref(), Some("0xDE, 0xAD, 0x00, 0x61"));
        assert_eq!(written(bytes, Form::Base64).as_deref(), Some("3q0AYQ=="));
        assert_eq!(written(b"hi \xFF", Form::Text).as_deref(), Some("hi \u{FFFD}"));
        assert_eq!(written(b"", Form::Hex).as_deref(), Some(""));
    }
}
