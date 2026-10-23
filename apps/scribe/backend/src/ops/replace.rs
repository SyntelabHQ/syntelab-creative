//! Finding and replacing.
//!
//! Patterns are run by the `regex` engine, whose time grows with the length
//! of the text and never beyond: no pattern, however it is written, can
//! freeze the program. The price is that it has no look-around and no
//! back-references inside a pattern (`\1`); groups can still be used in what
//! is put in place (`$1`).

use std::collections::HashSet;

use regex::{Captures, Regex, RegexBuilder};
use serde::Deserialize;

use super::{OpError, Outcome};

/// What to find and what to put in its place.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Replacement {
    pub find: String,
    /// What is put in place of each match. With `regex`, `$1` or `${name}`
    /// stand for the groups of the pattern, `$0` for the whole match, and
    /// `\n` and `\t` for a new line and a tab.
    #[serde(default)]
    pub with: String,
    /// `find` is a regular expression; without it, plain text.
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    /// Only where it is a word of its own, not a part of a longer one.
    #[serde(default)]
    pub whole_word: bool,
    /// What is put in place takes the case of what it replaces: "Cat" → "Dog", "CAT" → "DOG".
    #[serde(default)]
    pub keep_case: bool,
    /// What is put in place may hold blanks that are filled in at each match: `{counter}` (1, 2, 3…; `{counter:10}`
    /// starts at 10, `{counter:10:5}` goes up by 5), `{date}`, `{time}`, `{uuid}`, `{random}` (8 letters and
    /// digits; `{random:12}` for 12).
    #[serde(default)]
    pub fill: bool,
    /// The day and the hour as the user's clock has them, for `{date}` and `{time}`: the interface gives them.
    #[serde(default)]
    pub today: String,
    #[serde(default)]
    pub now: String,
}

/// A find-and-replace of several pairs, done one after another.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManyReplacements {
    /// One pair to a line: what to find, `=>`, what to put in its place (nothing, to take it out).
    pub pairs: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default)]
    pub keep_case: bool,
}

/// What stands between the two halves of a pair.
const ARROW: &str = "=>";

/// The pairs of a list, in order; a line that is not a pair is refused, so nothing is done by halves.
pub fn pairs_of(many: &ManyReplacements) -> Result<Vec<Replacement>, OpError> {
    let mut pairs = Vec::new();
    for line in many.pairs.lines().filter(|line| !line.trim().is_empty()) {
        let (find, with) = line.split_once(ARROW).ok_or(OpError::BadChoice("a line is not a pair"))?;
        // The spaces around the arrow are for the eye; the ones further out are part of the pair.
        let find = find.strip_suffix(' ').unwrap_or(find);
        let with = with.strip_prefix(' ').unwrap_or(with);
        if find.is_empty() {
            return Err(OpError::BadChoice("a line is not a pair"));
        }
        pairs.push(Replacement { find: find.to_owned(), with: with.to_owned(), regex: many.regex, case_sensitive: many.case_sensitive, whole_word: many.whole_word, keep_case: many.keep_case, fill: false, today: String::new(), now: String::new() });
    }
    if pairs.is_empty() {
        return Err(OpError::BadChoice("nothing to find"));
    }
    Ok(pairs)
}

/// Does the pairs one after another: each works on what the one before left.
pub fn replace_many(text: &str, many: &ManyReplacements) -> Result<Outcome, OpError> {
    let mut outcome = Outcome { text: text.to_owned(), changed: 0 };
    for pair in pairs_of(many)? {
        let next = replace(&outcome.text, &pair)?;
        outcome = Outcome { text: next.text, changed: outcome.changed + next.changed };
    }
    Ok(outcome)
}

