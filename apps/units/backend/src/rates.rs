//! The rates of the currency converter.
//!
//! Currencies have no fixed factor: what one is worth changes. Their rates
//! are read from two services (through `syntelab-net`, the only code that
//! goes online): the currencies of countries once a day, which is as often
//! as their source changes, and cryptocurrencies when the converter is
//! opened or the user asks. The last rates are handed to the interface to be
//! kept on the computer, and taken back from it when there is no connection.

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::number::{self, Number};

/// The currencies of countries are asked again by hand no sooner than this after they were read (their source asks for an hour at most).
const FIAT_AGAIN_AFTER: u64 = 3600;
/// Cryptocurrencies are read again when the converter is opened and what it has is older than this…
pub const COINS_OLD_AFTER: u64 = 15 * 60;
/// …and by hand no sooner than this.
const COINS_AGAIN_AFTER: u64 = 60;
/// Rates of countries' currencies that say no time for their next change are taken to last a day.
const A_DAY: u64 = 24 * 3600;

/// Rates of one kind: when they were read, and what each currency is worth.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Read {
    /// When the service says they are of, in seconds since 1970.
    pub time: u64,
    /// When the service changes them next; 0 where it does not say.
    pub next: u64,
    /// By the code of a currency (`EUR`): how many of it one US dollar is. By the name of a coin (`bitcoin`): its price in US dollars.
    pub rates: HashMap<String, Number>,
}

/// Everything the currency converter knows of what currencies are worth.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Rates {
    pub fiat: Option<Read>,
    pub coins: Option<Read>,
}

/// A number of a JSON answer, exactly as it is written there.
fn exact(value: &Value) -> Option<Number> {
    let written = match value {
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        _ => return None,
    };
    number::exact(&written).filter(|value| *value > Number::from_integer(0.into()))
}

/// The answer of the service of countries' currencies: `{"result":"success","time_last_update_unix":…,"time_next_update_unix":…,"rates":{"USD":1,"EUR":0.92,…}}`.
pub fn read_fiat(answer: &str) -> Option<Read> {
    let answer: Value = serde_json::from_str(answer).ok()?;
    if answer["result"] != "success" {
        return None;
    }
    let rates: HashMap<String, Number> = answer["rates"].as_object()?.iter().filter_map(|(code, rate)| Some((code.clone(), exact(rate)?))).collect();
    (!rates.is_empty()).then(|| Read { time: answer["time_last_update_unix"].as_u64().unwrap_or(0), next: answer["time_next_update_unix"].as_u64().unwrap_or(0), rates })
}

/// The answer of the service of cryptocurrencies: `{"bitcoin":{"usd":64000.5},…}`. It says no time: `now` is when it was read.
pub fn read_coins(answer: &str, now: u64) -> Option<Read> {
    let answer: Value = serde_json::from_str(answer).ok()?;
    let rates: HashMap<String, Number> = answer.as_object()?.iter().filter_map(|(coin, price)| Some((coin.clone(), exact(&price["usd"])?))).collect();
    (!rates.is_empty()).then_some(Read { time: now, next: 0, rates })
}

impl Read {
    fn kept(&self) -> Value {
        let rates: Map<String, Value> = self.rates.iter().map(|(name, rate)| (name.clone(), Value::String(rate.to_string()))).collect();
        json!({ "time": self.time, "next": self.next, "rates": rates })
    }

    fn from_kept(kept: &Value) -> Option<Self> {
        let rates: HashMap<String, Number> = kept["rates"].as_object()?.iter().filter_map(|(name, rate)| Some((name.clone(), exact(rate)?))).collect();
        (!rates.is_empty()).then(|| Read { time: kept["time"].as_u64().unwrap_or(0), next: kept["next"].as_u64().unwrap_or(0), rates })
    }
}

impl Rates {
    /// What the interface keeps on the computer, to hand back next time.
    pub fn kept(&self) -> Value {
        json!({ "fiat": self.fiat.as_ref().map(Read::kept), "coins": self.coins.as_ref().map(Read::kept) })
    }

    /// Rates as the interface kept them. What is not rates is passed over.
    pub fn from_kept(kept: &Value) -> Self {
        Self { fiat: Read::from_kept(&kept["fiat"]), coins: Read::from_kept(&kept["coins"]) }
    }

