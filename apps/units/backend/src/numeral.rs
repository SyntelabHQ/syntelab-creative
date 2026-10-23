//! Whole numbers written in other ways than with ten digits.
//!
//! The converter of number bases answers with text: a value in base 16 is
//! `FF`, a Roman numeral is `XIV`. Each of its units is a way of writing a
//! whole number that is not negative; this reads and writes them.

use num_bigint::BigInt;
use num_integer::Integer;
use num_traits::{One, Signed, ToPrimitive, Zero};

/// A way of writing a whole number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Numeral {
    /// Digits of a base from 2 to 64: `0-9`, then `A-Z`, then `a-z`, then `+` and `/`. Up to base 36 small letters are read as capitals.
    Radix(u32),
    /// Base 60 as the Babylonians are transcribed: its digits in base ten, with colons between them (`1:30:15`).
    Sexagesimal,
    /// Roman numerals, from I to MMMCMXCIX.
    Roman,
    /// Binary-coded decimal: four bits for each decimal digit.
    Bcd,
    /// Gray code, in bits: neighbours differ by one bit.
    Gray,
}

const DIGITS: &[u8] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz+/";
/// The largest base the digits reach.
pub const LARGEST_RADIX: u32 = DIGITS.len() as u32;
const LARGEST_ROMAN: u32 = 3999;
const ROMAN: &[(u32, &str)] = &[(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")];
/// The most letters read: beyond it, it is not a number anybody means.
const LONGEST: usize = 4000;

fn in_radix(written: &str, radix: u32) -> Option<BigInt> {
    if written.is_empty() || !(2..=LARGEST_RADIX).contains(&radix) {
        return None;
    }
    let mut value = BigInt::zero();
    for letter in written.bytes() {
        let letter = if radix <= 36 { letter.to_ascii_uppercase() } else { letter };
        let digit = DIGITS.iter().position(|known| *known == letter)? as u32;
        if digit >= radix {
            return None;
        }
        value = value * radix + digit;
    }
    Some(value)
}

fn to_radix(value: &BigInt, radix: u32) -> String {
    if value.is_zero() {
        return "0".to_owned();
    }
    let mut left = value.clone();
    let mut digits = Vec::new();
    while !left.is_zero() {
        let (rest, digit) = left.div_rem(&BigInt::from(radix));
        digits.push(DIGITS[digit.to_usize().unwrap_or(0)]);
        left = rest;
    }
    digits.reverse();
    String::from_utf8(digits).unwrap_or_default()
}

/// Reads a whole number written as `numeral` writes it. None when it is not written so.
pub fn read(written: &str, numeral: Numeral) -> Option<BigInt> {
    let written = written.trim();
    if written.is_empty() || written.len() > LONGEST {
        return None;
    }
    match numeral {
        Numeral::Radix(radix) => in_radix(written, radix),
        Numeral::Sexagesimal => written.split(':').try_fold(BigInt::zero(), |value, digit| {
            // One or two digits of base ten, under sixty.
            let known = (1..=2).contains(&digit.len()) && digit.bytes().all(|letter| letter.is_ascii_digit());
            let digit: u32 = digit.parse().ok().filter(|digit| known && *digit < 60)?;
            Some(value * 60 + digit)
        }),
        Numeral::Roman => {
            let written = written.to_ascii_uppercase();
            // Read greedily, then written back: only the one right way of writing a number is taken.
            let mut value = 0;
            let mut rest = written.as_str();
            for (worth, letters) in ROMAN {
                while let Some(after) = rest.strip_prefix(letters) {
                    value += worth;
                    rest = after;
                    if value > LARGEST_ROMAN {
                        return None;
                    }
                }
            }
            let value = BigInt::from(value);
            (rest.is_empty() && self::written(&value, Numeral::Roman).as_deref() == Some(written.as_str())).then_some(value)
        }
        Numeral::Bcd => {
            let bits = in_radix(written, 2)?;
            let (mut left, mut value, mut place) = (bits, BigInt::zero(), BigInt::one());
            while !left.is_zero() {
                let digit = &left % 16;
                if digit > BigInt::from(9) {
                    return None;
                }
                value += digit * &place;
                place *= 10;
                left >>= 4;
            }
            Some(value)
        }
        Numeral::Gray => {
            let mut bit = in_radix(written, 2)?;
            let mut value = BigInt::zero();
            while !bit.is_zero() {
                value ^= &bit;
                bit >>= 1;
            }
            Some(value)
        }
    }
}

/// Writes a whole number as `numeral` does. None when it cannot be written so (a negative number; a Roman numeral out of reach).
pub fn written(value: &BigInt, numeral: Numeral) -> Option<String> {
    if value.is_negative() {
        return None;
    }
    Some(match numeral {
        Numeral::Radix(radix) => to_radix(value, radix),
        Numeral::Sexagesimal => {
            if value.is_zero() {
                return Some("0".to_owned());
            }
            let mut left = value.clone();
            let mut digits = Vec::new();
            while !left.is_zero() {
                let (rest, digit) = left.div_rem(&BigInt::from(60));
                digits.push(digit.to_string());
                left = rest;
            }
            digits.reverse();
            digits.join(":")
        }
        Numeral::Roman => {
            let mut left = value.to_u32().filter(|value| (1..=LARGEST_ROMAN).contains(value))?;
            let mut letters = String::new();
            for (worth, written) in ROMAN {
                while left >= *worth {
                    letters.push_str(written);
                    left -= worth;
                }
            }
            letters
        }
        Numeral::Bcd => {
            let mut bits = BigInt::zero();
            for (place, digit) in value.to_string().bytes().rev().enumerate() {
                bits |= BigInt::from(digit - b'0') << (4 * place);
            }
            to_radix(&bits, 2)
        }
        Numeral::Gray => to_radix(&(value ^ (value >> 1u32)), 2),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn there(value: u64, numeral: Numeral) -> String {
        written(&BigInt::from(value), numeral).unwrap_or_else(|| "-".to_owned())
    }

    fn back(text: &str, numeral: Numeral) -> String {
        read(text, numeral).map_or_else(|| "-".to_owned(), |value| value.to_string())
    }

    #[test]
    fn writes_and_reads_the_bases() {
        assert_eq!(there(255, Numeral::Radix(2)), "11111111");
        assert_eq!(there(255, Numeral::Radix(16)), "FF");
        assert_eq!(there(35, Numeral::Radix(36)), "Z");
        assert_eq!(there(61, Numeral::Radix(62)), "z");
        assert_eq!(there(0, Numeral::Radix(8)), "0");
        assert_eq!(back("ff", Numeral::Radix(16)), "255");
        assert_eq!(back("FF", Numeral::Radix(16)), "255");
        assert_eq!(back("12", Numeral::Radix(2)), "-");
        assert_eq!(back("", Numeral::Radix(10)), "-");
        // Beyond base 36 small letters are digits of their own.
        assert_eq!(back("a", Numeral::Radix(64)), "36");
        assert_eq!(back("A", Numeral::Radix(64)), "10");
        // No size is too large.
        let large = "1".repeat(200);
        assert_eq!(written(&read(&large, Numeral::Radix(2)).expect("bits"), Numeral::Radix(2)).as_deref(), Some(large.as_str()));
    }

    #[test]
    fn writes_and_reads_the_other_ways() {
        assert_eq!(there(5415, Numeral::Sexagesimal), "1:30:15");
        assert_eq!(back("1:30:15", Numeral::Sexagesimal), "5415");
        assert_eq!(back("1:60", Numeral::Sexagesimal), "-");
        assert_eq!(there(1994, Numeral::Roman), "MCMXCIV");
        assert_eq!(back("mcmxciv", Numeral::Roman), "1994");
        assert_eq!(back("IIII", Numeral::Roman), "-");
        assert_eq!(back("IC", Numeral::Roman), "-");
        assert_eq!(there(0, Numeral::Roman), "-");
        assert_eq!(there(4000, Numeral::Roman), "-");
        assert_eq!(there(25, Numeral::Bcd), "100101");
        assert_eq!(back("100101", Numeral::Bcd), "25");
        assert_eq!(back("1010", Numeral::Bcd), "-");
        assert_eq!(there(5, Numeral::Gray), "111");
        assert_eq!(back("111", Numeral::Gray), "5");
        assert_eq!(written(&BigInt::from(-1), Numeral::Radix(2)), None);
    }
}
