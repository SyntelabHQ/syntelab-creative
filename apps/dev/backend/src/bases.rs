//! Whole numbers written in one base, told in the others: binary, octal, decimal, hexadecimal, and any base up
//! to 36.
//!
//! A number has no most: it is kept as limbs of 32 bits, as many as it needs. Each line holds one number. Its base
//! is the one chosen, or told from how it is written (`0x`, `0b`, `0o` before it; decimal otherwise). A negative
//! number is also given as computers keep it (two's complement), in the smallest of the usual sizes that holds it.

use crate::json::Style;
use crate::lines::{object, plain, text, EachLine, Members};

/// A whole number that is not negative, of any size: limbs of 32 bits, the lowest first, with no zero at its top.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct Big(Vec<u32>);

const DIGITS: &[u8; 36] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

impl Big {
    fn is_zero(&self) -> bool {
        self.0.is_empty()
    }

    /// Itself times `by`, plus `more`.
    fn times_plus(&mut self, by: u32, more: u32) {
        let mut carried = u64::from(more);
        for limb in &mut self.0 {
            let whole = u64::from(*limb) * u64::from(by) + carried;
            *limb = whole as u32;
            carried = whole >> 32;
        }
        if carried > 0 {
            self.0.push(carried as u32);
        }
    }

    /// Divides itself by `by`; gives what is left over.
    fn divide(&mut self, by: u32) -> u32 {
        let mut left = 0u64;
        for limb in self.0.iter_mut().rev() {
            let whole = left << 32 | u64::from(*limb);
            *limb = (whole / u64::from(by)) as u32;
            left = whole % u64::from(by);
        }
        while self.0.last() == Some(&0) {
            self.0.pop();
        }
        left as u32
    }

    /// The digits of a number in a base (from 2 to 36), read into a number. None when a letter is no digit of the base.
    fn read(digits: &str, base: u32) -> Option<Big> {
        let mut number = Big::default();
        let mut any = false;
        for letter in digits.chars() {
            // Signs people put between groups of digits to read them more easily.
            if matches!(letter, '_' | ' ' | '\'' | '\u{a0}') {
                continue;
            }
            number.times_plus(base, letter.to_digit(base)?);
            any = true;
        }
        any.then_some(number)
    }

    /// Written in a base: taken apart by the largest power of the base a limb holds, so a long number is not
    /// divided once for every digit.
    fn written(&self, base: u32) -> String {
        if self.is_zero() {
            return "0".to_owned();
        }
        let (mut power, mut each) = (base, 1usize);
        while u64::from(power) * u64::from(base) <= u64::from(u32::MAX) {
            power *= base;
            each += 1;
        }
        let mut left = self.clone();
        let mut digits: Vec<u8> = Vec::new();
        while !left.is_zero() {
            let mut group = left.divide(power);
            for _ in 0..each {
                digits.push(DIGITS[(group % base) as usize]);
                group /= base;
            }
        }
        while digits.len() > 1 && digits.last() == Some(&b'0') {
            digits.pop();
        }
        digits.reverse();
        String::from_utf8(digits).unwrap_or_default()
    }

    /// How many bits it takes to write.
    fn bits(&self) -> u64 {
        match self.0.last() {
            Some(top) => (self.0.len() as u64 - 1) * 32 + u64::from(32 - top.leading_zeros()),
            None => 0,
        }
    }

    /// The negative of this number as computers keep it in so many bits (a multiple of 8): every bit turned over, and one added.
    fn negative_in(&self, bits: u64) -> Big {
        let limbs = bits.div_ceil(32) as usize;
        let mut turned: Vec<u32> = (0..limbs).map(|index| !self.0.get(index).copied().unwrap_or(0)).collect();
        // Bits beyond the size are not of the number.
        if !bits.is_multiple_of(32) {
            if let Some(top) = turned.last_mut() {
                *top &= (1u32 << (bits % 32)) - 1;
            }
        }
        let mut number = Big(turned);
        let mut carried = true;
        for limb in &mut number.0 {
            if !carried {
                break;
            }
            let (sum, over) = limb.overflowing_add(1);
            *limb = sum;
            carried = over;
        }
        if !bits.is_multiple_of(32) {
            if let Some(top) = number.0.last_mut() {
                *top &= (1u32 << (bits % 32)) - 1;
            }
        }
        while number.0.last() == Some(&0) {
            number.0.pop();
        }
        number
    }
}

