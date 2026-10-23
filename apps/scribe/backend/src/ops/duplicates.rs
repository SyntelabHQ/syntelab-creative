//! Lines that are there more than once: taken out, or counted.
//!
//! What makes two lines "the same" is chosen: their capitals, the spaces
//! around them, the numbers and the punctuation in them may be passed over,
//! and only a part of the line (a column, what a pattern finds) may count.

use std::collections::HashMap;

use regex::Regex;
use serde::Deserialize;

use super::keys::{delimiter_of, KeyOf, Part};
use super::{lines_of, text_of, OpError, Outcome};
use crate::language::collation::Sorter;

/// Which of the lines that are the same stays.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Keep {
    #[default]
    First,
    Last,
    /// None of them: only the lines that are there once stay.
    None,
}

/// What is done with empty lines while duplicates are taken out.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmptyAmong {
    /// They are lines like the others: the second empty line is a duplicate.
    #[default]
    AsOthers,
    /// They all stay where they are: they part the text, they do not repeat it.
    Keep,
    /// They all go.
    Remove,
    /// Several in a row become one.
    Collapse,
}

/// What makes two lines the same, as the interface asks for it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sameness {
    pub case_sensitive: bool,
    /// Spaces around a line do not make it another line.
    pub ignore_spaces: bool,
    /// Digits do not count: "item 1" and "item 2" are the same.
    pub ignore_numbers: bool,
    /// Punctuation does not count: "da." and "da!" are the same.
    pub ignore_punctuation: bool,
    /// This many characters at the start, and at the end, of each line do not count.
    pub skip_start: usize,
    pub skip_end: usize,
    /// The part of each line that is compared.
    pub key: KeyOf,
    pub position: usize,
    pub delimiter: String,
    /// When not empty: a regular expression, and what it finds in the line (its first group, when it has one) is what is compared.
    pub pattern: String,
}

/// Taking duplicates out, with its choices.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Duplicates {
    #[serde(flatten)]
    pub same: Sameness,
    pub keep: Keep,
    /// Only lines that follow each other count as the same.
    pub adjacent_only: bool,
    pub empty: EmptyAmong,
}

/// How the counted lines are ordered.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CountOrder {
    /// The most repeated first.
    #[default]
    MostFirst,
    /// The least repeated first.
    LeastFirst,
    /// As they are first met in the text.
    AsMet,
    /// By their letters.
    Alphabetical,
}

/// Counting how often each line is there, with its choices.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Counting {
    #[serde(flatten)]
    pub same: Sameness,
    pub order: CountOrder,
    /// What stands between the count and the line.
    pub separator: String,
    /// Only the lines that are there more than once are listed.
    pub repeated_only: bool,
    pub language: Option<String>,
}

impl Default for Counting {
    fn default() -> Self {
        Self { same: Sameness::default(), order: CountOrder::default(), separator: "\t".to_owned(), repeated_only: false, language: None }
    }
}

/// Finds what counts of a line.
struct KeyMaker<'a> {
    same: &'a Sameness,
    delimiter: String,
    pattern: Option<Regex>,
}

impl<'a> KeyMaker<'a> {
    fn new(same: &'a Sameness) -> Result<Self, OpError> {
        let pattern = if same.pattern.is_empty() { None } else { Some(Regex::new(&same.pattern).map_err(|error| OpError::BadPattern(error.to_string().lines().last().unwrap_or("").trim_start_matches("error: ").to_owned()))?) };
        Ok(Self { same, delimiter: delimiter_of(&same.delimiter), pattern })
    }

    /// What two lines must have alike to be the same line.
    fn key(&self, line: &str) -> String {
        let same = self.same;
        let part = Part { of: same.key, position: same.position, delimiter: &self.delimiter }.of(line);
        // What the pattern finds; a line it finds nothing in is compared whole.
        let found = self.pattern.as_ref().and_then(|pattern| pattern.captures(part)).map(|found| found.get(1).or_else(|| found.get(0)).map_or("", |group| group.as_str()));
        let mut seen = found.unwrap_or(part);
        if same.ignore_spaces {
            seen = seen.trim();
        }
        if same.skip_start > 0 {
            seen = seen.char_indices().nth(same.skip_start).map_or("", |(at, _)| &seen[at..]);
        }
        if same.skip_end > 0 {
            let length = seen.chars().count();
            seen = seen.char_indices().nth(length.saturating_sub(same.skip_end)).map_or(seen, |(at, _)| &seen[..at]);
            if same.skip_end >= length {
                seen = "";
            }
        }
        let mut key = String::with_capacity(seen.len());
        for letter in seen.chars() {
            if same.ignore_numbers && letter.is_numeric() {
                continue;
            }
            if same.ignore_punctuation && !letter.is_alphanumeric() && !letter.is_whitespace() {
                continue;
            }
            if same.case_sensitive {
                key.push(letter);
            } else {
                key.extend(letter.to_lowercase());
            }
        }
        // With what was passed over gone, the spaces left around are passed over too.
        if same.ignore_spaces || same.ignore_numbers || same.ignore_punctuation {
            key.split_whitespace().collect::<Vec<_>>().join(" ")
        } else {
            key
        }
    }
}

