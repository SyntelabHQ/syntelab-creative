//! Moments in time: Unix timestamps and dates, told in full.
//!
//! A line is a number (seconds, milliseconds, microseconds or nanoseconds since 1970, told apart by how large it
//! is), a date or a date and time as ISO 8601 and RFC 3339 write them, or the word `now`. What is told of it: the
//! count of seconds and of milliseconds, the moment in universal time and in a chosen time zone, the day of the
//! week, and how far it is from now. Dates, times and zones are those of the `jiff` crate, which carries the
//! zones of the IANA database where the system has none.

use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use jiff::{Timestamp, Zoned};

use crate::json::Style;
use crate::lines::{plain, text, EachLine, Members};

/// The last second a signed count of 32 bits holds: 2038-01-19T03:14:07Z.
const LAST_OF_32_BITS: i64 = 2_147_483_647;

/// The time zone by this name: one of the IANA database, `UTC`, or `local` for the one of the system.
pub fn zone(name: &str) -> Option<TimeZone> {
    match name.trim() {
        "" | "local" => Some(TimeZone::system()),
        "UTC" | "utc" | "Z" => Some(TimeZone::UTC),
        other => TimeZone::get(other).ok(),
    }
}

/// The moment a line stands for, and what kind of line it was.
fn read(line: &str, zone: &TimeZone, now: Timestamp) -> Option<(Timestamp, &'static str)> {
    if line.eq_ignore_ascii_case("now") {
        return Some((now, "now"));
    }
    let digits = line.strip_prefix(['-', '+']).unwrap_or(line);
    if !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit()) {
        // How large a count is tells its unit: seconds reach eleven digits only in the year 5138.
        let count: i128 = line.parse().ok()?;
        let (nanoseconds, kind) = match digits.len() {
            0..=11 => (count.checked_mul(1_000_000_000)?, "seconds"),
            12..=14 => (count.checked_mul(1_000_000)?, "milliseconds"),
            15..=17 => (count.checked_mul(1_000)?, "microseconds"),
            _ => (count, "nanoseconds"),
        };
        return Timestamp::from_nanosecond(nanoseconds).ok().map(|moment| (moment, kind));
    }
    if let Ok(seconds) = line.parse::<f64>() {
        // A count with a point is of seconds.
        return Timestamp::from_nanosecond((seconds * 1e9) as i128).ok().map(|moment| (moment, "seconds"));
    }
    // As mail and HTTP write a moment (RFC 2822 and RFC 9110): `Tue, 14 Nov 2023 22:13:20 +0000`, `… GMT`.
    if let Ok(zoned) = jiff::fmt::rfc2822::parse(line) {
        return Some((zoned.timestamp(), "date and time"));
    }
    // A space between the date and the time is as good as the T.
    let mut iso = if line.len() > 10 && line.is_char_boundary(10) && line.as_bytes()[10] == b' ' { format!("{}T{}", &line[..10], line[11..].trim_start()) } else { line.to_owned() };
    // So is one before the offset (`… 00:13:20 +0200`, as Git writes it), and UTC or GMT written after the time.
    if let Some((time, offset)) = iso.rsplit_once(' ') {
        if offset.eq_ignore_ascii_case("utc") || offset.eq_ignore_ascii_case("gmt") || offset == "Z" {
            iso = format!("{time}Z");
        } else if offset.starts_with(['+', '-']) && offset.len() > 1 && offset[1..].bytes().all(|byte| byte.is_ascii_digit() || byte == b':') {
            iso = format!("{time}{offset}");
        }
    }
    if let Ok(moment) = iso.parse::<Timestamp>() {
        return Some((moment, "date and time"));
    }
    if let Ok(zoned) = iso.parse::<Zoned>() {
        return Some((zoned.timestamp(), "date and time"));
    }
    if let Ok(civil) = iso.parse::<DateTime>() {
        // No offset was written: the time is of the zone chosen.
        return civil.to_zoned(zone.clone()).ok().map(|zoned| (zoned.timestamp(), if iso.len() <= 10 { "date" } else { "date and time" }));
    }
    let date = iso.parse::<Date>().ok()?;
    date.to_zoned(zone.clone()).ok().map(|zoned| (zoned.timestamp(), "date"))
}

/// What is told of a moment. `now`: the moment it is compared with.
pub fn told(line: &str, zone: &TimeZone, now: Timestamp) -> Result<Members, &'static str> {
    let (moment, kind) = read(line, zone, now).ok_or("bad-time")?;
    let zoned = moment.to_zoned(zone.clone());
    let mut members: Members = vec![
        ("input", text(line)),
        ("readAs", text(kind)),
        ("seconds", plain(moment.as_second())),
        ("milliseconds", plain(moment.as_millisecond())),
        ("utc", text(&moment.strftime("%Y-%m-%dT%H:%M:%S%.3fZ").to_string())),
        ("inZone", text(&zoned.strftime("%Y-%m-%dT%H:%M:%S%.3f%:z").to_string())),
        ("zone", text(zone.iana_name().unwrap_or("local"))),
        ("weekday", text(&zoned.strftime("%A").to_string())),
        ("fromNowSeconds", plain(moment.as_second() - now.as_second())),
    ];
    if moment.as_second() > LAST_OF_32_BITS {
        // A count of seconds kept in 32 signed bits ends in January 2038: this moment is past it.
        members.push(("after2038", plain(true)));
    }
    Ok(members)
}

