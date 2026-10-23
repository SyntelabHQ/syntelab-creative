//! Text files: read with the encoding and the line endings they have, and
//! written back the same way or as the user chose.
//!
//! Inside the program a text is always Unicode with `\n` between its lines;
//! what a file had is remembered beside it, so that saving changes nothing
//! the user did not change.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, UTF_8};

/// How the lines of a file end.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LineEnding {
    /// `\n`: Linux, macOS.
    Lf,
    /// `\r\n`: Windows.
    CrLf,
    /// `\r`: old Mac files.
    Cr,
}

impl LineEnding {
    pub fn name(self) -> &'static str {
        match self {
            LineEnding::Lf => "lf",
            LineEnding::CrLf => "crlf",
            LineEnding::Cr => "cr",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "lf" => Some(LineEnding::Lf),
            "crlf" => Some(LineEnding::CrLf),
            "cr" => Some(LineEnding::Cr),
            _ => None,
        }
    }

    fn text(self) -> &'static str {
        match self {
            LineEnding::Lf => "\n",
            LineEnding::CrLf => "\r\n",
            LineEnding::Cr => "\r",
        }
    }
}

/// A text as its file has it.
#[derive(Debug, PartialEq, Eq)]
pub struct ReadText {
    /// The text, with `\n` between its lines whatever the file had.
    pub text: String,
    /// The name of the encoding, as the web names it: `UTF-8`, `windows-1250`…
    pub encoding: &'static str,
    /// The file starts with a byte order mark.
    pub mark: bool,
    /// The line ending the file uses most; what the system uses when it has one line.
    pub line_ending: LineEnding,
    /// The file has lines that end in different ways.
    pub mixed_endings: bool,
    /// Some bytes were not text in that encoding; they show as `�`.
    pub damaged: bool,
}

#[derive(Debug)]
pub enum FileError {
    /// The file could not be read or written.
    Io(io::Error),
    /// The file is not text (a picture, a program…).
    NotText,
    /// The encoding asked for is not one the program knows.
    UnknownEncoding(String),
    /// The text has letters the encoding asked for cannot write; the first of them is given.
    CannotEncode(char),
}

impl std::fmt::Display for FileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FileError::Io(error) => write!(f, "{error}"),
            FileError::NotText => f.write_str("the file is not text"),
            FileError::UnknownEncoding(name) => write!(f, "unknown encoding: {name}"),
            FileError::CannotEncode(letter) => write!(f, "the encoding cannot write {letter:?}"),
        }
    }
}

impl From<io::Error> for FileError {
    fn from(error: io::Error) -> Self {
        FileError::Io(error)
    }
}

/// The encodings offered for saving, by the names the web gives them. Any
/// other name `encoding_rs` knows is accepted too.
pub const ENCODINGS: &[&str] = &[
    "UTF-8",
    "UTF-16LE",
    "UTF-16BE",
    "windows-1250",
    "windows-1251",
    "windows-1252",
    "windows-1253",
    "windows-1254",
    "windows-1255",
    "windows-1256",
    "windows-1257",
    "windows-1258",
    "ISO-8859-2",
    "ISO-8859-5",
    "ISO-8859-7",
    "ISO-8859-15",
    "ISO-8859-16",
    "KOI8-R",
    "KOI8-U",
    "IBM866",
    "macintosh",
    "Shift_JIS",
    "EUC-JP",
    "GBK",
    "gb18030",
    "Big5",
    "EUC-KR",
];

/// What the system uses for a new text.
pub fn system_line_ending() -> LineEnding {
    if cfg!(windows) {
        LineEnding::CrLf
    } else {
        LineEnding::Lf
    }
}

/// Reads a text file. `encoding` forces how its bytes are read (to open
/// again a file that was guessed wrong); without it the file's own mark is
/// followed, then UTF-8 when the bytes are valid UTF-8, then a guess.
pub fn read_text(path: &Path, encoding: Option<&str>) -> Result<ReadText, FileError> {
    decode(&fs::read(path)?, encoding)
}

/// Like [`read_text`], from bytes that are already in memory.
pub fn decode(bytes: &[u8], encoding: Option<&str>) -> Result<ReadText, FileError> {
    let marked = Encoding::for_bom(bytes);
    let (chosen, mark_length) = match (encoding, marked) {
        (Some(name), _) => {
            let asked = Encoding::for_label(name.as_bytes()).ok_or_else(|| FileError::UnknownEncoding(name.to_owned()))?;
            // A mark of that same encoding is not part of the text.
            (asked, marked.filter(|(found, _)| *found == asked).map_or(0, |(_, length)| length))
        }
        (None, Some((found, length))) => (found, length),
        (None, None) => (guess(bytes)?, 0),
    };
    let (decoded, damaged) = chosen.decode_without_bom_handling(&bytes[mark_length..]);
    let (text, line_ending, mixed_endings) = with_plain_endings(&decoded);
    Ok(ReadText { text, encoding: chosen.name(), mark: mark_length > 0, line_ending, mixed_endings, damaged })
}

