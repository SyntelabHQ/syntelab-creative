//! The converters and their units, read from the data files in `data/`.
//!
//! A converter is data, not code: its units, each with how it becomes the
//! base unit of the converter. One engine (`convert.rs`) serves them all, so
//! a new converter is a new file here and a line in `FILES`.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use serde::{Deserialize, Serialize};

use crate::convert::{self, Rule};
use crate::formula;
use crate::number::{self, Number};
use crate::numeral::{self, Numeral};
use crate::rates::Rates;

/// The data files, in the order the converters are listed: by category, as the menus show them. Built into the program.
const FILES: &[&str] = &[
    include_str!("../data/length.json"),
    include_str!("../data/weight.json"),
    include_str!("../data/temperature.json"),
    include_str!("../data/volume.json"),
    include_str!("../data/area.json"),
    include_str!("../data/time.json"),
    include_str!("../data/currency.json"),
    include_str!("../data/speed.json"),
    include_str!("../data/fuel-economy.json"),
    include_str!("../data/acceleration.json"),
    include_str!("../data/force.json"),
    include_str!("../data/torque.json"),
    include_str!("../data/pressure.json"),
    include_str!("../data/energy.json"),
    include_str!("../data/power.json"),
    include_str!("../data/electric-charge.json"),
    include_str!("../data/voltage.json"),
    include_str!("../data/electric-current.json"),
    include_str!("../data/resistance.json"),
    include_str!("../data/density.json"),
    include_str!("../data/frequency.json"),
    include_str!("../data/angle.json"),
    include_str!("../data/concentration.json"),
    include_str!("../data/prefixes.json"),
    include_str!("../data/light.json"),
    include_str!("../data/flow.json"),
    include_str!("../data/data-storage.json"),
    include_str!("../data/data-transfer.json"),
    include_str!("../data/image-resolution.json"),
    include_str!("../data/typography.json"),
    include_str!("../data/sound.json"),
    include_str!("../data/number-base.json"),
    include_str!("../data/heat-transfer.json"),
    include_str!("../data/viscosity.json"),
    include_str!("../data/surface-tension.json"),
    include_str!("../data/permeability.json"),
    include_str!("../data/magnetic-field.json"),
    include_str!("../data/radiation.json"),
];

/// A group of units inside a converter (SI, imperial, historical…): what the units panel filters by.
#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Group {
    pub id: String,
    /// The colour its units are marked with, as `#rrggbb`.
    pub color: String,
}

/// A unit as its file writes it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UnitData {
    id: String,
    symbol: String,
    group: String,
    /// How it becomes the base unit: one of `factor` (with `offset`), `inverse`, `formula` and `numeral`.
    /// How many base units one of it is: `0.0254`, `5/9`, `1.616255e-35`.
    #[serde(default)]
    factor: Option<String>,
    /// What is added after multiplying, for a scale that does not start where the base does (Celsius).
    #[serde(default)]
    offset: Option<String>,
    /// `base = factor ÷ (value × scale + offset)`.
    #[serde(default)]
    inverse: Option<InverseData>,
    /// A rule that needs more than arithmetic, by its name.
    #[serde(default)]
    formula: Option<FormulaData>,
    /// A way of writing a whole number.
    #[serde(default)]
    numeral: Option<NumeralData>,
    /// A currency: what it is worth is read from a service, under this name.
    #[serde(default)]
    rate: Option<RateData>,
    /// It measures a difference between two values, not a value on a scale (a difference of temperature).
    #[serde(default)]
    interval: bool,
    #[serde(default)]
    popular: bool,
    /// Decimals a value in this unit is written with, when the unit has its own.
    #[serde(default)]
    decimals: Option<usize>,
    /// Its value is measured, not defined: the last digits may change when it is measured again.
    #[serde(default)]
    measured: bool,
    /// Other things it is called and written as, for the search. Names in the languages of the program are in the translations.
    #[serde(default)]
    aliases: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
