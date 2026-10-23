//! What the tools that turn bytes into other bytes have in common (Base64, URL, HTML entities, escapes, gzip).
//!
//! Each of them is a [`Stage`]: it is handed what is read, a piece at a
//! time, and writes what it makes of it as it goes. Nothing is held whole,
//! so what a stage works on is as large as the disk lets it be. [`drive`]
//! reads from a file or a text and hands the pieces over.

use std::io::{self, Read, Write};

/// What is wrong with what a tool was given, and where.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Wrong {
    /// A code the interface translates.
    pub code: &'static str,
    /// The line, from 1; 0 when the problem has no place (what is read is not text).
    pub line: u64,
    /// The place in the line, from 1, counted as editors count (in UTF-16 units).
    pub column: u64,
    /// The place in the whole text, from 0, counted the same way.
    pub offset: u64,
}

impl Wrong {
    /// A problem that has no place in a text.
    pub fn nowhere(code: &'static str) -> Self {
        Wrong { code, line: 0, column: 0, offset: 0 }
    }
}

#[derive(Debug)]
pub enum CodecError {
    Wrong(Wrong),
    Io(io::Error),
    /// The one who watches the work asked for it to stop.
    Stopped,
    /// The computer has no memory left for what the work needs.
    NoMemory,
}

impl From<io::Error> for CodecError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::OutOfMemory {
            CodecError::NoMemory
        } else {
            CodecError::Io(error)
        }
    }
}

impl From<Wrong> for CodecError {
    fn from(wrong: Wrong) -> Self {
        CodecError::Wrong(wrong)
    }
}

/// Where in a text the byte that is next stands, counted as it goes by.
#[derive(Debug, Clone, Copy)]
pub struct Place {
    line: u64,
    offset: u64,
    line_start: u64,
}

impl Default for Place {
    fn default() -> Self {
        Place { line: 1, offset: 0, line_start: 0 }
    }
}

impl Place {
    /// One more byte went by.
    pub fn pass(&mut self, byte: u8) {
        // A byte that only continues a letter adds nothing; a letter of four bytes is two units.
        if byte & 0xC0 != 0x80 {
            self.offset += if byte >= 0xF0 { 2 } else { 1 };
        }
        if byte == b'\n' {
            self.line += 1;
            self.line_start = self.offset;
        }
    }

    /// One more letter went by.
    pub fn pass_letter(&mut self, letter: char) {
        let mut bytes = [0u8; 4];
        letter.encode_utf8(&mut bytes).bytes().for_each(|byte| self.pass(byte));
    }

    /// A problem with the byte that is next.
    pub fn wrong(&self, code: &'static str) -> Wrong {
        Wrong { code, line: self.line, column: self.offset - self.line_start + 1, offset: self.offset }
    }
}

/// One way of turning bytes into other bytes, fed a piece at a time.
pub trait Stage {
    /// Takes the next piece of what is read, and writes what can be written of the result so far.
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError>;
    /// What is read is over: writes what is left, or says that what was read is not whole.
    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError>;
    /// Things worth telling the user of once the work is done (names that were not known…), each with a code.
    fn notes(&self) -> Vec<(&'static str, String)> {
        Vec::new()
    }
    /// What the stage has to say, in its own words, of the problem it stopped on (what a library said of it).
    fn said(&self) -> Option<String> {
        None
    }
}

/// What a run came to.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Done {
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub notes: Vec<(&'static str, String)>,
}

/// Counts what goes through it.
struct Counted<W: Write> {
    out: W,
    written: u64,
}

impl<W: Write> Write for Counted<W> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let written = self.out.write(bytes)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.out.flush()
    }
}

/// What is read is handed over in pieces of this size.
const PIECE: usize = 64 * 1024;

/// Reads `input` to its end, a piece at a time, through `stage` into `output`.
///
/// `watch` is told how many bytes were read, after each piece; when it
/// answers false the work stops with [`CodecError::Stopped`]. What was
/// written until an error is left as it is: the one who called decides what
/// becomes of it.
pub fn drive(mut input: impl Read, output: impl Write, stage: &mut dyn Stage, watch: &mut dyn FnMut(u64) -> bool) -> Result<Done, CodecError> {
    let mut out = Counted { out: output, written: 0 };
    let mut piece = Vec::new();
    if piece.try_reserve_exact(PIECE).is_err() {
        return Err(CodecError::NoMemory);
    }
    piece.resize(PIECE, 0);
    let mut read_in_all = 0u64;
    loop {
        let read = match input.read(&mut piece) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error.into()),
        };
        stage.push(&piece[..read], &mut out)?;
        read_in_all += read as u64;
        if !watch(read_in_all) {
            return Err(CodecError::Stopped);
        }
    }
    stage.finish(&mut out)?;
    out.flush()?;
    Ok(Done { bytes_in: read_in_all, bytes_out: out.written, notes: stage.notes() })
}

