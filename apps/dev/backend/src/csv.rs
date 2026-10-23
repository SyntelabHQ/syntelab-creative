//! CSV read as JSON, and JSON written as CSV.
//!
//! Reading goes row by row (RFC 4180, with what files in the wild add to it: any of four signs between the fields,
//! lines ended in any of the three ways, rows of uneven length), and each row is written as soon as it is read: a
//! file is as large as the disk lets it be. The sign between the fields is told from the first row when it is not
//! given.
//!
//! Writing needs the names of all the columns before the first row, so the JSON is held whole.

use std::collections::HashMap;
use std::io::Write;

use crate::codec::{CodecError, Letters, Place, Stage, Wrong};
use crate::json::Style;
use crate::tree::{self, quoted, unquoted, Change, Node};
use crate::whole::{json_tree, Notes, Whole};

/// The signs that may stand between fields, in the order they are preferred when the first row does not tell.
const SEPARATORS: [u8; 4] = *b",;\t|";

/// How CSV is read.
#[derive(Debug, Clone, Copy)]
pub struct Reading {
    /// The sign between the fields; none to tell it from the first row.
    pub separator: Option<u8>,
    /// The first row holds the names of the columns: each row becomes an object. Else each row is an array.
    pub header: bool,
    /// Fields that are numbers, `true` or `false` are written as such, and empty ones as `null`; else all are strings.
    pub typed: bool,
    pub style: Style,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum At {
    /// Before the first sign of a field.
    FieldStart,
    Plain,
    Quoted,
    /// After a quote inside a quoted field: the field is over, or the quote was one of a pair.
    QuoteInQuoted,
}

pub struct Read {
    how: Reading,
    letters: Letters,
    /// What was read before the sign between the fields was known.
    waiting: Option<String>,
    separator: u8,
    at: At,
    place: Place,
    /// Where the quoted field that is open began.
    opened: Wrong,
    field: String,
    field_quoted: bool,
    /// The fields of the row so far, each with whether it stood in quotes.
    row: Vec<(String, bool)>,
    /// A carriage return ended the last row: a line feed right after it belongs to it.
    after_return: bool,
    names: Option<Vec<Box<str>>>,
    rows: u64,
    columns: usize,
    uneven: u64,
}

/// Whether a field is a number as JSON writes them.
fn is_number(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut at = usize::from(bytes.first() == Some(&b'-'));
    let digits = |at: &mut usize| {
        let start = *at;
        while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
            *at += 1;
        }
        *at - start
    };
    let whole_start = at;
    let whole = digits(&mut at);
    if whole == 0 || (whole > 1 && bytes[whole_start] == b'0') {
        return false;
    }
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        if digits(&mut at) == 0 {
            return false;
        }
    }
    if matches!(bytes.get(at), Some(b'e' | b'E')) {
        at += 1;
        if matches!(bytes.get(at), Some(b'+' | b'-')) {
            at += 1;
        }
        if digits(&mut at) == 0 {
            return false;
        }
    }
    at == bytes.len()
}

impl Read {
    pub fn new(how: Reading) -> Self {
        Read {
            how,
            letters: Letters::default(),
            waiting: how.separator.is_none().then(String::new),
            separator: how.separator.unwrap_or(b','),
            at: At::FieldStart,
            place: Place::default(),
            opened: Wrong::nowhere("unclosed-quote"),
            field: String::new(),
            field_quoted: false,
            row: Vec::new(),
            after_return: false,
            names: None,
            rows: 0,
            columns: 0,
            uneven: 0,
        }
    }

