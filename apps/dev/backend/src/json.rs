//! JSON read as it comes and written again: indented, on one line, or only checked.
//!
//! The text is never held as a whole and no tree is built from it: what is
//! read goes by once, a piece at a time, and what is written leaves as it is
//! made. Memory grows only with how deep the values are nested, so a file is
//! as large as the disk lets it be. Strings and numbers are written back as
//! they were read, letter for letter: no number loses a digit.
//!
//! What is accepted is JSON as RFC 8259 says it, and nothing more: no
//! comments, no comma after the last item, no single quotes. When lenient
//! reading is asked for, comments (`//` and `/* */`) and a comma after the
//! last item are let by, and are not written again: what comes out is always
//! strict JSON.

use std::io::{self, Read, Write};

/// How the values are written again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Style {
    /// Each item on a line of its own, pushed in by so many spaces for each level (none at all for 0).
    Spaces(u8),
    /// The same, pushed in by one tab for each level.
    Tab,
    /// Everything on one line, with no space that is not inside a string.
    Minify,
    /// Nothing is written: the text is only read to the end.
    Check,
}

/// How JSON is read and written again, in full. [`Options::of`] gives the usual: strict reading, a space after
/// each colon, lines ended by a line feed, no line break after the last sign, letters written as they are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Options {
    pub style: Style,
    /// A space after the colon of each key (not when everything goes on one line).
    pub colon_space: bool,
    /// Lines end with a carriage return and a line feed, as Windows has them.
    pub crlf: bool,
    /// A line break after the last sign, as text files have.
    pub final_newline: bool,
    /// Letters that are not ASCII are written as `\uXXXX`.
    pub ascii: bool,
    /// Comments and a comma after the last item are let by.
    pub lenient: bool,
}

impl Options {
    pub fn of(style: Style) -> Self {
        Options { style, colon_space: true, crlf: false, final_newline: false, ascii: false, lenient: false }
    }
}

/// What a text held, once it was read to the end.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Stats {
    pub bytes_in: u64,
    pub bytes_out: u64,
    /// Every value, the ones inside others too: objects, arrays, strings (not keys), numbers, `true`, `false`, `null`.
    pub values: u64,
    /// How deep objects and arrays are nested, at the deepest.
    pub depth: u64,
    pub objects: u64,
    pub arrays: u64,
    /// The keys of every object, each counted where it stands.
    pub keys: u64,
}

/// What is wrong with a text that is not JSON. Each has a code the interface translates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Problem {
    Empty,
    UnexpectedEnd,
    ExpectedValue,
    ExpectedKey,
    ExpectedColon,
    ExpectedCommaOrBrace,
    ExpectedCommaOrBracket,
    BadEscape,
    BadUnicodeEscape,
    ControlCharacter,
    BadNumber,
    BadWord,
    Trailing,
    NotUtf8,
}

impl Problem {
    pub fn code(self) -> &'static str {
        match self {
            Problem::Empty => "empty",
            Problem::UnexpectedEnd => "unexpected-end",
            Problem::ExpectedValue => "expected-value",
            Problem::ExpectedKey => "expected-key",
            Problem::ExpectedColon => "expected-colon",
            Problem::ExpectedCommaOrBrace => "expected-comma-or-brace",
            Problem::ExpectedCommaOrBracket => "expected-comma-or-bracket",
            Problem::BadEscape => "bad-escape",
            Problem::BadUnicodeEscape => "bad-unicode-escape",
            Problem::ControlCharacter => "control-character",
            Problem::BadNumber => "bad-number",
            Problem::BadWord => "bad-word",
            Problem::Trailing => "trailing",
            Problem::NotUtf8 => "not-utf8",
        }
    }
}

/// Where a text stops being JSON, and why.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct JsonError {
    pub problem: Problem,
    /// The line, from 1.
    pub line: u64,
    /// The place in the line, from 1, counted as editors count (in UTF-16 units).
    pub column: u64,
    /// The place in the whole text, from 0, counted the same way.
    pub offset: u64,
    /// The place in the whole text in bytes, from 0.
    pub byte: u64,
}

#[derive(Debug)]
pub enum RunError {
    Json(JsonError),
    Io(io::Error),
    /// The one who watches the work asked for it to stop.
    Stopped,
    /// The computer has no memory left for what the work needs.
    NoMemory,
}

impl From<io::Error> for RunError {
    fn from(error: io::Error) -> Self {
        if error.kind() == io::ErrorKind::OutOfMemory {
            RunError::NoMemory
        } else {
            RunError::Io(error)
        }
    }
}

/// What may come next between two tokens.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Expect {
    /// A value: at the start, after a colon, after a comma in an array.
    Value,
    /// The first item of an array, or its end.
    ValueOrEnd,
    /// The first key of an object, or its end.
    KeyOrEnd,
    /// A key, after a comma in an object.
    Key,
    Colon,
    /// After a value inside an object or an array.
    CommaOrEnd,
    /// After the one value of the text: only white space.
    Nothing,
}

