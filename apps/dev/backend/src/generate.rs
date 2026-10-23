//! What is made from nothing given: identifiers (UUID), and passwords and secrets.
//!
//! Each thing made is written on a line as soon as it is made, so as many as are asked for are made, into memory
//! or straight into a file. Everything random comes from the operating system (`getrandom`); nothing made here is
//! kept, logged or written anywhere but where the one who asked said.
//!
//! Identifiers are those of RFC 9562, made by the `uuid` crate: versions 1, 3, 4, 5, 6 and 7, nil and max. A UUID
//! is also taken apart: its version, its variant, and the time and the node it holds when it holds them.

use std::io::Write;

use uuid::{Uuid, Variant};

use crate::codec::{CodecError, Letters, Place, Stage, Wrong};
use crate::json::Style;
use crate::tree::quoted;

/// How a UUID is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Written {
    Hyphens,
    Plain,
    Urn,
    Braces,
}

/// Which UUIDs are made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Kind {
    /// The time and a node that is random (never the address of this computer's network card).
    V1,
    /// The MD5 of a name within a namespace.
    V3(Uuid, String),
    /// Random.
    V4,
    /// The SHA-1 of a name within a namespace.
    V5(Uuid, String),
    /// As version 1, with the time written so that they sort by it.
    V6,
    /// The time in milliseconds, then random: they sort by when they were made, and those of one run are in order.
    V7,
    Nil,
    Max,
}

/// The namespace a name is hashed in: one of the four of the standard, or any UUID.
pub fn namespace(name: &str) -> Option<Uuid> {
    Some(match name {
        "dns" => Uuid::NAMESPACE_DNS,
        "url" => Uuid::NAMESPACE_URL,
        "oid" => Uuid::NAMESPACE_OID,
        "x500" => Uuid::NAMESPACE_X500,
        other => Uuid::parse_str(other.trim()).ok()?,
    })
}

/// Random bytes from the operating system, asked for many at a time.
struct Random {
    pool: Vec<u8>,
    at: usize,
}

impl Random {
    fn new() -> Self {
        Random { pool: Vec::new(), at: 0 }
    }

    fn byte(&mut self) -> Result<u8, CodecError> {
        if self.at >= self.pool.len() {
            self.pool.resize(16 * 1024, 0);
            getrandom::fill(&mut self.pool).map_err(|_| CodecError::Io(std::io::Error::other("the system gave no random bytes")))?;
            self.at = 0;
        }
        self.at += 1;
        Ok(self.pool[self.at - 1])
    }

    /// A number below `below` (at most 256), each as likely as the others: a byte that would favour the low ones is asked for again.
    /// A number below `below`, however large that is, each as likely as the others: four bytes at a time, and those
    /// that would make some numbers likelier are drawn again.
    fn below_any(&mut self, below: usize) -> Result<usize, CodecError> {
        let below = below.max(1) as u64;
        if below > u64::from(u32::MAX) {
            return Err(CodecError::NoMemory);
        }
        let fair = (1u64 << 32) - (1u64 << 32) % below;
        loop {
            let drawn = u64::from(u32::from_be_bytes([self.byte()?, self.byte()?, self.byte()?, self.byte()?]));
            if drawn < fair {
                return Ok((drawn % below) as usize);
            }
        }
    }

    fn below(&mut self, below: usize) -> Result<usize, CodecError> {
        let fair = 256 - 256 % below;
        loop {
            let byte = usize::from(self.byte()?);
            if byte < fair {
                return Ok(byte % below);
            }
        }
    }
}

impl Drop for Random {
    fn drop(&mut self) {
        // What was asked of the system and not used is not left lying in memory.
        self.pool.iter_mut().for_each(|byte| *byte = 0);
    }
}

