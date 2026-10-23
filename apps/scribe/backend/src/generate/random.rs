//! Random characters: passwords, letters, digits, identifiers.

use serde::Deserialize;

use super::{Dice, MOST_CHARACTERS};
use crate::ops::OpError;

const LOWER: &str = "abcdefghijklmnopqrstuvwxyz";
const UPPER: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
/// Marks that can be typed on every keyboard and are taken by most places that ask for a password.
const MARKS: &str = "!#$%&*+-=?@^_";
const HEX: &str = "0123456789abcdef";
/// Characters easily taken for one another when read or copied by hand.
const LOOKALIKES: &str = "0O1lI";

/// What the characters are picked from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Alphabet {
    /// Letters of both kinds, digits and marks, with at least one of each.
    #[default]
    Password,
    LettersDigits,
    Letters,
    Digits,
    Hex,
    /// An identifier of the usual form (version 4): its length is its own.
    Uuid,
}

impl Alphabet {
    /// The kinds of characters it is made of.
    fn kinds(self) -> &'static [&'static str] {
        match self {
            Alphabet::Password => &[LOWER, UPPER, DIGITS, MARKS],
            Alphabet::LettersDigits => &[LOWER, UPPER, DIGITS],
            Alphabet::Letters => &[LOWER, UPPER],
            Alphabet::Digits => &[DIGITS],
            Alphabet::Hex | Alphabet::Uuid => &[HEX],
        }
    }
}

/// `lines` lines of `length` random characters each.
pub fn write(what: Alphabet, length: usize, lines: usize, no_lookalikes: bool, dice: &mut Dice) -> Result<String, OpError> {
    if length == 0 || lines == 0 {
        return Err(OpError::BadChoice("nothing to write"));
    }
    let length = if what == Alphabet::Uuid { 36 } else { length };
    if length.saturating_add(1).saturating_mul(lines) > MOST_CHARACTERS {
        return Err(OpError::BadChoice("too much to write"));
    }
    let kinds: Vec<Vec<char>> = what.kinds().iter().map(|kind| kind.chars().filter(|letter| !(no_lookalikes && what != Alphabet::Hex && what != Alphabet::Uuid && LOOKALIKES.contains(*letter))).collect()).collect();
    let all: Vec<char> = kinds.iter().flatten().copied().collect();
    let mut text = String::with_capacity((length + 1) * lines);
    for line in 0..lines {
        if line > 0 {
            text.push('\n');
        }
        if what == Alphabet::Uuid {
            text.push_str(&uuid(dice));
        } else {
            text.extend(one_line(&kinds, &all, length, what == Alphabet::Password, dice));
        }
    }
    Ok(text)
}

/// One line; with `every_kind`, each kind of character is in it at least once (when it is long enough to hold them).
fn one_line(kinds: &[Vec<char>], all: &[char], length: usize, every_kind: bool, dice: &mut Dice) -> Vec<char> {
    let mut line: Vec<char> = Vec::with_capacity(length);
    if every_kind && length >= kinds.len() {
        line.extend(kinds.iter().map(|kind| *dice.pick(kind)));
    }
    while line.len() < length {
        line.push(*dice.pick(all));
    }
    // The ones put in first do not stay first.
    dice.shuffle(&mut line);
    line
}

/// A random identifier as RFC 9562 writes one of version 4.
pub(super) fn uuid(dice: &mut Dice) -> String {
    let mut bytes = [0u8; 16];
    for byte in &mut bytes {
        *byte = dice.below(256) as u8;
    }
    bytes[6] = (bytes[6] & 0x0F) | 0x40;
    bytes[8] = (bytes[8] & 0x3F) | 0x80;
    let mut text = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            text.push('-');
        }
        text.push_str(&format!("{byte:02x}"));
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_lines_of_the_length_asked() {
        let text = write(Alphabet::Digits, 6, 4, false, &mut Dice::seeded(1)).expect("writes");
        let lines: Vec<&str> = text.split('\n').collect();
        assert_eq!(lines.len(), 4);
        assert!(lines.iter().all(|line| line.len() == 6 && line.chars().all(|letter| letter.is_ascii_digit())), "{text}");
        assert!(lines.iter().any(|line| *line != lines[0]));
    }

    #[test]
    fn a_password_has_every_kind_of_character() {
        for seed in 1..200 {
            let password = write(Alphabet::Password, 4, 1, false, &mut Dice::seeded(seed)).expect("writes");
            assert_eq!(password.chars().count(), 4);
            assert!(password.chars().any(|letter| letter.is_ascii_lowercase()), "{password}");
            assert!(password.chars().any(|letter| letter.is_ascii_uppercase()), "{password}");
            assert!(password.chars().any(|letter| letter.is_ascii_digit()), "{password}");
            assert!(password.chars().any(|letter| MARKS.contains(letter)), "{password}");
        }
        // Too short to hold them all: it is still as long as asked.
        assert_eq!(write(Alphabet::Password, 2, 1, false, &mut Dice::seeded(1)).expect("writes").len(), 2);
    }

    #[test]
    fn leaves_out_the_characters_taken_for_one_another() {
        let text = write(Alphabet::LettersDigits, 4000, 1, true, &mut Dice::seeded(3)).expect("writes");
        assert!(!text.chars().any(|letter| LOOKALIKES.contains(letter)));
        let all = write(Alphabet::LettersDigits, 4000, 1, false, &mut Dice::seeded(3)).expect("writes");
        assert!(LOOKALIKES.chars().all(|letter| all.contains(letter)));
        // Hexadecimal needs all its digits.
        assert!(write(Alphabet::Hex, 4000, 1, true, &mut Dice::seeded(3)).expect("writes").contains('0'));
    }

    #[test]
    fn writes_identifiers_of_the_usual_form() {
        let text = write(Alphabet::Uuid, 5, 3, false, &mut Dice::system()).expect("writes");
        for line in text.split('\n') {
            let parts: Vec<&str> = line.split('-').collect();
            assert_eq!(parts.iter().map(|part| part.len()).collect::<Vec<_>>(), [8, 4, 4, 4, 12], "{line}");
            assert!(parts[2].starts_with('4') && matches!(parts[3].as_bytes()[0], b'8' | b'9' | b'a' | b'b'), "{line}");
        }
        assert_eq!(text.split('\n').count(), 3);
    }

    #[test]
    fn refuses_nothing_and_too_much() {
        assert_eq!(write(Alphabet::Letters, 0, 1, false, &mut Dice::seeded(1)), Err(OpError::BadChoice("nothing to write")));
        assert_eq!(write(Alphabet::Letters, 100_000, 100_000, false, &mut Dice::seeded(1)), Err(OpError::BadChoice("too much to write")));
    }
}
