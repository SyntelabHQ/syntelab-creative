//! Comparing two texts: which lines are only in one of them, and, where a
//! line was changed, which of its words.
//!
//! The lines are compared with the Myers algorithm (the `similar` crate),
//! which needs room and time in proportion to the texts and to how much they
//! differ, not to one multiplied by the other: two long files that differ in
//! a few places are compared at once.

// The library the lines are compared with, for those who compare in their own way (Dev, on files it does not hold whole).
pub use similar;
use similar::{capture_diff_slices, group_diff_ops, Algorithm, ChangeTag, DiffOp, TextDiff};

/// What is passed over when lines are compared.
#[derive(Debug, Clone, Copy, Default)]
pub struct Ignoring {
    pub case: bool,
    /// Spaces at the ends of lines, and how many stand between words.
    pub spaces: bool,
    pub empty_lines: bool,
    /// Digits do not count: two lines that differ only in their numbers are the same.
    pub numbers: bool,
    /// Punctuation does not count.
    pub punctuation: bool,
}

/// A stretch of a line: text that is the same on both sides, or that only this side has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Piece {
    pub text: String,
    pub changed: bool,
}

/// What a row of the comparison is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RowKind {
    /// The line is on both sides, the same.
    Same,
    /// Only the first text has it.
    Removed,
    /// Only the second text has it.
    Added,
    /// Both have a line here, and they differ.
    Changed,
}

impl RowKind {
    pub fn name(self) -> &'static str {
        match self {
            RowKind::Same => "same",
            RowKind::Removed => "removed",
            RowKind::Added => "added",
            RowKind::Changed => "changed",
        }
    }
}

/// One side of a row: the number of the line (from 1) and its text in pieces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Side {
    pub number: usize,
    pub pieces: Vec<Piece>,
}

/// One row of the two texts side by side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    pub kind: RowKind,
    pub left: Option<Side>,
    pub right: Option<Side>,
}

/// A place where the texts differ, with a few of the lines around it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hunk {
    /// Lines that are the same on both sides and are not shown, between the hunk before (or the start) and this one.
    pub skipped: usize,
    pub rows: Vec<Row>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Comparison {
    pub hunks: Vec<Hunk>,
    /// Lines that are the same after the last hunk and are not shown.
    pub skipped_after: usize,
    pub added: usize,
    pub removed: usize,
    pub changed: usize,
    pub same: usize,
}

impl Comparison {
    pub fn identical(&self) -> bool {
        self.added + self.removed + self.changed == 0
    }
}

/// What a line is compared as: itself, or itself without what is passed over.
pub fn key(line: &str, ignoring: Ignoring) -> String {
    let kept: String = if ignoring.numbers || ignoring.punctuation {
        line.chars().filter(|letter| !(ignoring.numbers && letter.is_numeric()) && !(ignoring.punctuation && !letter.is_alphanumeric() && !letter.is_whitespace())).collect()
    } else {
        line.to_owned()
    };
    let spaced = if ignoring.spaces { kept.split_whitespace().collect::<Vec<_>>().join(" ") } else { kept };
    if ignoring.case {
        spaced.to_lowercase()
    } else {
        spaced
    }
}

/// The lines of a text with their numbers; empty ones are left out when they are passed over.
fn numbered(text: &str, ignoring: Ignoring) -> Vec<(usize, &str)> {
    let body = text.strip_suffix('\n').unwrap_or(text);
    if text.is_empty() {
        return Vec::new();
    }
    body.split('\n').enumerate().map(|(index, line)| (index + 1, line)).filter(|(_, line)| !(ignoring.empty_lines && line.trim().is_empty())).collect()
}

fn whole(number: usize, line: &str, changed: bool) -> Side {
    Side { number, pieces: vec![Piece { text: line.to_owned(), changed }] }
}

/// Two lines that stand in each other's place, with the words only one of them has marked.
pub fn changed_pair(left: (usize, &str), right: (usize, &str)) -> (Side, Side) {
    let diff = TextDiff::from_words(left.1, right.1);
    let (mut old, mut new): (Vec<Piece>, Vec<Piece>) = (Vec::new(), Vec::new());
    let push = |pieces: &mut Vec<Piece>, text: &str, changed: bool| match pieces.last_mut() {
        // Pieces of one kind that follow each other are one piece.
        Some(last) if last.changed == changed => last.text.push_str(text),
        _ => pieces.push(Piece { text: text.to_owned(), changed }),
    };
    for change in diff.iter_all_changes() {
        match change.tag() {
            ChangeTag::Equal => {
                push(&mut old, change.value(), false);
                push(&mut new, change.value(), false);
            }
            ChangeTag::Delete => push(&mut old, change.value(), true),
            ChangeTag::Insert => push(&mut new, change.value(), true),
        }
    }
    (Side { number: left.0, pieces: old }, Side { number: right.0, pieces: new })
}