fn uuid_text(uuid: &Uuid, written: Written, upper: bool) -> String {
    let plain = if written == Written::Plain { uuid.simple().to_string() } else { uuid.hyphenated().to_string() };
    let cased = if upper { plain.to_uppercase() } else { plain };
    match written {
        Written::Hyphens | Written::Plain => cased,
        Written::Urn => format!("urn:uuid:{cased}"),
        Written::Braces => format!("{{{cased}}}"),
    }
}

/// Writes `count` UUIDs, each on a line. `go_on` is told how many are made, and stops the work by answering false.
pub fn uuids(kind: &Kind, written: Written, upper: bool, count: u64, out: &mut dyn Write, go_on: &mut dyn FnMut(u64) -> bool) -> Result<(), CodecError> {
    let mut random = Random::new();
    // The node of versions 1 and 6: random, and marked as no card's address (the lowest bit of its first byte).
    let mut node = [0u8; 6];
    for byte in &mut node {
        *byte = random.byte()?;
    }
    node[0] |= 1;
    for made in 0..count {
        let uuid = match kind {
            Kind::V1 => Uuid::now_v1(&node),
            Kind::V3(space, name) => Uuid::new_v3(space, name.as_bytes()),
            Kind::V4 => {
                let mut bytes = [0u8; 16];
                for byte in &mut bytes {
                    *byte = random.byte()?;
                }
                uuid::Builder::from_random_bytes(bytes).into_uuid()
            }
            Kind::V5(space, name) => Uuid::new_v5(space, name.as_bytes()),
            Kind::V6 => Uuid::now_v6(&node),
            Kind::V7 => Uuid::now_v7(),
            Kind::Nil => Uuid::nil(),
            Kind::Max => Uuid::max(),
        };
        writeln!(out, "{}", uuid_text(&uuid, written, upper))?;
        if made % 4096 == 4095 && !go_on(made + 1) {
            return Err(CodecError::Stopped);
        }
    }
    Ok(())
}

/// A day counted from 1970-01-01 as a year, a month and a day (the calendar in use now, carried back and forth).
fn date(days: i64) -> (i64, u32, u32) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let of_era = shifted.rem_euclid(146_097);
    let year_of_era = (of_era - of_era / 1460 + of_era / 36_524 - of_era / 146_096) / 365;
    let day_of_year = of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 } as u32;
    (year_of_era + era * 400 + i64::from(month <= 2), month, day)
}

/// A moment as ISO 8601 writes it, in universal time, to the millisecond.
pub fn moment(seconds: u64, nanos: u32) -> String {
    let (year, month, day) = date((seconds / 86_400) as i64);
    let of_day = seconds % 86_400;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z", of_day / 3600, of_day % 3600 / 60, of_day % 60, nanos / 1_000_000)
}

/// UUIDs taken apart: each line that holds one becomes an object of a JSON array.
pub struct TakeApart {
    style: Style,
    letters: Letters,
    held: String,
    place: Place,
    found: u64,
}

impl TakeApart {
    pub fn new(style: Style) -> Self {
        TakeApart { style, letters: Letters::default(), held: String::new(), place: Place::default(), found: 0 }
    }

