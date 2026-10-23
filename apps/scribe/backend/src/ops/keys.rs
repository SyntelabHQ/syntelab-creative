//! What of a line is looked at when lines are sorted or held for the same:
//! the whole line, or a part of it.

use serde::Deserialize;

/// The part of a line that counts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum KeyOf {
    /// All of it.
    #[default]
    Line,
    /// From its n-th word on.
    Word,
    /// From its n-th character on.
    Character,
    /// Its n-th column, where columns are parted by a delimiter.
    Column,
}

/// Which part, with what finds it.
#[derive(Debug, Clone, Copy)]
pub struct Part<'a> {
    pub of: KeyOf,
    /// The word, the character or the column, counted from 1.
    pub position: usize,
    /// What stands between columns.
    pub delimiter: &'a str,
}

/// What is typed for a tab becomes one; an empty delimiter is a comma.
/// What is written between things (a number and its line, lines made one), as typed: `\t` stands for a tab,
/// which cannot be typed into a field.
pub fn separator_of(typed: &str) -> String {
    typed.replace("\\t", "\t")
}

pub fn delimiter_of(typed: &str) -> String {
    match typed {
        "" => ",".to_owned(),
        "\\t" | "tab" => "\t".to_owned(),
        other => other.to_owned(),
    }
}

impl Part<'_> {
    /// The part of `line` that counts; empty when the line has no such part (too few words, too short).
    pub fn of<'l>(&self, line: &'l str) -> &'l str {
        let nth = self.position.max(1) - 1;
        match self.of {
            KeyOf::Line => line,
            KeyOf::Word => {
                let mut rest = line.trim_start();
                for _ in 0..nth {
                    // Past this word and the spaces after it.
                    let Some(end) = rest.find(char::is_whitespace) else {
                        return "";
                    };
                    rest = rest[end..].trim_start();
                }
                rest
            }
            KeyOf::Character => line.char_indices().nth(nth).map_or("", |(at, _)| &line[at..]),
            KeyOf::Column => line.split(self.delimiter).nth(nth).map_or("", str::trim),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn part(of: KeyOf, position: usize) -> Part<'static> {
        Part { of, position, delimiter: "," }
    }

    #[test]
    fn finds_the_part_of_a_line_that_counts() {
        assert_eq!(part(KeyOf::Line, 3).of("Ana are mere"), "Ana are mere");
        assert_eq!(part(KeyOf::Word, 2).of("  Ana   are mere"), "are mere");
        assert_eq!(part(KeyOf::Word, 4).of("Ana are mere"), "");
        assert_eq!(part(KeyOf::Character, 3).of("țară"), "ră");
        assert_eq!(part(KeyOf::Character, 9).of("țară"), "");
        assert_eq!(part(KeyOf::Column, 2).of("Ana, Popescu ,34"), "Popescu");
        assert_eq!(part(KeyOf::Column, 5).of("Ana,Popescu"), "");
        // A position of nothing is the first.
        assert_eq!(part(KeyOf::Word, 0).of("Ana are"), "Ana are");
    }

    #[test]
    fn reads_the_delimiter_as_it_is_typed() {
        assert_eq!(delimiter_of(""), ",");
        assert_eq!(delimiter_of("\\t"), "\t");
        assert_eq!(delimiter_of(";"), ";");
        assert_eq!(Part { of: KeyOf::Column, position: 2, delimiter: &delimiter_of("\\t") }.of("a\tb\tc"), "b");
    }
}