/// Above this many pairs of lines to weigh (the lines of one side times those of the other), a run of changed
/// lines is paired in order instead: weighing every line against every other would take too long.
const MOST_WEIGHED: usize = 10_000;
/// Lines longer than this are weighed by their words, not by their letters.
const LONG_LINE: usize = 200;
/// Two lines at least this much alike are one line that was changed.
const ALIKE: f32 = 0.5;

/// How alike two lines are, from 0 (nothing in common) to 1 (the same).
fn likeness(one: &str, other: &str) -> f32 {
    if one.is_empty() || other.is_empty() {
        return 0.0;
    }
    if one.len() > LONG_LINE || other.len() > LONG_LINE {
        return TextDiff::from_words(one, other).ratio();
    }
    TextDiff::from_chars(one, other).ratio()
}

/// Which lines of a run that was changed stand in each other's place: for each row, the place of the line in
/// `old` and in `new` (one of the two is missing where a line is only on one side).
///
/// Lines that are alike are found first, wherever they are in the run (a line put in before them does not make
/// every line after it look changed into the next); between them, what is left is paired in order.
pub fn paired(old: &[String], new: &[String]) -> Vec<(Option<usize>, Option<usize>)> {
    let (rows, columns) = (old.len(), new.len());
    let mut alike: Vec<(usize, usize)> = Vec::new();
    if rows * columns <= MOST_WEIGHED {
        // The pairing with the most likeness in all, among those that keep the order of the lines.
        let mut likenesses = vec![0.0_f32; rows * columns];
        let mut best = vec![0.0_f32; (rows + 1) * (columns + 1)];
        let at = |row: usize, column: usize| row * (columns + 1) + column;
        for row in 0..rows {
            for column in 0..columns {
                let weight = likeness(&old[row], &new[column]);
                likenesses[row * columns + column] = weight;
                let together = if weight >= ALIKE { best[at(row, column)] + weight } else { 0.0 };
                best[at(row + 1, column + 1)] = together.max(best[at(row, column + 1)]).max(best[at(row + 1, column)]);
            }
        }
        let (mut row, mut column) = (rows, columns);
        while row > 0 && column > 0 {
            let weight = likenesses[(row - 1) * columns + column - 1];
            if weight >= ALIKE && best[at(row, column)] == best[at(row - 1, column - 1)] + weight {
                alike.push((row - 1, column - 1));
                row -= 1;
                column -= 1;
            } else if best[at(row, column)] == best[at(row - 1, column)] {
                row -= 1;
            } else {
                column -= 1;
            }
        }
        alike.reverse();
    }

    let mut rows_out = Vec::with_capacity(rows.max(columns));
    let (mut next_old, mut next_new) = (0, 0);
    let between = |until_old: usize, until_new: usize, rows_out: &mut Vec<(Option<usize>, Option<usize>)>, next_old: &mut usize, next_new: &mut usize| {
        let together = (until_old - *next_old).min(until_new - *next_new);
        rows_out.extend((0..together).map(|offset| (Some(*next_old + offset), Some(*next_new + offset))));
        rows_out.extend((*next_old + together..until_old).map(|line| (Some(line), None)));
        rows_out.extend((*next_new + together..until_new).map(|line| (None, Some(line))));
        *next_old = until_old;
        *next_new = until_new;
    };
    for (in_old, in_new) in alike {
        between(in_old, in_new, &mut rows_out, &mut next_old, &mut next_new);
        rows_out.push((Some(in_old), Some(in_new)));
        next_old = in_old + 1;
        next_new = in_new + 1;
    }
    between(rows, columns, &mut rows_out, &mut next_old, &mut next_new);
    rows_out
}