/// The base a number is read in: one that is chosen, or told from how the number is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum From {
    Told,
    Base(u32),
}

/// The smallest of the usual sizes (8, 16, 32, 64, then doubling) that holds a negative number of so many bits.
fn size_for(negative: &Big) -> u64 {
    let mut size = 8u64;
    // `-128` fits in 8 bits though 128 takes eight: a power of two is the one number that needs no bit more.
    let power_of_two = negative.0.iter().map(|limb| u64::from(limb.count_ones())).sum::<u64>() == 1;
    let needed = negative.bits() + u64::from(!power_of_two);
    while size < needed {
        size *= 2;
    }
    size
}

fn told(line: &str, from: From, other: u32) -> Result<Members, &'static str> {
    let (negative, unsigned) = match line.strip_prefix('-') {
        Some(rest) => (true, rest.trim_start()),
        None => (false, line.strip_prefix('+').unwrap_or(line).trim_start()),
    };
    let lower = unsigned.to_ascii_lowercase();
    let (base, digits) = match from {
        From::Base(base) => {
            // A prefix that says the same as the base chosen is no digit.
            let prefix = match base {
                16 => "0x",
                2 => "0b",
                8 => "0o",
                _ => "\0",
            };
            (base, lower.strip_prefix(prefix).map(str::to_owned).unwrap_or(lower.clone()))
        }
        From::Told => match (lower.strip_prefix("0x"), lower.strip_prefix("0b"), lower.strip_prefix("0o")) {
            (Some(rest), _, _) => (16, rest.to_owned()),
            (_, Some(rest), _) => (2, rest.to_owned()),
            (_, _, Some(rest)) => (8, rest.to_owned()),
            // Letters with no prefix: hexadecimal is what is meant.
            _ if lower.bytes().any(|letter| letter.is_ascii_alphabetic()) => (16, lower.trim_end_matches('h').to_owned()),
            _ => (10, lower.clone()),
        },
    };
    let number = Big::read(&digits, base).ok_or("not-a-number")?;
    let negative = negative && !number.is_zero();
    let sign = if negative { "-" } else { "" };
    let mut members: Members = vec![
        ("input", text(line)),
        ("base", plain(base)),
        ("negative", plain(negative)),
        ("decimal", text(&format!("{sign}{}", number.written(10)))),
        ("hex", text(&format!("{sign}{}", number.written(16)))),
        ("octal", text(&format!("{sign}{}", number.written(8)))),
        ("binary", text(&format!("{sign}{}", number.written(2)))),
    ];
    if !matches!(other, 2 | 8 | 10 | 16) {
        members.push(("other", object(vec![("base", plain(other)), ("written", text(&format!("{sign}{}", number.written(other))))])));
    }
    members.push(("bits", plain(number.bits())));
    if negative {
        let size = size_for(&number);
        let kept = number.negative_in(size);
        let binary = kept.written(2);
        members.push(("twosComplement", object(vec![("bits", plain(size)), ("hex", text(&format!("{:0>width$}", kept.written(16), width = (size / 4) as usize))), ("binary", text(&format!("{binary:0>width$}", width = size as usize)))])));
    }
    Ok(members)
}

