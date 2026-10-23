//! Keeping only the lines a pattern finds, or only those it does not.

use serde::Deserialize;

use super::replace::{self, Replacement};
use super::{lines_of, text_of, OpError, Outcome};

/// What is done with the lines the pattern finds.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FilterMode {
    /// They stay; the others go.
    #[default]
    Keep,
    /// They go; the others stay.
    Drop,
}

/// A filter with its choices, as the interface asks for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub find: String,
    /// `find` is a regular expression; without it, plain text.
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub mode: FilterMode,
}

/// Leaves the lines the pattern finds (or the others).
pub fn filter(text: &str, filter: &Filter) -> Result<Outcome, OpError> {
    let pattern = replace::pattern(&Replacement { find: filter.find.clone(), with: String::new(), regex: filter.regex, case_sensitive: filter.case_sensitive, whole_word: filter.whole_word, keep_case: false, fill: false, today: String::new(), now: String::new() })?;
    let (lines, ended) = lines_of(text);
    let kept: Vec<&str> = lines.iter().copied().filter(|line| pattern.is_match(line) == (filter.mode == FilterMode::Keep)).collect();
    Ok(Outcome { changed: lines.len() - kept.len(), text: text_of(&kept, ended) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(find: &str, mode: FilterMode) -> Filter {
        Filter { find: find.to_owned(), regex: false, case_sensitive: false, whole_word: false, mode }
    }

    #[test]
    fn keeps_or_drops_the_lines_that_are_found() {
        let text = "eroare: disc plin\ninfo: pornit\nEROARE: rețea\ninfo: oprit\n";
        assert_eq!(filter(text, &with("eroare", FilterMode::Keep)).expect("works").text, "eroare: disc plin\nEROARE: rețea\n");
        let dropped = filter(text, &with("eroare", FilterMode::Drop)).expect("works");
        assert_eq!((dropped.text.as_str(), dropped.changed), ("info: pornit\ninfo: oprit\n", 2));
        let numbered = Filter { regex: true, ..with(r"^\d+\.", FilterMode::Keep) };
        assert_eq!(filter("1. unu\ndoi\n22. trei", &numbered).expect("works").text, "1. unu\n22. trei");
        let word = Filter { whole_word: true, ..with("info", FilterMode::Keep) };
        assert_eq!(filter("informații\ninfo aici", &word).expect("works").text, "info aici");
    }

    #[test]
    fn refuses_nothing_to_find_and_a_bad_pattern() {
        assert!(matches!(filter("a", &with("", FilterMode::Keep)), Err(OpError::BadChoice(_))));
        assert!(matches!(filter("a", &Filter { regex: true, ..with("(", FilterMode::Keep) }), Err(OpError::BadPattern(_))));
    }
}