const OBJECT: u8 = b'{';
const ARRAY: u8 = b'[';

/// Inside a number, how far its grammar has got.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Number {
    Minus,
    Zero,
    Whole,
    Dot,
    Fraction,
    E,
    ESign,
    Exponent,
}

impl Number {
    /// The number may end here.
    fn whole(self) -> bool {
        matches!(self, Number::Zero | Number::Whole | Number::Fraction | Number::Exponent)
    }

    /// The state after one more byte; None when the byte is not part of a number here.
    fn next(self, byte: u8) -> Option<Number> {
        let digit = byte.is_ascii_digit();
        match self {
            Number::Minus if byte == b'0' => Some(Number::Zero),
            Number::Minus if digit => Some(Number::Whole),
            Number::Whole if digit => Some(Number::Whole),
            Number::Zero | Number::Whole if byte == b'.' => Some(Number::Dot),
            Number::Zero | Number::Whole | Number::Fraction if byte == b'e' || byte == b'E' => Some(Number::E),
            Number::Dot | Number::Fraction if digit => Some(Number::Fraction),
            Number::E if byte == b'+' || byte == b'-' => Some(Number::ESign),
            Number::E | Number::ESign | Number::Exponent if digit => Some(Number::Exponent),
            _ => None,
        }
    }
}

/// Inside a string, what the next byte must be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Text {
    Plain,
    /// After a backslash.
    Escape,
    /// After `\u`: so many hexadecimal digits are still to come.
    Hex(u8),
    /// Inside a letter of several bytes: so many are still to come, and the next one lies between two bounds.
    More(u8, u8, u8),
}

/// What is being read: nothing (between tokens), or the inside of a token.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Token {
    Between,
    String { key: bool, at: Text },
    Number(Number),
    /// `true`, `false` or `null`: the word, and how many of its letters were read.
    Word(&'static [u8], usize),
    /// A comment, when they are let by.
    Comment(Comment),
}

/// Inside a comment, how far it has got.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Comment {
    /// After the first `/`.
    Slash,
    /// After `//`: to the end of the line.
    Line,
    /// After `/*`.
    Block,
    /// After a `*` inside `/* */`: a `/` ends the comment.
    BlockStar,
}

/// Bytes on their way out are gathered and handed over in pieces of about this size.
const PIECE: usize = 64 * 1024;

struct Machine<W: Write> {
    style: Style,
    options: Options,
    /// A comma was read and is not written yet: it is, when what it comes before turns up.
    comma: bool,
    /// The bytes of a letter that is not ASCII, gathered to be written as `\uXXXX`.
    wide: Vec<u8>,
    out: W,
    held: Vec<u8>,
    /// The objects and arrays that are open, the outermost first.
    open: Vec<u8>,
    expect: Expect,
    token: Token,
    stats: Stats,
    line: u64,
    /// The place of the byte that is next, in UTF-16 units and in bytes; and where its line starts.
    offset: u64,
    line_start: u64,
    byte: u64,
}

impl<W: Write> Machine<W> {
    fn new(out: W, options: Options) -> Self {
        Machine { style: options.style, options, comma: false, wide: Vec::new(), out, held: Vec::new(), open: Vec::new(), expect: Expect::Value, token: Token::Between, stats: Stats::default(), line: 1, offset: 0, line_start: 0, byte: 0 }
    }

    fn wrong(&self, problem: Problem) -> RunError {
        RunError::Json(JsonError { problem, line: self.line, column: self.offset - self.line_start + 1, offset: self.offset, byte: self.byte })
    }

    fn writes(&self) -> bool {
        self.style != Style::Check
    }

    fn put(&mut self, bytes: &[u8]) -> Result<(), RunError> {
        if !self.writes() {
            return Ok(());
        }
        if self.held.capacity() == 0 && self.held.try_reserve_exact(PIECE + 1024).is_err() {
            return Err(RunError::NoMemory);
        }
        if self.held.len() + bytes.len() > self.held.capacity() {
            self.flush()?;
        }
        if bytes.len() > self.held.capacity() {
            self.stats.bytes_out += bytes.len() as u64;
            self.out.write_all(bytes)?;
        } else {
            self.held.extend_from_slice(bytes);
        }
        Ok(())
    }

    fn flush(&mut self) -> Result<(), RunError> {
        self.stats.bytes_out += self.held.len() as u64;
        self.out.write_all(&self.held)?;
        self.held.clear();
        Ok(())
    }