/// The encoding of a text, from its start: the one its mark names (with the length of the mark), else a guess.
pub fn sniff(start: &[u8]) -> Result<(&'static Encoding, usize), FileError> {
    match Encoding::for_bom(start) {
        Some(marked) => Ok(marked),
        None => Ok((guess(start)?, 0)),
    }
}

/// The encoding of bytes that carry no mark: told by the code Scribe shares with Dev.
fn guess(bytes: &[u8]) -> Result<&'static Encoding, FileError> {
    syntelab_encoding::guess(bytes).ok_or(FileError::NotText)
}

/// The text with `\n` between its lines, the ending it used most, and whether it used more than one.
fn with_plain_endings(text: &str) -> (String, LineEnding, bool) {
    let (mut crlf, mut lf, mut cr) = (0_usize, 0_usize, 0_usize);
    let mut plain = String::with_capacity(text.len());
    let mut letters = text.chars().peekable();
    while let Some(letter) = letters.next() {
        match letter {
            '\r' if letters.peek() == Some(&'\n') => {
                letters.next();
                crlf += 1;
                plain.push('\n');
            }
            '\r' => {
                cr += 1;
                plain.push('\n');
            }
            '\n' => {
                lf += 1;
                plain.push('\n');
            }
            other => plain.push(other),
        }
    }
    let ending = if crlf + lf + cr == 0 {
        system_line_ending()
    } else if crlf >= lf && crlf >= cr {
        LineEnding::CrLf
    } else if lf >= cr {
        LineEnding::Lf
    } else {
        LineEnding::Cr
    };
    let kinds = [crlf, lf, cr].iter().filter(|count| **count > 0).count();
    (plain, ending, kinds > 1)
}

/// How a text is written to its file.
#[derive(Debug, Clone, Copy)]
pub struct WriteAs<'a> {
    pub encoding: &'a str,
    /// Start the file with a byte order mark (only UTF-8 and UTF-16 have one).
    pub mark: bool,
    pub line_ending: LineEnding,
}

/// The bytes of a text (with `\n` between its lines) written as asked.
pub fn encode(text: &str, how: WriteAs<'_>) -> Result<Vec<u8>, FileError> {
    let encoding = Encoding::for_label(how.encoding.as_bytes()).ok_or_else(|| FileError::UnknownEncoding(how.encoding.to_owned()))?;
    let ended = if how.line_ending == LineEnding::Lf { std::borrow::Cow::Borrowed(text) } else { std::borrow::Cow::Owned(text.replace('\n', how.line_ending.text())) };
    let mut bytes = Vec::with_capacity(ended.len() + 3);
    if encoding == UTF_16LE || encoding == UTF_16BE {
        // `encoding_rs` only reads UTF-16; writing it is simple enough to do here.
        let little = encoding == UTF_16LE;
        if how.mark {
            bytes.extend_from_slice(if little { &[0xFF, 0xFE] } else { &[0xFE, 0xFF] });
        }
        for unit in ended.encode_utf16() {
            bytes.extend_from_slice(&if little { unit.to_le_bytes() } else { unit.to_be_bytes() });
        }
        return Ok(bytes);
    }
    if encoding == UTF_8 && how.mark {
        bytes.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
    }
    let (encoded, _, unmappable) = encoding.encode(&ended);
    if unmappable {
        // Said with the letter, so the user can find it; nothing is written with letters turned into something else.
        let lost = ended.chars().find(|letter| encoding.encode(letter.encode_utf8(&mut [0; 4])).2).unwrap_or('?');
        return Err(FileError::CannotEncode(lost));
    }
    bytes.extend_from_slice(&encoded);
    Ok(bytes)
}

/// Writes a text to `path`. The file appears under its name only when it is
/// whole: it is written beside it first, then moved into place.
pub fn write_text(path: &Path, text: &str, how: WriteAs<'_>) -> Result<(), FileError> {
    let bytes = encode(text, how)?;
    let partial = partial_path(path);
    let written = fs::File::create(&partial).and_then(|mut file| {
        file.write_all(&bytes)?;
        file.sync_all()
    });
    let moved = written.and_then(|()| fs::rename(&partial, path));
    if moved.is_err() {
        let _ = fs::remove_file(&partial);
    }
    Ok(moved?)
}

