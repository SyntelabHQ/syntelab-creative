//! A text written as the inside of a string in code, and read back: for JSON, for JavaScript, for C and the
//! languages that write strings as C does.
//!
//! What is given and what comes out is what stands between the quotes, without the quotes themselves.

use std::io::Write;

use crate::codec::{CodecError, Letters, Place, Stage};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Flavor {
    Json,
    JavaScript,
    C,
}

pub struct Escape {
    flavor: Flavor,
    letters: Letters,
}

impl Escape {
    pub fn new(flavor: Flavor) -> Self {
        Escape { flavor, letters: Letters::default() }
    }
}

impl Stage for Escape {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        let mut written = String::with_capacity(text.len() + text.len() / 8);
        for letter in text.chars() {
            let short = match letter {
                '"' => Some("\\\""),
                '\\' => Some("\\\\"),
                '\n' => Some("\\n"),
                '\r' => Some("\\r"),
                '\t' => Some("\\t"),
                '\u{8}' => Some("\\b"),
                '\u{c}' => Some("\\f"),
                '\'' if self.flavor != Flavor::Json => Some("\\'"),
                '\u{b}' if self.flavor != Flavor::Json => Some("\\v"),
                '\u{7}' if self.flavor == Flavor::C => Some("\\a"),
                _ => None,
            };
            match (short, self.flavor) {
                (Some(short), _) => written.push_str(short),
                (None, Flavor::Json) if letter < ' ' => written.push_str(&format!("\\u{:04x}", u32::from(letter))),
                (None, Flavor::JavaScript) if letter < ' ' || letter == '\u{7f}' => written.push_str(&format!("\\x{:02x}", u32::from(letter))),
                // The two line breaks a JavaScript string cannot hold as they are.
                (None, Flavor::JavaScript) if matches!(letter, '\u{2028}' | '\u{2029}') => written.push_str(&format!("\\u{:04x}", u32::from(letter))),
                // Three octal digits: a number in hexadecimal would swallow the letters after it.
                (None, Flavor::C) if letter < ' ' || letter == '\u{7f}' => written.push_str(&format!("\\{:03o}", u32::from(letter))),
                _ => written.push(letter),
            }
        }
        out.write_all(written.as_bytes()).map_err(Into::into)
    }

    fn finish(&mut self, _out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()
    }
}

/// Inside an escape, what is being read.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Reading {
    Plain,
    /// After a backslash.
    Slash,
    /// Hexadecimal digits: how many are still to come, the number so far, and whether they give a UTF-16 unit
    /// (`\uXXXX`) or a byte (`\xHH`).
    Hex { left: u8, value: u32, unit: bool },
    /// After `\u{`: the number so far, and how many digits it has.
    Braced { value: u32, digits: u8 },
    /// Octal digits (of C, and the old escapes of JavaScript): how many were read, and the number so far.
    Octal { read: u8, value: u32 },
    /// After a backslash and a carriage return: a line feed that follows belongs to the same line break.
    BrokenLine,
}

pub struct Unescape {
    flavor: Flavor,
    letters: Letters,
    reading: Reading,
    /// The first half of a pair (`\ud83d`), waiting for its second half.
    high: Option<u32>,
    place: Place,
    /// Where the backslash of the escape that is being read stands.
    slash_at: Place,
}

impl Unescape {
    pub fn new(flavor: Flavor) -> Self {
        Unescape { flavor, letters: Letters::default(), reading: Reading::Plain, high: None, place: Place::default(), slash_at: Place::default() }
    }

    /// A first half that got no second half is no letter: the sign for that stands in its place.
    fn drop_high(&mut self, written: &mut Vec<u8>) {
        if self.high.take().is_some() {
            written.extend_from_slice("\u{FFFD}".as_bytes());
        }
    }

    fn letter(&mut self, letter: char, written: &mut Vec<u8>) {
        self.drop_high(written);
        written.extend_from_slice(letter.encode_utf8(&mut [0; 4]).as_bytes());
    }

    /// A UTF-16 unit given by `\uXXXX`: a letter, or one half of a pair.
    fn unit(&mut self, unit: u32, written: &mut Vec<u8>) {
        match (self.high, unit) {
            (Some(high), 0xDC00..=0xDFFF) => {
                self.high = None;
                let point = 0x10000 + ((high - 0xD800) << 10) + (unit - 0xDC00);
                self.letter(char::from_u32(point).unwrap_or('\u{FFFD}'), written);
            }
            (_, 0xD800..=0xDBFF) => {
                self.drop_high(written);
                self.high = Some(unit);
            }
            _ => self.letter(char::from_u32(unit).unwrap_or('\u{FFFD}'), written),
        }
    }