    /// The sign that stands between the fields of the first row of `text`: the one of the four found most often
    /// outside quotes. None while the first row is not known to be whole.
    pub(crate) fn told(text: &str, whole: bool) -> Option<u8> {
        let mut counts = [0usize; 4];
        let mut quoted = false;
        let mut ended = false;
        for byte in text.bytes() {
            match byte {
                b'"' => quoted = !quoted,
                b'\n' | b'\r' if !quoted => {
                    ended = true;
                    break;
                }
                other if !quoted => {
                    if let Some(which) = SEPARATORS.iter().position(|&sign| sign == other) {
                        counts[which] += 1;
                    }
                }
                _ => {}
            }
        }
        // A first row longer than this is taken as it is so far: what waits is not let grow with the file.
        if !ended && !whole && text.len() < 1024 * 1024 {
            return None;
        }
        let most = counts.iter().copied().max().unwrap_or(0);
        Some(SEPARATORS[counts.iter().position(|&count| count == most).unwrap_or(0)])
    }

    fn indent(&self, levels: usize, out: &mut dyn Write) -> Result<(), CodecError> {
        match self.how.style {
            Style::Spaces(spaces) => write!(out, "\n{:width$}", "", width = levels * usize::from(spaces))?,
            Style::Tab => write!(out, "\n{}", "\t".repeat(levels))?,
            Style::Minify | Style::Check => {}
        }
        Ok(())
    }

    fn value(&self, text: &str, in_quotes: bool) -> Box<str> {
        if self.how.typed && !in_quotes {
            match text {
                "" => return "null".into(),
                "true" | "TRUE" | "True" => return "true".into(),
                "false" | "FALSE" | "False" => return "false".into(),
                number if is_number(number) => return number.into(),
                _ => {}
            }
        }
        quoted(text)
    }

    /// The names of the columns, from the first row: one that is empty is named by its place, one that comes again
    /// gets a number.
    fn named(row: &[(String, bool)]) -> Vec<Box<str>> {
        let mut seen: HashMap<String, usize> = HashMap::new();
        let mut names = Vec::with_capacity(row.len());
        for (index, (name, _)) in row.iter().enumerate() {
            let name = if name.trim().is_empty() { format!("column {}", index + 1) } else { name.clone() };
            let times = seen.entry(name.clone()).or_insert(0);
            *times += 1;
            names.push(quoted(&if *times > 1 { format!("{name}_{times}") } else { name }));
        }
        names
    }

    /// A row is whole: it is written, or kept as the names of the columns.
    fn row_done(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.row.push((std::mem::take(&mut self.field), self.field_quoted));
        self.field_quoted = false;
        let row = std::mem::take(&mut self.row);
        // A line with nothing on it is no row.
        if row.len() == 1 && row[0].0.is_empty() && !row[0].1 {
            return Ok(());
        }
        if self.how.header && self.names.is_none() {
            self.columns = row.len();
            self.names = Some(Self::named(&row));
            return Ok(());
        }
        if self.rows == 0 && !self.how.header {
            self.columns = row.len();
        }
        if row.len() != self.columns {
            self.uneven += 1;
        }
        let spread = !matches!(self.how.style, Style::Minify | Style::Check);
        out.write_all(if self.rows == 0 { b"[" } else { b"," })?;
        self.indent(1, out)?;
        self.rows += 1;
        match &self.names {
            Some(names) => {
                out.write_all(b"{")?;
                for index in 0..row.len().max(names.len()) {
                    if index > 0 {
                        out.write_all(b",")?;
                    }
                    self.indent(2, out)?;
                    match names.get(index) {
                        Some(name) => out.write_all(name.as_bytes())?,
                        // A field more than there are names.
                        None => out.write_all(quoted(&format!("column {}", index + 1)).as_bytes())?,
                    }
                    out.write_all(if spread { b": " } else { b":" })?;
                    match row.get(index) {
                        Some((text, in_quotes)) => out.write_all(self.value(text, *in_quotes).as_bytes())?,
                        // A field less: every row has every name.
                        None => out.write_all(b"null")?,
                    }
                }
                self.indent(1, out)?;
                out.write_all(b"}")?;
            }
            // A row with no names is short: it stands on one line.
            None => {
                out.write_all(b"[")?;
                for (index, (text, in_quotes)) in row.iter().enumerate() {
                    if index > 0 {
                        out.write_all(if spread { b", " } else { b"," })?;
                    }
                    out.write_all(self.value(text, *in_quotes).as_bytes())?;
                }
                out.write_all(b"]")?;
            }
        }
        Ok(())
    }