/// Takes out the lines that are there more than once.
pub fn remove(text: &str, duplicates: &Duplicates) -> Result<Outcome, OpError> {
    let (lines, ended) = lines_of(text);
    let maker = KeyMaker::new(&duplicates.same)?;
    let apart = duplicates.empty != EmptyAmong::AsOthers;
    // Empty lines that are dealt with apart take no part in what is the same as what.
    let counted = |line: &str| !(apart && line.trim().is_empty());
    let keys: Vec<Option<String>> = lines.iter().map(|line| counted(line).then(|| maker.key(line))).collect();

    let mut stays = vec![true; lines.len()];
    if duplicates.adjacent_only {
        // Runs of the same line: the first of each stays, or the last, or none when the run is longer than one.
        let mut start = 0;
        while start < lines.len() {
            let Some(key) = &keys[start] else {
                start += 1;
                continue;
            };
            let mut end = start + 1;
            while end < lines.len() && keys[end].as_ref() == Some(key) {
                end += 1;
            }
            if end - start > 1 {
                for (index, stay) in stays.iter_mut().enumerate().take(end).skip(start) {
                    *stay = match duplicates.keep {
                        Keep::First => index == start,
                        Keep::Last => index == end - 1,
                        Keep::None => false,
                    };
                }
            }
            start = end;
        }
    } else {
        let mut places: HashMap<&str, (usize, usize, usize)> = HashMap::with_capacity(lines.len());
        for (index, key) in keys.iter().enumerate() {
            if let Some(key) = key {
                let place = places.entry(key.as_str()).or_insert((index, index, 0));
                place.1 = index;
                place.2 += 1;
            }
        }
        for (index, key) in keys.iter().enumerate() {
            if let Some((first, last, count)) = key.as_ref().and_then(|key| places.get(key.as_str())) {
                stays[index] = match duplicates.keep {
                    Keep::First => index == *first,
                    Keep::Last => index == *last,
                    Keep::None => *count == 1,
                };
            }
        }
    }

    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    let mut after_empty = false;
    for (index, line) in lines.iter().enumerate() {
        let empty = line.trim().is_empty();
        let stay = if empty && apart {
            match duplicates.empty {
                EmptyAmong::Keep | EmptyAmong::AsOthers => true,
                EmptyAmong::Remove => false,
                EmptyAmong::Collapse => !after_empty,
            }
        } else {
            stays[index]
        };
        if stay {
            kept.push(line);
            after_empty = empty;
        }
    }
    Ok(Outcome { changed: lines.len() - kept.len(), text: text_of(&kept, ended) })
}

/// A line with how often it is in a text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Counted {
    /// The line as it is first written in the text.
    pub line: String,
    pub count: usize,
    /// The number of the first line that says it (from 1).
    pub first: usize,
}

/// How often each line is in the text; empty lines are not counted.
pub fn count(text: &str, counting: &Counting) -> Result<Vec<Counted>, OpError> {
    let (lines, _) = lines_of(text);
    let maker = KeyMaker::new(&counting.same)?;
    let mut places: HashMap<String, usize> = HashMap::new();
    let mut counted: Vec<Counted> = Vec::new();
    for (index, line) in lines.iter().enumerate().filter(|(_, line)| !line.trim().is_empty()) {
        match places.get(&maker.key(line)) {
            Some(place) => counted[*place].count += 1,
            None => {
                places.insert(maker.key(line), counted.len());
                counted.push(Counted { line: (*line).to_owned(), count: 1, first: index + 1 });
            }
        }
    }
    if counting.repeated_only {
        counted.retain(|line| line.count > 1);
    }
    let letters = Sorter::new(counting.language.as_deref(), counting.same.case_sensitive, false);
    match counting.order {
        // Lines as often there keep the order they are met in.
        CountOrder::MostFirst => counted.sort_by(|one, other| other.count.cmp(&one.count).then(one.first.cmp(&other.first))),
        CountOrder::LeastFirst => counted.sort_by(|one, other| one.count.cmp(&other.count).then(one.first.cmp(&other.first))),
        CountOrder::AsMet => {}
        CountOrder::Alphabetical => counted.sort_by(|one, other| letters.compare(&one.line, &other.line).then(one.first.cmp(&other.first))),
    }
    Ok(counted)
}