/// What a blank is filled with at the match numbered `match_number` (from 0); None when it is not a blank that is known.
fn filled(blank: &str, match_number: usize, replacement: &Replacement, dice: &mut crate::generate::Dice) -> Option<String> {
    let mut parts = blank.split(':').map(str::trim);
    match parts.next()? {
        "counter" => {
            let start: i64 = parts.next().map_or(Some(1), |start| start.parse().ok())?;
            let step: i64 = parts.next().map_or(Some(1), |step| step.parse().ok())?;
            Some(start.saturating_add(step.saturating_mul(match_number as i64)).to_string())
        }
        "date" => Some(replacement.today.clone()),
        "time" => Some(replacement.now.clone()),
        "uuid" => crate::generate::random::write(crate::generate::Alphabet::Uuid, 36, 1, false, dice).ok(),
        "random" => {
            let length: usize = parts.next().map_or(Some(8), |length| length.parse().ok())?;
            crate::generate::random::write(crate::generate::Alphabet::LettersDigits, length.clamp(1, 256), 1, false, dice).ok()
        }
        _ => None,
    }
}

/// A text with its blanks filled in; a pair of braces that holds no known blank stays as it is written.
fn with_blanks_filled(text: &str, match_number: usize, replacement: &Replacement, dice: &mut crate::generate::Dice) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('}') else {
            rest = &rest[open..];
            break;
        };
        let blank = &rest[open + 1..open + close];
        match filled(blank, match_number, replacement, dice) {
            Some(value) => out.push_str(&value),
            None => out.push_str(&rest[open..=open + close]),
        }
        rest = &rest[open + close + 1..];
    }
    out.push_str(rest);
    out
}

/// What is known of the matches of a pattern beside their number: on how many lines they are, and how many different texts they are.
pub fn match_facts(text: &str, replacement: &Replacement) -> Result<(usize, usize), OpError> {
    let pattern = pattern(replacement)?;
    let mut different: HashSet<String> = HashSet::new();
    let (mut lines, mut last_line, mut at, mut line) = (0, usize::MAX, 0, 0);
    for found in pattern.find_iter(text) {
        line += text[at..found.start()].bytes().filter(|byte| *byte == b'\n').count();
        at = found.start();
        if line != last_line {
            lines += 1;
            last_line = line;
        }
        // Enough to say "many": the set is not let grow without end.
        if different.len() < 100_000 {
            different.insert(if replacement.case_sensitive { found.as_str().to_owned() } else { found.as_str().to_lowercase() });
        }
    }
    Ok((lines, different.len()))
}

/// The pattern of a replacement, ready to run.
pub fn pattern(replacement: &Replacement) -> Result<Regex, OpError> {
    if replacement.find.is_empty() {
        return Err(OpError::BadChoice("nothing to find"));
    }
    let written = if replacement.regex { replacement.find.clone() } else { regex::escape(&replacement.find) };
    let bounded = if replacement.whole_word { format!(r"\b(?:{written})\b") } else { written };
    RegexBuilder::new(&bounded)
        .case_insensitive(!replacement.case_sensitive)
        // ^ and $ are the start and the end of each line, as people expect in a text.
        .multi_line(true)
        .build()
        .map_err(|error| OpError::BadPattern(reason(&error)))
}

/// Why a pattern was refused, without the drawing the engine makes around it.
fn reason(error: &regex::Error) -> String {
    let said = error.to_string();
    said.lines().rev().find_map(|line| line.trim().strip_prefix("error: ")).map_or(said.clone(), str::to_owned)
}