    fn read(&mut self, text: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        for letter in text.chars() {
            let mut bytes = [0u8; 4];
            let here = self.place;
            letter.encode_utf8(&mut bytes).bytes().for_each(|byte| self.place.pass(byte));
            if std::mem::take(&mut self.after_return) && letter == '\n' {
                continue;
            }
            let separator = letter == char::from(self.separator);
            match self.at {
                At::Quoted if letter == '"' => self.at = At::QuoteInQuoted,
                At::Quoted => self.field.push(letter),
                At::QuoteInQuoted if letter == '"' => {
                    self.field.push('"');
                    self.at = At::Quoted;
                }
                At::QuoteInQuoted if !(separator || letter == '\n' || letter == '\r') => return Err(here.wrong("after-quote").into()),
                At::FieldStart if letter == '"' => {
                    self.opened = here.wrong("unclosed-quote");
                    self.field_quoted = true;
                    self.at = At::Quoted;
                }
                _ if separator => {
                    self.row.push((std::mem::take(&mut self.field), std::mem::take(&mut self.field_quoted)));
                    self.at = At::FieldStart;
                }
                _ if letter == '\n' || letter == '\r' => {
                    self.after_return = letter == '\r';
                    self.at = At::FieldStart;
                    self.row_done(out)?;
                }
                _ => {
                    self.field.push(letter);
                    self.at = At::Plain;
                }
            }
        }
        Ok(())
    }
}

impl Stage for Read {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let mut text = self.letters.take(piece)?;
        if let Some(mut waiting) = self.waiting.take() {
            if waiting.is_empty() {
                // The mark some programs put before a text is not part of it.
                if let Some(rest) = text.strip_prefix('\u{feff}') {
                    text = rest.to_owned();
                }
            }
            waiting.push_str(&text);
            match Self::told(&waiting, false) {
                Some(separator) => {
                    self.separator = separator;
                    text = waiting;
                }
                None => {
                    self.waiting = Some(waiting);
                    return Ok(());
                }
            }
        } else if self.place.wrong("").offset == 0 {
            if let Some(rest) = text.strip_prefix('\u{feff}') {
                text = rest.to_owned();
            }
        }
        self.read(&text, out)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        if let Some(waiting) = self.waiting.take() {
            self.separator = Self::told(&waiting, true).unwrap_or(b',');
            self.read(&waiting, out)?;
        }
        match self.at {
            At::Quoted => return Err(self.opened.into()),
            // The last row need not end in a line break.
            At::Plain | At::QuoteInQuoted => self.row_done(out)?,
            At::FieldStart if !self.row.is_empty() => self.row_done(out)?,
            At::FieldStart => {}
        }
        if self.rows == 0 {
            if self.names.is_none() {
                return Err(Wrong::nowhere("empty").into());
            }
            out.write_all(b"[]")?;
        } else {
            self.indent(0, out)?;
            out.write_all(b"]")?;
        }
        Ok(())
    }

    fn notes(&self) -> Notes {
        let sign = match self.separator {
            b'\t' => "Tab".to_owned(),
            other => char::from(other).to_string(),
        };
        let mut notes = vec![("csv-read", format!("{}\n{}", self.rows, self.columns)), ("csv-separator", format!("\n{sign}"))];
        if self.uneven > 0 {
            notes.push(("csv-uneven", self.uneven.to_string()));
        }
        notes
    }
}

/// How CSV is written.
#[derive(Debug, Clone, Copy)]
pub struct Writing {
    pub separator: u8,
    /// A first row with the names of the columns.
    pub header: bool,
    /// What is nested in a row is brought up into columns of its own (`address.city`); else it is written as JSON.
    pub flatten: bool,
    /// Every field stands in quotes, not only those that must.
    pub quote_all: bool,
    /// Rows end with a carriage return and a line feed, as RFC 4180 has them.
    pub crlf: bool,
}