/// Each line told as a moment, in the zone given.
pub fn stage(style: Style, zone: TimeZone) -> EachLine {
    EachLine::new(style, "moments-read", move |line| told(line, &zone, Timestamp::now()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::Node;

    fn member(members: &Members, name: &str) -> String {
        match members.iter().find(|(known, _)| *known == name).map(|(_, value)| value) {
            Some(Node::Scalar(raw)) => raw.trim_matches('"').to_owned(),
            _ => String::new(),
        }
    }

    fn at(line: &str, zone_name: &str) -> Members {
        told(line, &zone(zone_name).expect("a zone"), Timestamp::from_second(1_700_000_000).expect("a moment")).expect("a moment")
    }

    #[test]
    fn counts_are_told_apart_by_how_large_they_are() {
        for (line, kind) in [("1700000000", "seconds"), ("1700000000000", "milliseconds"), ("1700000000000000", "microseconds"), ("1700000000000000000", "nanoseconds")] {
            let told = at(line, "UTC");
            assert_eq!((member(&told, "readAs"), member(&told, "utc"), member(&told, "seconds")), (kind.to_string(), "2023-11-14T22:13:20.000Z".to_string(), "1700000000".to_string()), "{line}");
        }
        let told = at("1700000000.5", "UTC");
        assert_eq!((member(&told, "milliseconds"), member(&told, "fromNowSeconds")), ("1700000000500".to_string(), "0".to_string()));
        assert_eq!(member(&at("0", "UTC"), "utc"), "1970-01-01T00:00:00.000Z");
        assert_eq!(member(&at("-86400", "UTC"), "utc"), "1969-12-31T00:00:00.000Z");
    }

    #[test]
    fn a_moment_is_told_in_the_zone_chosen() {
        let told = at("1700000000", "Europe/Bucharest");
        assert_eq!((member(&told, "inZone"), member(&told, "zone"), member(&told, "weekday")), ("2023-11-15T00:13:20.000+02:00".to_string(), "Europe/Bucharest".to_string(), "Wednesday".to_string()));
        // Summer time is of the zone's own rules.
        assert_eq!(member(&at("2024-07-01T12:00:00Z", "Europe/Bucharest"), "inZone"), "2024-07-01T15:00:00.000+03:00");
        assert_eq!(member(&at("2024-07-01T12:00:00Z", "America/New_York"), "inZone"), "2024-07-01T08:00:00.000-04:00");
        assert!(zone("Nowhere/Never").is_none());
    }

    #[test]
    fn dates_are_read_as_they_are_written() {
        assert_eq!(member(&at("2023-11-14T22:13:20Z", "UTC"), "seconds"), "1700000000");
        assert_eq!(member(&at("2023-11-15T00:13:20+02:00", "UTC"), "seconds"), "1700000000");
        assert_eq!(member(&at("2023-11-15 00:13:20+02:00", "UTC"), "seconds"), "1700000000");
        // With no offset written, the time is of the zone chosen.
        assert_eq!(member(&at("2023-11-15T00:13:20", "Europe/Bucharest"), "seconds"), "1700000000");
        let date = at("2023-11-15", "Europe/Bucharest");
        assert_eq!((member(&date, "readAs"), member(&date, "utc")), ("date".to_string(), "2023-11-14T22:00:00.000Z".to_string()));
        assert_eq!(member(&at("now", "UTC"), "seconds"), "1700000000");
        // As mail, HTTP and Git write it.
        assert_eq!(member(&at("Tue, 14 Nov 2023 22:13:20 +0000", "Europe/Bucharest"), "seconds"), "1700000000");
        assert_eq!(member(&at("Wed, 15 Nov 2023 00:13:20 +0200", "UTC"), "seconds"), "1700000000");
        assert_eq!(member(&at("Tue, 14 Nov 2023 22:13:20 GMT", "UTC"), "seconds"), "1700000000");
        assert_eq!(member(&at("2023-11-15 00:13:20 +0200", "UTC"), "seconds"), "1700000000");
        assert_eq!(member(&at("2023-11-14 22:13:20 UTC", "Europe/Bucharest"), "seconds"), "1700000000");
        assert_eq!(told("next tuesday", &TimeZone::UTC, Timestamp::now()).err(), Some("bad-time"));
    }

    #[test]
    fn what_32_bits_cannot_hold_is_said() {
        assert_eq!(member(&at("2147483647", "UTC"), "after2038"), "");
        let after = at("2147483648", "UTC");
        assert_eq!((member(&after, "after2038"), member(&after, "utc")), ("true".to_string(), "2038-01-19T03:14:08.000Z".to_string()));
    }
}