/// Letters of a text that came in pieces: a letter cut by the end of a piece waits for its other bytes.
///
/// Gives back the part of `held + piece` that is whole letters, and keeps the rest for the next piece. What is not
/// UTF-8 is a problem with a place.
#[derive(Default)]
pub struct Letters {
    held: Vec<u8>,
    place: Place,
}

impl Letters {
    /// The whole letters of what was held and of this piece, as one text.
    pub fn take(&mut self, piece: &[u8]) -> Result<String, CodecError> {
        let mut bytes = std::mem::take(&mut self.held);
        if bytes.try_reserve(piece.len()).is_err() {
            return Err(CodecError::NoMemory);
        }
        bytes.extend_from_slice(piece);
        match String::from_utf8(bytes) {
            Ok(text) => {
                text.bytes().for_each(|byte| self.place.pass(byte));
                Ok(text)
            }
            Err(error) => {
                let whole = error.utf8_error().valid_up_to();
                let cut_short = error.utf8_error().error_len().is_none();
                let mut bytes = error.into_bytes();
                bytes[..whole].iter().for_each(|&byte| self.place.pass(byte));
                if !cut_short {
                    return Err(self.place.wrong("not-utf8").into());
                }
                self.held = bytes.split_off(whole);
                // The bytes before the cut were just found to be text.
                Ok(String::from_utf8(bytes).unwrap_or_default())
            }
        }
    }

    /// What is read is over: a letter that was waiting for its other bytes never got them.
    pub fn end(&self) -> Result<(), CodecError> {
        if self.held.is_empty() {
            Ok(())
        } else {
            Err(self.place.wrong("not-utf8").into())
        }
    }
}

#[cfg(test)]
pub mod tests {
    use super::*;

    /// Runs a stage on some bytes, handed over `at_once` at a time: nothing may depend on where a piece ends.
    pub fn through(stage: &mut dyn Stage, bytes: &[u8], at_once: usize) -> Result<Vec<u8>, CodecError> {
        let mut out = Vec::new();
        for piece in bytes.chunks(at_once.max(1)) {
            stage.push(piece, &mut out)?;
        }
        stage.finish(&mut out)?;
        Ok(out)
    }

    /// The code of the problem a run ended in, with its line and column.
    pub fn problem(result: Result<Vec<u8>, CodecError>) -> (&'static str, u64, u64) {
        match result {
            Err(CodecError::Wrong(wrong)) => (wrong.code, wrong.line, wrong.column),
            other => panic!("not a problem with a place: {other:?}"),
        }
    }

    struct Doubles;
    impl Stage for Doubles {
        fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
            for &byte in piece {
                out.write_all(&[byte, byte])?;
            }
            Ok(())
        }
        fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
            out.write_all(b"!").map_err(Into::into)
        }
    }

    #[test]
    fn drives_a_stage_and_counts_what_went_through() {
        let mut out = Vec::new();
        let done = drive(&b"abc"[..], &mut out, &mut Doubles, &mut |_| true).expect("done");
        assert_eq!((out.as_slice(), done.bytes_in, done.bytes_out), (&b"aabbcc!"[..], 3, 7));
        assert!(matches!(drive(&b"abc"[..], std::io::sink(), &mut Doubles, &mut |_| false), Err(CodecError::Stopped)));
    }

    #[test]
    fn letters_cut_by_a_piece_are_put_together() {
        let text = "aé€😀b";
        for at_once in 1..=text.len() {
            let mut letters = Letters::default();
            let mut whole = String::new();
            for piece in text.as_bytes().chunks(at_once) {
                whole.push_str(&letters.take(piece).expect("text"));
            }
            letters.end().expect("whole");
            assert_eq!(whole, text, "{at_once} at a time");
        }
        let mut letters = Letters::default();
        assert!(matches!(letters.take(b"ab\xffc"), Err(CodecError::Wrong(Wrong { code: "not-utf8", line: 1, column: 3, .. }))));
        let mut letters = Letters::default();
        letters.take(b"a\xe2\x82").expect("so far");
        assert!(letters.end().is_err());
    }
}