fn field(text: &str, how: &Writing, out: &mut Vec<u8>) {
    let must = text.bytes().any(|byte| byte == how.separator || matches!(byte, b'"' | b'\n' | b'\r')) || text.starts_with(' ') || text.ends_with(' ');
    if !(must || how.quote_all) {
        out.extend_from_slice(text.as_bytes());
        return;
    }
    out.push(b'"');
    for byte in text.bytes() {
        if byte == b'"' {
            out.push(b'"');
        }
        out.push(byte);
    }
    out.push(b'"');
}

/// What a value is in a field: a string as its text, nothing for `null`, anything nested as JSON on one line.
fn cell(node: &Node) -> String {
    match node {
        Node::Scalar(raw) if raw.starts_with('"') => unquoted(raw),
        Node::Scalar(raw) if &**raw == "null" => String::new(),
        Node::Scalar(raw) => raw.to_string(),
        nested => {
            let mut written = Vec::new();
            // Writing into memory does not fail.
            let _ = tree::write(nested, &mut written, &tree::Writing { options: crate::json::Options::of(Style::Minify), one_line_within: 0 });
            String::from_utf8_lossy(&written).into_owned()
        }
    }
}

/// JSON written as CSV: an array of objects (their keys are the columns, in the order they are first met), an array
/// of arrays (each is a row), an array of plain values (one column), or one object (one row).
pub fn write(how: Writing) -> Whole {
    Whole::new(move |text, out| {
        let (mut root, depth) = json_tree(text)?;
        let mut rows = match &mut root {
            Node::Array(items) => std::mem::take(items),
            Node::Object(members) => vec![Node::Object(std::mem::take(members))],
            Node::Scalar(_) => return Err(Wrong::nowhere("not-rows").into()),
        };
        let objects = rows.iter().filter(|row| matches!(row, Node::Object(_))).count();
        let arrays = rows.iter().filter(|row| matches!(row, Node::Array(_))).count();
        if (objects > 0 && objects < rows.len()) || (arrays > 0 && arrays < rows.len()) {
            return Err(Wrong::nowhere("not-rows").into());
        }
        if how.flatten && objects > 0 {
            let flat = tree::deep(depth, || rows.into_iter().map(|row| tree::change(row, Change::Flatten)).collect::<Option<Vec<Node>>>());
            rows = flat.flatten().ok_or(CodecError::NoMemory)?;
        }
        let end: &[u8] = if how.crlf { b"\r\n" } else { b"\n" };
        let mut line = Vec::new();
        let mut names: Vec<Box<str>> = Vec::new();
        if objects > 0 {
            let mut known: HashMap<Box<str>, usize> = HashMap::new();
            for row in &rows {
                if let Node::Object(members) = row {
                    for (key, _) in members {
                        if !known.contains_key(key) {
                            known.insert(key.clone(), names.len());
                            names.push(key.clone());
                        }
                    }
                }
            }
            if how.header {
                for (index, name) in names.iter().enumerate() {
                    if index > 0 {
                        line.push(how.separator);
                    }
                    field(&unquoted(name), &how, &mut line);
                }
                line.extend_from_slice(end);
                out.write_all(&line)?;
            }
            let mut cells: Vec<Option<String>> = Vec::new();
            for row in &rows {
                line.clear();
                cells.clear();
                cells.resize(names.len(), None);
                if let Node::Object(members) = row {
                    for (key, value) in members {
                        // A key written twice in one object: the last one stands, as readers of JSON have it.
                        cells[known[key]] = Some(cell(value));
                    }
                }
                for (index, cell) in cells.iter().enumerate() {
                    if index > 0 {
                        line.push(how.separator);
                    }
                    field(cell.as_deref().unwrap_or_default(), &how, &mut line);
                }
                line.extend_from_slice(end);
                out.write_all(&line)?;
            }
        } else {
            for row in &rows {
                line.clear();
                match row {
                    Node::Array(items) => {
                        for (index, item) in items.iter().enumerate() {
                            if index > 0 {
                                line.push(how.separator);
                            }
                            field(&cell(item), &how, &mut line);
                        }
                    }
                    plain => field(&cell(plain), &how, &mut line),
                }
                line.extend_from_slice(end);
                out.write_all(&line)?;
            }
        }
        let columns = if objects > 0 { names.len() } else { rows.iter().map(|row| if let Node::Array(items) = row { items.len() } else { 1 }).max().unwrap_or(0) };
        let notes: Notes = vec![("csv-written", format!("{}\n{columns}", rows.len()))];
        // The rows are taken apart off this stack: what they hold may be nested deep.
        tree::deep(depth, move || drop(rows));
        Ok(notes)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn reading(separator: Option<u8>, header: bool, typed: bool, style: Style) -> Read {
        Read::new(Reading { separator, header, typed, style })
    }

    fn json(csv: &str, stage: &mut Read) -> String {
        // Whatever the size of the pieces, the result is the same.
        let whole = String::from_utf8(through(&mut Read::new(stage.how), csv.as_bytes(), 1_000_000).expect("read")).expect("text");
        for at_once in [1, 2, 5] {
            assert_eq!(String::from_utf8(through(&mut Read::new(stage.how), csv.as_bytes(), at_once).expect("read")).expect("text"), whole, "{at_once} at a time");
        }
        String::from_utf8(through(stage, csv.as_bytes(), 3).expect("read")).expect("text")
    }

    #[test]
    fn rows_become_objects_named_by_the_first_row() {
        let mut stage = reading(None, true, true, Style::Minify);
        assert_eq!(json("name,age,ok,note\nAna,30,true,\n\"Bo, Jr\",007,FALSE,\"said \"\"hi\"\"\"\r\nCy,-1.5e3,x,\"12\"\n", &mut stage), r#"[{"name":"Ana","age":30,"ok":true,"note":null},{"name":"Bo, Jr","age":"007","ok":false,"note":"said \"hi\""},{"name":"Cy","age":-1.5e3,"ok":"x","note":"12"}]"#);
        assert_eq!(stage.notes(), vec![("csv-read", "3\n4".to_string()), ("csv-separator", "\n,".to_string())]);
        assert_eq!(json("a,b\n1,2", &mut reading(Some(b','), true, false, Style::Minify)), r#"[{"a":"1","b":"2"}]"#);
    }

    #[test]
    fn the_sign_between_fields_is_told_from_the_first_row() {
        assert_eq!(json("a;b;c\n1,5;2;3\n", &mut reading(None, true, true, Style::Minify)), r#"[{"a":"1,5","b":2,"c":3}]"#);
        assert_eq!(json("a\tb\n1\t2\n", &mut reading(None, false, true, Style::Minify)), r#"[["a","b"],[1,2]]"#);
        assert_eq!(json("\"x,y\"|b\n1|2\n", &mut reading(None, true, true, Style::Minify)), r#"[{"x,y":1,"b":2}]"#);
        let mut stage = reading(None, true, true, Style::Minify);
        json("a\tb\n1\t2\n", &mut stage);
        assert_eq!(stage.notes()[1], ("csv-separator", "\nTab".to_string()));
    }

    #[test]
    fn rows_are_spread_as_json_is() {
        assert_eq!(json("\u{feff}a,b\n1,x\n2,y\n", &mut reading(None, true, true, Style::Spaces(2))), "[\n  {\n    \"a\": 1,\n    \"b\": \"x\"\n  },\n  {\n    \"a\": 2,\n    \"b\": \"y\"\n  }\n]");
        assert_eq!(json("1,x\r2,y", &mut reading(None, false, true, Style::Tab)), "[\n\t[1, \"x\"],\n\t[2, \"y\"]\n]");
        assert_eq!(json("a,b\n", &mut reading(None, true, true, Style::Spaces(2))), "[]");
    }

    #[test]
    fn rows_that_are_uneven_names_that_are_missing_and_lines_between_are_taken() {
        let mut stage = reading(Some(b','), true, true, Style::Minify);
        assert_eq!(json("a,,a,\n\n1\n1,2,3,4,5\n\n\"line\nbreak\",x,y,z\n", &mut stage), r#"[{"a":1,"column 2":null,"a_2":null,"column 4":null},{"a":1,"column 2":2,"a_2":3,"column 4":4,"column 5":5},{"a":"line\nbreak","column 2":"x","a_2":"y","column 4":"z"}]"#);
        assert_eq!(stage.notes()[2], ("csv-uneven", "2".to_string()));
    }

    #[test]
    fn what_is_wrong_is_told_with_its_place() {
        assert_eq!(problem(through(&mut reading(None, true, true, Style::Minify), b"a,b\n1,\"open\n2,3\n", 4)), ("unclosed-quote", 2, 3));
        assert_eq!(problem(through(&mut reading(None, true, true, Style::Minify), b"a,b\n\"x\"y,2\n", 4)), ("after-quote", 2, 4));
        assert_eq!(problem(through(&mut reading(None, true, true, Style::Minify), b"\n\n", 4)), ("empty", 0, 0));
        assert_eq!(problem(through(&mut reading(None, true, true, Style::Minify), b"a\n\xff", 4)), ("not-utf8", 2, 1));
    }

    fn csv(json: &str, how: Writing) -> String {
        String::from_utf8(through(&mut write(how), json.as_bytes(), 5).expect("written")).expect("text")
    }

    const USUAL: Writing = Writing { separator: b',', header: true, flatten: true, quote_all: false, crlf: false };

    #[test]
    fn objects_become_rows_under_all_their_keys() {
        assert_eq!(csv(r#"[{"name":"Ana","age":30},{"name":"Bo, Jr","ok":true,"age":null},{"note":"said \"hi\"\nthere"}]"#, USUAL), "name,age,ok,note\nAna,30,,\n\"Bo, Jr\",,true,\n,,,\"said \"\"hi\"\"\nthere\"\n");
        assert_eq!(csv(r#"{"a":1,"b":" x "}"#, Writing { separator: b';', crlf: true, ..USUAL }), "a;b\r\n1;\" x \"\r\n");
        assert_eq!(csv(r#"[{"a":1}]"#, Writing { header: false, quote_all: true, ..USUAL }), "\"1\"\n");
    }

    #[test]
    fn what_is_nested_is_brought_up_or_written_as_json() {
        let nested = r#"[{"id":1,"at":{"city":"Cluj","tags":["a","b"]}}]"#;
        assert_eq!(csv(nested, USUAL), "id,at.city,at.tags.0,at.tags.1\n1,Cluj,a,b\n");
        assert_eq!(csv(nested, Writing { flatten: false, ..USUAL }), "id,at\n1,\"{\"\"city\"\":\"\"Cluj\"\",\"\"tags\"\":[\"\"a\"\",\"\"b\"\"]}\"\n");
    }

    #[test]
    fn arrays_and_plain_values_are_rows_too_and_the_rest_is_refused() {
        assert_eq!(csv(r#"[["a","b"],[1,[2,3]],[]]"#, USUAL), "a,b\n1,\"[2,3]\"\n\n");
        assert_eq!(csv(r#"[1,"two",null]"#, USUAL), "1\ntwo\n\n");
        assert_eq!(csv("[]", USUAL), "");
        assert_eq!(problem(through(&mut write(USUAL), br#"[{"a":1},[2]]"#, 100)), ("not-rows", 0, 0));
        assert_eq!(problem(through(&mut write(USUAL), b"5", 100)), ("not-rows", 0, 0));
        assert!(problem(through(&mut write(USUAL), b"[1,", 100)).0 != "not-rows");
    }

    #[test]
    fn what_was_written_is_read_back() {
        let rows = r#"[{"a":"x, y","b":"line\nbreak","c":"q\"q"},{"a":"1","b":"","c":" s "}]"#;
        let there = csv(rows, USUAL);
        assert_eq!(json(&there, &mut reading(None, true, false, Style::Minify)), rows);
    }
}