/// Compares two texts. `context` is how many lines that are the same are shown around each difference.
pub fn compare(left: &str, right: &str, ignoring: Ignoring, context: usize) -> Comparison {
    let (old, new) = (numbered(left, ignoring), numbered(right, ignoring));
    let old_keys: Vec<String> = old.iter().map(|(_, line)| key(line, ignoring)).collect();
    let new_keys: Vec<String> = new.iter().map(|(_, line)| key(line, ignoring)).collect();
    let ops = capture_diff_slices(Algorithm::Myers, &old_keys, &new_keys);

    let mut comparison = Comparison::default();
    // How the lines of each changed run are paired: found once, used for the counts and for what is shown.
    let mut pairings: std::collections::HashMap<(usize, usize), Vec<(Option<usize>, Option<usize>)>> = std::collections::HashMap::new();
    for op in &ops {
        match *op {
            DiffOp::Equal { len, .. } => comparison.same += len,
            DiffOp::Delete { old_len, .. } => comparison.removed += old_len,
            DiffOp::Insert { new_len, .. } => comparison.added += new_len,
            DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                // The lines that stand in each other's place were changed; the rest are only on one side.
                let rows = paired(&old_keys[old_index..old_index + old_len], &new_keys[new_index..new_index + new_len]);
                let together = rows.iter().filter(|(left, right)| left.is_some() && right.is_some()).count();
                comparison.changed += together;
                comparison.removed += old_len - together;
                comparison.added += new_len - together;
                pairings.insert((old_index, new_index), rows);
            }
        }
    }

    let mut shown_old = 0;
    for group in group_diff_ops(ops, context) {
        let Some(first) = group.first() else {
            continue;
        };
        let mut hunk = Hunk { skipped: first.old_range().start - shown_old, rows: Vec::new() };
        for op in &group {
            match *op {
                DiffOp::Equal { old_index, new_index, len } => {
                    for offset in 0..len {
                        let (left, right) = (old[old_index + offset], new[new_index + offset]);
                        hunk.rows.push(Row { kind: RowKind::Same, left: Some(whole(left.0, left.1, false)), right: Some(whole(right.0, right.1, false)) });
                    }
                }
                DiffOp::Delete { old_index, old_len, .. } => {
                    hunk.rows.extend(old[old_index..old_index + old_len].iter().map(|line| Row { kind: RowKind::Removed, left: Some(whole(line.0, line.1, true)), right: None }));
                }
                DiffOp::Insert { new_index, new_len, .. } => {
                    hunk.rows.extend(new[new_index..new_index + new_len].iter().map(|line| Row { kind: RowKind::Added, left: None, right: Some(whole(line.0, line.1, true)) }));
                }
                DiffOp::Replace { old_index, new_index, .. } => {
                    for (in_old, in_new) in pairings.get(&(old_index, new_index)).into_iter().flatten() {
                        hunk.rows.push(match (in_old.map(|line| old[old_index + line]), in_new.map(|line| new[new_index + line])) {
                            (Some(was), Some(is)) => {
                                let (left, right) = changed_pair(was, is);
                                Row { kind: RowKind::Changed, left: Some(left), right: Some(right) }
                            }
                            (Some(was), None) => Row { kind: RowKind::Removed, left: Some(whole(was.0, was.1, true)), right: None },
                            (None, is) => Row { kind: RowKind::Added, left: None, right: is.map(|is| whole(is.0, is.1, true)) },
                        });
                    }
                }
            }
        }
        shown_old = group.last().map_or(shown_old, |last| last.old_range().end);
        comparison.hunks.push(hunk);
    }
    comparison.skipped_after = if comparison.hunks.is_empty() { 0 } else { old.len() - shown_old };
    comparison
}

#[cfg(test)]
mod tests {
    use super::*;

