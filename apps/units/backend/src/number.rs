//! Exact numbers.
//!
//! A value and the factors of the units are fractions of whole numbers of any
//! size, so a conversion is exact: nothing is rounded until the result is
//! written, and it is written from the exact value. A value "in full" then
//! shows true digits, however many they are.

use num_bigint::BigInt;
use num_integer::Integer;
use num_rational::BigRational;
use num_traits::{One, Signed, Zero};

pub type Number = BigRational;

/// The most a power of ten is taken to when a number is read: beyond it, it is not a number anybody means.
const LARGEST_EXPONENT: i64 = 5000;

fn ten_to(power: u32) -> BigInt {
    num_traits::pow(BigInt::from(10), power as usize)
}

/// A number as it is written in the data of the units, exactly: `0.0254`, `5/9`, `-2/3`, `1.616255e-35`, `1e9`.
pub fn exact(written: &str) -> Option<Number> {
    let written = written.trim();
    if let Some((above, below)) = written.split_once('/') {
        let (above, below) = (exact(above)?, exact(below)?);
        return if below.is_zero() { None } else { Some(above / below) };
    }
    let (mantissa, exponent) = match written.split_once(['e', 'E']) {
        Some((mantissa, exponent)) => (mantissa, exponent.parse::<i64>().ok()?),
        None => (written, 0),
    };
    if exponent.abs() > LARGEST_EXPONENT {
        return None;
    }
    let (negative, digits) = match mantissa.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, mantissa.strip_prefix('+').unwrap_or(mantissa)),
    };
    let (whole, part) = digits.split_once('.').unwrap_or((digits, ""));
    if (whole.is_empty() && part.is_empty()) || !whole.bytes().chain(part.bytes()).all(|digit| digit.is_ascii_digit()) {
        return None;
    }
    let all: BigInt = format!("{whole}{part}").parse().ok()?;
    // The digits after the point, and the power of ten written after them, move the point.
    let shift = exponent - part.len() as i64;
    let value = if shift >= 0 { Number::from_integer(all * ten_to(shift as u32)) } else { Number::new(all, ten_to((-shift) as u32)) };
    Some(if negative { -value } else { value })
}

/// The power of ten of a number's first digit: 2 for 123.4, 0 for 5, -3 for 0.0012. None for zero.
pub fn magnitude(value: &Number) -> Option<i64> {
    if value.is_zero() {
        return None;
    }
    let value = value.abs();
    let (above, below) = (value.numer(), value.denom());
    // Close to the answer from the lengths of the two whole numbers, then settled exactly.
    let mut power = above.to_string().len() as i64 - below.to_string().len() as i64;
    let at_least = |power: i64| if power >= 0 { above >= &(below * ten_to(power as u32)) } else { &(above * ten_to((-power) as u32)) >= below };
    while !at_least(power) {
        power -= 1;
    }
    while at_least(power + 1) {
        power += 1;
    }
    Some(power)
}

/// The number with `decimals` digits after the point, rounded to the nearest (a half goes away from zero).
pub fn to_decimals(value: &Number, decimals: usize) -> String {
    let scaled = (value * Number::from_integer(ten_to(decimals as u32))).round().to_integer();
    let negative = scaled.is_negative();
    let digits = scaled.abs().to_string();
    // At least one digit before the point.
    let digits = if digits.len() <= decimals { format!("{}{digits}", "0".repeat(decimals + 1 - digits.len())) } else { digits };
    let (whole, part) = digits.split_at(digits.len() - decimals);
    let written = if decimals == 0 { whole.to_owned() } else { format!("{whole}.{part}") };
    // What rounds to nothing is written without a sign.
    if negative && !scaled.is_zero() {
        format!("-{written}")
    } else {
        written
    }
}

/// The number as a digit, a point, more digits and a power of ten: `1.616e-35`. `digits` is how many it shows in all.
pub fn scientific(value: &Number, digits: usize) -> String {
    let Some(mut power) = magnitude(value) else {
        return "0".to_owned();
    };
    let digits = digits.max(1);
    let scale = |power: i64| if power >= 0 { value / Number::from_integer(ten_to(power as u32)) } else { value * Number::from_integer(ten_to((-power) as u32)) };
    let mut written = to_decimals(&scale(power), digits - 1);
    // 9.9996 with four digits is 10.00: one more power of ten, and 1.000.
    if written.trim_start_matches('-').split('.').next().is_some_and(|whole| whole.len() > 1) {
        power += 1;
        written = to_decimals(&scale(power), digits - 1);
    }
    format!("{}e{power}", without_trailing_zeros(&written, 0))
}