    /// A new line, pushed in for so many levels. Nothing when everything goes on one line.
    fn new_line(&mut self, levels: usize) -> Result<(), RunError> {
        const SPACES: [u8; 16] = [b' '; 16];
        let (unit, width): (&[u8], usize) = match self.style {
            Style::Spaces(width) => (&SPACES, usize::from(width)),
            Style::Tab => (b"\t", 1),
            Style::Minify | Style::Check => return Ok(()),
        };
        self.put(if self.options.crlf { b"\r\n" } else { b"\n" })?;
        for _ in 0..levels {
            // As many spaces as were asked for, a stretch at a time.
            let mut left = width;
            while left > 0 {
                let stretch = left.min(unit.len());
                self.put(&unit[..stretch])?;
                left -= stretch;
            }
        }
        Ok(())
    }

    /// One more byte was read: the places move on.
    fn passed(&mut self, byte: u8) {
        self.byte += 1;
        // A byte that only continues a letter adds nothing; a letter of four bytes is two units.
        if byte & 0xC0 != 0x80 {
            self.offset += if byte >= 0xF0 { 2 } else { 1 };
        }
        if byte == b'\n' {
            self.line += 1;
            self.line_start = self.offset;
        }
    }

    /// The comma that was read is written, now that what it comes before is here.
    fn take_comma(&mut self) -> Result<(), RunError> {
        if std::mem::take(&mut self.comma) {
            self.put(b",")?;
        }
        Ok(())
    }

    /// A byte of a letter that is not ASCII, inside a string: written as it is, or gathered until the letter is whole
    /// and written as `\uXXXX` (two of them for a letter beyond the first 65,536).
    fn put_wide(&mut self, byte: u8, last: bool) -> Result<(), RunError> {
        if !self.options.ascii {
            return self.put(&[byte]);
        }
        self.wide.push(byte);
        if !last {
            return Ok(());
        }
        let bytes = std::mem::take(&mut self.wide);
        let letter = std::str::from_utf8(&bytes).ok().and_then(|text| text.chars().next()).unwrap_or('\u{FFFD}');
        let mut units = [0u16; 2];
        for unit in letter.encode_utf16(&mut units) {
            self.put(format!("\\u{unit:04x}").as_bytes())?;
        }
        Ok(())
    }

    /// A value starts (a string that is not a key, a number, a word, an object, an array).
    fn value_starts(&mut self) -> Result<(), RunError> {
        self.take_comma()?;
        match self.expect {
            Expect::Value => {
                // After a comma in an array the value goes on a line of its own; after a colon, or at the very start, it does not.
                if self.open.last() == Some(&ARRAY) {
                    self.new_line(self.open.len())?;
                }
            }
            Expect::ValueOrEnd => self.new_line(self.open.len())?,
            Expect::KeyOrEnd | Expect::Key => return Err(self.wrong(Problem::ExpectedKey)),
            Expect::Colon => return Err(self.wrong(Problem::ExpectedColon)),
            Expect::CommaOrEnd => return Err(self.wrong(self.comma_or_end())),
            Expect::Nothing => return Err(self.wrong(Problem::Trailing)),
        }
        self.stats.values += 1;
        Ok(())
    }

    fn comma_or_end(&self) -> Problem {
        if self.open.last() == Some(&OBJECT) {
            Problem::ExpectedCommaOrBrace
        } else {
            Problem::ExpectedCommaOrBracket
        }
    }

    /// A value ended: what may follow it.
    fn value_ended(&mut self) {
        self.expect = if self.open.is_empty() { Expect::Nothing } else { Expect::CommaOrEnd };
    }

    fn opens(&mut self, kind: u8) -> Result<(), RunError> {
        self.value_starts()?;
        if self.open.len() == self.open.capacity() && self.open.try_reserve(self.open.len().max(64)).is_err() {
            return Err(RunError::NoMemory);
        }
        self.open.push(kind);
        self.stats.depth = self.stats.depth.max(self.open.len() as u64);
        if kind == OBJECT {
            self.stats.objects += 1;
        } else {
            self.stats.arrays += 1;
        }
        self.put(&[kind])?;
        self.expect = if kind == OBJECT { Expect::KeyOrEnd } else { Expect::ValueOrEnd };
        Ok(())
    }

    fn closes(&mut self, kind: u8) -> Result<(), RunError> {
        let empty = match (self.expect, self.open.last().copied()) {
            (Expect::KeyOrEnd, Some(OBJECT)) if kind == OBJECT => true,
            (Expect::ValueOrEnd, Some(ARRAY)) if kind == ARRAY => true,
            (Expect::CommaOrEnd, Some(open)) if open == kind => false,
            // A comma after the last item, when that is let by: the comma is dropped.
            (Expect::Key, Some(OBJECT)) if kind == OBJECT && self.options.lenient && self.comma => false,
            (Expect::Value, Some(ARRAY)) if kind == ARRAY && self.options.lenient && self.comma => false,
            (Expect::CommaOrEnd, _) => return Err(self.wrong(self.comma_or_end())),
            (Expect::KeyOrEnd | Expect::Key, _) => return Err(self.wrong(Problem::ExpectedKey)),
            (Expect::Colon, _) => return Err(self.wrong(Problem::ExpectedColon)),
            (Expect::Nothing, _) => return Err(self.wrong(Problem::Trailing)),
            _ => return Err(self.wrong(Problem::ExpectedValue)),
        };
        self.comma = false;
        self.open.pop();
        if !empty {
            self.new_line(self.open.len())?;
        }
        self.put(if kind == OBJECT { b"}" } else { b"]" })?;
        self.value_ended();
        Ok(())
    }