    fn kinds(comparison: &Comparison) -> Vec<&'static str> {
        comparison.hunks.iter().flat_map(|hunk| hunk.rows.iter().map(|row| row.kind.name())).collect()
    }

    #[test]
    fn pairs_changed_lines_with_the_lines_they_are_like() {
        // An empty line taken out before two lines that were changed: each is shown beside what it became.
        let found = compare("one\n\nfour 4\nfive.\nsix\n", "one\nfour 5\nfive!\nsix\n", Ignoring::default(), 3);
        assert_eq!(kinds(&found), ["same", "removed", "changed", "changed", "same"]);
        assert_eq!((found.changed, found.removed, found.added), (2, 1, 0));
        let numbers: Vec<(Option<usize>, Option<usize>)> = found.hunks[0].rows.iter().map(|row| (row.left.as_ref().map(|side| side.number), row.right.as_ref().map(|side| side.number))).collect();
        assert_eq!(numbers, [(Some(1), Some(1)), (Some(2), None), (Some(3), Some(2)), (Some(4), Some(3)), (Some(5), Some(4))]);
        // Lines with nothing in common still stand side by side, in order.
        let rewritten = compare("alpha\nbeta\n", "123\n456\n789\n", Ignoring::default(), 3);
        assert_eq!(kinds(&rewritten), ["changed", "changed", "added"]);
    }

    #[test]
    fn says_two_same_texts_are_the_same() {
        let same = compare("a\nb\n", "a\nb\n", Ignoring::default(), 3);
        assert!(same.identical());
        assert_eq!((same.same, same.hunks.len()), (2, 0));
        assert!(compare("", "", Ignoring::default(), 3).identical());
    }

    #[test]
    fn finds_lines_added_removed_and_changed() {
        let found = compare("one\ntwo\nthree\nfour\n", "one\n2\nthree\nfour\nfive\n", Ignoring::default(), 1);
        assert_eq!((found.added, found.removed, found.changed, found.same), (1, 0, 1, 3));
        assert_eq!(kinds(&found), ["same", "changed", "same", "same", "added"]);
        let changed = &found.hunks[0].rows[1];
        assert_eq!(changed.left.as_ref().map(|side| side.number), Some(2));
        assert_eq!(changed.right.as_ref().map(|side| side.pieces.clone()), Some(vec![Piece { text: "2".to_owned(), changed: true }]));
    }

    #[test]
    fn marks_the_words_that_differ_inside_a_line() {
        let found = compare("the quick brown fox", "the slow brown fox jumps", Ignoring::default(), 3);
        let row = &found.hunks[0].rows[0];
        fn pieces(side: &Option<Side>) -> Vec<(&str, bool)> {
            side.as_ref().map(|side| side.pieces.iter().map(|piece| (piece.text.as_str(), piece.changed)).collect()).unwrap_or_default()
        }
        assert_eq!(pieces(&row.left), [("the ", false), ("quick", true), (" brown fox", false)]);
        assert_eq!(pieces(&row.right), [("the ", false), ("slow", true), (" brown fox", false), (" jumps", true)]);
    }

    #[test]
    fn shows_only_what_differs_with_a_few_lines_around() {
        let old: String = (1..=40).map(|number| format!("line {number}\n")).collect();
        let new = old.replace("line 20\n", "line twenty\n");
        let found = compare(&old, &new, Ignoring::default(), 2);
        assert_eq!(found.hunks.len(), 1);
        assert_eq!((found.hunks[0].skipped, found.hunks[0].rows.len(), found.skipped_after), (17, 5, 18));
        assert_eq!(found.hunks[0].rows[0].left.as_ref().map(|side| side.number), Some(18));
        // Two differences far apart are two places, with what lies between them counted.
        let twice = compare(&old, &new.replace("line 35\n", ""), Ignoring::default(), 2);
        assert_eq!(twice.hunks.len(), 2);
        assert_eq!(twice.hunks[1].skipped, 10);
    }

    #[test]
    fn passes_over_what_it_is_told_to() {
        assert!(!compare("Ana  are mere ", "ana are mere", Ignoring::default(), 3).identical());
        assert!(compare("Ana  are mere ", "ana are mere", Ignoring { case: true, spaces: true, ..Ignoring::default() }, 3).identical());
        assert!(compare("pagina 12, rândul 3.", "pagina 7, rândul 41!", Ignoring { numbers: true, punctuation: true, ..Ignoring::default() }, 3).identical());
        assert!(!compare("pagina 12", "pagina 7", Ignoring { punctuation: true, ..Ignoring::default() }, 3).identical());
        assert!(compare("a\n\n\nb", "a\nb", Ignoring { empty_lines: true, ..Ignoring::default() }, 3).identical());
        // The numbers shown are still those of the lines in their texts.
        let found = compare("a\n\nb", "a\nc", Ignoring { empty_lines: true, ..Ignoring::default() }, 3);
        assert_eq!(found.hunks[0].rows[1].left.as_ref().map(|side| side.number), Some(3));
    }

    #[test]
    fn compares_long_texts_that_differ_little_at_once() {
        let old: String = (1..=200_000).map(|number| format!("row {number}\n")).collect();
        let new = old.replace("row 150000\n", "row changed\n");
        let started = std::time::Instant::now();
        let found = compare(&old, &new, Ignoring::default(), 3);
        assert_eq!((found.changed, found.hunks.len()), (1, 1));
        assert!(started.elapsed().as_secs() < 10);
    }
}