/// A written number without the zeros at its end that say nothing, keeping at least `least` digits after the point.
pub fn without_trailing_zeros(written: &str, least: usize) -> String {
    let Some((whole, part)) = written.split_once('.') else {
        return written.to_owned();
    };
    let kept = part.trim_end_matches('0').len().max(least).min(part.len());
    if kept == 0 {
        whole.to_owned()
    } else {
        format!("{whole}.{}", &part[..kept])
    }
}

/// Whether the number can be written out in full with a finite number of digits after the point.
pub fn ends(value: &Number) -> bool {
    let mut below = value.denom().clone();
    for factor in [2, 5] {
        let factor = BigInt::from(factor);
        while below.is_multiple_of(&factor) {
            below /= &factor;
        }
    }
    below.is_one()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn number(written: &str) -> Number {
        exact(written).expect("a number")
    }

    #[test]
    fn reads_what_the_data_writes() {
        assert_eq!(number("0.0254"), Number::new(254.into(), 10000.into()));
        assert_eq!(number("5/9"), Number::new(5.into(), 9.into()));
        assert_eq!(number("-2/3"), Number::new((-2).into(), 3.into()));
        assert_eq!(number("1e3"), Number::from_integer(1000.into()));
        assert_eq!(number("1.5e-2"), number("0.015"));
        assert_eq!(number(".5"), number("0.5"));
        assert_eq!(number("0.0254/72"), number("0.0254") / number("72"));
        for wrong in ["", "abc", "1/0", "1.2.3", "e5", "1e99999", "-"] {
            assert_eq!(exact(wrong), None, "{wrong}");
        }
    }

    #[test]
    fn knows_the_power_of_ten_of_the_first_digit() {
        for (written, power) in [("123.4", 2), ("5", 0), ("0.0012", -3), ("1000", 3), ("999.999", 2), ("0.1", -1), ("-0.00001", -5), ("1e-35", -35), ("1e30", 30)] {
            assert_eq!(magnitude(&number(written)), Some(power), "{written}");
        }
        assert_eq!(magnitude(&number("0")), None);
    }

    #[test]
    fn writes_with_the_decimals_asked_for() {
        assert_eq!(to_decimals(&number("1.005"), 2), "1.01");
        assert_eq!(to_decimals(&number("2/3"), 4), "0.6667");
        assert_eq!(to_decimals(&number("-2/3"), 2), "-0.67");
        assert_eq!(to_decimals(&number("1234.5"), 0), "1235");
        assert_eq!(to_decimals(&number("0.004"), 2), "0.00");
        assert_eq!(to_decimals(&number("-0.004"), 2), "0.00");
        assert_eq!(to_decimals(&number("5"), 3), "5.000");
        assert_eq!(to_decimals(&number("1e30"), 0), "1000000000000000000000000000000");
    }

    #[test]
    fn writes_with_a_power_of_ten() {
        assert_eq!(scientific(&number("1.616255e-35"), 4), "1.616e-35");
        assert_eq!(scientific(&number("123456"), 3), "1.23e5");
        assert_eq!(scientific(&number("9.9996"), 4), "1e1");
        assert_eq!(scientific(&number("-0.00052"), 2), "-5.2e-4");
        assert_eq!(scientific(&number("1000"), 4), "1e3");
    }

    #[test]
    fn drops_the_zeros_that_say_nothing() {
        assert_eq!(without_trailing_zeros("1.2300", 0), "1.23");
        assert_eq!(without_trailing_zeros("1.2300", 3), "1.230");
        assert_eq!(without_trailing_zeros("5.000", 0), "5");
        assert_eq!(without_trailing_zeros("5.000", 2), "5.00");
        assert_eq!(without_trailing_zeros("100", 0), "100");
    }

    #[test]
    fn knows_which_numbers_end() {
        assert!(ends(&number("0.0254")));
        assert!(ends(&number("1/8")));
        assert!(!ends(&number("1/3")));
        assert!(!ends(&number("5/9")));
    }
}