    /// A byte between two tokens.
    fn between(&mut self, byte: u8) -> Result<(), RunError> {
        match byte {
            b' ' | b'\t' | b'\n' | b'\r' => {}
            b'{' => self.opens(OBJECT)?,
            b'[' => self.opens(ARRAY)?,
            b'}' => self.closes(OBJECT)?,
            b']' => self.closes(ARRAY)?,
            b'/' if self.options.lenient => self.token = Token::Comment(Comment::Slash),
            b',' => {
                if self.expect != Expect::CommaOrEnd {
                    return Err(self.wrong(self.unexpected()));
                }
                self.comma = true;
                self.expect = if self.open.last() == Some(&OBJECT) { Expect::Key } else { Expect::Value };
            }
            b':' => {
                if self.expect != Expect::Colon {
                    return Err(self.wrong(self.unexpected()));
                }
                self.put(if matches!(self.style, Style::Minify) || !self.options.colon_space { b":" } else { b": " })?;
                self.expect = Expect::Value;
            }
            b'"' => {
                let key = matches!(self.expect, Expect::KeyOrEnd | Expect::Key);
                if key {
                    self.take_comma()?;
                    self.stats.keys += 1;
                    self.new_line(self.open.len())?;
                } else {
                    self.value_starts()?;
                }
                self.put(b"\"")?;
                self.token = Token::String { key, at: Text::Plain };
            }
            b'-' | b'0'..=b'9' => {
                self.value_starts()?;
                self.put(&[byte])?;
                self.token = Token::Number(match byte {
                    b'-' => Number::Minus,
                    b'0' => Number::Zero,
                    _ => Number::Whole,
                });
            }
            b't' | b'f' | b'n' => {
                self.value_starts()?;
                let word: &'static [u8] = match byte {
                    b't' => b"true",
                    b'f' => b"false",
                    _ => b"null",
                };
                self.put(word)?;
                self.token = Token::Word(word, 1);
            }
            _ => return Err(self.wrong(self.unexpected())),
        }
        Ok(())
    }

    /// What to say of a byte that cannot stand where it does.
    fn unexpected(&self) -> Problem {
        match self.expect {
            Expect::Value | Expect::ValueOrEnd => Problem::ExpectedValue,
            Expect::KeyOrEnd | Expect::Key => Problem::ExpectedKey,
            Expect::Colon => Problem::ExpectedColon,
            Expect::CommaOrEnd => self.comma_or_end(),
            Expect::Nothing => Problem::Trailing,
        }
    }

    /// The token that was being read is over.
    fn token_ended(&mut self, key: bool) {
        self.token = Token::Between;
        if key {
            self.expect = Expect::Colon;
        } else {
            self.value_ended();
        }
    }

    /// Reads a piece of the text.
    fn read(&mut self, piece: &[u8]) -> Result<(), RunError> {
        let mut at = 0;
        while at < piece.len() {
            let byte = piece[at];
            match self.token {
                Token::Between => {
                    self.between(byte)?;
                    self.passed(byte);
                    at += 1;
                }
                Token::String { key, at: Text::Plain } => {
                    // The plain letters of a string go by in one stretch.
                    let run = piece[at..].iter().position(|&next| next == b'"' || next == b'\\' || !(0x20..0x80).contains(&next)).unwrap_or(piece.len() - at);
                    if run > 0 {
                        self.put(&piece[at..at + run])?;
                        self.byte += run as u64;
                        self.offset += run as u64;
                        at += run;
                        continue;
                    }
                    let next = match byte {
                        b'"' => None,
                        b'\\' => Some(Text::Escape),
                        0x00..=0x1F => return Err(self.wrong(Problem::ControlCharacter)),
                        0xC2..=0xDF => Some(Text::More(1, 0x80, 0xBF)),
                        0xE0 => Some(Text::More(2, 0xA0, 0xBF)),
                        0xED => Some(Text::More(2, 0x80, 0x9F)),
                        0xE1..=0xEF => Some(Text::More(2, 0x80, 0xBF)),
                        0xF0 => Some(Text::More(3, 0x90, 0xBF)),
                        0xF1..=0xF3 => Some(Text::More(3, 0x80, 0xBF)),
                        0xF4 => Some(Text::More(3, 0x80, 0x8F)),
                        _ => return Err(self.wrong(Problem::NotUtf8)),
                    };
                    if byte >= 0x80 {
                        self.put_wide(byte, false)?;
                    } else {
                        self.put(&[byte])?;
                    }
                    self.passed(byte);
                    at += 1;
                    match next {
                        Some(text) => self.token = Token::String { key, at: text },
                        None => self.token_ended(key),
                    }
                }
                Token::String { key, at: text } => {
                    let next = match text {
                        Text::Escape => match byte {
                            b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => Text::Plain,
                            b'u' => Text::Hex(4),
                            _ => return Err(self.wrong(Problem::BadEscape)),
                        },
                        Text::Hex(left) => {
                            if !byte.is_ascii_hexdigit() {
                                return Err(self.wrong(Problem::BadUnicodeEscape));
                            }
                            if left == 1 {
                                Text::Plain
                            } else {
                                Text::Hex(left - 1)
                            }
                        }
                        Text::More(left, low, high) => {
                            if byte < low || byte > high {
                                return Err(self.wrong(Problem::NotUtf8));
                            }
                            if left == 1 {
                                Text::Plain
                            } else {
                                Text::More(left - 1, 0x80, 0xBF)
                            }
                        }
                        Text::Plain => unreachable!("plain text is read above"),
                    };
                    if matches!(text, Text::More(..)) {
                        self.put_wide(byte, next == Text::Plain)?;
                    } else {
                        self.put(&[byte])?;
                    }
                    self.passed(byte);
                    at += 1;
                    self.token = Token::String { key, at: next };
                }
                Token::Number(number) => match number.next(byte) {
                    Some(next) => {
                        self.put(&[byte])?;
                        self.passed(byte);
                        at += 1;
                        self.token = Token::Number(next);
                    }
                    // A digit after a leading zero, a letter, a second dot: the number is wrong where it stands.
                    None if !number.whole() || byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'+' || byte == b'-' => return Err(self.wrong(Problem::BadNumber)),
                    // The number is over; the byte is read again as what follows it.
                    None => self.token_ended(false),
                },
                Token::Comment(comment) => {
                    let next = match (comment, byte) {
                        (Comment::Slash, b'/') => Some(Comment::Line),
                        (Comment::Slash, b'*') => Some(Comment::Block),
                        (Comment::Slash, _) => return Err(self.wrong(self.unexpected())),
                        (Comment::Line, b'\n') => None,
                        (Comment::Line, _) => Some(Comment::Line),
                        (Comment::Block | Comment::BlockStar, b'*') => Some(Comment::BlockStar),
                        (Comment::BlockStar, b'/') => None,
                        (Comment::Block | Comment::BlockStar, _) => Some(Comment::Block),
                    };
                    self.passed(byte);
                    at += 1;
                    self.token = next.map_or(Token::Between, Token::Comment);
                }
                Token::Word(word, read) => {
                    if byte != word[read] {
                        return Err(self.wrong(Problem::BadWord));
                    }
                    self.passed(byte);
                    at += 1;
                    if read + 1 == word.len() {
                        self.token_ended(false);
                    } else {
                        self.token = Token::Word(word, read + 1);
                    }
                }
            }
        }
        Ok(())
    }

    /// The text is over: it must be whole.
    fn end(mut self) -> Result<Stats, RunError> {
        match self.token {
            // A comment that runs to the end of its line may be the last thing there is.
            Token::Between | Token::Comment(Comment::Line) => {}
            Token::Number(number) if number.whole() => self.token_ended(false),
            Token::Number(_) => return Err(self.wrong(Problem::BadNumber)),
            _ => return Err(self.wrong(Problem::UnexpectedEnd)),
        }
        if self.expect != Expect::Nothing {
            let nothing_read = self.expect == Expect::Value && self.open.is_empty();
            return Err(self.wrong(if nothing_read { Problem::Empty } else { Problem::UnexpectedEnd }));
        }
        if self.options.final_newline && self.writes() {
            self.put(if self.options.crlf { b"\r\n" } else { b"\n" })?;
        }
        self.flush()?;
        self.out.flush()?;
        self.stats.bytes_in = self.byte;
        Ok(self.stats)
    }
}

