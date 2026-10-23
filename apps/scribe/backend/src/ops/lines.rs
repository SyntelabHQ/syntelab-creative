//! Operations on the lines of a text: their order, which stay, how they are numbered and joined.

use serde::Deserialize;

use super::{lines_of, text_of, OpError, Outcome};

/// What is done with empty lines.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmptyLines {
    /// All of them go.
    #[default]
    Remove,
    /// Several in a row become one.
    Collapse,
}

/// How many lines are not where they were.
pub(super) fn moved(before: &[&str], after: &[&str]) -> usize {
    before.iter().zip(after).filter(|(one, other)| one != other).count()
}

/// The number a line starts with, if it has one: `12`, `-3.5`, `1,5`, `1 000`.
pub(super) fn leading_number(line: &str) -> Option<f64> {
    let trimmed = line.trim_start();
    let mut written = String::new();
    let mut seen_digit = false;
    let mut seen_point = false;
    for (index, letter) in trimmed.char_indices() {
        match letter {
            '-' | '+' if index == 0 => written.push(letter),
            '0'..='9' => {
                seen_digit = true;
                written.push(letter);
            }
            '.' | ',' if seen_digit && !seen_point => {
                seen_point = true;
                written.push('.');
            }
            _ => break,
        }
    }
    if !seen_digit {
        return None;
    }
    written.trim_end_matches('.').parse().ok()
}

pub fn reverse(text: &str) -> Outcome {
    let (lines, ended) = lines_of(text);
    let mut reversed = lines.clone();
    reversed.reverse();
    Outcome { changed: moved(&lines, &reversed), text: text_of(&reversed, ended) }
}

/// A small generator of numbers that look random: enough to shuffle lines, and the same for the same seed.
pub(super) struct Shuffler(u64);

impl Shuffler {
    pub(super) fn new(seed: u64) -> Self {
        // Zero would stay zero for ever.
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    /// A number from 0 up to, not including, `below`.
    pub(super) fn below(&mut self, below: usize) -> usize {
        (self.next() % below as u64) as usize
    }
}

pub fn shuffle(text: &str, seed: Option<u64>) -> Outcome {
    let (lines, ended) = lines_of(text);
    let seed = seed.unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |since| since.as_nanos() as u64));
    let mut shuffled = lines.clone();
    let mut numbers = Shuffler::new(seed);
    for index in (1..shuffled.len()).rev() {
        shuffled.swap(index, numbers.below(index + 1));
    }
    Outcome { changed: moved(&lines, &shuffled), text: text_of(&shuffled, ended) }
}

pub fn number(text: &str, start: i64, separator: &str, pad: bool, skip_empty: bool) -> Outcome {
    let separator = &super::keys::separator_of(separator);
    let (lines, ended) = lines_of(text);
    let counted = lines.iter().filter(|line| !(skip_empty && line.trim().is_empty())).count();
    let last = start + counted as i64 - 1;
    let width = if pad { last.to_string().len().max(start.to_string().len()) } else { 0 };
    let mut next = start;
    let numbered: Vec<String> = lines
        .iter()
        .map(|line| {
            if skip_empty && line.trim().is_empty() {
                return (*line).to_owned();
            }
            let written = format!("{next:0width$}{separator}{line}");
            next += 1;
            written
        })
        .collect();
    Outcome { changed: counted, text: text_of(&numbered, ended) }
}

pub fn empty_lines(text: &str, mode: EmptyLines) -> Outcome {
    let (lines, ended) = lines_of(text);
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut after_empty = false;
    for line in &lines {
        let empty = line.trim().is_empty();
        if !empty || (mode == EmptyLines::Collapse && !after_empty) {
            kept.push(if empty { "" } else { line });
        }
        after_empty = empty;
    }
    Outcome { changed: lines.len() - kept.len(), text: text_of(&kept, ended) }
}

pub fn join(text: &str, separator: &str) -> Outcome {
    let (lines, ended) = lines_of(text);
    let joined = lines.join(&super::keys::separator_of(separator));
    Outcome { changed: lines.len().saturating_sub(1), text: if ended && !lines.is_empty() { format!("{joined}\n") } else { joined } }
}

pub fn split(text: &str, separator: &str) -> Result<Outcome, OpError> {
    if separator.is_empty() {
        return Err(OpError::BadChoice("nothing to split at"));
    }
    let separator = &super::keys::separator_of(separator);
    Ok(Outcome { changed: text.matches(separator).count(), text: text.replace(separator, "\n") })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_tab_can_be_typed_as_a_separator() {
        assert_eq!(join("a\nb", "\\t").text, "a\tb");
        assert_eq!(split("a\tb", "\\t").expect("splits").text, "a\nb");
        assert_eq!(number("a", 1, "\\t", false, false).text, "1\ta");
    }

    #[test]
    fn reverses_and_shuffles() {
        assert_eq!(reverse("1\n2\n3\n").text, "3\n2\n1\n");
        let shuffled = shuffle("1\n2\n3\n4\n5\n6\n7\n8", Some(7));
        assert_eq!(shuffled.text, shuffle("1\n2\n3\n4\n5\n6\n7\n8", Some(7)).text, "the same seed gives the same order");
        assert_ne!(shuffled.text, "1\n2\n3\n4\n5\n6\n7\n8");
        let mut lines: Vec<&str> = shuffled.text.split('\n').collect();
        lines.sort_unstable();
        assert_eq!(lines, ["1", "2", "3", "4", "5", "6", "7", "8"], "no line is lost or made twice");
    }

    #[test]
    fn numbers_lines() {
        assert_eq!(number("a\nb", 1, ". ", false, false).text, "1. a\n2. b");
        assert_eq!(number("a\n\nb", 9, ") ", true, true).text, "09) a\n\n10) b");
        assert_eq!(number("a\n\nb", 1, " ", false, false).text, "1 a\n2 \n3 b");
    }

    #[test]
    fn removes_or_collapses_empty_lines() {
        assert_eq!(empty_lines("a\n\n  \nb\n\nc\n", EmptyLines::Remove).text, "a\nb\nc\n");
        assert_eq!(empty_lines("a\n\n  \nb\n\nc\n", EmptyLines::Collapse).text, "a\n\nb\n\nc\n");
    }

    #[test]
    fn joins_and_splits() {
        assert_eq!(join("a\nb\nc\n", ", ").text, "a, b, c\n");
        assert_eq!(split("a, b, c", ", ").expect("splits").text, "a\nb\nc");
        assert_eq!(split("a", ""), Err(OpError::BadChoice("nothing to split at")));
    }
}