enum RateData {
    /// The code of a currency of a country: `EUR`.
    Fiat(String),
    /// The name the service of cryptocurrencies gives a coin: `bitcoin`.
    Coin(String),
}

/// The name a currency is known by to the service its rate is read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RateOf {
    /// A currency of a country, by its code: how many of it one US dollar is.
    Fiat(String),
    /// A cryptocurrency, by the name of its coin: its price in US dollars.
    Coin(String),
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
struct InverseData {
    factor: String,
    #[serde(default)]
    scale: Option<String>,
    #[serde(default)]
    offset: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum FormulaData {
    /// `base = offset + multiplier × log(value × scale)`, in logarithms of `base`.
    Log {
        multiplier: String,
        base: u32,
        scale: String,
        #[serde(default)]
        offset: Option<String>,
    },
    /// A slope in percent, against its angle in degrees.
    Grade,
    /// `base = (a × value − b ÷ value) × scale`.
    Efflux { a: String, b: String, scale: String },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum NumeralData {
    Radix { radix: u32 },
    Sexagesimal,
    Roman,
    Bcd,
    Gray,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ConverterData {
    id: String,
    category: String,
    icon: String,
    base: String,
    /// The units a table of this converter starts with, and the smart converter shows.
    starts_with: Vec<String>,
    /// Decimals a value in a unit of this converter is written with, when the unit has none of its own.
    #[serde(default)]
    decimals: Option<usize>,
    groups: Vec<Group>,
    units: Vec<UnitData>,
}

/// A unit, ready to convert with.
#[derive(Debug, Clone)]
pub struct Unit {
    pub id: String,
    pub symbol: String,
    pub group: String,
    /// How it becomes the base unit of its converter.
    pub rule: Rule,
    pub popular: bool,
    pub decimals: Option<usize>,
    pub measured: bool,
    pub aliases: Vec<String>,
    /// The name the user gave it, for a unit of the user's own. The others are named by the translations.
    pub name: Option<String>,
    /// For a currency: the name its rate is read under.
    pub rate: Option<RateOf>,
    /// It measures a difference between two values, not a value on a scale: a difference of 100 °C is one of 180 °F,
    /// while 100 °C is 212 °F. The two kinds do not convert into each other.
    pub interval: bool,
}

impl Unit {
    /// The way it writes whole numbers, when it is one: its values are text, not numbers with decimals.
    pub fn numeral(&self) -> Option<Numeral> {
        match self.rule {
            Rule::Numeral(numeral) => Some(numeral),
            _ => None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Converter {
    pub id: String,
    /// One of the six categories the converters are listed under.
    pub category: String,
    /// Name of a file in `assets/icons/`, without the extension.
    pub icon: String,
    pub base: String,
    pub starts_with: Vec<String>,
    pub groups: Vec<Group>,
    pub units: Vec<Unit>,
    by_id: HashMap<String, usize>,
}

impl Converter {
    pub fn unit(&self, id: &str) -> Option<&Unit> {
        self.by_id.get(id).map(|at| &self.units[*at])
    }
}

/// Why a data file is refused. A file that is wrong stops the tests, never a user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataError(pub String);

fn converter(data: ConverterData) -> Result<Converter, DataError> {
    let wrong = |what: String| DataError(format!("{}: {what}", data.id));
    let mut units = Vec::with_capacity(data.units.len());
    let mut by_id = HashMap::new();
    for unit in &data.units {
        let number = |written: &str, what: &str| number::exact(written).ok_or_else(|| wrong(format!("the {what} of {} is not a number", unit.id)));
        let or_zero = |written: &Option<String>, what: &str| written.as_deref().map_or(Ok(Number::from_integer(0.into())), |written| number(written, what));
        let double = |written: &str, what: &str| written.parse::<f64>().ok().filter(|value| value.is_finite() && *value != 0.0).ok_or_else(|| wrong(format!("the {what} of {} is not a number or is zero", unit.id)));
        let not_zero = |value: Number, what: &str| if value == Number::from_integer(0.into()) { Err(wrong(format!("the {what} of {} is zero", unit.id))) } else { Ok(value) };
        let rate = unit.rate.as_ref().map(|rate| match rate {
            RateData::Fiat(code) => RateOf::Fiat(code.clone()),
            RateData::Coin(coin) => RateOf::Coin(coin.clone()),
        });
        let rule = match (&unit.factor, &unit.inverse, &unit.formula, &unit.numeral) {
            // A currency has no rule of its own: its rate comes later. The base is one of itself whatever the rates.
            (None, None, None, None) if rate.is_some() => {
                if unit.id == data.base {
                    Rule::Linear { factor: Number::from_integer(1.into()), offset: Number::from_integer(0.into()) }
                } else {
                    Rule::NoRate
                }
            }
            (Some(factor), None, None, None) => Rule::Linear { factor: not_zero(number(factor, "factor")?, "factor")?, offset: or_zero(&unit.offset, "offset")? },
            (None, Some(inverse), None, None) => Rule::Inverse {
                factor: not_zero(number(&inverse.factor, "factor")?, "factor")?,
                scale: not_zero(inverse.scale.as_deref().map_or(Ok(Number::from_integer(1.into())), |scale| number(scale, "scale"))?, "scale")?,
                offset: or_zero(&inverse.offset, "offset")?,
            },
            (None, None, Some(FormulaData::Log { multiplier, base, scale, offset }), None) if *base >= 2 => {
                Rule::Log { multiplier: double(multiplier, "multiplier")?, base: f64::from(*base), scale: double(scale, "scale")?, offset: offset.as_deref().map_or(Ok(0.0), |offset| double(offset, "offset"))? }
            }
            (None, None, Some(FormulaData::Grade), None) => Rule::Grade,
            (None, None, Some(FormulaData::Efflux { a, b, scale }), None) => Rule::Efflux { a: double(a, "a")?, b: double(b, "b")?, scale: double(scale, "scale")? },
            (None, None, None, Some(numeral)) => Rule::Numeral(match numeral {
                NumeralData::Radix { radix } if (2..=numeral::LARGEST_RADIX).contains(radix) => Numeral::Radix(*radix),
                NumeralData::Radix { .. } => return Err(wrong(format!("the base of {} is out of reach", unit.id))),
                NumeralData::Sexagesimal => Numeral::Sexagesimal,
                NumeralData::Roman => Numeral::Roman,
                NumeralData::Bcd => Numeral::Bcd,
                NumeralData::Gray => Numeral::Gray,
            }),
            _ => return Err(wrong(format!("{} must say how it becomes the base in one way", unit.id))),
        };
        if unit.offset.is_some() && unit.factor.is_none() {
            return Err(wrong(format!("{} has an offset and no factor", unit.id)));
        }
        if !data.groups.iter().any(|group| group.id == unit.group) {
            return Err(wrong(format!("{} is in a group that is not listed: {}", unit.id, unit.group)));
        }
        if by_id.insert(unit.id.clone(), units.len()).is_some() {
            return Err(wrong(format!("{} is there twice", unit.id)));
        }
        units.push(Unit { id: unit.id.clone(), symbol: unit.symbol.clone(), group: unit.group.clone(), rule, popular: unit.popular, decimals: unit.decimals.or(data.decimals), measured: unit.measured, aliases: unit.aliases.clone(), name: None, rate, interval: unit.interval });
    }
    for id in data.starts_with.iter().chain([&data.base]) {
        if !by_id.contains_key(id) {
            return Err(wrong(format!("{id} is named but is not a unit")));
        }
    }
    Ok(Converter { id: data.id.clone(), category: data.category.clone(), icon: data.icon.clone(), base: data.base.clone(), starts_with: data.starts_with.clone(), groups: data.groups.clone(), units, by_id })
}

/// Reads one data file.
pub fn read(file: &str) -> Result<Converter, DataError> {
    let data: ConverterData = serde_json::from_str(file).map_err(|error| DataError(error.to_string()))?;
    converter(data)
}

/// Every converter the program has, read once.
pub fn converters() -> &'static [Arc<Converter>] {
    static ALL: OnceLock<Vec<Arc<Converter>>> = OnceLock::new();
    // The files are built in and tested: one that cannot be read is left out rather than stopping the program.
    ALL.get_or_init(|| FILES.iter().filter_map(|file| read(file).ok()).map(Arc::new).collect())
}

pub fn by_id(id: &str) -> Option<&'static Arc<Converter>> {
    converters().iter().find(|known| known.id == id)
}

/// The group the user's own units are listed under, and its colour.
pub const OWN_GROUP: &str = "custom";
const OWN_COLOR: &str = "#64748b";
/// The most units of the user's own a converter takes.
pub const MOST_OWN: usize = 500;
const LONGEST_NAME: usize = 80;

/// A unit of the user's own, as the interface keeps and sends it. It is said by another unit of its converter:
/// with a factor (and an offset where its scale starts elsewhere), or with a formula each way.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnUnit {
    pub id: String,
    pub name: String,
    pub symbol: String,
    /// The unit it is said by: one of the converter, or one of the user's own listed before it.
    pub reference: String,
    /// `reference = value × factor + offset`.
    #[serde(default)]
    pub factor: Option<String>,
    #[serde(default)]
    pub offset: Option<String>,
    /// `reference = to_reference(x)`, with `from_reference` its way back.
    #[serde(default)]
    pub to_reference: Option<String>,
    #[serde(default)]
    pub from_reference: Option<String>,
    #[serde(default)]
    pub decimals: Option<usize>,
}

/// Why a unit of the user's own is refused: the unit, a stable word for the interface to translate, and where in a formula.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnError {
    pub unit: String,
    pub what: &'static str,
    pub at: Option<usize>,
}

/// The rule of a unit of the user's own, from what it says of its reference.
fn own_rule(own: &OwnUnit, reference: &Rule) -> Result<Rule, OwnError> {
    let wrong = |what: &'static str, at: Option<usize>| OwnError { unit: own.id.clone(), what, at };
    let zero = || Number::from_integer(0.into());
    match (&own.factor, &own.to_reference, &own.from_reference) {
        (Some(factor), None, None) => {
            let factor = number::exact(factor).filter(|factor| *factor != zero()).ok_or_else(|| wrong("factor", None))?;
            let offset = match &own.offset {
                Some(offset) => number::exact(offset).ok_or_else(|| wrong("offset", None))?,
                None => zero(),
            };
            Ok(match reference {
                // A factor of a factor is a factor: the unit stays exact, and as quick as any other.
                Rule::Linear { factor: of_factor, offset: of_offset } => Rule::Linear { factor: &factor * of_factor, offset: &offset * of_factor + of_offset },
                other => Rule::Scaled { factor, offset, of: Box::new(other.clone()) },
            })
        }
        (None, Some(to), Some(from)) => {
            let to = formula::read(to).map_err(|error| wrong(error.what, Some(error.at)))?;
            let from = formula::read(from).map_err(|error| OwnError { unit: own.id.clone(), what: match error.what { "empty" => "no-way-back", other => other }, at: Some(error.at) })?;
            if !to.uses_x() || !from.uses_x() {
                return Err(wrong("no-x", None));
            }
            Ok(Rule::Formula { to, from, of: Box::new(reference.clone()) })
        }
        (None, Some(_), None) => Err(wrong("no-way-back", None)),
        _ => Err(wrong("one-way", None)),
    }
}

/// A converter with the user's own units after its own, under a group of their own.
pub fn with_own(converter: &Converter, own: &[OwnUnit]) -> Result<Converter, OwnError> {
    let mut built = converter.clone();
    if own.is_empty() {
        return Ok(built);
    }
    if own.len() > MOST_OWN {
        return Err(OwnError { unit: String::new(), what: "too-many", at: None });
    }
    built.groups.push(Group { id: OWN_GROUP.to_owned(), color: OWN_COLOR.to_owned() });
    for unit in own {
        let wrong = |what: &'static str| OwnError { unit: unit.id.clone(), what, at: None };
        let (id, name, symbol) = (unit.id.trim(), unit.name.trim(), unit.symbol.trim());
        if id.is_empty() || built.by_id.contains_key(id) {
            return Err(wrong("id"));
        }
        if name.is_empty() || name.chars().count() > LONGEST_NAME {
            return Err(wrong("name"));
        }
        if symbol.is_empty() || symbol.chars().count() > LONGEST_NAME {
            return Err(wrong("symbol"));
        }
        let reference = built.unit(&unit.reference).ok_or_else(|| wrong("reference"))?;
        if reference.numeral().is_some() {
            return Err(wrong("reference"));
        }
        let rule = own_rule(unit, &reference.rule)?;
        let reference_decimals = reference.decimals;
        // A unit said by a difference is a difference.
        let reference_interval = reference.interval;
        built.by_id.insert(id.to_owned(), built.units.len());
        built.units.push(Unit { id: id.to_owned(), symbol: symbol.to_owned(), group: OWN_GROUP.to_owned(), rule, popular: false, decimals: unit.decimals.map(|decimals| decimals.min(crate::precision::MOST_DECIMALS)).or(reference_decimals), measured: false, aliases: Vec::new(), name: Some(name.to_owned()), rate: None, interval: reference_interval });
    }
    Ok(built)
}

/// A converter of currencies with what each is worth today, against its base (the US dollar).
/// A currency the rates do not name keeps no rate, and has no value in the others.
pub fn with_rates(converter: &Converter, rates: &Rates) -> Converter {
    let mut built = converter.clone();
    let zero = Number::from_integer(0.into());
    for unit in &mut built.units {
        if unit.id == built.base {
            continue;
        }
        // One of a country's currency is 1/rate dollars; one coin is its price in dollars.
        let factor = match &unit.rate {
            Some(RateOf::Fiat(code)) => rates.fiat.as_ref().and_then(|read| read.rates.get(code)).map(|rate| Number::from_integer(1.into()) / rate),
            Some(RateOf::Coin(coin)) => rates.coins.as_ref().and_then(|read| read.rates.get(coin)).cloned(),
            None => continue,
        };
        unit.rule = match factor {
            Some(factor) => Rule::Linear { factor, offset: zero.clone() },
            None => Rule::NoRate,
        };
    }
    built
}

/// The coins whose prices a converter needs, by the names the service gives them.
pub fn coins_of(converter: &Converter) -> Vec<&str> {
    converter.units.iter().filter_map(|unit| match &unit.rate {
        Some(RateOf::Coin(coin)) => Some(coin.as_str()),
        _ => None,
    }).collect()
}

/// Whether the two formulas of a unit undo each other: tried on a few values, there and back.
/// None when the unit has no formulas, or no value comes of any of them.
pub fn undoes_itself(converter: &Converter, id: &str) -> Option<bool> {
    let unit = converter.unit(id)?;
    let Rule::Formula { to, from, .. } = &unit.rule else { return None };
    let mut tried = 0;
    for value in [1.0, 2.0, 10.0, 37.5, 100.0, 0.5, 1000.0] {
        let Some(back) = to.value(value).and_then(|there| from.value(there)) else { continue };
        tried += 1;
        if (back - value).abs() > value.abs() * 1e-6 {
            return Some(false);
        }
    }
    (tried > 0).then_some(true)
}

/// One of a unit, written in the unit it is said by: what the interface shows while the unit is made.
pub fn one_in_base(converter: &Converter, id: &str) -> Option<Number> {
    let unit = converter.unit(id)?;
    convert::to_base(&Number::from_integer(1.into()), unit)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_data_file_is_right() {
        for file in FILES {
            let read = read(file).expect("a data file that can be read");
            assert!(!read.units.is_empty(), "{}", read.id);
            // The base unit is one of itself, starting where it starts.
            let base = read.unit(&read.base).expect("a base unit");
            let one = number::exact("1").expect("one");
            assert!(matches!(&base.rule, Rule::Numeral(_)) || crate::convert::to_base(&one, base) == Some(one.clone()), "{}", read.id);
            // Symbols and ids are not empty; decimals are within what can be asked for.
            for unit in &read.units {
                assert!(!unit.id.is_empty() && !unit.symbol.is_empty(), "{}", read.id);
                assert!(unit.decimals.is_none_or(|decimals| decimals <= crate::precision::MOST_DECIMALS), "{}", unit.id);
            }
        }
        assert_eq!(converters().len(), FILES.len());
    }

    fn own(id: &str, reference: &str) -> OwnUnit {
        OwnUnit { id: id.to_owned(), name: format!("my {id}"), symbol: id.to_owned(), reference: reference.to_owned(), factor: None, offset: None, to_reference: None, from_reference: None, decimals: None }
    }

    fn converted(converter: &Converter, value: &str, from: &str, to: &str, decimals: usize) -> String {
        let (from, to) = (converter.unit(from).expect("a unit"), converter.unit(to).expect("a unit"));
        convert::convert(&number::exact(value).expect("a number"), from, to).map_or_else(|| "-".to_owned(), |value| number::to_decimals(&value, decimals))
    }

    #[test]
    fn takes_units_of_the_users_own() {
        let length = by_id("length").expect("a converter");
        // One pace is 0.75 m; a stride is two paces: said by a unit of the user's own.
        let built = with_own(length, &[OwnUnit { factor: Some("0.75".into()), ..own("pace", "m") }, OwnUnit { factor: Some("2".into()), ..own("stride", "pace") }]).expect("built");
        assert_eq!(built.units.len(), length.units.len() + 2);
        assert_eq!(built.groups.last().map(|group| group.id.as_str()), Some(OWN_GROUP));
        assert_eq!(converted(&built, "4", "pace", "m", 2), "3.00");
        assert_eq!(converted(&built, "3", "m", "stride", 2), "2.00");
        assert_eq!(built.unit("pace").and_then(|unit| unit.name.clone()).as_deref(), Some("my pace"));
        // With an offset, and with formulas; said by a unit that is itself not a plain factor.
        let temperature = by_id("temperature").expect("a converter");
        let built = with_own(temperature, &[OwnUnit { factor: Some("2".into()), offset: Some("10".into()), ..own("double", "C") }, OwnUnit { to_reference: Some("(x - 32) * 5 / 9".into()), from_reference: Some("x * 9 / 5 + 32".into()), ..own("mine", "C") }]).expect("built");
        assert_eq!(converted(&built, "45", "double", "C", 2), "100.00");
        assert_eq!(converted(&built, "100", "C", "double", 2), "45.00");
        assert_eq!(converted(&built, "212", "mine", "K", 2), "373.15");
        assert_eq!(converted(&built, "0", "C", "mine", 2), "32.00");
        assert_eq!((undoes_itself(&built, "mine"), undoes_itself(&built, "double")), (Some(true), None));
        let fuel = by_id("fuel-economy").expect("a converter");
        let built = with_own(fuel, &[OwnUnit { factor: Some("2".into()), ..own("half", "mpg-us") }]).expect("built");
        assert_eq!(converted(&built, "10", "half", "mpg-us", 2), "20.00");
        assert_eq!(converted(&built, "20", "mpg-us", "half", 2), "10.00");
    }

    #[test]
    fn gives_currencies_what_they_are_worth() {
        let currency = by_id("currency").expect("a converter");
        // Without rates only the base has a value.
        assert_eq!(converted(currency, "1", "usd", "usd", 2), "1.00");
        assert_eq!(converted(currency, "1", "usd", "eur", 2), "-");
        let rates = Rates { fiat: crate::rates::read_fiat(r#"{"result":"success","time_last_update_unix":1,"time_next_update_unix":2,"rates":{"USD":1,"EUR":0.8,"RON":4}}"#), coins: crate::rates::read_coins(r#"{"bitcoin":{"usd":50000}}"#, 1) };
        let built = with_rates(currency, &rates);
        assert_eq!(converted(&built, "100", "usd", "eur", 2), "80.00");
        assert_eq!(converted(&built, "100", "eur", "ron", 2), "500.00");
        assert_eq!(converted(&built, "2", "btc", "eur", 2), "80000.00");
        assert_eq!(converted(&built, "25000", "usd", "btc", 4), "0.5000");
        // A currency the rates do not name has no value.
        assert_eq!(converted(&built, "1", "usd", "jpy", 2), "-");
        assert!(coins_of(currency).contains(&"bitcoin") && coins_of(currency).len() > 50);
        assert_eq!(currency.units.len(), 171);
    }

    #[test]
    fn refuses_units_of_the_users_own_that_are_wrong() {
        let length = by_id("length").expect("a converter");
        let refused = |unit: OwnUnit| with_own(length, &[unit]).map(|_| ()).map_err(|error| (error.what, error.at));
        assert_eq!(refused(OwnUnit { factor: Some("1".into()), ..own("m", "m") }), Err(("id", None)), "an id that is taken");
        assert_eq!(refused(OwnUnit { factor: Some("1".into()), ..own("a", "nothing") }), Err(("reference", None)));
        assert_eq!(refused(OwnUnit { factor: Some("0".into()), ..own("a", "m") }), Err(("factor", None)));
        assert_eq!(refused(OwnUnit { factor: Some("1".into()), offset: Some("x".into()), ..own("a", "m") }), Err(("offset", None)));
        assert_eq!(refused(own("a", "m")), Err(("one-way", None)));
        assert_eq!(refused(OwnUnit { to_reference: Some("x * 2".into()), ..own("a", "m") }), Err(("no-way-back", None)));
        assert_eq!(refused(OwnUnit { to_reference: Some("x * ".into()), from_reference: Some("x / 2".into()), ..own("a", "m") }), Err(("expected", Some(4))));
        assert_eq!(refused(OwnUnit { to_reference: Some("2".into()), from_reference: Some("x".into()), ..own("a", "m") }), Err(("no-x", None)));
        assert_eq!(refused(OwnUnit { to_reference: Some("system(x)".into()), from_reference: Some("x".into()), ..own("a", "m") }), Err(("name", Some(0))));
        let built = with_own(length, &[OwnUnit { to_reference: Some("x * 2".into()), from_reference: Some("x / 3".into()), ..own("a", "m") }]).expect("built");
        assert_eq!(undoes_itself(&built, "a"), Some(false));
    }

    #[test]
    fn refuses_a_file_that_is_wrong() {
        let file = |units: &str| format!(r##"{{"id":"x","category":"essentials","icon":"ruler","base":"a","startsWith":["a"],"groups":[{{"id":"g","color":"#000000"}}],"units":[{units}]}}"##);
        let unit = |id: &str, factor: &str, group: &str| format!(r#"{{"id":"{id}","symbol":"{id}","group":"{group}","factor":"{factor}"}}"#);
        assert!(read(&file(&unit("a", "1", "g"))).is_ok());
        assert!(read(&file(&unit("a", "0", "g"))).is_err(), "a factor of zero");
        assert!(read(&file(&unit("a", "one", "g"))).is_err(), "a factor that is not a number");
        assert!(read(&file(&unit("a", "1", "other"))).is_err(), "a group that is not listed");
        assert!(read(&file(&format!("{},{}", unit("a", "1", "g"), unit("a", "2", "g")))).is_err(), "a unit twice");
        assert!(read(&file(&unit("b", "1", "g"))).is_err(), "a base that is not a unit");
    }
}