/// The mark some programs put at the start of a UTF-8 file. It is not part of the text.
const MARK: &[u8] = &[0xEF, 0xBB, 0xBF];

/// Reads JSON from `input` to its end and writes it to `output` as `style` says.
///
/// `watch` is told how many bytes were read, after each piece; when it
/// answers false the work stops with [`RunError::Stopped`]. What was written
/// until an error is left as it is: the one who called decides what becomes of it.
pub fn transform<R: Read, W: Write>(input: R, output: W, style: Style, watch: &mut dyn FnMut(u64) -> bool) -> Result<Stats, RunError> {
    transform_with(input, output, Options::of(style), watch)
}

/// As [`transform`], with every choice of how JSON is read and written.
pub fn transform_with<R: Read, W: Write>(mut input: R, output: W, options: Options, watch: &mut dyn FnMut(u64) -> bool) -> Result<Stats, RunError> {
    let mut machine = Machine::new(output, options);
    let mut piece = Vec::new();
    if piece.try_reserve_exact(PIECE).is_err() {
        return Err(RunError::NoMemory);
    }
    piece.resize(PIECE, 0);
    let mut read_in_all = 0u64;
    let mut first = true;
    loop {
        // The first piece is filled as far as the mark is long, so the mark is seen whole.
        let mut filled = 0;
        loop {
            let read = match input.read(&mut piece[filled..]) {
                Ok(read) => read,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.into()),
            };
            filled += read;
            if read == 0 || !first || filled >= MARK.len() {
                break;
            }
        }
        if filled == 0 {
            break;
        }
        let marked = first && piece[..filled].starts_with(MARK);
        first = false;
        machine.read(&piece[if marked { MARK.len() } else { 0 }..filled])?;
        read_in_all += filled as u64;
        if !watch(read_in_all) {
            return Err(RunError::Stopped);
        }
    }
    machine.end()
}

