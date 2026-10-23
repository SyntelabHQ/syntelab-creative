//! Tools that tell something of each line they are given (a moment, a URL, a schedule): what the lines have in
//! common.
//!
//! Each line that holds something becomes an object of a JSON array, written as soon as the line is read, so a
//! file of any number of lines goes through. A line that is not what the tool reads stops the run, and is told
//! with its place.

use std::io::Write;

use crate::codec::{CodecError, Letters, Place, Stage, Wrong};
use crate::json::{Options, Style};
use crate::tree::{self, quoted, Node};

/// The members of the object a line becomes, in order.
pub type Members = Vec<(&'static str, Node)>;

pub fn text(text: &str) -> Node {
    Node::Scalar(quoted(text))
}

/// A number, `true`, `false` or `null`, given as JSON writes it.
pub fn plain(written: impl ToString) -> Node {
    Node::Scalar(written.to_string().into_boxed_str())
}

pub fn list(items: impl IntoIterator<Item = Node>) -> Node {
    Node::Array(items.into_iter().collect())
}

pub fn object(members: Members) -> Node {
    Node::Object(members.into_iter().map(|(name, value)| (quoted(name), value)).collect())
}

type Work = Box<dyn FnMut(&str) -> Result<Members, &'static str>>;

pub struct EachLine {
    style: Style,
    work: Work,
    /// The code of the note that tells how many lines were read.
    counted_as: &'static str,
    letters: Letters,
    held: String,
    place: Place,
    found: u64,
}

impl EachLine {
    /// `work` makes of a line the members of its object, or says what is wrong with it (a code).
    pub fn new(style: Style, counted_as: &'static str, work: impl FnMut(&str) -> Result<Members, &'static str> + 'static) -> Self {
        EachLine { style, work: Box::new(work), counted_as, letters: Letters::default(), held: String::new(), place: Place::default(), found: 0 }
    }

    fn line(&mut self, line: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let here = self.place;
        line.bytes().for_each(|byte| self.place.pass(byte));
        self.place.pass(b'\n');
        let said = line.trim();
        if said.is_empty() {
            return Ok(());
        }
        let node = object((self.work)(said).map_err(|code| here.wrong(code))?);
        let mut written = Vec::new();
        tree::write(&node, &mut written, &tree::Writing { options: Options::of(self.style), one_line_within: 0 })?;
        out.write_all(if self.found == 0 { b"[" } else { b"," })?;
        self.found += 1;
        match self.style {
            Style::Minify | Style::Check => out.write_all(&written)?,
            Style::Spaces(_) | Style::Tab => {
                // The object stands one level in: each of its lines is pushed in by one more.
                let step = if let Style::Spaces(spaces) = self.style { " ".repeat(usize::from(spaces)) } else { "\t".to_owned() };
                for part in written.split(|&byte| byte == b'\n') {
                    write!(out, "\n{step}")?;
                    out.write_all(part)?;
                }
            }
        }
        Ok(())
    }
}

impl Stage for EachLine {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        self.held.push_str(&text);
        while let Some(end) = self.held.find('\n') {
            let line: String = self.held.drain(..=end).collect();
            self.line(line.trim_end_matches(['\n', '\r']).trim_start_matches('\u{feff}'), out)?;
        }
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        let last = std::mem::take(&mut self.held);
        self.line(last.trim_end_matches('\r').trim_start_matches('\u{feff}'), out)?;
        if self.found == 0 {
            return Err(Wrong::nowhere("empty").into());
        }
        out.write_all(if matches!(self.style, Style::Minify | Style::Check) { b"]" } else { b"\n]" })?;
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        vec![(self.counted_as, self.found.to_string())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn lengths(style: Style) -> EachLine {
        EachLine::new(style, "lines-read", |line| if line == "bad" { Err("bad-line") } else { Ok(vec![("line", text(line)), ("letters", plain(line.chars().count())), ("parts", list(line.split(' ').map(text)))]) })
    }

    #[test]
    fn each_line_becomes_an_object_of_an_array() {
        let mut stage = lengths(Style::Minify);
        assert_eq!(String::from_utf8(through(&mut stage, "\u{feff}a b\r\n\n  é  \n".as_bytes(), 2).expect("read")).expect("text"), r#"[{"line":"a b","letters":3,"parts":["a","b"]},{"line":"é","letters":1,"parts":["é"]}]"#);
        assert_eq!(stage.notes(), vec![("lines-read", "2".to_string())]);
        assert_eq!(String::from_utf8(through(&mut lengths(Style::Spaces(2)), b"x", 9).expect("read")).expect("text"), "[\n  {\n    \"line\": \"x\",\n    \"letters\": 1,\n    \"parts\": [\n      \"x\"\n    ]\n  }\n]");
        assert_eq!(problem(through(&mut lengths(Style::Minify), b"ok\n\nbad\n", 3)), ("bad-line", 3, 1));
        assert_eq!(problem(through(&mut lengths(Style::Minify), b"\n \n", 3)), ("empty", 0, 0));
    }
}