    fn line(&mut self, line: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let here = self.place;
        line.bytes().for_each(|byte| self.place.pass(byte));
        self.place.pass(b'\n');
        let text = line.trim();
        if text.is_empty() {
            return Ok(());
        }
        let uuid = Uuid::parse_str(text).map_err(|_| here.wrong("bad-uuid"))?;
        let version = uuid.get_version_num();
        let variant = match uuid.get_variant() {
            Variant::NCS => "NCS",
            Variant::RFC4122 => "RFC 9562",
            Variant::Microsoft => "Microsoft",
            _ => "reserved",
        };
        let known = uuid.get_variant() == Variant::RFC4122;
        let what = match (uuid.is_nil(), uuid.is_max(), known, version) {
            (true, _, _, _) => "nil",
            (_, true, _, _) => "max",
            (_, _, true, 1) => "time and node",
            (_, _, true, 2) => "DCE security",
            (_, _, true, 3) => "name, MD5",
            (_, _, true, 4) => "random",
            (_, _, true, 5) => "name, SHA-1",
            (_, _, true, 6) => "time and node, sortable",
            (_, _, true, 7) => "Unix time and random",
            (_, _, true, 8) => "custom",
            _ => "unknown",
        };
        let mut members: Vec<(&str, String)> = vec![("uuid", quoted(&uuid.hyphenated().to_string()).into()), ("version", version.to_string()), ("kind", quoted(what).into()), ("variant", quoted(variant).into())];
        if known {
            if let Some(time) = uuid.get_timestamp() {
                let (seconds, nanos) = time.to_unix();
                members.push(("time", quoted(&moment(seconds, nanos)).into()));
                members.push(("unixMilliseconds", (u128::from(seconds) * 1000 + u128::from(nanos / 1_000_000)).to_string()));
            }
            if let Some(node) = uuid.get_node_id() {
                members.push(("node", quoted(&node.iter().map(|byte| format!("{byte:02x}")).collect::<Vec<_>>().join(":")).into()));
            }
        }
        let (spread, step) = match self.style {
            Style::Spaces(spaces) => (true, " ".repeat(usize::from(spaces))),
            Style::Tab => (true, "\t".to_owned()),
            Style::Minify | Style::Check => (false, String::new()),
        };
        out.write_all(if self.found == 0 { b"[" } else { b"," })?;
        self.found += 1;
        if spread {
            write!(out, "\n{step}")?;
        }
        out.write_all(b"{")?;
        for (index, (name, value)) in members.iter().enumerate() {
            if index > 0 {
                out.write_all(b",")?;
            }
            if spread {
                write!(out, "\n{step}{step}\"{name}\": {value}")?;
            } else {
                write!(out, "\"{name}\":{value}")?;
            }
        }
        if spread {
            write!(out, "\n{step}")?;
        }
        out.write_all(b"}")?;
        Ok(())
    }
}

impl Stage for TakeApart {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        self.held.push_str(&text);
        while let Some(end) = self.held.find('\n') {
            let line: String = self.held.drain(..=end).collect();
            self.line(line.trim_end_matches(['\n', '\r']), out)?;
        }
        Ok(())
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        let last = std::mem::take(&mut self.held);
        self.line(last.trim_end_matches('\r'), out)?;
        if self.found == 0 {
            return Err(Wrong::nowhere("empty").into());
        }
        out.write_all(if matches!(self.style, Style::Minify | Style::Check) { b"]" } else { b"\n]" })?;
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        vec![("uuid-read", self.found.to_string())]
    }
}

/// What a secret is made of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Secret {
    /// Letters taken one by one from these, each as likely as the others. `sets`: the kinds of letters asked for
    /// (small, capital, digits, signs): a password holds at least one of each when it is long enough to.
    Password { letters: Vec<char>, sets: Vec<Vec<char>> },
    /// So many random bytes, written in hexadecimal.
    Hex,
    /// The same, in Base64; with `-` and `_` and no filling when it is for an address.
    Base64 { for_urls: bool },
    /// So many words taken from a list, each as likely as the others (a passphrase): `separator` between them,
    /// each beginning with a capital when `capital`, and one figure after one of them when `digit`.
    Words { separator: String, capital: bool, digit: bool },
}

/// The words passphrases are made of: the long list of the Electronic Frontier Foundation (7776 words, each told
/// from the others by its first letters; https://www.eff.org/dice , CC BY 3.0 US). Each line is five figures of
/// dice, a tab, and the word.
const WORD_LIST: &str = include_str!("../data/eff_large_wordlist.txt");

