//! What operations would do to a text, told before they are done.
//!
//! The result comes with an account of how it differs from the text: which
//! of its lines changed (and where in the line), which only moved, which are
//! new, and which lines of the text are no longer there. How the two are
//! set against each other depends on what was done: a sort moves lines, a
//! replacement changes them where they stand, taking out duplicates removes
//! some. The account is found from the two texts alone, so it is right for
//! any operation and for several in a row.

use std::collections::HashMap;

use crate::compare::{self, Ignoring, RowKind};
use crate::ops::{self, lines_of, OpError, Operation};

/// The most lines of the result that are told about one by one; the rest are only counted.
pub const MOST_MARKS: usize = 5000;
/// The most removed lines that are listed.
pub const MOST_REMOVED: usize = 1000;
/// A removed line is listed cut to this many characters.
const SHOWN_OF_A_LINE: usize = 300;

/// How the result is set against the text.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Nothing differs.
    Same,
    /// The same lines in another order.
    Reordered,
    /// As many lines, changed where they stand.
    InPlace,
    /// Lines of the text, fewer of them (and perhaps in another order).
    Removed,
    /// Anything else: set against each other as two texts are compared.
    Rewritten,
}

impl Kind {
    pub fn name(self) -> &'static str {
        match self {
            Kind::Same => "same",
            Kind::Reordered => "reordered",
            Kind::InPlace => "inPlace",
            Kind::Removed => "removed",
            Kind::Rewritten => "rewritten",
        }
    }
}

/// What is said of one line of the result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Mark {
    /// The line is not as it was; `pieces` are the stretches of it that differ, in UTF-16 units from its start.
    Changed { line: usize, pieces: Vec<(usize, usize)> },
    /// The line was elsewhere: at line `from` of the text (from 1).
    Moved { line: usize, from: usize },
    /// The line is new.
    Added { line: usize },
}

#[derive(Debug, PartialEq, Eq)]
pub struct Preview {
    pub text: String,
    /// What the operations say they changed, in what each counts.
    pub changed: usize,
    pub kind: Kind,
    pub lines_before: usize,
    pub lines_after: usize,
    pub characters_before: usize,
    pub characters_after: usize,
    /// How many lines of the result changed, moved, or are new; and how many lines of the text are gone.
    pub changed_lines: usize,
    pub moved_lines: usize,
    pub added_lines: usize,
    pub removed_lines: usize,
    /// The lines of the result that differ, by their place in it (from 0): the first `MOST_MARKS` of them.
    pub marks: Vec<Mark>,
    /// The lines of the text that are gone: their number (from 1) and what they said; the first `MOST_REMOVED`.
    pub removed: Vec<(usize, String)>,
}

/// The stretches of `after` that differ from `before`, in UTF-16 units.
fn changed_pieces(before: &str, after: &str) -> Vec<(usize, usize)> {
    let (_, side) = compare::changed_pair((0, before), (0, after));
    let mut pieces = Vec::new();
    let mut at = 0;
    for piece in &side.pieces {
        let length = piece.text.encode_utf16().count();
        if piece.changed && length > 0 {
            pieces.push((at, at + length));
        }
        at += length;
    }
    pieces
}

fn shown(line: &str) -> String {
    if line.chars().count() <= SHOWN_OF_A_LINE {
        return line.to_owned();
    }
    let mut cut: String = line.chars().take(SHOWN_OF_A_LINE).collect();
    cut.push('…');
    cut
}

/// Where each line of the text is, by what it says.
fn places_of<'a>(lines: &[&'a str]) -> HashMap<&'a str, Vec<usize>> {
    let mut places: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, line) in lines.iter().enumerate() {
        places.entry(line).or_default().push(index);
    }
    places
}

/// The lines of `after` found in `before` one after another, each at the first place past the one before it;
/// None when they do not follow each other so. With `latest`, each is found at the last place it can be:
/// of lines that say the same, it is the later ones that are taken to have stayed.
fn matched_in_order(places: &HashMap<&str, Vec<usize>>, after: &[&str], lines: usize, latest: bool) -> Option<Vec<usize>> {
    let mut found = Vec::with_capacity(after.len());
    if latest {
        let mut before_this = lines;
        for line in after.iter().rev() {
            let known = places.get(line)?;
            let place = *known.get(known.partition_point(|place| *place < before_this).checked_sub(1)?)?;
            found.push(place);
            before_this = place;
        }
        found.reverse();
    } else {
        let mut from = 0;
        for line in after {
            let known = places.get(line)?;
            let place = *known.get(known.partition_point(|place| *place < from))?;
            found.push(place);
            from = place + 1;
        }
    }
    Some(found)
}

