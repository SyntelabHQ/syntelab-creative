//! Converting a value from one unit to another of the same converter.
//!
//! Every unit says how it becomes the base unit of its converter (its
//! `Rule`). A conversion goes to the base and from it. Most rules are exact:
//! a factor, with an offset where a scale does not start where the base does,
//! or a division (fuel for a distance against distance for a fuel). The few
//! that need a logarithm, a tangent or a root are computed in doubles.

use num_traits::{ToPrimitive, Zero};

use crate::catalog::Unit;
use crate::formula::Formula;
use crate::number::{self, Number};
use crate::numeral::Numeral;

/// How a unit becomes the base unit of its converter.
#[derive(Debug, Clone, PartialEq)]
pub enum Rule {
    /// `base = value × factor + offset`.
    Linear { factor: Number, offset: Number },
    /// `base = factor ÷ (value × scale + offset)`: miles per gallon against litres per 100 km, a wavelength against a frequency.
    Inverse { factor: Number, scale: Number, offset: Number },
    /// `base = offset + multiplier × log(value × scale)`, in the base of logarithms named: a pressure of sound against decibels.
    Log { multiplier: f64, base: f64, scale: f64, offset: f64 },
    /// A slope in percent against its angle in degrees: `base = atan(value ÷ 100)`.
    Grade,
    /// Seconds of flow through a viscometer: `base = (a × value − b ÷ value) × scale`.
    Efflux { a: f64, b: f64, scale: f64 },
    /// A way of writing a whole number: the value is the number itself.
    Numeral(Numeral),
    /// A currency whose rate is not known (yet): it has no value in any other.
    NoRate,
    /// A unit said by another unit, which is not a plain factor of the base: `other = value × factor + offset`, then as `of` goes.
    Scaled { factor: Number, offset: Number, of: Box<Rule> },
    /// A unit of the user's own, said by another with a formula each way: `other = to(value)`, `value = from(other)`, then as `of` goes.
    Formula { to: Formula, from: Formula, of: Box<Rule> },
}

fn double(value: &Number) -> Option<f64> {
    value.to_f64().filter(|value| value.is_finite())
}

fn exact(value: f64) -> Option<Number> {
    value.is_finite().then(|| number::exact(&format!("{value:e}"))).flatten()
}

/// A value under `rule`, as the base unit. None where there is no such value (a pressure of sound of zero).
fn up(value: &Number, rule: &Rule) -> Option<Number> {
    match rule {
        Rule::Linear { factor, offset } => Some(value * factor + offset),
        Rule::Inverse { factor, scale, offset } => {
            let below = value * scale + offset;
            (!below.is_zero()).then(|| factor / below)
        }
        Rule::Log { multiplier, base, scale, offset } => {
            let inside = double(value)? * scale;
            (inside > 0.0).then(|| exact(offset + multiplier * inside.log(*base))).flatten()
        }
        Rule::Grade => exact((double(value)? / 100.0).atan().to_degrees()),
        Rule::Efflux { a, b, scale } => {
            let value = double(value)?;
            (value != 0.0).then(|| exact((a * value - b / value) * scale)).flatten()
        }
        Rule::Numeral(_) => Some(value.floor()),
        Rule::NoRate => None,
        Rule::Scaled { factor, offset, of } => up(&(value * factor + offset), of),
        Rule::Formula { to, of, .. } => up(&exact(to.value(double(value)?)?)?, of),
    }
}

/// A value in the base unit, as `rule` has it.
fn down(value: &Number, rule: &Rule) -> Option<Number> {
    match rule {
        Rule::Linear { factor, offset } => Some((value - offset) / factor),
        Rule::Inverse { factor, scale, offset } => (!value.is_zero()).then(|| (factor / value - offset) / scale),
        Rule::Log { multiplier, base, scale, offset } => exact(base.powf((double(value)? - offset) / multiplier) / scale),
        Rule::Grade => {
            let degrees = double(value)?;
            // A slope has an angle under a right angle.
            (degrees.abs() < 90.0).then(|| exact(degrees.to_radians().tan() * 100.0)).flatten()
        }
        Rule::Efflux { a, b, scale } => {
            let flow = double(value)? / scale;
            exact((flow + (flow * flow + 4.0 * a * b).sqrt()) / (2.0 * a))
        }
        Rule::Numeral(_) => Some(value.floor()),
        Rule::NoRate => None,
        Rule::Scaled { factor, offset, of } => Some((down(value, of)? - offset) / factor),
        Rule::Formula { from, of, .. } => exact(from.value(double(&down(value, of)?)?)?),
    }
}