/// The words of the list, read once.
pub fn words() -> &'static [&'static str] {
    static WORDS: std::sync::OnceLock<Vec<&'static str>> = std::sync::OnceLock::new();
    WORDS.get_or_init(|| WORD_LIST.lines().filter_map(|line| line.split('\t').nth(1)).map(str::trim).filter(|word| !word.is_empty()).collect())
}

const SMALL: &str = "abcdefghijklmnopqrstuvwxyz";
const CAPITAL: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGITS: &str = "0123456789";
const SIGNS: &str = "!@#$%^&*()-_=+[]{};:,.?/";
/// Letters that are taken for one another when read or typed.
const ALIKE: &str = "0O1lI|";

/// The letters a password is made of, from the kinds asked for; none when no kind is.
pub fn password(small: bool, capital: bool, digits: bool, signs: bool, no_look_alikes: bool) -> Option<Secret> {
    let sets: Vec<Vec<char>> = [(small, SMALL), (capital, CAPITAL), (digits, DIGITS), (signs, SIGNS)]
        .into_iter()
        .filter(|(asked, _)| *asked)
        .map(|(_, set)| set.chars().filter(|letter| !(no_look_alikes && ALIKE.contains(*letter))).collect())
        .collect();
    let letters: Vec<char> = sets.iter().flatten().copied().collect();
    (!letters.is_empty()).then_some(Secret::Password { letters, sets })
}

/// How much is not known of a secret to one who knows how it was made, in bits.
pub fn bits(secret: &Secret, length: u64) -> f64 {
    match secret {
        Secret::Password { letters, .. } => length as f64 * (letters.len() as f64).log2(),
        Secret::Hex | Secret::Base64 { .. } => length as f64 * 8.0,
        // Each word is one of the list; the figure is one of ten, after one of the words.
        Secret::Words { digit, .. } => length as f64 * (words().len() as f64).log2() + if *digit { 10f64.log2() + (length as f64).log2() } else { 0.0 },
    }
}

