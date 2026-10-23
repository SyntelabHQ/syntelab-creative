//! Reading a number as a person types or pastes it.
//!
//! "1,234.56" and "1.234,56" are the same number written in two countries.
//! Both are understood. Where what is written can be read two ways ("1,234":
//! a thousand, or one and a bit), it is read as the language of the program
//! writes numbers, and said to be ambiguous so the interface can tell.

use crate::number::{self, Number};

/// A number that was read.
#[derive(Debug, Clone, PartialEq)]
pub struct Read {
    pub value: Number,
    /// It could have been read another way: the language of the program decided.
    pub ambiguous: bool,
    /// How many digits it was written with after the decimal mark: "2.00" has two, and is shown again as "2.00".
    pub decimals: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReadError {
    /// Nothing was written.
    Empty,
    NotANumber,
}

/// What stands for nothing between the digits of a number: spaces of every width, and the apostrophes some countries group thousands with.
fn is_filler(letter: char) -> bool {
    letter.is_whitespace() || matches!(letter, '\u{00A0}' | '\u{202F}' | '\u{2009}' | '\'' | '\u{2019}' | '_')
}

/// A digit of another script as the digit it is; the marks Arabic writes numbers with as a point and a comma.
fn plain(letter: char) -> char {
    match letter {
        '\u{0660}'..='\u{0669}' => char::from(b'0' + (letter as u32 - 0x0660) as u8),
        '\u{06F0}'..='\u{06F9}' => char::from(b'0' + (letter as u32 - 0x06F0) as u8),
        '\u{066B}' => '.',
        '\u{066C}' => ',',
        '\u{2212}' => '-',
        other => other,
    }
}

/// Reads `written`. `decimal` is the mark the language of the program puts before the decimals: `.` or `,`.
pub fn read(written: &str, decimal: char) -> Result<Read, ReadError> {
    let cleaned: String = written.chars().filter(|letter| !is_filler(*letter)).map(plain).collect();
    if cleaned.is_empty() {
        return Err(ReadError::Empty);
    }
    // A power of ten at the end: 1.5e-3.
    let (mantissa, exponent) = match cleaned.find(['e', 'E']) {
        Some(at) => (&cleaned[..at], Some(&cleaned[at + 1..])),
        None => (cleaned.as_str(), None),
    };
    if exponent.is_some_and(|exponent| exponent.parse::<i64>().is_err()) {
        return Err(ReadError::NotANumber);
    }
    let (sign, digits) = match mantissa.strip_prefix(['-', '+']) {
        Some(rest) => (&mantissa[..1], rest),
        None => ("", mantissa),
    };
    if digits.is_empty() || !digits.chars().all(|letter| letter.is_ascii_digit() || letter == '.' || letter == ',') {
        return Err(ReadError::NotANumber);
    }

    let count = |mark: char| digits.matches(mark).count();
    let (points, commas) = (count('.'), count(','));
    let mut ambiguous = false;
    // Which of the two marks stands before the decimals, if any does.
    let decimal_mark = match (points, commas) {
        (0, 0) => None,
        // Both: the one written last is before the decimals, and it is written once.
        (_, _) if points > 0 && commas > 0 => {
            let last = if digits.rfind('.') > digits.rfind(',') { '.' } else { ',' };
            if count(last) != 1 {
                return Err(ReadError::NotANumber);
            }
            Some(last)
        }
        // One mark, more than once: it groups thousands.
        (_, _) if points + commas > 1 => None,
        // One mark, once.
        _ => {
            let mark = if points == 1 { '.' } else { ',' };
            let (before, after) = digits.split_once(mark).unwrap_or((digits, ""));
            // "1,234" can be a thousand or one and a bit; "0,234", "1,23" and "12345,678" cannot be thousands.
            let could_group = after.len() == 3 && (1..=3).contains(&before.len()) && before != "0";
            if could_group {
                ambiguous = true;
                (mark == decimal).then_some(mark)
            } else {
                Some(mark)
            }
        }
    };

    let grouping = |mark: char| Some(mark) != decimal_mark;
    // Thousands are groups of three digits after the first group.
    for mark in ['.', ','] {
        if grouping(mark) && count(mark) > 0 {
            let whole = decimal_mark.and_then(|decimal| digits.split_once(decimal)).map_or(digits, |(whole, _)| whole);
            let mut groups = whole.split(mark);
            let first = groups.next().unwrap_or("");
            if first.is_empty() || first.len() > 3 || groups.any(|group| group.len() != 3) {
                return Err(ReadError::NotANumber);
            }
        }
    }
    let plain_digits: String = digits.chars().filter(|letter| letter.is_ascii_digit() || Some(*letter) == decimal_mark).map(|letter| if letter.is_ascii_digit() { letter } else { '.' }).collect();
    let exact = format!("{sign}{plain_digits}{}", exponent.map(|exponent| format!("e{exponent}")).unwrap_or_default());
    // The digits after the mark, less what a power of ten takes of them: 1.50e1 is 15.0, with one.
    let written_after = plain_digits.split_once('.').map_or(0, |(_, part)| part.len()) as i64;
    let decimals = (written_after - exponent.and_then(|exponent| exponent.parse::<i64>().ok()).unwrap_or(0)).max(0) as usize;
    number::exact(&exact).map(|value| Read { value, ambiguous, decimals }).ok_or(ReadError::NotANumber)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn value(written: &str, decimal: char) -> String {
        match read(written, decimal) {
            Ok(read) => format!("{}{}", number::without_trailing_zeros(&number::to_decimals(&read.value, 6), 0), if read.ambiguous { " ?" } else { "" }),
            Err(error) => format!("{error:?}"),
        }
    }

    #[test]
    fn reads_plain_numbers() {
        for (written, expected) in [("5", "5"), ("-2.5", "-2.5"), ("+3", "3"), (" 12 ", "12"), ("1e3", "1000"), ("1.5E-3", "0.0015"), (".5", "0.5"), ("5.", "5"), ("0,5", "0.5")] {
            assert_eq!(value(written, '.'), expected, "{written}");
        }
    }

    #[test]
    fn reads_thousands_written_either_way() {
        for decimal in ['.', ','] {
            assert_eq!(value("1,234.56", decimal), "1234.56");
            assert_eq!(value("1.234,56", decimal), "1234.56");
            assert_eq!(value("1 234 567,8", decimal), "1234567.8");
            assert_eq!(value("1'234'567.8", decimal), "1234567.8");
            assert_eq!(value("1,234,567", decimal), "1234567");
            assert_eq!(value("1.234.567", decimal), "1234567");
            assert_eq!(value("12,5", decimal), "12.5");
            assert_eq!(value("12.5", decimal), "12.5");
            assert_eq!(value("0,234", decimal), "0.234");
            assert_eq!(value("12345,678", decimal), "12345.678");
        }
    }

    #[test]
    fn says_when_the_language_had_to_decide() {
        assert_eq!(value("1,234", '.'), "1234 ?");
        assert_eq!(value("1,234", ','), "1.234 ?");
        assert_eq!(value("1.234", '.'), "1.234 ?");
        assert_eq!(value("1.234", ','), "1234 ?");
        assert_eq!(value("123,456", ','), "123.456 ?");
    }

    #[test]
    fn reads_the_digits_of_other_scripts() {
        assert_eq!(value("١٢٣٫٥", '.'), "123.5");
        assert_eq!(value("۱۲۳", '.'), "123");
        assert_eq!(value("−5", '.'), "-5");
    }

    #[test]
    fn remembers_how_many_decimals_were_written() {
        for (written, decimals) in [("2.00", 2), ("5", 0), ("1,234.5", 1), ("1.50e1", 1), ("1e-3", 3), ("12,50", 2)] {
            assert_eq!(read(written, '.').map(|read| read.decimals), Ok(decimals), "{written}");
        }
    }

    #[test]
    fn refuses_what_is_not_a_number() {
        assert_eq!(read("", '.'), Err(ReadError::Empty));
        assert_eq!(read("   ", '.'), Err(ReadError::Empty));
        for wrong in ["abc", "1,2.3,4", "1.2.3,4.5", "12,34,567", "1e", "--5", "5m", "1,2345,678"] {
            assert_eq!(read(wrong, '.'), Err(ReadError::NotANumber), "{wrong}");
        }
    }
}
