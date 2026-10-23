//! Operations on text: the tools of Scribe.
//!
//! Each takes a text (with `\n` between its lines) and gives the new text
//! with a short account of what it did. They are written once, here, and run
//! the same on the text in the editor, on a file and in a recipe.

pub mod case;
pub mod clean;
pub mod duplicates;
pub mod filter;
pub mod keys;
pub mod lines;
pub mod replace;
pub mod reverse;
pub mod sort;

use serde::Deserialize;

pub use case::CaseStyle;
pub use clean::{QuoteStyle, Side};
pub use duplicates::{Counting, Duplicates, Keep};
pub use filter::Filter;
pub use lines::EmptyLines;
pub use sort::{SortBy, Sorting};
pub use replace::{ManyReplacements, Replacement};
pub use reverse::Reversal;

/// One operation with its choices, as the interface asks for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Operation {
    /// Sorts the lines, or the paragraphs (`sort`).
    SortLines(Sorting),
    /// Takes out lines that are there more than once (`duplicates`).
    RemoveDuplicates(Duplicates),
    /// Leaves each line once, with how often it was there written before it.
    CountLines(Counting),
    /// Keeps only the lines a pattern finds, or only the others.
    FilterLines(Filter),
    ReverseLines,
    /// Puts the lines in a random order; the same `seed` gives the same order.
    ShuffleLines {
        #[serde(default)]
        seed: Option<u64>,
    },
    /// Writes its number before each line.
    #[serde(rename_all = "camelCase")]
    NumberLines {
        #[serde(default = "one")]
        start: i64,
        /// What stands between the number and the line.
        #[serde(default = "dot_space")]
        separator: String,
        /// Numbers get zeros in front, so all are as long as the last.
        #[serde(default)]
        pad: bool,
        /// Empty lines get no number and do not count.
        #[serde(default)]
        skip_empty: bool,
    },
    /// Takes the spaces off the ends of every line.
    TrimLines {
        #[serde(default)]
        side: Side,
    },
    EmptyLines {
        #[serde(default)]
        mode: EmptyLines,
    },
    /// Makes one line of all, with `separator` between what were lines.
    JoinLines {
        #[serde(default = "space")]
        separator: String,
    },
    /// Starts a new line at every `separator`.
    SplitLines { separator: String },
    ChangeCase { to: CaseStyle },
    /// Runs of spaces become one space; spaces at the ends of lines go.
    CleanSpaces,
    TabsToSpaces {
        #[serde(default = "four")]
        width: usize,
    },
    /// Spaces at the start of lines become tabs, `width` spaces to a tab.
    SpacesToTabs {
        #[serde(default = "four")]
        width: usize,
    },
    Quotes { to: QuoteStyle },
    /// Leaves the text of a web page, without its tags.
    StripHtml,
    /// Takes the marks off letters: ă → a, é → e.
    RemoveDiacritics,
    /// Romanian written with the wrong letters: ş → ș, ţ → ț.
    RepairRomanian,
    /// Romanian typed without diacritics, written with them where the words are known (`language::romanian`).
    RestoreRomanian {
        /// Words that can be read in more than one way take their likelier reading; without it they are left as typed.
        #[serde(default)]
        guess: bool,
    },
    Replace(Replacement),
    /// Several find-and-replace pairs, done one after another.
    ReplaceMany(ManyReplacements),
    /// Turns the letters or the words of every line around.
    ReverseText {
        #[serde(default)]
        what: Reversal,
    },
}

fn one() -> i64 {
    1
}
fn four() -> usize {
    4
}
fn space() -> String {
    " ".to_owned()
}
fn dot_space() -> String {
    ". ".to_owned()
}

/// What an operation gave.
#[derive(Debug, PartialEq, Eq)]
pub struct Outcome {
    pub text: String,
    /// How much it changed, in what the operation counts: lines moved or taken out, places replaced…
    pub changed: usize,
}

#[derive(Debug, PartialEq, Eq)]
pub enum OpError {
    /// The pattern to find is not a valid regular expression; why is given.
    BadPattern(String),
    /// A choice is not usable (a tab of no width, nothing to find).
    BadChoice(&'static str),
}

impl std::fmt::Display for OpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            OpError::BadPattern(why) => write!(f, "{why}"),
            OpError::BadChoice(what) => f.write_str(what),
        }
    }
}

