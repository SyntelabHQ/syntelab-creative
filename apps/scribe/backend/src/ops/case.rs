//! Changing the case of a text: capitals and small letters, and the ways programmers join words.

use serde::Deserialize;

use super::Outcome;

/// What the letters are turned into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CaseStyle {
    /// EVERY LETTER A CAPITAL.
    Upper,
    /// every letter small.
    Lower,
    /// Every Word Starts With A Capital.
    Title,
    /// A capital after every full stop, question or exclamation mark; the rest small.
    Sentence,
    /// cAPITALS BECOME SMALL AND SMALL LETTERS CAPITALS.
    Inverted,
    /// wordsJoinedLikeThis
    Camel,
    /// WordsJoinedLikeThis
    Pascal,
    /// words_joined_like_this
    Snake,
    /// WORDS_JOINED_LIKE_THIS
    Constant,
    /// words-joined-like-this
    Kebab,
}

fn upper(letter: char, into: &mut String) {
    into.extend(letter.to_uppercase());
}

fn lower(letter: char, into: &mut String) {
    into.extend(letter.to_lowercase());
}

fn title(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut inside_word = false;
    for letter in text.chars() {
        // An apostrophe inside a word does not start a new one: "don't", "l'été".
        let part_of_word = letter.is_alphanumeric() || (inside_word && matches!(letter, '\'' | '’'));
        if part_of_word && !inside_word {
            upper(letter, &mut out);
        } else if part_of_word {
            lower(letter, &mut out);
        } else {
            out.push(letter);
        }
        inside_word = part_of_word;
    }
    out
}

fn sentence(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut starts = true;
    for letter in text.chars() {
        if letter.is_alphabetic() {
            if starts {
                upper(letter, &mut out);
            } else {
                lower(letter, &mut out);
            }
            starts = false;
        } else {
            out.push(letter);
            // A new sentence after its mark, and at the start of a paragraph; a digit starts one without a capital.
            if matches!(letter, '.' | '!' | '?' | '…' | '\n') {
                starts = true;
            } else if letter.is_numeric() {
                starts = false;
            }
        }
    }
    out
}

fn inverted(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for letter in text.chars() {
        if letter.is_uppercase() {
            lower(letter, &mut out);
        } else {
            upper(letter, &mut out);
        }
    }
    out
}

/// The words of a line as programmers count them: split at anything that is
/// not a letter or a digit, and inside a run where small letters turn to
/// capitals ("someName" → "some", "Name"; "HTMLPage" → "HTML", "Page").
fn name_words(line: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let letters: Vec<char> = line.chars().collect();
    for (index, letter) in letters.iter().copied().enumerate() {
        if !letter.is_alphanumeric() {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            continue;
        }
        let previous = index.checked_sub(1).and_then(|before| letters.get(before)).copied();
        let next = letters.get(index + 1).copied();
        let after_small = previous.is_some_and(|before| before.is_lowercase() || before.is_numeric());
        let before_small = next.is_some_and(char::is_lowercase);
        let starts_word = letter.is_uppercase() && (after_small || (previous.is_some_and(char::is_uppercase) && before_small));
        if starts_word && !current.is_empty() {
            words.push(std::mem::take(&mut current));
        }
        current.push(letter);
    }
    if !current.is_empty() {
        words.push(current);
    }
    words
}

fn capitalized(word: &str) -> String {
    let mut out = String::with_capacity(word.len());
    for (index, letter) in word.chars().enumerate() {
        if index == 0 {
            upper(letter, &mut out);
        } else {
            lower(letter, &mut out);
        }
    }
    out
}

/// Each line made one name in the style asked for. The spaces a line starts with are kept (code is indented).
fn names(text: &str, style: CaseStyle) -> String {
    let named = |line: &str| {
        let indent_length = line.len() - line.trim_start().len();
        let words = name_words(line);
        let joined = match style {
            CaseStyle::Camel => words.iter().enumerate().map(|(index, word)| if index == 0 { word.to_lowercase() } else { capitalized(word) }).collect::<String>(),
            CaseStyle::Pascal => words.iter().map(|word| capitalized(word)).collect::<String>(),
            CaseStyle::Snake => words.iter().map(|word| word.to_lowercase()).collect::<Vec<_>>().join("_"),
            CaseStyle::Constant => words.iter().map(|word| word.to_uppercase()).collect::<Vec<_>>().join("_"),
            _ => words.iter().map(|word| word.to_lowercase()).collect::<Vec<_>>().join("-"),
        };
        format!("{}{joined}", &line[..indent_length])
    };
    text.split('\n').map(named).collect::<Vec<_>>().join("\n")
}

pub fn change(text: &str, to: CaseStyle) -> Outcome {
    let changed = match to {
        CaseStyle::Upper => text.to_uppercase(),
        CaseStyle::Lower => text.to_lowercase(),
        CaseStyle::Title => title(text),
        CaseStyle::Sentence => sentence(text),
        CaseStyle::Inverted => inverted(text),
        CaseStyle::Camel | CaseStyle::Pascal | CaseStyle::Snake | CaseStyle::Constant | CaseStyle::Kebab => names(text, to),
    };
    // Counted in lines: how many came out other than they went in.
    let lines = text.split('\n').zip(changed.split('\n')).filter(|(before, after)| before != after).count();
    Outcome { changed: lines, text: changed }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn to(text: &str, style: CaseStyle) -> String {
        change(text, style).text
    }

    #[test]
    fn changes_capitals_and_small_letters() {
        assert_eq!(to("Șase țări, ß", CaseStyle::Upper), "ȘASE ȚĂRI, SS");
        assert_eq!(to("ȘASE Țări", CaseStyle::Lower), "șase țări");
        assert_eq!(to("Hello World 1a", CaseStyle::Inverted), "hELLO wORLD 1A");
    }

    #[test]
    fn starts_every_word_with_a_capital() {
        assert_eq!(to("the QUICK brown-fox don't stop, l’été", CaseStyle::Title), "The Quick Brown-Fox Don't Stop, L’été");
        assert_eq!(to("în țară\nșase", CaseStyle::Title), "În Țară\nȘase");
    }

    #[test]
    fn starts_every_sentence_with_a_capital() {
        assert_eq!(to("hELLO there. how ARE you? fine! ok", CaseStyle::Sentence), "Hello there. How are you? Fine! Ok");
        assert_eq!(to("first line\nsecond line", CaseStyle::Sentence), "First line\nSecond line");
        // A sentence that starts with a number has no capital to give.
        assert_eq!(to("3 mere. apoi", CaseStyle::Sentence), "3 mere. Apoi");
    }

    #[test]
    fn joins_words_the_ways_programmers_do() {
        assert_eq!(to("some variable name", CaseStyle::Camel), "someVariableName");
        assert_eq!(to("some-variable_name", CaseStyle::Pascal), "SomeVariableName");
        assert_eq!(to("someVariableName", CaseStyle::Snake), "some_variable_name");
        assert_eq!(to("parseHTMLPage2Fast", CaseStyle::Kebab), "parse-html-page2-fast");
        assert_eq!(to("max retry count", CaseStyle::Constant), "MAX_RETRY_COUNT");
        // Line by line, with the indent kept.
        assert_eq!(to("  first name\n\tlast name", CaseStyle::Snake), "  first_name\n\tlast_name");
    }

    #[test]
    fn counts_the_lines_it_changed() {
        assert_eq!(change("already\nNOT\nalready", CaseStyle::Lower).changed, 1);
    }
}
