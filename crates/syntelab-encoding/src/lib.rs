//! Telling how the bytes of a text are written, and reading them.
//!
//! A text may carry a mark at its start that names its encoding. Without
//! one, bytes that are valid UTF-8 are UTF-8; bytes with a zero in every
//! other place are UTF-16; and the rest is guessed from the letters the
//! bytes would make in each of the old encodings. Bytes that are no text at
//! all (zeros here and there) are told so, not guessed at.

pub use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};

/// The encoding of a text, from its bytes (or from its start): the one its mark names, with the length of the
/// mark, else a guess. None when the bytes are not text.
pub fn sniff(start: &[u8]) -> Option<(&'static Encoding, usize)> {
    match Encoding::for_bom(start) {
        Some(marked) => Some(marked),
        None => guess(start).map(|guessed| (guessed, 0)),
    }
}

/// The encoding of bytes that carry no mark. None when they are not text.
pub fn guess(bytes: &[u8]) -> Option<&'static Encoding> {
    if std::str::from_utf8(bytes).is_ok() {
        // Text has no zero bytes; what has them and is valid UTF-8 is something else (or UTF-16 of plain letters).
        return if bytes.contains(&0) { wide_or_not_text(bytes) } else { Some(UTF_8) };
    }
    if bytes.contains(&0) {
        return wide_or_not_text(bytes);
    }
    let mut detector = chardetng::EncodingDetector::new();
    detector.feed(bytes, true);
    Some(detector.guess(None, true))
}

/// UTF-16 without a mark shows as a zero in every other byte of plain letters; anything else with zeros is not text.
fn wide_or_not_text(bytes: &[u8]) -> Option<&'static Encoding> {
    let looked_at = &bytes[..bytes.len().min(4096) & !1];
    if looked_at.len() < 2 {
        return None;
    }
    let pairs = looked_at.len() / 2;
    let zeros_at = |offset: usize| looked_at.iter().skip(offset).step_by(2).filter(|byte| **byte == 0).count();
    let (first, second) = (zeros_at(0), zeros_at(1));
    // Most pairs have their zero on one side, and almost none on the other.
    if second * 10 >= pairs * 6 && first * 10 <= pairs {
        Some(UTF_16LE)
    } else if first * 10 >= pairs * 6 && second * 10 <= pairs {
        Some(UTF_16BE)
    } else {
        None
    }
}

/// Bytes read as text, however they are written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Read {
    pub text: String,
    /// The name the web gives the encoding: `UTF-8`, `UTF-16LE`, `windows-1252`…
    pub encoding: &'static str,
    /// Some bytes were no letter of that encoding, and were read as the sign that stands for such.
    pub damaged: bool,
}

/// Reads bytes as text: by their mark, as UTF-8 when they are that, else by a guess. None when they are not text.
pub fn read(bytes: &[u8]) -> Option<Read> {
    let (encoding, mark) = sniff(bytes)?;
    let (text, damaged) = encoding.decode_without_bom_handling(&bytes[mark..]);
    Some(Read { text: text.into_owned(), encoding: encoding.name(), damaged })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_text_by_its_mark_and_without_one() {
        assert_eq!(read("plain ășț".as_bytes()), Some(Read { text: "plain ășț".into(), encoding: "UTF-8", damaged: false }));
        assert_eq!(read(b"\xEF\xBB\xBFmarked").map(|read| read.text), Some("marked".into()));
        // UTF-16 with its mark, and without (plain letters have a zero in every other byte).
        let wide: Vec<u8> = "wide text".encode_utf16().flat_map(u16::to_le_bytes).collect();
        let marked = [&[0xFF, 0xFE][..], &wide].concat();
        assert_eq!(read(&marked), Some(Read { text: "wide text".into(), encoding: "UTF-16LE", damaged: false }));
        assert_eq!(read(&wide).map(|read| (read.text, read.encoding)), Some(("wide text".into(), "UTF-16LE")));
        let big: Vec<u8> = "wide text".encode_utf16().flat_map(u16::to_be_bytes).collect();
        assert_eq!(read(&big).map(|read| read.encoding), Some("UTF-16BE"));
    }

    #[test]
    fn guesses_an_old_encoding_from_its_letters() {
        // A sentence in French, written in windows-1252.
        let french = b"Ceci est un texte fran\xE7ais avec des lettres accentu\xE9es : \xE9 \xE8 \xE0 \xE7 \xF9.";
        let read = read(french).expect("text");
        assert_eq!(read.encoding, "windows-1252");
        assert!(read.text.contains("français") && read.text.contains("accentuées"));
    }

    #[test]
    fn tells_what_is_not_text() {
        assert_eq!(read(b"\x00\x01\x02binary\x00\x00\xFF\xFE\x00junk\x03\x00\x00\x00\x07"), None);
        assert_eq!(read(b"PK\x03\x04\x14\x00\x00\x00\x08\x00"), None);
        assert_eq!(guess(b""), Some(UTF_8));
    }
}