/// A value in `unit`, as the base unit of its converter. None where the unit has no such value.
pub fn to_base(value: &Number, unit: &Unit) -> Option<Number> {
    up(value, &unit.rule)
}

/// A value in the base unit, as `unit`.
pub fn from_base(value: &Number, unit: &Unit) -> Option<Number> {
    down(value, &unit.rule)
}

/// A value in `from`, as `to`. None where it has no value in `to`.
pub fn convert(value: &Number, from: &Unit, to: &Unit) -> Option<Number> {
    if from.id == to.id {
        return Some(value.clone());
    }
    // A value on a scale and a difference between two values are not the same thing: neither is the other.
    if from.interval != to.interval {
        return None;
    }
    from_base(&to_base(value, from)?, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;
    use crate::number::{self, to_decimals};

    /// `value` of `from` written in `to` with `decimals`.
    fn converted(converter: &str, value: &str, from: &str, to: &str, decimals: usize) -> String {
        let known = catalog::by_id(converter).expect("a converter");
        let (from, to) = (known.unit(from).expect("a unit"), known.unit(to).expect("a unit"));
        convert(&number::exact(value).expect("a number"), from, to).map_or_else(|| "-".to_owned(), |value| to_decimals(&value, decimals))
    }

    #[test]
    fn converts_lengths_by_their_definitions() {
        // Defined exactly: the inch is 25.4 mm, the foot 12 inches, the yard 3 feet, the mile 5280 feet.
        assert_eq!(converted("length", "1", "in", "mm", 4), "25.4000");
        assert_eq!(converted("length", "1", "ft", "in", 6), "12.000000");
        assert_eq!(converted("length", "1", "yd", "ft", 6), "3.000000");
        assert_eq!(converted("length", "1", "mi", "ft", 6), "5280.000000");
        assert_eq!(converted("length", "1", "mi", "km", 6), "1.609344");
        assert_eq!(converted("length", "5", "cm", "in", 2), "1.97");
        assert_eq!(converted("length", "1", "m", "ft", 4), "3.2808");
        assert_eq!(converted("length", "100", "km", "mi", 4), "62.1371");
        // The US survey foot is 1200/3937 m.
        assert_eq!(converted("length", "3937", "ft-survey", "m", 6), "1200.000000");
        // The very small and the very large keep every digit.
        assert_eq!(converted("length", "1", "nm", "km", 15), "0.000000000001000");
        assert_eq!(converted("length", "1", "Em", "am", 0), format!("1{}", "0".repeat(36)));
    }

    #[test]
    fn converts_temperatures_by_their_definitions() {
        assert_eq!(converted("temperature", "0", "C", "K", 2), "273.15");
        assert_eq!(converted("temperature", "0", "C", "F", 2), "32.00");
        assert_eq!(converted("temperature", "100", "C", "F", 2), "212.00");
        assert_eq!(converted("temperature", "-40", "C", "F", 2), "-40.00");
        assert_eq!(converted("temperature", "98.6", "F", "C", 2), "37.00");
        assert_eq!(converted("temperature", "0", "K", "C", 2), "-273.15");
        assert_eq!(converted("temperature", "0", "K", "F", 2), "-459.67");
        assert_eq!(converted("temperature", "0", "K", "R", 2), "0.00");
        assert_eq!(converted("temperature", "491.67", "R", "C", 2), "0.00");
        // The old scales, at the freezing and the boiling of water.
        assert_eq!(converted("temperature", "100", "C", "Re", 2), "80.00");
        assert_eq!(converted("temperature", "100", "C", "De", 2), "0.00");
        assert_eq!(converted("temperature", "0", "C", "De", 2), "150.00");
        assert_eq!(converted("temperature", "100", "C", "N", 2), "33.00");
        assert_eq!(converted("temperature", "0", "C", "Ro", 2), "7.50");
        assert_eq!(converted("temperature", "100", "C", "Ro", 2), "60.00");
        // Differences convert among themselves, without the offsets of the scales; and not into temperatures.
        assert_eq!(converted("temperature", "100", "dC", "dF", 1), "180.0");
        assert_eq!(converted("temperature", "180", "dR", "dC", 1), "100.0");
        assert_eq!(converted("temperature", "100", "C", "dC", 1), "-");
        assert_eq!(converted("temperature", "100", "dF", "K", 1), "-");
        // Gas Mark 4 is 350 °F, nearly: the scale is 14 °C a mark from 121 °C.
        assert_eq!(converted("temperature", "4", "GM", "C", 1), "177.0");
        assert_eq!(converted("temperature", "1", "eV", "K", 1), "11604.5");
    }

    #[test]
    fn converts_what_is_divided() {
        // Litres per 100 km against miles per gallon, both ways.
        assert_eq!(converted("fuel-economy", "5", "l-100km", "mpg-us", 3), "47.043");
        assert_eq!(converted("fuel-economy", "47.043", "mpg-us", "l-100km", 3), "5.000");
        assert_eq!(converted("fuel-economy", "0", "mpg-us", "l-100km", 3), "-");
        assert_eq!(converted("fuel-economy", "20", "km-l", "mpg-us", 3), "47.043");
        // A wavelength of one metre is the speed of light in hertz.
        assert_eq!(converted("frequency", "1", "wavelength-m", "hertz", 0), "299792458");
        assert_eq!(converted("frequency", "299792458", "hertz", "wavelength-cm", 3), "100.000");
        assert_eq!(converted("resistance", "4", "ohm", "siemens", 2), "0.25");
        assert_eq!(converted("resistance", "2", "millisiemens", "ohm", 0), "500");
        // Water is 10 °API and 0 °Baumé on the heavy scale.
        assert_eq!(converted("density", "1000", "kg-m3", "degree-api", 3), "10.000");
        assert_eq!(converted("density", "0", "degree-baume-heavy", "kg-m3", 1), "1000.0");
        assert_eq!(converted("density", "10", "degree-brix", "kg-m3", 1), "1050.0");
    }

    #[test]
    fn converts_what_needs_more_than_arithmetic() {
        // 20 µPa is the quietest sound heard: 0 dB. One pascal is about 94 dB.
        assert_eq!(converted("sound", "20", "micropascal", "db-spl", 3), "0.000");
        assert_eq!(converted("sound", "1", "pascal", "db-spl", 2), "93.98");
        assert_eq!(converted("sound", "100", "db-spl", "pascal", 3), "2.000");
        assert_eq!(converted("sound", "0", "pascal", "db-spl", 2), "-");
        assert_eq!(converted("sound", "120", "db-spl", "watt-m2", 3), "1.000");
        assert_eq!(converted("sound", "2", "sone", "db-spl", 1), "50.0");
        // A slope of 100 % is 45°.
        assert_eq!(converted("angle", "100", "percent-grade", "degree", 4), "45.0000");
        assert_eq!(converted("angle", "45", "degree", "percent-grade", 4), "100.0000");
        assert_eq!(converted("angle", "90", "degree", "percent-grade", 4), "-");
        // There and back through the viscometer.
        let known = catalog::by_id("viscosity").expect("a converter");
        let (seconds, base) = (known.unit("saybolt-universal").expect("a unit"), known.unit(&known.base).expect("a base"));
        let there = convert(&number::exact("100").expect("a number"), seconds, base).expect("a value");
        assert_eq!(to_decimals(&convert(&there, base, seconds).expect("a value"), 6), "100.000000");
    }

    #[test]
    fn going_there_and_back_gives_the_value_started_with() {
        for known in catalog::converters() {
            let value = number::exact("123.456").expect("a number");
            let base = known.unit(&known.base).expect("a base unit");
            for unit in &known.units {
                // Exact rules only: what is computed in doubles comes back to within their precision, and is tried above.
                if !matches!(unit.rule, Rule::Linear { .. } | Rule::Inverse { .. } | Rule::Scaled { .. }) {
                    continue;
                }
                if unit.interval != base.interval {
                    continue;
                }
                let Some(there) = convert(&value, base, unit) else { continue };
                assert_eq!(convert(&there, unit, base).as_ref(), Some(&value), "{} of {}", unit.id, known.id);
            }
        }
    }
}
