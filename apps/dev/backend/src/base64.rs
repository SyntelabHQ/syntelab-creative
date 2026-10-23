//! Base64 (RFC 4648), both ways, as bytes come.
//!
//! Written out: the standard alphabet or the one for URLs and file names,
//! with or without the `=` that fill the last group, on one line or on lines
//! of a chosen length. Read back: either alphabet, with or without the
//! filling, with any white space between the letters.

use std::io::Write;

use crate::codec::{CodecError, Place, Stage};

const STANDARD: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const FOR_URLS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Bytes written as Base64.
pub struct Encode {
    letters: &'static [u8; 64],
    /// The last group is filled with `=` to four letters.
    padding: bool,
    /// Letters to a line; 0 for one line.
    wrap: usize,
    /// One or two bytes that wait for the others of their group of three.
    held: Vec<u8>,
    /// Letters written on the line so far.
    on_line: usize,
}

impl Encode {
    pub fn new(for_urls: bool, padding: bool, wrap: usize) -> Self {
        Encode { letters: if for_urls { FOR_URLS } else { STANDARD }, padding, wrap, held: Vec::with_capacity(3), on_line: 0 }
    }

    fn write(&mut self, letters: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        if self.wrap == 0 {
            return out.write_all(letters).map_err(Into::into);
        }
        for letter in letters {
            if self.on_line == self.wrap {
                out.write_all(b"\n")?;
                self.on_line = 0;
            }
            out.write_all(std::slice::from_ref(letter))?;
            self.on_line += 1;
        }
        Ok(())
    }

    fn group(&self, bytes: &[u8]) -> ([u8; 4], usize) {
        let all = (u32::from(bytes[0]) << 16) | (u32::from(*bytes.get(1).unwrap_or(&0)) << 8) | u32::from(*bytes.get(2).unwrap_or(&0));
        let letter = |shift: u32| self.letters[((all >> shift) & 63) as usize];
        // One byte gives two letters, two give three, three give four.
        ([letter(18), letter(12), letter(6), letter(0)], bytes.len() + 1)
    }
}

impl Stage for Encode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let mut piece = piece;
        // The bytes that waited are the start of the first group.
        while !self.held.is_empty() && self.held.len() < 3 && !piece.is_empty() {
            self.held.push(piece[0]);
            piece = &piece[1..];
        }
        if self.held.len() == 3 {
            let (letters, _) = self.group(&self.held);
            self.held.clear();
            self.write(&letters, out)?;
        }
        if !self.held.is_empty() {
            return Ok(());
        }
        let whole = piece.len() / 3 * 3;
        // Written a stretch at a time, not a group at a time.
        let mut written = Vec::with_capacity(4096);
        for group in piece[..whole].chunks_exact(3) {
            written.extend_from_slice(&self.group(group).0);
            if written.len() >= 4092 {
                self.write(&written, out)?;
                written.clear();
            }
        }
        self.write(&written, out)?;
        self.held.extend_from_slice(&piece[whole..]);
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        if self.held.is_empty() {
            return Ok(());
        }
        let (mut letters, used) = self.group(&self.held);
        self.held.clear();
        if self.padding {
            letters[used..].fill(b'=');
            self.write(&letters, out)
        } else {
            self.write(&letters[..used], out)
        }
    }
}

/// Base64 read back into the bytes it stands for.
#[derive(Default)]
pub struct Decode {
    /// The six bits of each letter of the group that is being read.
    group: [u8; 4],
    read: usize,
    /// A `=` was read: only more of them, and white space, may follow.
    filled: usize,
    /// How many bytes of a mark of UTF-8 (EF BB BF) the text began with, left out; 3 once the start is behind.
    mark: usize,
    place: Place,
}

/// The mark some editors put before a text written in UTF-8: it is no letter of Base64.
const UTF8_MARK: [u8; 3] = [0xEF, 0xBB, 0xBF];

fn six_bits(letter: u8) -> Option<u8> {
    match letter {
        b'A'..=b'Z' => Some(letter - b'A'),
        b'a'..=b'z' => Some(letter - b'a' + 26),
        b'0'..=b'9' => Some(letter - b'0' + 52),
        b'+' | b'-' => Some(62),
        b'/' | b'_' => Some(63),
        _ => None,
    }
}