/// The text made of its lines, each once, with how often it was there written before it.
pub fn count_lines(text: &str, counting: &Counting) -> Result<Outcome, OpError> {
    let (lines, ended) = lines_of(text);
    let counted = count(text, counting)?;
    // What is typed for a tab becomes one.
    let separator = super::keys::separator_of(&counting.separator);
    let written: Vec<String> = counted.iter().map(|line| format!("{}{separator}{}", line.count, line.line)).collect();
    Ok(Outcome { changed: lines.len().abs_diff(written.len()).max(usize::from(!written.is_empty())), text: text_of(&written, ended) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn removed(text: &str, duplicates: &Duplicates) -> String {
        remove(text, duplicates).expect("works").text
    }

    fn same(same: Sameness) -> Duplicates {
        Duplicates { same, ..Duplicates::default() }
    }

    #[test]
    fn removes_lines_that_are_there_twice() {
        assert_eq!(removed("a\nb\nA\nc\nb\n", &Duplicates::default()), "a\nb\nc\n");
        assert_eq!(removed("a\nb\nA\nc\nb\n", &same(Sameness { case_sensitive: true, ..Sameness::default() })), "a\nb\nA\nc\n");
        assert_eq!(removed("a\nb\nA\nc\nb", &Duplicates { keep: Keep::Last, ..Duplicates::default() }), "A\nc\nb");
        assert_eq!(removed("a \n a\nb", &same(Sameness { ignore_spaces: true, ..Sameness::default() })), "a \nb");
        assert_eq!(remove("a\na\na", &Duplicates::default()).expect("works").changed, 2);
    }

    #[test]
    fn keeps_none_of_the_lines_that_repeat_when_asked() {
        assert_eq!(removed("a\nb\na\nc\nb\nd", &Duplicates { keep: Keep::None, ..Duplicates::default() }), "c\nd");
        assert_eq!(removed("a\na\nb\na", &Duplicates { keep: Keep::None, adjacent_only: true, ..Duplicates::default() }), "b\na");
    }

    #[test]
    fn removes_only_repeats_in_a_row_when_asked() {
        assert_eq!(removed("a\na\nb\na\na", &Duplicates { adjacent_only: true, ..Duplicates::default() }), "a\nb\na");
        assert_eq!(removed("a\nA\nb", &Duplicates { adjacent_only: true, keep: Keep::Last, ..Duplicates::default() }), "A\nb");
    }

    #[test]
    fn passes_over_what_it_is_told_to() {
        assert_eq!(removed("item 1\nitem 22\naltul", &same(Sameness { ignore_numbers: true, ..Sameness::default() })), "item 1\naltul");
        assert_eq!(removed("Da.\nda!\n— da\nnu", &same(Sameness { ignore_punctuation: true, ..Sameness::default() })), "Da.\nnu");
        assert_eq!(removed("01: mere\n02: mere\n03: pere", &same(Sameness { skip_start: 4, ..Sameness::default() })), "01: mere\n03: pere");
        assert_eq!(removed("mere;\nmere.\npere.", &same(Sameness { skip_end: 1, ..Sameness::default() })), "mere;\npere.");
        assert_eq!(removed("ab\nxy", &same(Sameness { skip_end: 9, ..Sameness::default() })), "ab");
    }

    #[test]
    fn compares_a_part_of_the_line() {
        let by_mail = same(Sameness { key: KeyOf::Column, position: 2, delimiter: ";".into(), ..Sameness::default() });
        assert_eq!(removed("Ana;ana@x.ro\nAna P.;ANA@x.ro\nIon;ion@x.ro", &by_mail), "Ana;ana@x.ro\nIon;ion@x.ro");
        let by_number = same(Sameness { pattern: r"#(\d+)".into(), ..Sameness::default() });
        assert_eq!(removed("comanda #12 azi\nplata #12\nfără număr\ncomanda #13\nfără număr", &by_number), "comanda #12 azi\nfără număr\ncomanda #13");
        assert!(matches!(remove("a", &same(Sameness { pattern: "(".into(), ..Sameness::default() })), Err(OpError::BadPattern(_))));
    }

    #[test]
    fn deals_with_empty_lines_as_asked() {
        let text = "a\n\nb\n\n\na\n";
        assert_eq!(removed(text, &Duplicates::default()), "a\n\nb\n");
        assert_eq!(removed(text, &Duplicates { empty: EmptyAmong::Keep, ..Duplicates::default() }), "a\n\nb\n\n\n");
        assert_eq!(removed(text, &Duplicates { empty: EmptyAmong::Remove, ..Duplicates::default() }), "a\nb\n");
        assert_eq!(removed(text, &Duplicates { empty: EmptyAmong::Collapse, ..Duplicates::default() }), "a\n\nb\n\n");
    }

    #[test]
    fn counts_how_often_each_line_is_there() {
        let text = "mere\npere\nMere\n\nprune\nmere\npere\n";
        let counted = count(text, &Counting::default()).expect("counts");
        assert_eq!(counted.iter().map(|line| (line.line.as_str(), line.count, line.first)).collect::<Vec<_>>(), [("mere", 3, 1), ("pere", 2, 2), ("prune", 1, 5)]);
        assert_eq!(count_lines(text, &Counting::default()).expect("counts").text, "3\tmere\n2\tpere\n1\tprune\n");
        let repeated = Counting { repeated_only: true, order: CountOrder::LeastFirst, separator: " × ".into(), ..Counting::default() };
        assert_eq!(count_lines(text, &repeated).expect("counts").text, "2 × pere\n3 × mere\n");
        let by_letters = Counting { order: CountOrder::Alphabetical, same: Sameness { case_sensitive: true, ..Sameness::default() }, ..Counting::default() };
        assert_eq!(count_lines("b\na\nb", &by_letters).expect("counts").text, "1\ta\n2\tb");
    }
}