    /// A byte given by `\xHH` or by octal digits: in C it is that byte; in JavaScript, the letter with that number.
    fn byte(&mut self, value: u32, written: &mut Vec<u8>) {
        if self.flavor == Flavor::C {
            self.drop_high(written);
            written.push(value as u8);
        } else {
            self.letter(char::from_u32(value).unwrap_or('\u{FFFD}'), written);
        }
    }

    fn bad(&self, code: &'static str) -> CodecError {
        self.slash_at.wrong(code).into()
    }

    /// The letter after a backslash.
    fn after_slash(&mut self, letter: char, written: &mut Vec<u8>) -> Result<Reading, CodecError> {
        let plain = match letter {
            '"' | '\\' | '/' => Some(letter),
            'n' => Some('\n'),
            'r' => Some('\r'),
            't' => Some('\t'),
            'b' => Some('\u{8}'),
            'f' => Some('\u{c}'),
            '\'' if self.flavor != Flavor::Json => Some('\''),
            'v' if self.flavor != Flavor::Json => Some('\u{b}'),
            'a' if self.flavor == Flavor::C => Some('\u{7}'),
            '?' if self.flavor == Flavor::C => Some('?'),
            'e' if self.flavor == Flavor::C => Some('\u{1b}'),
            _ => None,
        };
        if let Some(plain) = plain {
            self.letter(plain, written);
            return Ok(Reading::Plain);
        }
        Ok(match (letter, self.flavor) {
            ('u', Flavor::Json | Flavor::C | Flavor::JavaScript) => Reading::Hex { left: 4, value: 0, unit: true },
            // A whole code point in eight digits, as C and C++ write it.
            ('U', Flavor::C) => Reading::Hex { left: 8, value: 0, unit: true },
            ('x', Flavor::JavaScript | Flavor::C) => Reading::Hex { left: 2, value: 0, unit: false },
            // In JavaScript too, outside strict code: `\101` is `A`, and `\0` alone is the letter 0.
            ('0'..='7', Flavor::C | Flavor::JavaScript) => Reading::Octal { read: 1, value: letter as u32 - '0' as u32 },
            // A backslash at the end of a line of JavaScript: the string goes on, and the line break is not part of it.
            ('\n' | '\u{2028}' | '\u{2029}', Flavor::JavaScript) => Reading::Plain,
            ('\r', Flavor::JavaScript) => Reading::BrokenLine,
            // Any other letter after a backslash is itself, in JavaScript.
            (_, Flavor::JavaScript) => {
                self.letter(letter, written);
                Reading::Plain
            }
            _ => return Err(self.bad("bad-escape")),
        })
    }

    fn one(&mut self, letter: char, written: &mut Vec<u8>) -> Result<(), CodecError> {
        self.reading = match self.reading {
            Reading::Plain if letter == '\\' => {
                self.slash_at = self.place;
                Reading::Slash
            }
            Reading::Plain => {
                self.letter(letter, written);
                Reading::Plain
            }
            Reading::Slash => self.after_slash(letter, written)?,
            // `\u{1F600}` of JavaScript: told from `\uXXXX` by the brace that comes first.
            Reading::Hex { left: 4, value: 0, unit: true } if letter == '{' && self.flavor == Flavor::JavaScript => Reading::Braced { value: 0, digits: 0 },
            Reading::Hex { left, value, unit } => {
                let Some(digit) = letter.to_digit(16) else { return Err(self.bad(if unit { "bad-unicode-escape" } else { "bad-hex-escape" })) };
                let value = (value << 4) | digit;
                if left == 1 {
                    if unit {
                        self.unit(value, written);
                    } else {
                        self.byte(value, written);
                    }
                    Reading::Plain
                } else {
                    Reading::Hex { left: left - 1, value, unit }
                }
            }
            Reading::Braced { value, digits } => match letter.to_digit(16) {
                Some(digit) if digits < 6 => Reading::Braced { value: (value << 4) | digit, digits: digits + 1 },
                None if letter == '}' && digits > 0 && value <= 0x10FFFF => {
                    self.letter(char::from_u32(value).unwrap_or('\u{FFFD}'), written);
                    Reading::Plain
                }
                _ => return Err(self.bad("bad-unicode-escape")),
            },
            // JavaScript takes no more digits than make a number up to 0o377; C takes three.
            Reading::Octal { read, value } => match letter.to_digit(8) {
                Some(digit) if read < 3 && (self.flavor == Flavor::C || (value << 3) | digit <= 0o377) => Reading::Octal { read: read + 1, value: (value << 3) | digit },
                _ => {
                    self.byte(value & 0xFF, written);
                    // The letter that ended the number is read again as what follows it.
                    self.reading = Reading::Plain;
                    return self.one(letter, written);
                }
            },
            Reading::BrokenLine if letter == '\n' => Reading::Plain,
            Reading::BrokenLine => {
                self.reading = Reading::Plain;
                return self.one(letter, written);
            }
        };
        Ok(())
    }
}

