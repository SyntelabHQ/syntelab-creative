//! How a result is written: how many digits, and in which way.
//!
//! The precision belongs to the unit a value arrives in, not to how many
//! digits were typed: 5 cm is 1.97 in, although 5 has one digit. A unit has
//! its decimals (centimetres one, inches two); the user can change them, for
//! a unit in the settings and for one column of a table. Under that stands a
//! floor: a result that is not zero always shows a few digits that say
//! something, so 1 cm is 0.00001 km and never 0.000 km.

use num_traits::Zero;
use serde::Deserialize;

use crate::catalog::Unit;
use crate::number::{self, Number};
use crate::numeral;

/// The decimals of a unit that says nothing of its own.
pub const USUAL_DECIMALS: usize = 2;
/// The most decimals a unit, a setting or a column can ask for.
pub const MOST_DECIMALS: usize = 30;
/// The digits that say something a result always shows, when it is not zero.
pub const LEAST_SIGNIFICANT: usize = 3;
/// A value is extreme from this many digits before the point…
const EXTREME_ABOVE: i64 = 15;
/// …or from this many zeros after it before the first digit that says something.
const EXTREME_BELOW: i64 = -10;
/// The digits an extreme value shows when it is written with a power of ten.
const SCIENTIFIC_DIGITS: usize = 6;
/// In full, a value that never ends is cut after this many decimals.
const MOST_WRITTEN: usize = 400;

/// What a cell says when its unit has no such value: a pressure of sound of zero has no decibels.
pub const NO_VALUE: &str = "—";

/// How values too large or too small to read at a glance are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Extremes {
    /// With a power of ten: 1.616e-35.
    #[default]
    Scientific,
    /// In full, with every zero.
    Full,
}

/// Writes a result with `decimals` after the point, never fewer digits than say something.
///
/// The text uses a point before the decimals and nothing between thousands:
/// the interface writes it as the language of the program does.
pub fn written(value: &Number, decimals: usize, extremes: Extremes) -> String {
    let decimals = decimals.min(MOST_DECIMALS);
    let Some(power) = number::magnitude(value) else {
        return number::to_decimals(&Number::zero(), decimals);
    };
    if extremes == Extremes::Scientific && (power >= EXTREME_ABOVE || power <= EXTREME_BELOW) {
        return number::scientific(value, SCIENTIFIC_DIGITS);
    }
    // The digits that say something at the decimals asked for: 0.00001234 with three decimals shows none.
    let shown = decimals as i64 + power + 1;
    if shown >= LEAST_SIGNIFICANT as i64 {
        return number::to_decimals(value, decimals);
    }
    // More decimals, as many as show the least digits; then the zeros at the end that were not asked for go.
    let needed = ((LEAST_SIGNIFICANT as i64 - power - 1).max(decimals as i64) as usize).min(MOST_WRITTEN);
    number::without_trailing_zeros(&number::to_decimals(value, needed), decimals)
}

/// Writes a value in the unit it arrived in: with decimals, or as the unit writes whole numbers (base 16, Roman numerals).
/// A unit that has no such value says so with a dash.
pub fn written_in(value: Option<&Number>, unit: &Unit, decimals: usize, extremes: Extremes) -> String {
    let Some(value) = value else { return NO_VALUE.to_owned() };
    match unit.numeral() {
        Some(kind) => numeral::written(&value.floor().to_integer(), kind).unwrap_or_else(|| NO_VALUE.to_owned()),
        None => written(value, decimals, extremes),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shown(value: &str, decimals: usize, extremes: Extremes) -> String {
        written(&number::exact(value).expect("a number"), decimals, extremes)
    }

    #[test]
    fn writes_the_decimals_of_the_unit() {
        assert_eq!(shown("1.9685", 2, Extremes::Scientific), "1.97");
        assert_eq!(shown("12.7", 1, Extremes::Scientific), "12.7");
        assert_eq!(shown("5", 2, Extremes::Scientific), "5.00");
        assert_eq!(shown("1234.5678", 0, Extremes::Scientific), "1235");
        assert_eq!(shown("0", 2, Extremes::Scientific), "0.00");
        assert_eq!(shown("-40", 1, Extremes::Scientific), "-40.0");
    }

    #[test]
    fn never_writes_a_value_as_nothing() {
        // 1 cm in km, with the three decimals of a kilometre.
        assert_eq!(shown("0.00001", 3, Extremes::Scientific), "0.00001");
        assert_eq!(shown("0.00001234", 3, Extremes::Scientific), "0.0000123");
        assert_eq!(shown("0.0004567", 2, Extremes::Scientific), "0.000457");
        // Enough is shown already: nothing is added.
        assert_eq!(shown("0.25", 2, Extremes::Scientific), "0.25");
        assert_eq!(shown("0.05", 2, Extremes::Scientific), "0.05");
        assert_eq!(shown("0.051", 2, Extremes::Scientific), "0.051");
        assert_eq!(shown("0.0512", 0, Extremes::Scientific), "0.0512");
    }

    #[test]
    fn writes_extremes_as_asked() {
        assert_eq!(shown("1.616255e-35", 2, Extremes::Scientific), "1.61626e-35");
        assert_eq!(shown("1e-35", 2, Extremes::Full), format!("0.{}1", "0".repeat(34)));
        assert_eq!(shown("9.4607304725808e15", 2, Extremes::Scientific), "9.46073e15");
        assert_eq!(shown("9.4607304725808e15", 2, Extremes::Full), "9460730472580800.00");
        // Not extreme yet.
        assert_eq!(shown("123456789012345", 0, Extremes::Scientific), "123456789012345");
        assert_eq!(shown("0.000000001", 2, Extremes::Scientific), "0.000000001");
    }
}
