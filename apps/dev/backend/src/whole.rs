//! Tools that must hold what they are given whole before they can write anything (YAML, JSON written as CSV).
//!
//! They are a [`Stage`] like the others, so they are run, checked and told of the same way; but what they are fed
//! is kept until the end, and the work is done then. How much they take is a matter of memory.

use std::io::Write;

use crate::codec::{CodecError, Place, Stage};
use crate::json::{self, Grown, Options, RunError, Style};
use crate::tree::{self, Node};

/// What the work on a whole text gives beside what it writes: things worth telling the user of.
pub type Notes = Vec<(&'static str, String)>;

/// What is wrong with the text, in the words of the one who read it (in English), beside its code and its place.
#[derive(Debug)]
pub struct Said(pub CodecError, pub Option<String>);

impl<E: Into<CodecError>> From<E> for Said {
    fn from(error: E) -> Self {
        Said(error.into(), None)
    }
}

type Work = Box<dyn FnMut(&str, &mut dyn Write) -> Result<Notes, Said>>;

/// A stage that keeps what it is fed and works on all of it at the end.
pub struct Whole {
    held: Vec<u8>,
    work: Work,
    notes: Notes,
    said: Option<String>,
}

impl Whole {
    pub fn new(work: impl FnMut(&str, &mut dyn Write) -> Result<Notes, Said> + 'static) -> Self {
        Whole { held: Vec::new(), work: Box::new(work), notes: Vec::new(), said: None }
    }
}

impl Stage for Whole {
    fn push(&mut self, piece: &[u8], _out: &mut dyn Write) -> Result<(), CodecError> {
        if self.held.try_reserve(piece.len()).is_err() {
            return Err(CodecError::NoMemory);
        }
        self.held.extend_from_slice(piece);
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        let held = std::mem::take(&mut self.held);
        let text = match std::str::from_utf8(&held) {
            Ok(text) => text,
            Err(error) => {
                let mut place = Place::default();
                held[..error.valid_up_to()].iter().for_each(|&byte| place.pass(byte));
                return Err(place.wrong("not-utf8").into());
            }
        };
        // The mark some programs put before a text is not part of it.
        match (self.work)(text.strip_prefix('\u{feff}').unwrap_or(text), out) {
            Ok(notes) => {
                self.notes = notes;
                Ok(())
            }
            Err(Said(error, said)) => {
                self.said = said;
                Err(error)
            }
        }
    }

    fn notes(&self) -> Notes {
        self.notes.clone()
    }

    fn said(&self) -> Option<String> {
        self.said.clone()
    }
}

/// JSON read into its tree, with how deep it is nested. What is wrong with it is told as the JSON formatter tells it.
pub fn json_tree(text: &str) -> Result<(Node, u64), CodecError> {
    let mut minified = Grown::default();
    let stats = json::transform_with(text.as_bytes(), &mut minified, Options::of(Style::Minify), &mut |_| true).map_err(|error| match error {
        RunError::Json(error) => CodecError::Wrong(crate::codec::Wrong { code: error.problem.code(), line: error.line, column: error.column, offset: error.offset }),
        RunError::Io(error) => CodecError::Io(error),
        RunError::Stopped => CodecError::Stopped,
        RunError::NoMemory => CodecError::NoMemory,
    })?;
    // Only bytes of the text, which is UTF-8, and plain signs were written.
    let minified = String::from_utf8(minified.0).map_err(|_| CodecError::NoMemory)?;
    Ok((tree::build(&minified).ok_or(CodecError::NoMemory)?, stats.depth))
}

/// A tree written as JSON into memory, on a stack deep enough for it.
pub fn json_text(node: &Node, depth: u64, options: Options) -> Result<Vec<u8>, CodecError> {
    let writing = tree::Writing { options, one_line_within: 0 };
    let written = tree::deep(depth, || {
        let mut grown = Grown::default();
        tree::write(node, &mut grown, &writing).map(|()| grown.0)
    });
    Ok(written.ok_or(CodecError::NoMemory)??)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    #[test]
    fn works_on_everything_at_the_end_whatever_the_pieces() {
        for at_once in [1, 3, 100] {
            let mut stage = Whole::new(|text, out| {
                out.write_all(text.to_uppercase().as_bytes())?;
                Ok(vec![("seen", text.len().to_string())])
            });
            assert_eq!(through(&mut stage, "\u{feff}aé b".as_bytes(), at_once).expect("done"), "AÉ B".as_bytes());
            assert_eq!(stage.notes(), vec![("seen", "5".to_string())]);
        }
    }

    #[test]
    fn tells_what_is_not_text_and_what_the_work_said() {
        let mut stage = Whole::new(|_, _| Ok(Vec::new()));
        assert_eq!(problem(through(&mut stage, b"a\nb\xffc", 2)), ("not-utf8", 2, 2));
        let mut stage = Whole::new(|_, _| Err(Said(crate::codec::Wrong::nowhere("bad").into(), Some("why".into()))));
        assert_eq!(problem(through(&mut stage, b"x", 1)), ("bad", 0, 0));
        assert_eq!(stage.said().as_deref(), Some("why"));
    }

    #[test]
    fn reads_json_into_a_tree_and_writes_it_again() {
        let (node, depth) = json_tree("{\"a\": [1, {\"b\": null}]}").expect("tree");
        assert_eq!(depth, 3);
        assert_eq!(json_text(&node, depth, Options::of(Style::Minify)).expect("text"), b"{\"a\":[1,{\"b\":null}]}");
        assert!(matches!(json_tree("{\"a\": }"), Err(CodecError::Wrong(wrong)) if wrong.line == 1 && wrong.column == 7));
    }
}