impl Stage for Unescape {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        let mut written = Vec::with_capacity(text.len());
        for letter in text.chars() {
            self.one(letter, &mut written)?;
            letter.encode_utf8(&mut [0; 4]).bytes().for_each(|byte| self.place.pass(byte));
        }
        out.write_all(&written).map_err(Into::into)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        let mut written = Vec::new();
        match self.reading {
            Reading::Plain | Reading::BrokenLine => {}
            Reading::Octal { value, .. } => self.byte(value & 0xFF, &mut written),
            Reading::Slash => return Err(self.bad("bad-escape")),
            Reading::Hex { unit: false, .. } => return Err(self.bad("bad-hex-escape")),
            Reading::Hex { .. } | Reading::Braced { .. } => return Err(self.bad("bad-unicode-escape")),
        }
        self.drop_high(&mut written);
        out.write_all(&written).map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn escaped(text: &str, flavor: Flavor) -> String {
        String::from_utf8(through(&mut Escape::new(flavor), text.as_bytes(), 3).expect("escaped")).expect("text")
    }

    fn unescaped(text: &str, flavor: Flavor, at_once: usize) -> Result<Vec<u8>, CodecError> {
        through(&mut Unescape::new(flavor), text.as_bytes(), at_once)
    }

    fn back(text: &str, flavor: Flavor) -> String {
        String::from_utf8(unescaped(text, flavor, 2).expect("unescaped")).expect("text")
    }

    #[test]
    fn writes_a_string_for_json_as_json_does() {
        // What `JSON.stringify` puts between the quotes.
        assert_eq!(escaped("He said \"hi\"\n\tC:\\dir é 😀 \u{1}\u{8}\u{c}/'", Flavor::Json), "He said \\\"hi\\\"\\n\\tC:\\\\dir é 😀 \\u0001\\b\\f/'");
    }

    #[test]
    fn writes_a_string_for_javascript_and_for_c() {
        assert_eq!(escaped("it's \"x\"\u{b}\u{1}\u{2028}é", Flavor::JavaScript), "it\\'s \\\"x\\\"\\v\\x01\\u2028é");
        assert_eq!(escaped("it's \"x\"\u{7}\u{1}\u{7f}é", Flavor::C), "it\\'s \\\"x\\\"\\a\\001\\177é");
    }

    #[test]
    fn what_was_written_reads_back_the_same() {
        let text = "He said \"hi\"\n\tC:\\dir é 😀 \u{0}\u{1}\u{7}\u{8}\u{b}\u{c}\u{7f}/'\u{2028}7";
        for flavor in [Flavor::Json, Flavor::JavaScript, Flavor::C] {
            for at_once in 1..=5 {
                assert_eq!(String::from_utf8(unescaped(&escaped(text, flavor), flavor, at_once).expect("unescaped")).expect("text"), text, "{flavor:?} {at_once}");
            }
        }
    }

    #[test]
    fn reads_the_escapes_of_each_language() {
        assert_eq!(back("\\u00e9\\ud83d\\ude00\\/ \\ud83dx", Flavor::Json), "é😀/ \u{FFFD}x");
        assert_eq!(back("\\x41\\u{1F600}\\0\\q\\\r\nz", Flavor::JavaScript), "A😀\0qz");
        assert_eq!(back("\\101\\x41\\0\\e[0m\\?", Flavor::C), "AA\0\u{1b}[0m?");
        // The old octal escapes of JavaScript: up to three digits, never beyond 0o377.
        assert_eq!(back("\\101\\08\\477\\1a", Flavor::JavaScript), "A\08'7\u{1}a");
        assert_eq!(back("\\U0001F600\\u00e9", Flavor::C), "😀é");
        // A byte of C that is not a letter by itself stays that byte.
        assert_eq!(unescaped("\\xff\\377", Flavor::C, 3).expect("unescaped"), [0xff, 0xff]);
    }

    #[test]
    fn says_what_is_wrong_and_where() {
        assert_eq!(problem(unescaped("ab\\q", Flavor::Json, 2)), ("bad-escape", 1, 3));
        assert_eq!(problem(unescaped("a\nb\\u12g4", Flavor::Json, 2)), ("bad-unicode-escape", 2, 2));
        assert_eq!(problem(unescaped("ab\\", Flavor::Json, 2)), ("bad-escape", 1, 3));
        assert_eq!(problem(unescaped("\\xZ1", Flavor::C, 2)), ("bad-hex-escape", 1, 1));
        assert_eq!(problem(unescaped("\\u{110000}", Flavor::JavaScript, 2)), ("bad-unicode-escape", 1, 1));
    }
}