/// Where a file is written before it is moved into place under its own name.
pub(crate) fn partial_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(".saving");
    path.with_file_name(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn written(text: &str, encoding: &str, mark: bool, line_ending: LineEnding) -> Vec<u8> {
        encode(text, WriteAs { encoding, mark, line_ending }).expect("encodes")
    }

    #[test]
    fn reads_utf8_with_and_without_its_mark() {
        let plain = decode("Șase țări\n".as_bytes(), None).expect("reads");
        assert_eq!((plain.text.as_str(), plain.encoding, plain.mark, plain.damaged), ("Șase țări\n", "UTF-8", false, false));
        let marked = decode(b"\xEF\xBB\xBFabc", None).expect("reads");
        assert_eq!((marked.text.as_str(), marked.encoding, marked.mark), ("abc", "UTF-8", true));
    }

    #[test]
    fn finds_the_line_endings_and_gives_plain_ones() {
        let windows = decode(b"one\r\ntwo\r\nthree", None).expect("reads");
        assert_eq!((windows.text.as_str(), windows.line_ending, windows.mixed_endings), ("one\ntwo\nthree", LineEnding::CrLf, false));
        let old_mac = decode(b"one\rtwo", None).expect("reads");
        assert_eq!((old_mac.text.as_str(), old_mac.line_ending), ("one\ntwo", LineEnding::Cr));
        let mixed = decode(b"one\ntwo\r\nthree\n", None).expect("reads");
        assert_eq!((mixed.text.as_str(), mixed.line_ending, mixed.mixed_endings), ("one\ntwo\nthree\n", LineEnding::Lf, true));
        assert_eq!(decode(b"one line", None).expect("reads").line_ending, system_line_ending());
    }

    #[test]
    fn reads_utf16_with_a_mark_and_without() {
        let little = written("Șapte", "UTF-16LE", true, LineEnding::Lf);
        let read = decode(&little, None).expect("reads");
        assert_eq!((read.text.as_str(), read.encoding, read.mark), ("Șapte", "UTF-16LE", true));
        // Without a mark it is known by the zeros between plain letters.
        let bare = written("plain letters, a whole line of them", "UTF-16BE", false, LineEnding::Lf);
        let read = decode(&bare, None).expect("reads");
        assert_eq!((read.text.as_str(), read.encoding, read.mark), ("plain letters, a whole line of them", "UTF-16BE", false));
    }

    #[test]
    fn guesses_an_old_encoding_and_can_be_told_another() {
        // Czech as old Windows programs wrote it.
        let old = written("Příliš žluťoučký kůň úpěl ďábelské ódy, a to je všechno, co se o něm dá říci", "windows-1250", false, LineEnding::Lf);
        assert!(std::str::from_utf8(&old).is_err());
        let guessed = decode(&old, None).expect("reads");
        assert_eq!(guessed.encoding, "windows-1250");
        assert_eq!(guessed.text, "Příliš žluťoučký kůň úpěl ďábelské ódy, a to je všechno, co se o něm dá říci");
        // Told the encoding, it is read in it whatever a guess would say.
        let told = decode(&old, Some("windows-1252")).expect("reads");
        assert_eq!(told.encoding, "windows-1252");
        assert_ne!(told.text, guessed.text);
        assert!(matches!(decode(&old, Some("no-such-encoding")), Err(FileError::UnknownEncoding(_))));
    }

    #[test]
    fn refuses_what_is_not_text() {
        assert!(matches!(decode(&[0x89, b'P', b'N', b'G', 0, 0, 0, 13, 1, 2, 3, 0, 0, 9], None), Err(FileError::NotText)));
        // An empty file is an empty text.
        assert_eq!(decode(b"", None).expect("reads").text, "");
    }

    #[test]
    fn says_when_bytes_are_not_text_in_the_encoding() {
        assert!(decode(b"abc\xFFdef", Some("UTF-8")).expect("reads").damaged);
    }

    #[test]
    fn writes_the_line_endings_and_the_mark_asked_for() {
        assert_eq!(written("a\nb", "UTF-8", false, LineEnding::CrLf), b"a\r\nb");
        assert_eq!(written("a\nb", "UTF-8", true, LineEnding::Lf), b"\xEF\xBB\xBFa\nb");
        assert_eq!(written("a\nb", "UTF-8", false, LineEnding::Cr), b"a\rb");
        assert_eq!(written("a", "UTF-16LE", true, LineEnding::Lf), [0xFF, 0xFE, b'a', 0]);
    }

    #[test]
    fn refuses_to_write_letters_the_encoding_does_not_have() {
        let refused = encode("price: 5 €, 日本", WriteAs { encoding: "windows-1250", mark: false, line_ending: LineEnding::Lf });
        assert!(matches!(refused, Err(FileError::CannotEncode('日'))), "{refused:?}");
    }

    #[test]
    fn a_file_comes_back_as_it_was_written() {
        let dir = std::env::temp_dir().join(format!("scribe-files-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("folder");
        let path = dir.join("text.txt");
        write_text(&path, "întâi\nal doilea\n", WriteAs { encoding: "ISO-8859-16", mark: false, line_ending: LineEnding::CrLf }).expect("writes");
        assert!(!dir.join("text.txt.saving").exists());
        let read = read_text(&path, Some("ISO-8859-16")).expect("reads");
        assert_eq!((read.text.as_str(), read.line_ending), ("întâi\nal doilea\n", LineEnding::CrLf));
        let _ = fs::remove_dir_all(&dir);
    }
}