/// Does one operation to a text.
pub fn apply(text: &str, operation: &Operation) -> Result<Outcome, OpError> {
    Ok(match operation {
        Operation::SortLines(sorting) => sort::sort(text, sorting),
        Operation::RemoveDuplicates(duplicates) => duplicates::remove(text, duplicates)?,
        Operation::CountLines(counting) => duplicates::count_lines(text, counting)?,
        Operation::FilterLines(filter) => filter::filter(text, filter)?,
        Operation::ReverseLines => lines::reverse(text),
        Operation::ShuffleLines { seed } => lines::shuffle(text, *seed),
        Operation::NumberLines { start, separator, pad, skip_empty } => lines::number(text, *start, separator, *pad, *skip_empty),
        Operation::TrimLines { side } => clean::trim_lines(text, *side),
        Operation::EmptyLines { mode } => lines::empty_lines(text, *mode),
        Operation::JoinLines { separator } => lines::join(text, separator),
        Operation::SplitLines { separator } => lines::split(text, separator)?,
        Operation::ChangeCase { to } => case::change(text, *to),
        Operation::CleanSpaces => clean::clean_spaces(text),
        Operation::TabsToSpaces { width } => clean::tabs_to_spaces(text, *width)?,
        Operation::SpacesToTabs { width } => clean::spaces_to_tabs(text, *width)?,
        Operation::Quotes { to } => clean::quotes(text, *to),
        Operation::StripHtml => clean::strip_html(text),
        Operation::RemoveDiacritics => clean::remove_diacritics(text),
        Operation::RepairRomanian => clean::repair_romanian(text),
        Operation::RestoreRomanian { guess } => {
            let restored = crate::language::romanian::restore(text, *guess);
            Outcome { text: restored.text, changed: restored.changed }
        }
        Operation::Replace(replacement) => replace::replace(text, replacement)?,
        Operation::ReplaceMany(many) => replace::replace_many(text, many)?,
        Operation::ReverseText { what } => reverse::reverse(text, *what),
    })
}

/// Does several operations one after another; stops at the first that cannot be done.
pub fn apply_all(text: &str, operations: &[Operation]) -> Result<Outcome, OpError> {
    let mut outcome = Outcome { text: text.to_owned(), changed: 0 };
    for operation in operations {
        let next = apply(&outcome.text, operation)?;
        outcome = Outcome { text: next.text, changed: outcome.changed + next.changed };
    }
    Ok(outcome)
}

/// The lines of a text and whether it ends with a line ending (which is kept as it is by what works on lines).
pub(crate) fn lines_of(text: &str) -> (Vec<&str>, bool) {
    if text.is_empty() {
        return (Vec::new(), false);
    }
    let ended = text.ends_with('\n');
    let body = if ended { &text[..text.len() - 1] } else { text };
    (body.split('\n').collect(), ended)
}

/// Lines put together again, with the ending the text had.
pub(crate) fn text_of<S: AsRef<str>>(lines: &[S], ended: bool) -> String {
    let mut text = String::with_capacity(lines.iter().map(|line| line.as_ref().len() + 1).sum());
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            text.push('\n');
        }
        text.push_str(line.as_ref());
    }
    if ended && !lines.is_empty() {
        text.push('\n');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn operation(value: serde_json::Value) -> Operation {
        serde_json::from_value(value).expect("an operation")
    }

    #[test]
    fn reads_operations_as_the_interface_writes_them() {
        assert!(matches!(operation(json!({ "kind": "sortLines" })), Operation::SortLines(Sorting { by: SortBy::Alphabetical, descending: false, case_sensitive: false, language: None, .. })));
        assert!(matches!(operation(json!({ "kind": "sortLines", "by": "date", "key": "column", "position": 2, "delimiter": ";", "keepHeader": true, "dateOrder": "monthFirst" })), Operation::SortLines(Sorting { by: SortBy::Date, position: 2, keep_header: true, .. })));
        assert!(matches!(operation(json!({ "kind": "removeDuplicates", "ignoreSpaces": true, "keep": "last" })), Operation::RemoveDuplicates(Duplicates { keep: Keep::Last, .. })));
        assert!(matches!(operation(json!({ "kind": "removeDuplicates", "keep": "none", "ignoreNumbers": true, "empty": "collapse" })), Operation::RemoveDuplicates(duplicates) if duplicates.same.ignore_numbers && duplicates.keep == Keep::None));
        assert!(matches!(operation(json!({ "kind": "countLines", "order": "leastFirst" })), Operation::CountLines(counting) if counting.separator == "\t"));
        assert!(matches!(operation(json!({ "kind": "filterLines", "find": "x", "mode": "drop" })), Operation::FilterLines(_)));
        assert!(matches!(operation(json!({ "kind": "changeCase", "to": "title" })), Operation::ChangeCase { to: CaseStyle::Title }));
        assert!(matches!(operation(json!({ "kind": "replace", "find": "a", "with": "b" })), Operation::Replace(_)));
        assert!(matches!(operation(json!({ "kind": "restoreRomanian" })), Operation::RestoreRomanian { guess: false }));
        assert_eq!(apply("si in oras", &operation(json!({ "kind": "restoreRomanian" }))).expect("works"), Outcome { text: "și în oraș".to_owned(), changed: 3 });
        assert!(serde_json::from_value::<Operation>(json!({ "kind": "nothing" })).is_err());
    }

    #[test]
    fn does_operations_one_after_another() {
        let chain = [operation(json!({ "kind": "trimLines" })), operation(json!({ "kind": "removeDuplicates" })), operation(json!({ "kind": "sortLines" }))];
        let outcome = apply_all("pear \napple\n pear\nfig\n", &chain).expect("works");
        assert_eq!(outcome.text, "apple\nfig\npear\n");
        assert!(outcome.changed > 0);
    }

    #[test]
    fn keeps_the_ending_of_the_text_as_it_was() {
        assert_eq!(apply("b\na", &operation(json!({ "kind": "sortLines" }))).expect("works").text, "a\nb");
        assert_eq!(apply("b\na\n", &operation(json!({ "kind": "sortLines" }))).expect("works").text, "a\nb\n");
        assert_eq!(apply("", &operation(json!({ "kind": "sortLines" }))).expect("works").text, "");
    }
}