/// Writes `count` secrets, each on a line. `length`: the letters of a password, or the bytes of the others.
/// `go_on` is told how many are made, and stops the work by answering false.
pub fn secrets(secret: &Secret, length: u64, count: u64, out: &mut dyn Write, go_on: &mut dyn FnMut(u64) -> bool) -> Result<(), CodecError> {
    let mut random = Random::new();
    let length = usize::try_from(length).map_err(|_| CodecError::NoMemory)?;
    let mut line: Vec<u8> = Vec::new();
    let mut made_letters: Vec<char> = Vec::new();
    if line.try_reserve(length.saturating_mul(4).saturating_add(2)).is_err() || made_letters.try_reserve(length).is_err() {
        return Err(CodecError::NoMemory);
    }
    for made in 0..count {
        line.clear();
        match secret {
            Secret::Password { letters, sets } => loop {
                made_letters.clear();
                for _ in 0..length {
                    made_letters.push(letters[random.below(letters.len())?]);
                }
                // One that lacks a kind asked for is made again whole: every password that has them all stays as likely as the others.
                if length < sets.len() || sets.iter().all(|set| made_letters.iter().any(|letter| set.contains(letter))) {
                    line.extend(made_letters.iter().collect::<String>().bytes());
                    break;
                }
            },
            Secret::Words { separator, capital, digit } => {
                let list = words();
                let with_digit = if *digit { Some(random.below_any(length)?) } else { None };
                for index in 0..length {
                    if index > 0 {
                        line.extend(separator.bytes());
                    }
                    let word = list[random.below_any(list.len())?];
                    let mut letters = word.chars();
                    match letters.next() {
                        Some(first) if *capital => {
                            line.extend(first.to_uppercase().collect::<String>().bytes());
                            line.extend(letters.as_str().bytes());
                        }
                        _ => line.extend(word.bytes()),
                    }
                    if with_digit == Some(index) {
                        line.push(b'0' + random.below(10)? as u8);
                    }
                }
            }
            Secret::Hex => {
                for _ in 0..length {
                    line.extend(format!("{:02x}", random.byte()?).bytes());
                }
            }
            Secret::Base64 { for_urls } => {
                let letters: &[u8; 64] = if *for_urls { b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_" } else { b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/" };
                let mut left = length;
                while left > 0 {
                    let group = left.min(3);
                    let mut bytes = [0u8; 3];
                    for byte in bytes.iter_mut().take(group) {
                        *byte = random.byte()?;
                    }
                    let bits = u32::from(bytes[0]) << 16 | u32::from(bytes[1]) << 8 | u32::from(bytes[2]);
                    for place in 0..4 {
                        if place <= group {
                            line.push(letters[(bits >> (18 - 6 * place) & 63) as usize]);
                        } else if !for_urls {
                            line.push(b'=');
                        }
                    }
                    left -= group;
                }
            }
        }
        line.push(b'\n');
        out.write_all(&line)?;
        if made % 1024 == 1023 && !go_on(made + 1) {
            return Err(CodecError::Stopped);
        }
    }
    // What was made is not left lying in memory once it was written.
    line.iter_mut().for_each(|byte| *byte = 0);
    made_letters.iter_mut().for_each(|letter| *letter = '\0');
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn made(kind: &Kind, written: Written, upper: bool, count: u64) -> Vec<String> {
        let mut out = Vec::new();
        uuids(kind, written, upper, count, &mut out, &mut |_| true).expect("made");
        String::from_utf8(out).expect("text").lines().map(str::to_owned).collect()
    }

    #[test]
    fn uuids_of_each_version_are_made() {
        for (kind, version) in [(Kind::V1, 1), (Kind::V4, 4), (Kind::V6, 6), (Kind::V7, 7)] {
            let all = made(&kind, Written::Hyphens, false, 300);
            assert_eq!(all.len(), 300);
            assert!(all.iter().all(|text| Uuid::parse_str(text).is_ok_and(|uuid| uuid.get_version_num() == version && uuid.get_variant() == Variant::RFC4122)), "{version}");
            let mut apart = all.clone();
            apart.sort();
            apart.dedup();
            assert_eq!(apart.len(), 300, "all of version {version} differ");
            // Those that hold the time first come out in order.
            if version >= 6 {
                assert!(all.windows(2).all(|pair| pair[0] < pair[1]), "version {version} in order");
            }
        }
        // The node of versions 1 and 6 is marked as no card's address.
        let node = Uuid::parse_str(&made(&Kind::V1, Written::Hyphens, false, 1)[0]).expect("a UUID").get_node_id().expect("a node");
        assert_eq!(node[0] & 1, 1);
        assert_eq!(made(&Kind::Nil, Written::Hyphens, false, 2), ["00000000-0000-0000-0000-000000000000", "00000000-0000-0000-0000-000000000000"]);
        assert_eq!(made(&Kind::Max, Written::Plain, true, 1), ["FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF"]);
    }

    #[test]
    fn names_give_the_uuids_of_the_standard_in_every_form() {
        // RFC 9562, appendix A.2 and A.4: www.example.com in the DNS namespace.
        let dns = namespace("dns").expect("a namespace");
        assert_eq!(made(&Kind::V3(dns, "www.example.com".into()), Written::Hyphens, false, 1), ["5df41881-3aed-3515-88a7-2f4a814cf09e"]);
        assert_eq!(made(&Kind::V5(dns, "www.example.com".into()), Written::Hyphens, false, 1), ["2ed6657d-e927-568b-95e1-2665a8aea6a2"]);
        assert_eq!(made(&Kind::V5(dns, "www.example.com".into()), Written::Urn, true, 1), ["urn:uuid:2ED6657D-E927-568B-95E1-2665A8AEA6A2"]);
        assert_eq!(made(&Kind::V5(dns, "www.example.com".into()), Written::Braces, false, 1), ["{2ed6657d-e927-568b-95e1-2665a8aea6a2}"]);
        assert_eq!(namespace("6ba7b811-9dad-11d1-80b4-00c04fd430c8"), namespace("url"));
        assert!(namespace("not one").is_none());
        assert!(matches!(uuids(&Kind::V4, Written::Hyphens, false, 10_000, &mut Vec::new(), &mut |_| false), Err(CodecError::Stopped)));
    }

    #[test]
    fn a_uuid_is_taken_apart() {
        // The examples of RFC 9562, appendix A.1, A.5 and A.6: all of 2022-02-22 19:22:22 UTC.
        let text = "C232AB00-9414-11EC-B3C8-9F6BDECED846\n\n{1ec9414c-232a-6b00-b3c8-9f6bdeced846}\nurn:uuid:017f22e2-79b0-7cc3-98c4-dc0c0c07398f\n00000000-0000-0000-0000-000000000000";
        let apart = String::from_utf8(through(&mut TakeApart::new(Style::Minify), text.as_bytes(), 5).expect("read")).expect("text");
        assert_eq!(
            apart,
            r#"[{"uuid":"c232ab00-9414-11ec-b3c8-9f6bdeced846","version":1,"kind":"time and node","variant":"RFC 9562","time":"2022-02-22T19:22:22.000Z","unixMilliseconds":1645557742000,"node":"9f:6b:de:ce:d8:46"},{"uuid":"1ec9414c-232a-6b00-b3c8-9f6bdeced846","version":6,"kind":"time and node, sortable","variant":"RFC 9562","time":"2022-02-22T19:22:22.000Z","unixMilliseconds":1645557742000,"node":"9f:6b:de:ce:d8:46"},{"uuid":"017f22e2-79b0-7cc3-98c4-dc0c0c07398f","version":7,"kind":"Unix time and random","variant":"RFC 9562","time":"2022-02-22T19:22:22.000Z","unixMilliseconds":1645557742000},{"uuid":"00000000-0000-0000-0000-000000000000","version":0,"kind":"nil","variant":"NCS"}]"#
        );
        assert_eq!(String::from_utf8(through(&mut TakeApart::new(Style::Spaces(2)), b"ffffffff-ffff-ffff-ffff-ffffffffffff", 50).expect("read")).expect("text"), "[\n  {\n    \"uuid\": \"ffffffff-ffff-ffff-ffff-ffffffffffff\",\n    \"version\": 15,\n    \"kind\": \"max\",\n    \"variant\": \"reserved\"\n  }\n]");
        assert_eq!(problem(through(&mut TakeApart::new(Style::Minify), b"c232ab00-9414-11ec-b3c8-9f6bdeced846\nnot a uuid\n", 4)), ("bad-uuid", 2, 1));
        assert_eq!(problem(through(&mut TakeApart::new(Style::Minify), b" \n", 4)), ("empty", 0, 0));
        assert_eq!(moment(951_782_400, 0), "2000-02-29T00:00:00.000Z");
    }

    fn secrets_made(secret: &Secret, length: u64, count: u64) -> Vec<String> {
        let mut out = Vec::new();
        secrets(secret, length, count, &mut out, &mut |_| true).expect("made");
        String::from_utf8(out).expect("text").lines().map(str::to_owned).collect()
    }

    #[test]
    fn passwords_hold_what_was_asked_for() {
        let all = password(true, true, true, true, false).expect("letters");
        let made = secrets_made(&all, 20, 200);
        assert_eq!(made.len(), 200);
        for one in &made {
            assert_eq!(one.chars().count(), 20);
            for set in [SMALL, CAPITAL, DIGITS, SIGNS] {
                assert!(one.chars().any(|letter| set.contains(letter)), "{one} holds one of {set}");
            }
        }
        // Every letter asked for turns up, and none that was not.
        let digits = secrets_made(&password(false, false, true, false, false).expect("letters"), 500, 1);
        assert!(DIGITS.chars().all(|digit| digits[0].contains(digit)) && digits[0].chars().all(|letter| DIGITS.contains(letter)));
        let plain = secrets_made(&password(true, true, true, false, true).expect("letters"), 2000, 1);
        assert!(!plain[0].chars().any(|letter| ALIKE.contains(letter)));
        // Shorter than the kinds asked for: made all the same.
        assert_eq!(secrets_made(&all, 2, 3).iter().map(String::len).collect::<Vec<_>>(), [2, 2, 2]);
        assert!(password(false, false, false, false, false).is_none());
        assert_eq!(bits(&password(false, false, true, false, false).expect("letters"), 10).round(), 33.0);
    }

    #[test]
    fn random_bytes_are_written_in_their_forms() {
        let hex = secrets_made(&Secret::Hex, 32, 3);
        assert!(hex.iter().all(|one| one.len() == 64 && one.chars().all(|letter| letter.is_ascii_hexdigit())));
        assert_ne!(hex[0], hex[1]);
        let base64 = secrets_made(&Secret::Base64 { for_urls: false }, 32, 2);
        assert!(base64.iter().all(|one| one.len() == 44 && one.ends_with('=')));
        let for_urls = secrets_made(&Secret::Base64 { for_urls: true }, 32, 50);
        assert!(for_urls.iter().all(|one| one.len() == 43 && one.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '-' || letter == '_')));
        assert_eq!(bits(&Secret::Hex, 32), 256.0);
        assert!(matches!(secrets(&Secret::Hex, 8, 5000, &mut Vec::new(), &mut |_| false), Err(CodecError::Stopped)));
    }

    #[test]
    fn numbers_below_a_bound_are_all_as_likely() {
        let mut random = Random::new();
        let mut seen = [0u32; 10];
        for _ in 0..100_000 {
            seen[random.below(10).expect("random")] += 1;
        }
        // Each of ten should come about 10,000 times; far from it would mean the low ones are favoured.
        assert!(seen.iter().all(|&times| (9_000..11_000).contains(&times)), "{seen:?}");
    }

    #[test]
    fn passphrases_are_words_of_the_list() {
        assert_eq!(words().len(), 7776);
        assert!(words().iter().all(|word| !word.is_empty() && word.chars().all(|letter| letter.is_ascii_lowercase() || letter == '-')));
        let passphrases = |secret: &Secret, length: u64| {
            let mut out = Vec::new();
            secrets(secret, length, 50, &mut out, &mut |_| true).expect("made");
            String::from_utf8(out).expect("text").lines().map(str::to_owned).collect::<Vec<_>>()
        };
        let plain = Secret::Words { separator: " ".into(), capital: false, digit: false };
        for passphrase in passphrases(&plain, 6) {
            let made: Vec<&str> = passphrase.split(' ').collect();
            assert_eq!(made.len(), 6, "{passphrase}");
            assert!(made.iter().all(|word| words().contains(word)), "{passphrase}");
        }
        // Six words of 7776: a little over 77 bits.
        assert_eq!(bits(&plain, 6).floor(), 77.0);
        let dressed = Secret::Words { separator: "_".into(), capital: true, digit: true };
        for passphrase in passphrases(&dressed, 4) {
            assert_eq!(passphrase.chars().filter(char::is_ascii_digit).count(), 1, "{passphrase}");
            assert!(passphrase.split('_').all(|word| word.chars().next().is_some_and(|first| first.is_ascii_uppercase())), "{passphrase}");
        }
        assert!(bits(&dressed, 4) > bits(&Secret::Words { separator: String::new(), capital: false, digit: false }, 4));
        // Every word can be drawn: over many draws the first and the last of the list both come up.
        let many = passphrases(&plain, 2000).join(" ");
        assert!(many.split(' ').any(|word| word.starts_with('a')) && many.split(' ').any(|word| word.starts_with('z')));
    }
}