/// For each line of `after`, the line of `before` it is; None when `after` has a line `before` has not (often enough).
/// Lines are matched in order where that can be done, so what was not moved is not said to have moved.
fn matched(before: &[&str], after: &[&str], latest: bool) -> Option<Vec<usize>> {
    let places = places_of(before);
    // First as a text with lines taken out: each line found after the one before it.
    if let Some(in_order) = matched_in_order(&places, after, before.len(), latest) {
        return Some(in_order);
    }
    // Else each line takes the first line of the text that says the same and is not taken yet.
    let mut taken: HashMap<&str, usize> = HashMap::new();
    let mut anywhere = Vec::with_capacity(after.len());
    for line in after {
        let known = places.get(line)?;
        let used = taken.entry(line).or_insert(0);
        anywhere.push(*known.get(*used)?);
        *used += 1;
    }
    Some(anywhere)
}

/// Does the operations and says how the result differs from the text.
pub fn preview(text: &str, operations: &[Operation]) -> Result<Preview, OpError> {
    let outcome = ops::apply_all(text, operations)?;
    let (before, _) = lines_of(text);
    let (after, _) = lines_of(&outcome.text);
    let mut told = Preview {
        changed: outcome.changed,
        kind: Kind::Same,
        lines_before: before.len(),
        lines_after: after.len(),
        characters_before: text.chars().count(),
        characters_after: outcome.text.chars().count(),
        changed_lines: 0,
        moved_lines: 0,
        added_lines: 0,
        removed_lines: 0,
        marks: Vec::new(),
        removed: Vec::new(),
        text: String::new(),
    };
    if before != after {
        // Of duplicates, the last was kept when the operations say so: then it is the earlier ones that went.
        let latest = operations.iter().any(|operation| matches!(operation, Operation::RemoveDuplicates(duplicates) if duplicates.keep == ops::Keep::Last));
        match matched(&before, &after, latest) {
            Some(places) => moved_and_removed(&before, &places, &mut told),
            None if before.len() == after.len() => in_place(&before, &after, &mut told),
            None => rewritten(text, &outcome.text, &mut told),
        }
    }
    told.text = outcome.text;
    Ok(told)
}

/// The result is made of lines of the text: some moved, some gone.
fn moved_and_removed(before: &[&str], places: &[usize], told: &mut Preview) {
    told.kind = if places.len() == before.len() { Kind::Reordered } else { Kind::Removed };
    let mut kept = vec![false; before.len()];
    // Where every line is still there, a line moved when it stands at another place than before; where some are
    // gone, when it now stands after a line that came later than it in the text.
    let mut furthest = None;
    for (line, place) in places.iter().enumerate() {
        kept[*place] = true;
        let moved = if told.kind == Kind::Reordered { *place != line } else { furthest.is_some_and(|furthest| *place < furthest) };
        if moved {
            told.moved_lines += 1;
            if told.marks.len() < MOST_MARKS {
                told.marks.push(Mark::Moved { line, from: place + 1 });
            }
        }
        furthest = Some(furthest.map_or(*place, |furthest: usize| furthest.max(*place)));
    }
    for (index, line) in before.iter().enumerate().filter(|(index, _)| !kept[*index]) {
        told.removed_lines += 1;
        if told.removed.len() < MOST_REMOVED {
            told.removed.push((index + 1, shown(line)));
        }
    }
}

/// As many lines as before, some of them changed where they stand.
fn in_place(before: &[&str], after: &[&str], told: &mut Preview) {
    told.kind = Kind::InPlace;
    for (line, (was, is)) in before.iter().zip(after).enumerate().filter(|(_, (was, is))| was != is) {
        told.changed_lines += 1;
        if told.marks.len() < MOST_MARKS {
            told.marks.push(Mark::Changed { line, pieces: changed_pieces(was, is) });
        }
    }
}