/// A place in memory that takes what is written, and says so when the computer has no more to give.
#[derive(Default)]
pub struct Grown(pub Vec<u8>);

impl Write for Grown {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.try_reserve(bytes.len()).is_err() {
            return Err(io::ErrorKind::OutOfMemory.into());
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// JSON given as a text, written again as a text.
pub fn transform_text(text: &str, style: Style, watch: &mut dyn FnMut(u64) -> bool) -> Result<(String, Stats), RunError> {
    transform_text_with(text, Options::of(style), watch)
}

/// As [`transform_text`], with every choice of how JSON is read and written.
pub fn transform_text_with(text: &str, options: Options, watch: &mut dyn FnMut(u64) -> bool) -> Result<(String, Stats), RunError> {
    let mut grown = Grown::default();
    let stats = transform_with(text.as_bytes(), &mut grown, options, watch)?;
    // Only bytes of the text, which is UTF-8, and plain signs were written.
    let written = String::from_utf8(grown.0).map_err(|_| RunError::Io(io::ErrorKind::InvalidData.into()))?;
    Ok((written, stats))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn run(text: &str, style: Style) -> Result<String, JsonError> {
        match transform_text(text, style, &mut |_| true) {
            Ok((written, _)) => Ok(written),
            Err(RunError::Json(error)) => Err(error),
            Err(other) => panic!("{other:?}"),
        }
    }

    fn problem(text: &str) -> (Problem, u64, u64) {
        let error = run(text, Style::Check).expect_err("not JSON");
        (error.problem, error.line, error.column)
    }

    #[test]
    fn indents_as_the_standard_tools_do() {
        // The same text `JSON.stringify(value, null, 2)` and `jq .` give.
        let text = r#"{"a":1,"b":[true,false,null],"c":{"d":"e"},"f":[],"g":{}}"#;
        let wanted = "{\n  \"a\": 1,\n  \"b\": [\n    true,\n    false,\n    null\n  ],\n  \"c\": {\n    \"d\": \"e\"\n  },\n  \"f\": [],\n  \"g\": {}\n}";
        assert_eq!(run(text, Style::Spaces(2)).as_deref(), Ok(wanted));
        assert_eq!(run(text, Style::Tab).as_deref(), Ok(wanted.replace("    ", "\t\t").replace("  ", "\t").as_str()));
        assert_eq!(run(wanted, Style::Spaces(4)).as_deref(), Ok(wanted.replace("  ", "    ").as_str()));
    }

    #[test]
    fn any_number_of_spaces_can_be_asked_for() {
        let text = r#"{"a":[1]}"#;
        assert_eq!(run(text, Style::Spaces(0)).as_deref(), Ok("{\n\"a\": [\n1\n]\n}"));
        assert_eq!(run(text, Style::Spaces(1)).as_deref(), Ok("{\n \"a\": [\n  1\n ]\n}"));
        assert_eq!(run(text, Style::Spaces(3)).as_deref(), Ok("{\n   \"a\": [\n      1\n   ]\n}"));
        let wide = run(text, Style::Spaces(40)).expect("JSON");
        assert_eq!(wide.lines().nth(1), Some(format!("{}\"a\": [", " ".repeat(40)).as_str()));
    }

    fn with(text: &str, change: impl FnOnce(&mut Options)) -> Result<String, JsonError> {
        let mut options = Options::of(Style::Spaces(2));
        change(&mut options);
        match transform_text_with(text, options, &mut |_| true) {
            Ok((written, _)) => Ok(written),
            Err(RunError::Json(error)) => Err(error),
            Err(other) => panic!("{other:?}"),
        }
    }

    #[test]
    fn the_other_ways_of_writing() {
        let text = r#"{"a":[1,"é😀"]}"#;
        assert_eq!(with(text, |options| options.colon_space = false).as_deref(), Ok("{\n  \"a\":[\n    1,\n    \"é😀\"\n  ]\n}"));
        assert_eq!(with(text, |options| options.crlf = true).as_deref(), Ok("{\r\n  \"a\": [\r\n    1,\r\n    \"é😀\"\r\n  ]\r\n}"));
        assert_eq!(with("[]", |options| options.final_newline = true).as_deref(), Ok("[]\n"));
        assert_eq!(with("[]", |options| (options.final_newline, options.crlf) = (true, true)).as_deref(), Ok("[]\r\n"));
        // What `JSON.stringify` would give if it wrote only ASCII: one `\u` for é, a pair for 😀.
        assert_eq!(with(text, |options| (options.ascii, options.style) = (true, Style::Minify)).as_deref(), Ok(r#"{"a":[1,"\u00e9\ud83d\ude00"]}"#));
        for at_once in 1..=5 {
            let mut grown = Grown::default();
            let mut options = Options::of(Style::Minify);
            options.ascii = true;
            let mut machine = Machine::new(&mut grown, options);
            for piece in "[\"aé€😀\"]".as_bytes().chunks(at_once) {
                machine.read(piece).expect("JSON");
            }
            machine.end().expect("whole");
            assert_eq!(String::from_utf8(grown.0).as_deref(), Ok(r#"["a\u00e9\u20ac\ud83d\ude00"]"#), "{at_once} at a time");
        }
    }

    #[test]
    fn lenient_reading_lets_comments_and_last_commas_by() {
        let text = "// a list\n{\n  \"a\": [1, 2,], /* two */\n  \"b\": {\"c\": null,},\n}\n// the end";
        let lenient = |text: &str| with(text, |options| (options.lenient, options.style) = (true, Style::Minify));
        assert_eq!(lenient(text).as_deref(), Ok(r#"{"a":[1,2],"b":{"c":null}}"#));
        assert_eq!(lenient("[1/**/,/* x */2]").as_deref(), Ok("[1,2]"));
        assert_eq!(lenient("\"http://not a comment\"").as_deref(), Ok("\"http://not a comment\""));
        // Still not let by: two commas, a comma with nothing before it, a comment that never ends, a lone slash.
        for wrong in ["[1,,2]", "[,]", "{,}", "[1] /* open", "[1] / 2"] {
            assert!(lenient(wrong).is_err(), "{wrong}");
        }
        // And without it, every one of them is what is wrong.
        assert_eq!(problem("[1,] // x"), (Problem::ExpectedValue, 1, 4));
        assert_eq!(problem("// x\n1"), (Problem::ExpectedValue, 1, 1));
    }

    #[test]
    fn counts_objects_arrays_and_keys() {
        let (_, stats) = transform_text(r#"{"a":[1,{"b":2,"c":[]}],"d":{}}"#, Style::Check, &mut |_| true).expect("JSON");
        assert_eq!((stats.objects, stats.arrays, stats.keys, stats.values, stats.depth), (3, 2, 4, 7, 4));
    }

    #[test]
    fn minifies_and_comes_back_the_same() {
        let text = "{\n  \"a\" : [ 1 , 2 , { \"b\" : null } ] ,\r\n\t\"c\" : \"x y\"\n}\n";
        let small = r#"{"a":[1,2,{"b":null}],"c":"x y"}"#;
        assert_eq!(run(text, Style::Minify).as_deref(), Ok(small));
        let indented = run(small, Style::Spaces(2)).expect("JSON");
        assert_eq!(run(&indented, Style::Minify).as_deref(), Ok(small));
    }

    #[test]
    fn keeps_strings_and_numbers_letter_for_letter() {
        let text = r#"[0.1000,1e400,-0,12345678901234567890123,"\u00e9\n\/","é€😀","\ud83d"]"#;
        assert_eq!(run(text, Style::Minify).as_deref(), Ok(text));
    }

    #[test]
    fn single_values_are_json() {
        for text in ["1", "-0.5e+3", "\"a\"", "true", "false", "null", " [] ", "{}", "\u{feff}{}"] {
            assert!(run(text, Style::Check).is_ok(), "{text}");
        }
    }

    #[test]
    fn counts_what_it_read() {
        let (_, stats) = transform_text(r#"{"a":[1,"b",{"c":null}]}"#, Style::Check, &mut |_| true).expect("JSON");
        assert_eq!((stats.values, stats.depth, stats.bytes_in, stats.bytes_out), (6, 3, 24, 0));
        let (written, stats) = transform_text("[ 1 ]", Style::Minify, &mut |_| true).expect("JSON");
        assert_eq!((written.as_str(), stats.bytes_out), ("[1]", 3));
    }

    #[test]
    fn says_what_is_wrong_and_where() {
        assert_eq!(problem(""), (Problem::Empty, 1, 1));
        assert_eq!(problem("  \n "), (Problem::Empty, 2, 2));
        assert_eq!(problem("{\"a\":1,}"), (Problem::ExpectedKey, 1, 8));
        assert_eq!(problem("[1,]"), (Problem::ExpectedValue, 1, 4));
        assert_eq!(problem("{\"a\" 1}"), (Problem::ExpectedColon, 1, 6));
        assert_eq!(problem("{\"a\":1 \"b\":2}"), (Problem::ExpectedCommaOrBrace, 1, 8));
        assert_eq!(problem("[1 2]"), (Problem::ExpectedCommaOrBracket, 1, 4));
        assert_eq!(problem("[1}"), (Problem::ExpectedCommaOrBracket, 1, 3));
        assert_eq!(problem("{a:1}"), (Problem::ExpectedKey, 1, 2));
        assert_eq!(problem("[1,\n2,\n x]"), (Problem::ExpectedValue, 3, 2));
        assert_eq!(problem("[\"a\\x\"]"), (Problem::BadEscape, 1, 5));
        assert_eq!(problem("\"\\u12g4\""), (Problem::BadUnicodeEscape, 1, 6));
        assert_eq!(problem("\"a\tb\""), (Problem::ControlCharacter, 1, 3));
        assert_eq!(problem("01"), (Problem::BadNumber, 1, 2));
        assert_eq!(problem("1."), (Problem::BadNumber, 1, 3));
        assert_eq!(problem("[-]"), (Problem::BadNumber, 1, 3));
        assert_eq!(problem("1.5.2"), (Problem::BadNumber, 1, 4));
        assert_eq!(problem("tru"), (Problem::UnexpectedEnd, 1, 4));
        assert_eq!(problem("nul1"), (Problem::BadWord, 1, 4));
        assert_eq!(problem("{} x"), (Problem::Trailing, 1, 4));
        assert_eq!(problem("[1] [2]"), (Problem::Trailing, 1, 5));
        assert_eq!(problem("[\"a"), (Problem::UnexpectedEnd, 1, 4));
        assert_eq!(problem("{\"a\":"), (Problem::UnexpectedEnd, 1, 6));
        assert_eq!(problem("// no\n1"), (Problem::ExpectedValue, 1, 1));
        assert_eq!(problem("'a'"), (Problem::ExpectedValue, 1, 1));
    }

    #[test]
    fn places_are_counted_as_editors_count() {
        // "é" is one unit, "😀" two: the wrong sign is the 8th unit of its line.
        let error = run("[\"é😀\" x]", Style::Check).expect_err("not JSON");
        assert_eq!((error.column, error.offset, error.byte), (8, 7, 10));
    }

    #[test]
    fn bytes_that_are_not_text_are_refused() {
        for bytes in [&b"\"\xff\""[..], b"\"\xc3\x28\"", b"\"\xed\xa0\x80\"", b"\"\xe2\x82\""] {
            let mut grown = Grown::default();
            assert!(matches!(transform(bytes, &mut grown, Style::Check, &mut |_| true), Err(RunError::Json(JsonError { problem: Problem::NotUtf8, .. }))), "{bytes:?}");
        }
    }

    /// Hands the text over a byte at a time: nothing may depend on where a piece ends.
    struct Dripping<'a>(&'a [u8]);

    impl Read for Dripping<'_> {
        fn read(&mut self, into: &mut [u8]) -> io::Result<usize> {
            let Some((&first, rest)) = self.0.split_first() else { return Ok(0) };
            into[0] = first;
            self.0 = rest;
            Ok(1)
        }
    }

    #[test]
    fn where_a_piece_ends_changes_nothing() {
        let text = "\u{feff}{\"k\\u00e9y\": [1.5e-3, \"é😀\\\"\", true, null, {\"deep\": [[]]}]}";
        let whole = run(text, Style::Spaces(2)).expect("JSON");
        let mut grown = Grown::default();
        transform(Dripping(text.as_bytes()), &mut grown, Style::Spaces(2), &mut |_| true).expect("JSON");
        assert_eq!(String::from_utf8(grown.0).as_deref(), Ok(whole.as_str()));
    }

    #[test]
    fn nesting_has_no_most() {
        // Deeper than a reader that calls itself for each level could go.
        let deep = 200_000;
        let text = format!("{}{}", "[".repeat(deep), "]".repeat(deep));
        let (written, stats) = transform_text(&text, Style::Minify, &mut |_| true).expect("JSON");
        assert_eq!((written.len(), stats.depth), (deep * 2, deep as u64));
    }

    #[test]
    fn stops_when_asked() {
        let text = format!("[{}1]", "1,".repeat(200_000));
        assert!(matches!(transform_text(&text, Style::Minify, &mut |read| read < 100_000), Err(RunError::Stopped)));
    }
}