/// Each line told as a number in every base. `other`: one more base to write it in (from 2 to 36).
pub fn stage(style: Style, from: From, other: u32) -> EachLine {
    let other = other.clamp(2, 36);
    EachLine::new(style, "numbers-read", move |line| told(line, from, other))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn bases(lines: &str, from: From, other: u32) -> String {
        String::from_utf8(through(&mut stage(Style::Minify, from, other), lines.as_bytes(), 5).expect("read")).expect("text")
    }

    #[test]
    fn a_number_is_told_in_every_base() {
        assert_eq!(bases("255", From::Told, 36), r#"[{"input":"255","base":10,"negative":false,"decimal":"255","hex":"FF","octal":"377","binary":"11111111","other":{"base":36,"written":"73"},"bits":8}]"#);
        assert_eq!(bases("0xFF\n0b1010\n0o17\ndeadBEEF\n1F4h\n0", From::Told, 10).matches("\"decimal\":").count(), 6);
        let read = |line: &str, from: From| bases(line, from, 10).split("\"decimal\":\"").nth(1).and_then(|rest| rest.split('"').next()).map(str::to_owned);
        assert_eq!(read("0xFF", From::Told).as_deref(), Some("255"));
        assert_eq!(read("0b1010", From::Told).as_deref(), Some("10"));
        assert_eq!(read("0o17", From::Told).as_deref(), Some("15"));
        assert_eq!(read("deadBEEF", From::Told).as_deref(), Some("3735928559"));
        assert_eq!(read("1F4h", From::Told).as_deref(), Some("500"));
        assert_eq!(read("1_000 000'000", From::Told).as_deref(), Some("1000000000"));
        // A base that is chosen: the digits are read in it, with or without its own prefix.
        assert_eq!(read("777", From::Base(8)).as_deref(), Some("511"));
        assert_eq!(read("0xff", From::Base(16)).as_deref(), Some("255"));
        assert_eq!(read("zz", From::Base(36)).as_deref(), Some("1295"));
        assert_eq!(read("+42", From::Told).as_deref(), Some("42"));
    }

    #[test]
    fn a_number_has_no_most() {
        // 2^128, and a number of a thousand digits that comes back as it went.
        assert!(bases("340282366920938463463374607431768211456", From::Told, 10).contains(r#""hex":"100000000000000000000000000000000","#));
        let long: String = "1234567890".repeat(100);
        let told = bases(&long, From::Told, 10);
        assert!(told.contains(&format!("\"decimal\":\"{long}\"")));
        assert!(told.contains("\"bits\":3319"));
        let hex = told.split("\"hex\":\"").nth(1).and_then(|rest| rest.split('"').next()).expect("hex").to_owned();
        assert!(bases(&hex, From::Base(16), 10).contains(&format!("\"decimal\":\"{long}\"")));
    }

    #[test]
    fn a_negative_number_is_given_as_computers_keep_it() {
        let kept = |line: &str| bases(line, From::Told, 10).split("\"twosComplement\":").nth(1).map(str::to_owned).unwrap_or_default();
        assert_eq!(kept("-1"), r#"{"bits":8,"hex":"FF","binary":"11111111"}}]"#);
        assert_eq!(kept("-128"), r#"{"bits":8,"hex":"80","binary":"10000000"}}]"#);
        assert_eq!(kept("-129"), r#"{"bits":16,"hex":"FF7F","binary":"1111111101111111"}}]"#);
        assert!(kept("-2147483648").starts_with(r#"{"bits":32,"hex":"80000000","#));
        assert!(kept("-2147483649").starts_with(r#"{"bits":64,"hex":"FFFFFFFF7FFFFFFF","#));
        assert!(kept("-0x8000000000000001").starts_with(r#"{"bits":128,"hex":"FFFFFFFFFFFFFFFF7FFFFFFFFFFFFFFF","#));
        assert!(bases("-42", From::Told, 10).contains(r#""negative":true,"decimal":"-42","hex":"-2A","#));
        // Minus nothing is nothing.
        assert!(bases("-0", From::Told, 10).contains(r#""negative":false,"decimal":"0""#));
    }

    #[test]
    fn what_is_no_number_is_told_with_its_line() {
        assert_eq!(problem(through(&mut stage(Style::Minify, From::Told, 10), b"12\n1.5\n", 5)), ("not-a-number", 2, 1));
        assert_eq!(problem(through(&mut stage(Style::Minify, From::Base(2), 10), b"102", 5)), ("not-a-number", 1, 1));
        assert_eq!(problem(through(&mut stage(Style::Minify, From::Told, 10), b"0x", 5)), ("not-a-number", 1, 1));
        assert_eq!(problem(through(&mut stage(Style::Minify, From::Base(10), 10), b"ff", 5)), ("not-a-number", 1, 1));
    }
}