    /// Takes from `other` what this has none of, or has older.
    pub fn with(mut self, other: Rates) -> Self {
        let newer = |mine: &Option<Read>, theirs: &Option<Read>| theirs.as_ref().is_some_and(|theirs| mine.as_ref().is_none_or(|mine| theirs.time > mine.time));
        if newer(&self.fiat, &other.fiat) {
            self.fiat = other.fiat;
        }
        if newer(&self.coins, &other.coins) {
            self.coins = other.coins;
        }
        self
    }

    /// Whether the currencies of countries are to be read now: there are none, their source has changed them since, or the user asks and an hour went by.
    pub fn fiat_is_due(&self, now: u64, asked: bool) -> bool {
        match &self.fiat {
            None => true,
            Some(read) => now >= if read.next > 0 { read.next } else { read.time + A_DAY } || (asked && now >= read.time.saturating_add(FIAT_AGAIN_AFTER)),
        }
    }

    /// Whether cryptocurrencies are to be read now: there are none, they are old, or the user asks and a minute went by.
    pub fn coins_are_due(&self, now: u64, asked: bool) -> bool {
        match &self.coins {
            None => true,
            Some(read) => now >= read.time.saturating_add(if asked { COINS_AGAIN_AFTER } else { COINS_OLD_AFTER }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIAT: &str = r#"{"result":"success","time_last_update_unix":1000,"time_next_update_unix":87400,"base_code":"USD","rates":{"USD":1,"EUR":0.8,"JPY":150.25,"BAD":0}}"#;
    const COINS: &str = r#"{"bitcoin":{"usd":64000.5},"shiba-inu":{"usd":1.2e-5},"nothing":{}}"#;

    #[test]
    fn reads_what_the_services_answer() {
        let fiat = read_fiat(FIAT).expect("rates");
        assert_eq!((fiat.time, fiat.next, fiat.rates.len()), (1000, 87400, 3));
        assert_eq!(fiat.rates["EUR"], number::exact("0.8").expect("a number"));
        let coins = read_coins(COINS, 5000).expect("prices");
        assert_eq!((coins.time, coins.rates.len()), (5000, 2));
        assert_eq!(coins.rates["shiba-inu"], number::exact("0.000012").expect("a number"));
        assert!(read_fiat(r#"{"result":"error","error-type":"unsupported-code"}"#).is_none());
        assert!(read_fiat("<html>").is_none() && read_coins("[]", 0).is_none() && read_coins("{}", 0).is_none());
    }

    #[test]
    fn is_kept_and_taken_back_whole() {
        let rates = Rates { fiat: read_fiat(FIAT), coins: read_coins(COINS, 5000) };
        assert_eq!(Rates::from_kept(&rates.kept()), rates);
        assert_eq!(Rates::from_kept(&json!({ "fiat": "nonsense" })), Rates::default());
        // The newer of two is kept, kind by kind.
        let older = Rates { fiat: Some(Read { time: 10, ..rates.fiat.clone().expect("rates") }), coins: None };
        assert_eq!(older.with(rates.clone()), rates);
        assert_eq!(rates.clone().with(Rates { fiat: Some(Read { time: 10, next: 0, rates: HashMap::new() }), coins: None }), rates);
    }

    #[test]
    fn knows_when_to_read_again() {
        let none = Rates::default();
        assert!(none.fiat_is_due(0, false) && none.coins_are_due(0, false));
        let rates = Rates { fiat: read_fiat(FIAT), coins: read_coins(COINS, 5000) };
        // Countries' currencies: when their source changes them; by hand, after an hour.
        assert!(!rates.fiat_is_due(87399, false) && rates.fiat_is_due(87400, false));
        assert!(!rates.fiat_is_due(4599, true) && rates.fiat_is_due(4600, true));
        // Cryptocurrencies: after a quarter of an hour; by hand, after a minute.
        assert!(!rates.coins_are_due(5899, false) && rates.coins_are_due(5900, false));
        assert!(!rates.coins_are_due(5059, true) && rates.coins_are_due(5060, true));
    }
}