/// Anything else: the two are compared as texts are.
fn rewritten(before: &str, after: &str, told: &mut Preview) {
    told.kind = Kind::Rewritten;
    let compared = compare::compare(before, after, Ignoring::default(), 0);
    told.added_lines = compared.added;
    told.changed_lines = compared.changed;
    told.removed_lines = compared.removed;
    for row in compared.hunks.iter().flat_map(|hunk| &hunk.rows) {
        match (row.kind, &row.left, &row.right) {
            (RowKind::Added, _, Some(right)) if told.marks.len() < MOST_MARKS => told.marks.push(Mark::Added { line: right.number - 1 }),
            (RowKind::Changed, Some(left), Some(right)) if told.marks.len() < MOST_MARKS => {
                let was: String = left.pieces.iter().map(|piece| piece.text.as_str()).collect();
                let is: String = right.pieces.iter().map(|piece| piece.text.as_str()).collect();
                told.marks.push(Mark::Changed { line: right.number - 1, pieces: changed_pieces(&was, &is) });
            }
            (RowKind::Removed, Some(left), _) if told.removed.len() < MOST_REMOVED => {
                let was: String = left.pieces.iter().map(|piece| piece.text.as_str()).collect();
                told.removed.push((left.number, shown(&was)));
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tell(text: &str, operation: serde_json::Value) -> Preview {
        preview(text, &[serde_json::from_value(operation).expect("an operation")]).expect("works")
    }

    #[test]
    fn a_line_that_kept_its_place_did_not_move() {
        let told = tell("c
b
a", json!({ "kind": "sortLines" }));
        assert_eq!(told.marks, [Mark::Moved { line: 0, from: 3 }, Mark::Moved { line: 2, from: 1 }]);
        assert_eq!(told.moved_lines, 2);
    }

    #[test]
    fn says_which_lines_a_sort_moved() {
        let told = tell("pere\nmere\nprune\n", json!({ "kind": "sortLines" }));
        assert_eq!((told.text.as_str(), told.kind), ("mere\npere\nprune\n", Kind::Reordered));
        assert_eq!(told.marks, [Mark::Moved { line: 0, from: 2 }, Mark::Moved { line: 1, from: 1 }]);
        assert_eq!((told.moved_lines, told.removed_lines, told.lines_before, told.lines_after), (2, 0, 3, 3));
    }

    #[test]
    fn says_which_lines_were_taken_out_and_which_one_was_kept() {
        let first = tell("a\nb\na\nc\nb\n", json!({ "kind": "removeDuplicates" }));
        assert_eq!((first.text.as_str(), first.kind), ("a\nb\nc\n", Kind::Removed));
        assert_eq!(first.removed, [(3, "a".to_owned()), (5, "b".to_owned())]);
        assert!(first.marks.is_empty(), "nothing moved: {:?}", first.marks);
        // Keeping the last: it is the earlier ones that go.
        let last = tell("a\nb\na\nc\nb\n", json!({ "kind": "removeDuplicates", "keep": "last" }));
        assert_eq!(last.text, "a\nc\nb\n");
        assert_eq!(last.removed, [(1, "a".to_owned()), (2, "b".to_owned())]);
        assert_eq!((last.moved_lines, last.removed_lines), (0, 2));
    }

    #[test]
    fn says_where_a_line_changed() {
        let told = tell("Ana are mere\nfără\nAna 😀 ana\n", json!({ "kind": "replace", "find": "ana", "with": "Ioana", "caseSensitive": true }));
        assert_eq!(told.kind, Kind::InPlace);
        // 😀 takes two units: "Ana 😀 " is 7 units long.
        assert_eq!(told.marks, [Mark::Changed { line: 2, pieces: vec![(7, 12)] }]);
        assert_eq!((told.changed_lines, told.changed, told.characters_before, told.characters_after), (1, 1, 28, 30));
    }

    #[test]
    fn compares_as_texts_what_is_neither() {
        let joined = tell("a\nb\nc\n", json!({ "kind": "joinLines", "separator": ", " }));
        assert_eq!((joined.text.as_str(), joined.kind), ("a, b, c\n", Kind::Rewritten));
        assert_eq!((joined.lines_before, joined.lines_after), (3, 1));
        assert!(joined.removed_lines + joined.changed_lines > 0);
        let numbered = tell("a\nb", json!({ "kind": "numberLines" }));
        assert_eq!(numbered.kind, Kind::InPlace);
        assert_eq!(numbered.marks[0], Mark::Changed { line: 0, pieces: vec![(0, 3)] });
    }

    #[test]
    fn says_nothing_when_nothing_changes() {
        let told = tell("a\nb\n", json!({ "kind": "sortLines" }));
        assert_eq!((told.kind, told.marks.len(), told.removed.len()), (Kind::Same, 0, 0));
        assert_eq!(super::preview("", &[]).expect("works").kind, Kind::Same);
    }

    #[test]
    fn counts_everything_but_tells_only_so_much() {
        let text: String = (0..MOST_MARKS + 500).map(|number| format!("row {number}\n")).collect();
        let told = tell(&text, json!({ "kind": "changeCase", "to": "upper" }));
        assert_eq!((told.changed_lines, told.marks.len()), (MOST_MARKS + 500, MOST_MARKS));
        let reversed = tell(&text, json!({ "kind": "reverseLines" }));
        assert_eq!((reversed.kind, reversed.moved_lines), (Kind::Reordered, MOST_MARKS + 500));
    }

    #[test]
    fn a_sort_that_also_takes_lines_out_is_told_as_both() {
        let chain: Vec<Operation> = [json!({ "kind": "removeDuplicates" }), json!({ "kind": "sortLines" })].into_iter().map(|value| serde_json::from_value(value).expect("an operation")).collect();
        let told = preview("c\na\nc\nb\n", &chain).expect("works");
        assert_eq!((told.text.as_str(), told.kind), ("a\nb\nc\n", Kind::Removed));
        assert_eq!((told.removed_lines, told.moved_lines), (1, 1));
    }
}
