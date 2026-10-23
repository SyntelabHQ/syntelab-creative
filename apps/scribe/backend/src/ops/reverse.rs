//! Turning a text around: its letters, its words, or the page itself.

use icu_segmenter::GraphemeClusterSegmenter;
use serde::Deserialize;

use super::{lines_of, text_of, Outcome};

/// What is turned around.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Reversal {
    /// The letters: "Bună ziua" → "auiz ănuB".
    #[default]
    Letters,
    /// The order of the words: "Bună ziua" → "ziua Bună".
    Words,
    /// The letters of each word, the words staying where they are: "Bună ziua" → "ănuB auiz".
    EachWord,
    /// The page: read by someone sitting across the table.
    UpsideDown,
    /// As in a mirror: the letters turned around, and the marks that have a left and a right swapped.
    Mirror,
}

/// A text as a reader counts its letters: a letter with its marks is one, an emoji made of several codes is one.
fn letters(text: &str) -> Vec<&str> {
    let ends: Vec<usize> = GraphemeClusterSegmenter::new().segment_str(text).collect();
    ends.windows(2).map(|ends| &text[ends[0]..ends[1]]).collect()
}

fn backwards(text: &str) -> String {
    letters(text).into_iter().rev().collect()
}

/// The marks that open on one side and close on the other, each with its other half.
fn mirrored(letter: &str) -> &str {
    match letter {
        "(" => ")",
        ")" => "(",
        "[" => "]",
        "]" => "[",
        "{" => "}",
        "}" => "{",
        "<" => ">",
        ">" => "<",
        "«" => "»",
        "»" => "«",
        "“" => "”",
        "”" => "“",
        "‘" => "’",
        "’" => "‘",
        "/" => "\\",
        "\\" => "/",
        other => other,
    }
}

/// A letter as it looks turned on its head, where another letter looks like that; else the letter itself.
fn on_its_head(letter: char) -> char {
    match letter {
        'a' => 'ɐ',
        'b' => 'q',
        'c' => 'ɔ',
        'd' => 'p',
        'e' => 'ǝ',
        'f' => 'ɟ',
        'g' => 'ƃ',
        'h' => 'ɥ',
        'i' => 'ᴉ',
        'j' => 'ɾ',
        'k' => 'ʞ',
        'm' => 'ɯ',
        'n' => 'u',
        'p' => 'd',
        'q' => 'b',
        'r' => 'ɹ',
        't' => 'ʇ',
        'u' => 'n',
        'v' => 'ʌ',
        'w' => 'ʍ',
        'y' => 'ʎ',
        'A' => '∀',
        'C' => 'Ɔ',
        'E' => 'Ǝ',
        'F' => 'Ⅎ',
        'G' => '⅁',
        'J' => 'ſ',
        'L' => '˥',
        'M' => 'W',
        'P' => 'Ԁ',
        'T' => '⊥',
        'U' => '∩',
        'V' => 'Λ',
        'W' => 'M',
        'Y' => '⅄',
        '1' => 'Ɩ',
        '2' => 'ᄅ',
        '3' => 'Ɛ',
        '4' => 'ㄣ',
        '5' => 'ϛ',
        '6' => '9',
        '7' => 'ㄥ',
        '9' => '6',
        '.' => '˙',
        ',' => '\'',
        '\'' => ',',
        '"' => '„',
        '?' => '¿',
        '!' => '¡',
        '_' => '‾',
        '&' => '⅋',
        '(' => ')',
        ')' => '(',
        '[' => ']',
        ']' => '[',
        '{' => '}',
        '}' => '{',
        '<' => '>',
        '>' => '<',
        other => other,
    }
}

/// One line turned around.
fn reversed(line: &str, what: Reversal) -> String {
    match what {
        Reversal::Letters => backwards(line),
        Reversal::Mirror => letters(line).into_iter().rev().map(mirrored).collect(),
        // Turned on its head, a line is read from its other end too. Letters with marks lose them: no mark is drawn under a letter.
        Reversal::UpsideDown => {
            use unicode_normalization::UnicodeNormalization;
            line.nfd().filter(|letter| !unicode_normalization::char::is_combining_mark(*letter)).map(on_its_head).collect::<Vec<char>>().into_iter().rev().collect()
        }
        Reversal::Words | Reversal::EachWord => {
            // The words and what parts them, each kept as it is.
            let mut pieces: Vec<&str> = Vec::new();
            let mut start = 0;
            let mut in_space = None;
            for (at, letter) in line.char_indices() {
                let space = letter.is_whitespace();
                if in_space.is_some_and(|before| before != space) {
                    pieces.push(&line[start..at]);
                    start = at;
                }
                in_space = Some(space);
            }
            pieces.push(&line[start..]);
            let is_word = |piece: &&str| !piece.chars().all(char::is_whitespace);
            if what == Reversal::EachWord {
                return pieces.iter().map(|piece| if is_word(piece) { backwards(piece) } else { (*piece).to_owned() }).collect();
            }
            // The words change places; the spaces between them stay where they were.
            let mut words: Vec<&str> = pieces.iter().copied().filter(is_word).collect();
            words.reverse();
            let mut next = words.into_iter();
            pieces.iter().map(|piece| if is_word(piece) { next.next().unwrap_or("") } else { piece }).collect()
        }
    }
}

/// Turns the text around, line by line: each line stays a line, in its place.
pub fn reverse(text: &str, what: Reversal) -> Outcome {
    let (lines, ended) = lines_of(text);
    let turned: Vec<String> = lines.iter().map(|line| reversed(line, what)).collect();
    let changed = lines.iter().zip(&turned).filter(|(was, is)| *was != is).count();
    Outcome { changed, text: text_of(&turned, ended) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn turned(text: &str, what: Reversal) -> String {
        reverse(text, what).text
    }

    #[test]
    fn turns_letters_around_as_a_reader_counts_them() {
        assert_eq!(turned("Bună ziua", Reversal::Letters), "auiz ănuB");
        // A letter written as a letter and a mark stays one; so does a family made of four people.
        assert_eq!(turned("a\u{326}b 👨‍👩‍👧‍👦!", Reversal::Letters), "!👨‍👩‍👧‍👦 ba\u{326}");
        assert_eq!(turned("unu\ndoi\n", Reversal::Letters), "unu\niod\n");
        assert_eq!(reverse("ana\nxyz", Reversal::Letters).changed, 1);
    }

    #[test]
    fn turns_words_around() {
        assert_eq!(turned("Ana are   mere, pere.", Reversal::Words), "pere. mere,   are Ana");
        assert_eq!(turned("  Ana are mere", Reversal::EachWord), "  anA era erem");
        assert_eq!(turned("", Reversal::Words), "");
        assert_eq!(turned("unul", Reversal::Words), "unul");
    }

    #[test]
    fn turns_the_page_on_its_head_and_in_a_mirror() {
        assert_eq!(turned("buna ziua!", Reversal::UpsideDown), "¡ɐnᴉz ɐunq");
        assert_eq!(turned("țară", Reversal::UpsideDown), "ɐɹɐʇ");
        assert_eq!(turned("(a) [b]", Reversal::Mirror), "[b] (a)");
        assert_eq!(turned("a → b", Reversal::Mirror), "b → a");
    }
}