impl Stage for Decode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let mut written = Vec::with_capacity(4096);
        for &letter in piece {
            if self.mark < 3 {
                if letter == UTF8_MARK[self.mark] {
                    self.mark += 1;
                    self.place.pass(letter);
                    continue;
                }
                if self.mark > 0 {
                    return Err(self.place.wrong("bad-character").into());
                }
                self.mark = 3;
            }
            if matches!(letter, b' ' | b'\t' | b'\r' | b'\n') {
                self.place.pass(letter);
                continue;
            }
            if letter == b'=' {
                // The filling stands only where a group lacks one or two letters.
                if self.read + self.filled >= 4 || self.read < 2 {
                    return Err(self.place.wrong("bad-padding").into());
                }
                self.filled += 1;
                self.place.pass(letter);
                continue;
            }
            let Some(bits) = six_bits(letter) else { return Err(self.place.wrong("bad-character").into()) };
            if self.filled > 0 {
                return Err(self.place.wrong("after-padding").into());
            }
            self.group[self.read] = bits;
            self.read += 1;
            self.place.pass(letter);
            if self.read == 4 {
                let all = (u32::from(self.group[0]) << 18) | (u32::from(self.group[1]) << 12) | (u32::from(self.group[2]) << 6) | u32::from(self.group[3]);
                written.extend_from_slice(&[(all >> 16) as u8, (all >> 8) as u8, all as u8]);
                self.read = 0;
                if written.len() >= 4092 {
                    out.write_all(&written)?;
                    written.clear();
                }
            }
        }
        out.write_all(&written).map_err(Into::into)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        match self.read {
            0 => Ok(()),
            // One letter alone is six bits: not even one byte.
            1 => Err(self.place.wrong("bad-length").into()),
            read => {
                self.group[read..].fill(0);
                let all = (u32::from(self.group[0]) << 18) | (u32::from(self.group[1]) << 12) | (u32::from(self.group[2]) << 6);
                let bytes = [(all >> 16) as u8, (all >> 8) as u8];
                self.read = 0;
                out.write_all(&bytes[..read - 1]).map_err(Into::into)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn encoded(bytes: &[u8], for_urls: bool, padding: bool, wrap: usize, at_once: usize) -> String {
        String::from_utf8(through(&mut Encode::new(for_urls, padding, wrap), bytes, at_once).expect("encoded")).expect("letters")
    }

    fn decoded(text: &str, at_once: usize) -> Result<Vec<u8>, CodecError> {
        through(&mut Decode::default(), text.as_bytes(), at_once)
    }

    #[test]
    fn gives_the_answers_of_the_standard() {
        // The test vectors of RFC 4648, section 10.
        for (plain, coded) in [("", ""), ("f", "Zg=="), ("fo", "Zm8="), ("foo", "Zm9v"), ("foob", "Zm9vYg=="), ("fooba", "Zm9vYmE="), ("foobar", "Zm9vYmFy")] {
            for at_once in 1..=7 {
                assert_eq!(encoded(plain.as_bytes(), false, true, 0, at_once), coded, "{plain} {at_once}");
                assert_eq!(decoded(coded, at_once).expect("decoded"), plain.as_bytes(), "{coded} {at_once}");
            }
        }
    }

    #[test]
    fn both_alphabets_with_and_without_the_filling() {
        let bytes = [0xfb, 0xff, 0xfe, 0x3e];
        assert_eq!(encoded(&bytes, false, true, 0, 9), "+//+Pg==");
        assert_eq!(encoded(&bytes, true, true, 0, 9), "-__-Pg==");
        assert_eq!(encoded(&bytes, true, false, 0, 9), "-__-Pg");
        for coded in ["+//+Pg==", "-__-Pg==", "-__-Pg", "+//+ Pg=\r\n=\n"] {
            assert_eq!(decoded(coded, 3).expect("decoded"), bytes, "{coded}");
        }
    }

    #[test]
    fn wraps_its_lines() {
        let text = encoded(&[0u8; 100], false, true, 76, 7);
        let lines: Vec<&str> = text.split('\n').collect();
        assert_eq!((lines.len(), lines[0].len(), lines[1].len()), (2, 76, 60));
        assert_eq!(decoded(&text, 5).expect("decoded"), [0u8; 100]);
    }

    #[test]
    fn a_mark_of_utf8_before_the_text_is_left_out() {
        for at_once in [1, 2, 4] {
            assert_eq!(decoded("\u{feff}Zm9v", at_once).expect("decoded"), b"foo");
        }
        assert_eq!(problem(decoded("Zm9v\u{feff}", 4)), ("bad-character", 1, 5));
    }

    #[test]
    fn says_what_is_wrong_and_where() {
        assert_eq!(problem(decoded("Zm9v\nYm*y", 4)), ("bad-character", 2, 3));
        assert_eq!(problem(decoded("Zm9vY", 4)), ("bad-length", 1, 6));
        assert_eq!(problem(decoded("Zg==Zg==", 4)), ("after-padding", 1, 5));
        assert_eq!(problem(decoded("Z===", 4)), ("bad-padding", 1, 2));
        assert_eq!(problem(decoded("Zm9v=", 4)), ("bad-padding", 1, 5));
    }

    #[test]
    fn any_bytes_come_back_the_same() {
        let bytes: Vec<u8> = (0..=255u8).cycle().take(10_000).collect();
        for at_once in [1, 2, 3, 4, 5, 1000] {
            let text = encoded(&bytes, false, true, 64, at_once);
            assert_eq!(decoded(&text, at_once).expect("decoded"), bytes);
        }
    }
}