/// What is typed for a new line and a tab becomes them.
fn unescaped(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut letters = text.chars();
    while let Some(letter) = letters.next() {
        if letter != '\\' {
            out.push(letter);
            continue;
        }
        match letters.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('\\') => out.push('\\'),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

/// `put` in the case of `found`: all capitals, a capital first, or as it is written.
fn in_case_of(found: &str, put: &str) -> String {
    let letters: Vec<char> = found.chars().filter(|letter| letter.is_alphabetic()).collect();
    let Some(first) = letters.first() else {
        return put.to_owned();
    };
    if letters.len() > 1 && letters.iter().all(|letter| letter.is_uppercase()) {
        return put.to_uppercase();
    }
    if letters.iter().all(|letter| letter.is_lowercase()) {
        return put.to_lowercase();
    }
    if first.is_uppercase() {
        let mut out = String::with_capacity(put.len());
        let mut started = false;
        for letter in put.chars() {
            if !started && letter.is_alphabetic() {
                out.extend(letter.to_uppercase());
                started = true;
            } else {
                out.push(letter);
            }
        }
        return out;
    }
    put.to_owned()
}

/// How many places of a text a pattern finds.
pub fn count(text: &str, replacement: &Replacement) -> Result<usize, OpError> {
    Ok(pattern(replacement)?.find_iter(text).count())
}

/// How many places a pattern finds, and where the first `most` of them are, in UTF-16 units (as the editor counts).
pub fn places(text: &str, replacement: &Replacement, most: usize) -> Result<(usize, Vec<(usize, usize)>), OpError> {
    let pattern = pattern(replacement)?;
    let mut found = Vec::new();
    let mut count = 0;
    // Where the counting has got to: in bytes, and in units.
    let (mut at, mut units) = (0, 0);
    for place in pattern.find_iter(text) {
        count += 1;
        if found.len() >= most {
            continue;
        }
        units += text[at..place.start()].encode_utf16().count();
        let length = place.as_str().encode_utf16().count();
        found.push((units, units + length));
        units += length;
        at = place.end();
    }
    Ok((count, found))
}

pub fn replace(text: &str, replacement: &Replacement) -> Result<Outcome, OpError> {
    let pattern = pattern(replacement)?;
    let with = if replacement.regex { unescaped(&replacement.with) } else { replacement.with.clone() };
    let mut changed = 0;
    let mut dice = crate::generate::Dice::system();
    let replaced = pattern.replace_all(text, |found: &Captures<'_>| {
        changed += 1;
        let mut put = String::new();
        if replacement.regex {
            found.expand(&with, &mut put);
        } else {
            put.push_str(&with);
        }
        if replacement.fill {
            put = with_blanks_filled(&put, changed - 1, replacement, &mut dice);
        }
        if replacement.keep_case {
            in_case_of(&found[0], &put)
        } else {
            put
        }
    });
    Ok(Outcome { text: replaced.into_owned(), changed })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fills_in_the_blanks_at_each_match() {
        let numbered = Replacement { fill: true, ..plain("#", "{counter}.") };
        assert_eq!(done("# a\n# b\n# c", &numbered).0, "1. a\n2. b\n3. c");
        let stepped = Replacement { fill: true, ..plain("x", "{counter:10:5}") };
        assert_eq!(done("x x x", &stepped).0, "10 15 20");
        let dated = Replacement { fill: true, today: "10.10.2026".into(), now: "21:45".into(), ..plain("AZI", "{date} la {time}") };
        assert_eq!(done("AZI", &dated).0, "10.10.2026 la 21:45");
        // What is not a blank stays as it is written; without the choice, so does everything.
        assert_eq!(done("x", &Replacement { fill: true, ..plain("x", "{altceva} {counter:abc} {") }).0, "{altceva} {counter:abc} {");
        assert_eq!(done("x", &plain("x", "{counter}")).0, "{counter}");
        let random = done("x x", &Replacement { fill: true, ..plain("x", "{random:6}") }).0;
        let parts: Vec<&str> = random.split(' ').collect();
        assert!(parts.len() == 2 && parts.iter().all(|part| part.len() == 6) && parts[0] != parts[1], "{random}");
        assert_eq!(done("x", &Replacement { fill: true, ..plain("x", "{uuid}") }).0.len(), 36);
    }

    #[test]
    fn does_several_pairs_one_after_another() {
        let many = |pairs: &str| ManyReplacements { pairs: pairs.to_owned(), regex: false, case_sensitive: false, whole_word: false, keep_case: false };
        let outcome = replace_many("mere și pere, MERE", &many("mere => prune\n\npere=>caise\n, => ;")).expect("works");
        assert_eq!((outcome.text.as_str(), outcome.changed), ("prune și caise; prune", 4));
        // A pair works on what the one before left; an empty second half takes the text out.
        assert_eq!(replace_many("a b", &many("a => b\nb =>")).expect("works").text, " ");
        assert_eq!(replace_many("a", &many("fără săgeată")), Err(OpError::BadChoice("a line is not a pair")));
        assert_eq!(replace_many("a", &many(" \n")), Err(OpError::BadChoice("nothing to find")));
    }

    #[test]
    fn says_on_how_many_lines_the_matches_are_and_how_many_differ() {
        assert_eq!(match_facts("ana Ana\nnimic\nANA și ion", &plain("ana", "")).expect("counts"), (2, 1));
        let any = Replacement { regex: true, ..plain(r"\b\w{3}\b", "") };
        assert_eq!(match_facts("ana are\nion\n", &any).expect("counts"), (2, 3));
    }

    #[test]
    fn says_where_the_matches_are_as_the_editor_counts() {
        // 😀 takes two units in the editor; ă takes one.
        let found = places("😀 ană, Ană și ANĂ", &plain("ană", ""), 2).expect("finds");
        assert_eq!(found, (3, vec![(3, 6), (8, 11)]));
        assert_eq!(places("abc", &plain("x", ""), 10).expect("finds"), (0, Vec::new()));
        assert!(places("abc", &plain("", ""), 10).is_err());
    }

    fn plain(find: &str, with: &str) -> Replacement {
        Replacement { find: find.to_owned(), with: with.to_owned(), regex: false, case_sensitive: false, whole_word: false, keep_case: false, fill: false, today: String::new(), now: String::new() }
    }

    fn done(text: &str, replacement: &Replacement) -> (String, usize) {
        let outcome = replace(text, replacement).expect("replaces");
        (outcome.text, outcome.changed)
    }

    #[test]
    fn replaces_plain_text_whatever_its_case() {
        assert_eq!(done("Cat, cat, CAT. (cat)", &plain("cat", "dog")), ("dog, dog, dog. (dog)".to_owned(), 4));
        assert_eq!(done("Cat, cat", &Replacement { case_sensitive: true, ..plain("cat", "dog") }), ("Cat, dog".to_owned(), 1));
        // What is typed is looked for as it is: a dot is a dot, a dollar is a dollar.
        assert_eq!(done("a.b a$b axb", &plain("a.b", "$1")).0, "$1 a$b axb");
    }

    #[test]
    fn replaces_whole_words_only_when_asked() {
        assert_eq!(done("cat category bobcat cat's", &Replacement { whole_word: true, ..plain("cat", "dog") }).0, "dog category bobcat dog's");
        // The letters of every language are letters of a word.
        assert_eq!(done("țară țărănesc", &Replacement { whole_word: true, ..plain("țară", "X") }).0, "X țărănesc");
    }

    #[test]
    fn keeps_the_case_of_what_it_replaces() {
        let kept = Replacement { keep_case: true, ..plain("cat", "dog") };
        assert_eq!(done("Cat cat CAT", &kept).0, "Dog dog DOG");
    }

    #[test]
    fn runs_regular_expressions_with_groups() {
        let dates = Replacement { regex: true, ..plain(r"(\d{2})/(\d{2})/(\d{4})", "$3-$2-$1") };
        assert_eq!(done("on 31/12/2026 and 01/02/2027", &dates), ("on 2026-12-31 and 2027-02-01".to_owned(), 2));
        // ^ and $ are the ends of each line; \n in what is put in place is a new line.
        assert_eq!(done("a\nb", &Replacement { regex: true, ..plain("^", "> ") }).0, "> a\n> b");
        assert_eq!(done("a;b", &Replacement { regex: true, ..plain(";", r"\n") }).0, "a\nb");
        assert_eq!(done("name: Ana", &Replacement { regex: true, ..plain(r"name: (?P<who>\w+)", "${who}!") }).0, "Ana!");
    }

    #[test]
    fn says_why_a_pattern_is_refused() {
        let refused = replace("a", &Replacement { regex: true, ..plain("(a", "b") });
        assert!(matches!(&refused, Err(OpError::BadPattern(why)) if why.contains("unclosed group")), "{refused:?}");
        assert_eq!(replace("a", &plain("", "b")), Err(OpError::BadChoice("nothing to find")));
    }

    #[test]
    fn counts_without_changing() {
        assert_eq!(count("a b a", &plain("a", "")).expect("counts"), 2);
    }

    #[test]
    fn a_pattern_that_freezes_other_engines_ends_here() {
        // Nested repeats on a long run with no match: the classic that hangs a backtracking engine.
        let text = "a".repeat(5000) + "!";
        let slow = Replacement { regex: true, ..plain("(a+)+$", "x") };
        let started = std::time::Instant::now();
        assert_eq!(count(&text, &slow).expect("counts"), 0);
        assert!(started.elapsed().as_secs() < 5);
    }
}
