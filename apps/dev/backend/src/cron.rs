//! Cron schedules read, in the forms people meet them in.
//!
//! - Five fields (minute, hour, day of month, month, day of week), as crontab has them; six with seconds first
//!   (Spring, Quartz and others); seven with a year last (Quartz).
//! - In every field: `*`, lists, ranges, steps (`*/5`, `10-40/10`, `5/15`); names of months and of days by their
//!   first three letters; `?` for "any" in the fields of days.
//! - What Quartz adds: `L` (the last day of the month, `L-3` three days before it, `6L` the last Friday), `W`
//!   (`15W` the working day nearest the 15th, `LW` the last working day), `#` (`MON#2` the second Monday).
//! - The aliases: `@yearly`, `@annually`, `@monthly`, `@weekly`, `@daily`, `@midnight`, `@hourly`, and `@reboot`
//!   (which has no times to tell).
//!
//! Days of the week are numbered as crontab does (0 or 7 is Sunday) or as Quartz does (1 is Sunday): the one who
//! asks says which. A day of the month and a day of the week both given mean either, as cron has it.
//!
//! What is told of a schedule: each field as it was read, what the schedule says in words (English here; the
//! interface says it in its own language from the fields), and when it next runs by the clocks of a chosen time
//! zone, summer time followed.

use jiff::civil::{Date, DateTime, Weekday};
use jiff::tz::TimeZone;
use jiff::{Timestamp, ToSpan};

use crate::json::Style;
use crate::lines::{list, object, plain, text, EachLine, Members};
use crate::tree::Node;

pub(crate) const MONTHS: [&str; 12] = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
pub(crate) const DAYS: [&str; 7] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
pub(crate) const FIRST_YEAR: u32 = 1970;
pub(crate) const LAST_YEAR: u32 = 2199;

/// One field as it was read.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Field {
    /// As it was written.
    pub written: String,
    /// The values it lets through, each at its own place (a year at its number).
    pub(crate) values: Vec<bool>,
    /// Written as `*` or `?`: every value.
    pub every: bool,
    /// Written as `*/n`: every n-th of all its values.
    pub step: Option<u32>,
    /// Day of month: `L`, and how many days before the last (`L-3` is 3).
    pub last: Option<u32>,
    /// Day of month: `LW`, the last working day.
    pub last_working: bool,
    /// Day of month: `15W`, the working day nearest each of these.
    pub nearest: Vec<u32>,
    /// Day of week: `6L`, the last of each of these days in the month (0 is Sunday).
    pub last_of: Vec<u32>,
    /// Day of week: `MON#2`, the n-th of a day in the month, as (day, n).
    pub nth: Vec<(u32, u32)>,
}

impl Field {
    fn has(&self, value: u32) -> bool {
        self.values.get(value as usize).copied().unwrap_or(false)
    }

    /// The plain values it lets through, in order.
    pub fn list(&self) -> Vec<u32> {
        (0..self.values.len() as u32).filter(|&value| self.has(value)).collect()
    }

    /// Written as every value, or as every n-th of them all.
    pub(crate) fn all(&self) -> bool {
        self.every || self.step.is_some()
    }

    /// It holds something only Quartz writes.
    pub(crate) fn special(&self) -> bool {
        self.last.is_some() || self.last_working || !self.nearest.is_empty() || !self.last_of.is_empty() || !self.nth.is_empty()
    }
}

/// How the days of the week are numbered.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Numbering {
    /// 0 is Sunday, and 7 too: crontab, and most others.
    Unix,
    /// 1 is Sunday, 7 Saturday: Quartz.
    Quartz,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Schedule {
    /// None when the schedule has no field for seconds: it runs at second 0.
    pub second: Option<Field>,
    pub minute: Field,
    pub hour: Field,
    pub day: Field,
    pub month: Field,
    pub weekday: Field,
    /// None when the schedule has no field for years: it runs every year.
    pub year: Option<Field>,
    /// `@reboot`: it runs when the system starts, and at no time that can be told.
    pub at_start: bool,
    /// A day of the month and a day of the week both given mean a day that is both (systemd), not either (cron).
    pub both_days: bool,
}

/// A value of a field: a number, or the name of a month or of a day by its first three letters.
fn value(written: &str, names: &[&str], least: u32) -> Option<u32> {
    if let Ok(number) = written.parse::<u32>() {
        return Some(number);
    }
    names.iter().position(|name| written.len() == 3 && name[..3].eq_ignore_ascii_case(written)).map(|at| at as u32 + least)
}

/// A day of the week as written, as its number from Sunday (0): by its name, or by its number in the numbering asked for.
fn weekday(written: &str, numbering: Numbering) -> Option<u32> {
    if let Some(named) = DAYS.iter().position(|name| written.len() == 3 && name[..3].eq_ignore_ascii_case(written)) {
        return Some(named as u32);
    }
    let number = written.parse::<u32>().ok()?;
    match numbering {
        Numbering::Unix => (number <= 7).then_some(number % 7),
        Numbering::Quartz => (1..=7).contains(&number).then(|| number - 1),
    }
}

/// The plain part of a field: lists, ranges and steps of values from `least` to `most`, each read by `read`.
fn plain_field(written: &str, least: u32, most: u32, read: &dyn Fn(&str) -> Option<u32>, field: &mut Field) -> Option<()> {
    let (range, step) = match written.split_once('/') {
        Some((range, step)) => (range, Some(step.parse::<u32>().ok().filter(|&step| step > 0)?)),
        None => (written, None),
    };
    let (from, to) = match range {
        "*" | "?" => (least, most),
        _ => match range.split_once('-') {
            Some((from, to)) => (read(from)?, read(to)?),
            // A single value with a step runs from it to the end.
            None => (read(range)?, if step.is_some() { most } else { read(range)? }),
        },
    };
    if from < least || to > most {
        return None;
    }
    // A range that goes round the end (FRI-MON, 22-2) is one that wraps.
    let wraps = from > to;
    let mut at = from;
    let mut left = if wraps { most - from + 1 + to - least + 1 } else { to - from + 1 };
    while left > 0 {
        field.values[(at - least) as usize] = true;
        let by = step.unwrap_or(1);
        if by >= left {
            break;
        }
        left -= by;
        at = least + (at - least + by) % (most - least + 1);
    }
    Some(())
}

pub(crate) fn field(written: &str, least: u32, most: u32, names: &[&str]) -> Option<Field> {
    let mut field = Field { written: written.to_owned(), values: vec![false; (most - least + 1) as usize], every: matches!(written, "*" | "?"), ..Field::default() };
    if let Some(step) = written.strip_prefix("*/") {
        field.step = step.parse().ok();
    }
    for part in written.split(',') {
        plain_field(part, least, most, &|value_written| value(value_written, names, least), &mut field)?;
    }
    // The values are kept from 0: those of a field that begins at 1 are moved up by its first.
    let mut moved = vec![false; least as usize];
    moved.append(&mut field.values);
    field.values = moved;
    Some(field)
}

pub(crate) fn day_field(written: &str) -> Option<Field> {
    let mut field = Field { written: written.to_owned(), values: vec![false; 31], every: matches!(written, "*" | "?"), ..Field::default() };
    if let Some(step) = written.strip_prefix("*/") {
        field.step = step.parse().ok();
    }
    for part in written.split(',') {
        let upper = part.to_ascii_uppercase();
        if upper == "L" {
            field.last = Some(0);
        } else if upper == "LW" || upper == "WL" {
            field.last_working = true;
        } else if let Some(before) = upper.strip_prefix("L-") {
            field.last = Some(before.parse::<u32>().ok().filter(|&before| before <= 30)?);
        } else if let Some(day) = upper.strip_suffix('W') {
            field.nearest.push(day.parse::<u32>().ok().filter(|day| (1..=31).contains(day))?);
        } else {
            plain_field(part, 1, 31, &|value_written| value_written.parse().ok(), &mut field)?;
        }
    }
    let mut moved = vec![false];
    moved.append(&mut field.values);
    field.values = moved;
    Some(field)
}

pub(crate) fn weekday_field(written: &str, numbering: Numbering) -> Option<Field> {
    let mut field = Field { written: written.to_owned(), values: vec![false; 7], every: matches!(written, "*" | "?"), ..Field::default() };
    if let Some(step) = written.strip_prefix("*/") {
        field.step = step.parse().ok();
    }
    for part in written.split(',') {
        let upper = part.to_ascii_uppercase();
        if let Some((day, nth)) = upper.split_once('#') {
            field.nth.push((weekday(day, numbering)?, nth.parse::<u32>().ok().filter(|nth| (1..=5).contains(nth))?));
        } else if upper == "L" {
            // Alone, `L` is the last day of the week: Saturday.
            field.values[6] = true;
        } else if let Some(day) = upper.strip_suffix('L') {
            field.last_of.push(weekday(day, numbering)?);
        } else {
            let (least, most) = if numbering == Numbering::Quartz { (1, 7) } else { (0, 7) };
            // Read in the numbering asked for, kept from Sunday as 0.
            let mut read = Field { values: vec![false; (most - least + 1) as usize], ..Field::default() };
            plain_field(part, least, most, &|value_written| DAYS.iter().position(|name| value_written.len() == 3 && name[..3].eq_ignore_ascii_case(value_written)).map(|at| at as u32 + least).or_else(|| value_written.parse().ok()), &mut read)?;
            for (at, set) in read.values.iter().enumerate() {
                if *set {
                    let day = if numbering == Numbering::Quartz { at as u32 } else { (at as u32 + least) % 7 };
                    field.values[day as usize] = true;
                }
            }
        }
    }
    Some(field)
}

/// Reads a schedule. What is wrong with it is a code.
pub fn read(written: &str, numbering: Numbering) -> Result<Schedule, &'static str> {
    let lower = written.trim().to_ascii_lowercase();
    let aliased = match lower.as_str() {
        "@yearly" | "@annually" => "0 0 1 1 *",
        "@monthly" => "0 0 1 * *",
        "@weekly" => "0 0 * * 0",
        "@daily" | "@midnight" => "0 0 * * *",
        "@hourly" => "0 * * * *",
        "@reboot" => "* * * * *",
        _ => written.trim(),
    };
    // An alias is of crontab: its Sunday is 0 whatever numbering is asked for.
    let numbering = if aliased == written.trim() { numbering } else { Numbering::Unix };
    let parts: Vec<&str> = aliased.split_whitespace().collect();
    let (second, rest, year) = match parts.len() {
        5 => (None, &parts[..], None),
        6 => (Some(parts[0]), &parts[1..], None),
        7 => (Some(parts[0]), &parts[1..6], Some(parts[6])),
        _ => return Err("bad-cron-fields"),
    };
    let bad = "bad-cron-field";
    Ok(Schedule {
        second: second.map(|second| field(second, 0, 59, &[]).ok_or(bad)).transpose()?,
        minute: field(rest[0], 0, 59, &[]).ok_or(bad)?,
        hour: field(rest[1], 0, 23, &[]).ok_or(bad)?,
        day: day_field(rest[2]).ok_or(bad)?,
        month: field(rest[3], 1, 12, &MONTHS).ok_or(bad)?,
        weekday: weekday_field(rest[4], numbering).ok_or(bad)?,
        year: year.map(|year| field(year, FIRST_YEAR, LAST_YEAR, &[]).ok_or(bad)).transpose()?,
        at_start: lower == "@reboot",
        both_days: false,
    })
}

fn last_day(date: Date) -> u32 {
    date.days_in_month() as u32
}

/// The working day nearest a day of the month, without leaving the month: Saturday goes back to Friday and Sunday
/// on to Monday, unless that would leave the month.
fn nearest_working(date: Date, day: u32) -> Option<u32> {
    let last = last_day(date);
    if day > last {
        return None;
    }
    let of = Date::new(date.year(), date.month(), day as i8).ok()?;
    Some(match of.weekday() {
        Weekday::Saturday if day == 1 => 3,
        Weekday::Saturday => day - 1,
        Weekday::Sunday if day == last => day - 2,
        Weekday::Sunday => day + 1,
        _ => day,
    })
}

impl Schedule {
    /// A day of the month and a day of the week are both given: a day that is either is a day it runs.
    pub fn either_day(&self) -> bool {
        !self.both_days && !self.day.every && !self.weekday.every
    }

    fn on(&self, date: Date) -> bool {
        if !self.month.has(date.month() as u32) || self.year.as_ref().is_some_and(|year| !year.has(date.year() as u32)) {
            return false;
        }
        let (day, last) = (date.day() as u32, last_day(date));
        let of_month = self.day.has(day)
            || self.day.last.is_some_and(|before| before < last && day == last - before)
            || (self.day.last_working && nearest_working(date, last) == Some(day))
            || self.day.nearest.iter().any(|&near| nearest_working(date, near) == Some(day));
        let of = date.weekday().to_sunday_zero_offset() as u32;
        let of_week = self.weekday.has(of) || (self.weekday.last_of.contains(&of) && day + 7 > last) || self.weekday.nth.contains(&(of, (day - 1) / 7 + 1));
        if self.either_day() {
            of_month || of_week
        } else {
            of_month && of_week
        }
    }

    /// The next `count` moments it runs after `after`, as the clocks of `zone` have them. Fewer when it does not
    /// run so many times within the years looked through (the 30th of February never comes).
    pub fn next(&self, after: Timestamp, zone: &TimeZone, count: usize) -> Vec<Timestamp> {
        let mut found = Vec::new();
        if self.at_start {
            return found;
        }
        let seconds = self.second.as_ref().map_or(vec![0], Field::list);
        let (hours, minutes) = (self.hour.list(), self.minute.list());
        let mut date = after.to_zoned(zone.clone()).date();
        // Every day of the next 28 years is looked at: the days of the week and of the month come round in that time.
        for _ in 0..366 * 28 {
            if found.len() >= count {
                break;
            }
            if self.on(date) {
                'day: for &hour in &hours {
                    for &minute in &minutes {
                        for &second in &seconds {
                            let Ok(civil) = DateTime::new(date.year(), date.month(), date.day(), hour as i8, minute as i8, second as i8, 0) else { continue };
                            let Ok(zoned) = civil.to_zoned(zone.clone()) else { continue };
                            // A time the zone skips is moved on by it, and may land on one already told.
                            if zoned.timestamp() > after && found.last() != Some(&zoned.timestamp()) {
                                found.push(zoned.timestamp());
                                if found.len() >= count {
                                    break 'day;
                                }
                            }
                        }
                    }
                }
            }
            match date.checked_add(1.day()) {
                Ok(next) => date = next,
                Err(_) => break,
            }
        }
        found
    }

    /// The last `count` moments it ran before `before`, the nearest first, as the clocks of `zone` have them.
    pub fn previous(&self, before: Timestamp, zone: &TimeZone, count: usize) -> Vec<Timestamp> {
        let mut found = Vec::new();
        if self.at_start {
            return found;
        }
        let seconds = self.second.as_ref().map_or(vec![0], Field::list);
        let (hours, minutes) = (self.hour.list(), self.minute.list());
        let mut date = before.to_zoned(zone.clone()).date();
        for _ in 0..366 * 28 {
            if found.len() >= count {
                break;
            }
            if self.on(date) {
                'day: for &hour in hours.iter().rev() {
                    for &minute in minutes.iter().rev() {
                        for &second in seconds.iter().rev() {
                            let Ok(civil) = DateTime::new(date.year(), date.month(), date.day(), hour as i8, minute as i8, second as i8, 0) else { continue };
                            let Ok(zoned) = civil.to_zoned(zone.clone()) else { continue };
                            if zoned.timestamp() < before && found.last() != Some(&zoned.timestamp()) {
                                found.push(zoned.timestamp());
                                if found.len() >= count {
                                    break 'day;
                                }
                            }
                        }
                    }
                }
            }
            match date.checked_sub(1.day()) {
                Ok(earlier) => date = earlier,
                Err(_) => break,
            }
        }
        found
    }

    /// What the schedule says, in words.
    pub fn words(&self) -> String {
        if self.at_start {
            return "When the system starts".to_owned();
        }
        let numbers = |field: &Field| field.list().iter().map(u32::to_string).collect::<Vec<_>>().join(", ");
        let single = |field: &Field| (field.list().len() == 1).then(|| field.list()[0]);
        let time = match (single(&self.minute), single(&self.hour)) {
            (Some(minute), Some(hour)) => format!("At {hour:02}:{minute:02}"),
            _ if self.minute.all() && self.hour.every => match self.minute.step {
                Some(step) if step > 1 => format!("Every {step} minutes"),
                _ => "Every minute".to_owned(),
            },
            (Some(minute), None) if self.hour.all() => match self.hour.step {
                Some(step) if step > 1 => format!("At minute {minute} of every {step} hours"),
                _ => format!("At minute {minute} of every hour"),
            },
            (Some(minute), None) => format!("At minute {minute} of hours {}", numbers(&self.hour)),
            (None, _) if self.minute.all() => match (self.minute.step, self.hour.every) {
                (Some(step), true) if step > 1 => format!("Every {step} minutes"),
                (Some(step), false) if step > 1 => format!("Every {step} minutes of hours {}", numbers(&self.hour)),
                _ => format!("Every minute of hours {}", numbers(&self.hour)),
            },
            (None, _) if self.hour.every => format!("At minutes {} of every hour", numbers(&self.minute)),
            (None, _) => format!("At minutes {} of hours {}", numbers(&self.minute), numbers(&self.hour)),
        };
        let seconds = match &self.second {
            Some(second) if second.all() => match second.step {
                Some(step) if step > 1 => format!(", every {step} seconds"),
                _ => ", every second".to_owned(),
            },
            Some(second) if second.list() != [0] => format!(", at seconds {}", numbers(second)),
            _ => String::new(),
        };
        let name = |day: u32| DAYS[(day % 7) as usize];
        let ordinal = |nth: u32| ["first", "second", "third", "fourth", "fifth"][(nth.clamp(1, 5) - 1) as usize];
        let mut of_month: Vec<String> = Vec::new();
        if !self.day.list().is_empty() {
            of_month.push(format!("on day {} of the month", numbers(&self.day)));
        }
        match self.day.last {
            Some(0) => of_month.push("on the last day of the month".to_owned()),
            Some(before) => of_month.push(format!("{before} days before the last day of the month")),
            None => {}
        }
        if self.day.last_working {
            of_month.push("on the last working day of the month".to_owned());
        }
        of_month.extend(self.day.nearest.iter().map(|day| format!("on the working day nearest day {day}")));
        let mut of_week: Vec<String> = Vec::new();
        if !self.weekday.list().is_empty() {
            of_week.push(format!("on {}", self.weekday.list().iter().map(|&day| name(day)).collect::<Vec<_>>().join(", ")));
        }
        of_week.extend(self.weekday.last_of.iter().map(|&day| format!("on the last {} of the month", name(day))));
        of_week.extend(self.weekday.nth.iter().map(|&(day, nth)| format!("on the {} {} of the month", ordinal(nth), name(day))));
        let days = match (self.day.every, self.weekday.every) {
            (true, true) => "every day".to_owned(),
            (false, true) => of_month.join(" and "),
            (true, false) => of_week.join(" and "),
            (false, false) if self.both_days => format!("{}, when that is {}", of_month.join(" and "), of_week.join(" and ").trim_start_matches("on ")),
            (false, false) => format!("{} or {}", of_month.join(" and "), of_week.join(" and ")),
        };
        let months = if self.month.every { String::new() } else { format!(", in {}", self.month.list().iter().filter_map(|&month| MONTHS.get(month as usize - 1).copied()).collect::<Vec<_>>().join(", ")) };
        let years = match &self.year {
            Some(year) if !year.every => format!(", in {}", year.list().iter().map(u32::to_string).collect::<Vec<_>>().join(", ")),
            _ => String::new(),
        };
        format!("{time}{seconds}, {days}{months}{years}")
    }
}

/// A field as the interface is told it: as written, and what it lets through.
fn told_field(field: &Field) -> Node {
    let mut members: Members = vec![("written", text(&field.written)), ("every", plain(field.every)), ("step", field.step.map_or_else(|| plain("null"), plain)), ("values", list(field.list().into_iter().map(plain)))];
    if let Some(before) = field.last {
        members.push(("last", plain(before)));
    }
    if field.last_working {
        members.push(("lastWorking", plain(true)));
    }
    if !field.nearest.is_empty() {
        members.push(("nearestWorking", list(field.nearest.iter().map(plain))));
    }
    if !field.last_of.is_empty() {
        members.push(("lastOf", list(field.last_of.iter().map(plain))));
    }
    if !field.nth.is_empty() {
        members.push(("nth", list(field.nth.iter().map(|&(day, nth)| object(vec![("day", plain(day)), ("nth", plain(nth))])))));
    }
    object(members)
}

/// What is told of a schedule written on a line, in any of the forms that are read.
pub fn told(line: &str, numbering: Numbering, zone: &TimeZone, count: usize, now: Timestamp) -> Result<Members, &'static str> {
    use crate::cron_forms::{read_any, written_as, Read};
    let (schedule, form, own_zone) = match read_any(line, numbering)? {
        Read::Schedule(schedule, form, own_zone) => (schedule, form, own_zone),
        // A rate is counted from when its rule was made: what it says can be told, when it runs cannot.
        Read::Rate { value, unit } => {
            return Ok(vec![
                ("expression", text(line)),
                ("says", text(&format!("Every {value} {unit}{}, counted from when the rule was made", if value == 1 { "" } else { "s" }))),
                ("form", text("rate")),
                ("rate", object(vec![("value", plain(value)), ("unit", text(unit))])),
                ("next", list([])),
                ("nextUnix", list([])),
            ]);
        }
    };
    // A schedule that names its own zone (systemd) runs by it; one of AWS runs by universal time.
    let zone = own_zone.as_ref().unwrap_or(zone);
    let next = schedule.next(now, zone, count);
    let previous = schedule.previous(now, zone, count);
    let stamp = |moment: &Timestamp| text(&moment.to_zoned(zone.clone()).strftime("%Y-%m-%dT%H:%M:%S%:z").to_string());
    let mut fields: Members = Vec::new();
    if let Some(second) = &schedule.second {
        fields.push(("second", told_field(second)));
    }
    fields.extend([("minute", told_field(&schedule.minute)), ("hour", told_field(&schedule.hour)), ("dayOfMonth", told_field(&schedule.day)), ("month", told_field(&schedule.month)), ("dayOfWeek", told_field(&schedule.weekday))]);
    if let Some(year) = &schedule.year {
        fields.push(("year", told_field(year)));
    }
    let other = written_as(&schedule);
    let as_other = |written: &Option<String>| written.as_deref().map_or_else(|| plain("null"), text);
    let mut members: Members = vec![
        ("expression", text(line)),
        ("says", text(&schedule.words())),
        ("form", text(form)),
        ("zone", text(zone.iana_name().unwrap_or("local"))),
        ("zoneIsItsOwn", plain(own_zone.is_some())),
        ("fields", object(fields)),
        ("next", list(next.iter().map(stamp))),
        ("nextUnix", list(next.iter().map(|moment| plain(moment.as_second())))),
        ("previous", list(previous.iter().map(stamp))),
        ("previousUnix", list(previous.iter().map(|moment| plain(moment.as_second())))),
        ("asOther", object(vec![("crontab", as_other(&other.crontab)), ("withSeconds", as_other(&other.with_seconds)), ("quartz", as_other(&other.quartz)), ("aws", as_other(&other.aws)), ("systemd", as_other(&other.systemd))])),
    ];
    if schedule.at_start {
        members.push(("atStart", plain(true)));
    } else {
        members.push(("eitherDay", plain(schedule.either_day())));
        members.push(("bothDays", plain(schedule.both_days && !schedule.day.every && !schedule.weekday.every)));
        if next.len() < count {
            // It does not run so many times in the years looked through: never, when none was found.
            members.push(("runsOut", plain(true)));
        }
    }
    Ok(members)
}

/// Each line told as a schedule: its fields, its words, its runs after and before now in the zone given, and how
/// it is written in the other forms.
pub fn stage(style: Style, numbering: Numbering, zone: TimeZone, count: usize) -> EachLine {
    EachLine::new(style, "schedules-read", move |line| told(line, numbering, &zone, count, Timestamp::now()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unix(written: &str) -> Schedule {
        read(written, Numbering::Unix).expect("a schedule")
    }

    fn next_in(written: &str, numbering: Numbering, after: &str, zone: &str, count: usize) -> Vec<String> {
        let zone = TimeZone::get(zone).expect("a zone");
        read(written, numbering).expect("a schedule").next(after.parse().expect("a moment"), &zone, count).iter().map(|moment| moment.to_zoned(zone.clone()).strftime("%Y-%m-%d %H:%M:%S").to_string()).collect()
    }

    fn next(written: &str, after: &str, zone: &str, count: usize) -> Vec<String> {
        next_in(written, Numbering::Unix, after, zone, count)
    }

    #[test]
    fn schedules_are_read_with_their_lists_ranges_steps_and_names() {
        let schedule = unix("*/15 9-17 1,15 jan-mar MON-FRI");
        assert_eq!(schedule.minute.list(), [0, 15, 30, 45]);
        assert_eq!(schedule.hour.list(), [9, 10, 11, 12, 13, 14, 15, 16, 17]);
        assert_eq!((schedule.day.list(), schedule.month.list(), schedule.weekday.list()), (vec![1, 15], vec![1, 2, 3], vec![1, 2, 3, 4, 5]));
        assert_eq!(unix("0 0 * * 7").weekday.list(), [0]);
        assert_eq!(unix("5/20 * * * *").minute.list(), [5, 25, 45]);
        // Ranges that go round the end.
        assert_eq!(unix("0 22-2 * * FRI-MON").hour.list(), [0, 1, 2, 22, 23]);
        assert_eq!(unix("0 22-2 * * FRI-MON").weekday.list(), [0, 1, 5, 6]);
        assert_eq!(unix("@daily"), Schedule { ..unix("0 0 * * *") });
        assert!(unix("30 * * * * *").second.is_some());
        assert_eq!(unix("0 0 12 * * ? 2030,2032").year.expect("years").list(), [2030, 2032]);
        for wrong in ["* * * *", "60 * * * *", "* 24 * * *", "* * 0 * *", "* * * 13 *", "* * * * 8", "*/0 * * * *", "a * * * *", "* * * * * * * *", "* * 32W * *", "* * * * MON#6", "0 0 0 * * ? 1969"] {
            assert!(read(wrong, Numbering::Unix).is_err(), "{wrong}");
        }
        assert_eq!(read("* * * *", Numbering::Unix).err(), Some("bad-cron-fields"));
        assert_eq!(read("61 * * * *", Numbering::Unix).err(), Some("bad-cron-field"));
    }

    #[test]
    fn the_days_of_the_week_are_numbered_as_asked() {
        // 1 is Monday for crontab, Sunday for Quartz; names are the same for both.
        assert_eq!(read("0 0 * * 1", Numbering::Unix).expect("a schedule").weekday.list(), [1]);
        assert_eq!(read("0 0 ? * 1", Numbering::Quartz).expect("a schedule").weekday.list(), [0]);
        assert_eq!(read("0 0 ? * 2-6", Numbering::Quartz).expect("a schedule").weekday.list(), [1, 2, 3, 4, 5]);
        assert_eq!(read("0 0 ? * MON", Numbering::Quartz).expect("a schedule").weekday.list(), [1]);
        assert!(read("0 0 ? * 0", Numbering::Quartz).is_err());
        // An alias keeps its Sunday.
        assert_eq!(read("@weekly", Numbering::Quartz).expect("a schedule").weekday.list(), [0]);
    }

    #[test]
    fn the_next_runs_are_found() {
        assert_eq!(next("30 2 * * *", "2024-01-01T00:00:00Z", "UTC", 2), ["2024-01-01 02:30:00", "2024-01-02 02:30:00"]);
        assert_eq!(next("*/20 * * * *", "2024-01-01T10:05:00Z", "UTC", 3), ["2024-01-01 10:20:00", "2024-01-01 10:40:00", "2024-01-01 11:00:00"]);
        assert_eq!(next("0 9 * * MON", "2024-01-01T09:00:00Z", "UTC", 2), ["2024-01-08 09:00:00", "2024-01-15 09:00:00"]);
        assert_eq!(next("0 0 29 2 *", "2024-03-01T00:00:00Z", "UTC", 2), ["2028-02-29 00:00:00", "2032-02-29 00:00:00"]);
        assert_eq!(next("*/30 * * * * *", "2024-01-01T00:00:10Z", "UTC", 2), ["2024-01-01 00:00:30", "2024-01-01 00:01:00"]);
        assert_eq!(next("0 0 12 1 1 ? 2030", "2024-01-01T00:00:00Z", "UTC", 3), ["2030-01-01 12:00:00"]);
        assert!(next("0 0 30 2 *", "2024-01-01T00:00:00Z", "UTC", 1).is_empty());
        assert!(next("@reboot", "2024-01-01T00:00:00Z", "UTC", 3).is_empty());
    }

    #[test]
    fn what_quartz_adds_is_followed() {
        // The last day of each month; three days before it.
        assert_eq!(next("0 0 L * *", "2024-01-15T00:00:00Z", "UTC", 3), ["2024-01-31 00:00:00", "2024-02-29 00:00:00", "2024-03-31 00:00:00"]);
        assert_eq!(next("0 0 L-3 * *", "2024-02-01T00:00:00Z", "UTC", 1), ["2024-02-26 00:00:00"]);
        // The last Friday (6 for Quartz); the second Monday.
        assert_eq!(next_in("0 0 0 ? * 6L", Numbering::Quartz, "2024-01-01T00:00:00Z", "UTC", 2), ["2024-01-26 00:00:00", "2024-02-23 00:00:00"]);
        assert_eq!(next("0 9 * * MON#2", "2024-01-01T00:00:00Z", "UTC", 2), ["2024-01-08 09:00:00", "2024-02-12 09:00:00"]);
        // The working day nearest the 15th: Saturday the 15th of June 2024 gives Friday the 14th; the 1st of a month
        // that begins on a Saturday gives Monday the 3rd; the last working day of March 2024 is Friday the 29th.
        assert_eq!(next("0 0 15W 6 *", "2024-01-01T00:00:00Z", "UTC", 1), ["2024-06-14 00:00:00"]);
        assert_eq!(next("0 0 1W 6 *", "2024-01-01T00:00:00Z", "UTC", 1), ["2024-06-03 00:00:00"]);
        assert_eq!(next("0 0 LW 3 *", "2024-01-01T00:00:00Z", "UTC", 1), ["2024-03-29 00:00:00"]);
    }

    #[test]
    fn a_day_of_the_month_and_a_day_of_the_week_mean_either() {
        // The 13th, and every Friday: January 2024 has the 5th, 12th (Fridays), the 13th, the 19th.
        assert_eq!(next("0 0 13 * FRI", "2024-01-01T00:00:00Z", "UTC", 4), ["2024-01-05 00:00:00", "2024-01-12 00:00:00", "2024-01-13 00:00:00", "2024-01-19 00:00:00"]);
        assert!(unix("0 0 13 * FRI").either_day());
        assert!(!unix("0 0 13 * *").either_day());
        assert!(!unix("0 0 13 * ?").either_day());
    }

    #[test]
    fn the_runs_follow_the_clocks_of_the_zone() {
        // In Bucharest the clocks went from 03:00 to 04:00 on 2024-03-31: 03:30 did not exist that day.
        assert_eq!(next("0 12 * * *", "2024-03-30T12:00:00Z", "Europe/Bucharest", 2), ["2024-03-31 12:00:00", "2024-04-01 12:00:00"]);
        let around = next("30 3 * * *", "2024-03-30T12:00:00Z", "Europe/Bucharest", 2);
        assert_eq!((around.len(), around[1].as_str()), (2, "2024-04-01 03:30:00"));
    }

    #[test]
    fn a_schedule_is_said_in_words() {
        let words = |written: &str| unix(written).words();
        assert_eq!(words("30 2 * * *"), "At 02:30, every day");
        assert_eq!(words("* * * * *"), "Every minute, every day");
        assert_eq!(words("*/15 * * * *"), "Every 15 minutes, every day");
        assert_eq!(words("0 * * * *"), "At minute 0 of every hour, every day");
        assert_eq!(words("0 9 * * 1-5"), "At 09:00, on Monday, Tuesday, Wednesday, Thursday, Friday");
        assert_eq!(words("0 0 1,15 * *"), "At 00:00, on day 1, 15 of the month");
        assert_eq!(words("0 0 13 * FRI"), "At 00:00, on day 13 of the month or on Friday");
        assert_eq!(words("15,45 8-9 * JAN,JUL *"), "At minutes 15, 45 of hours 8, 9, every day, in January, July");
        assert_eq!(words("*/10 * * * * *"), "Every minute, every 10 seconds, every day");
        assert_eq!(words("0 0 L * *"), "At 00:00, on the last day of the month");
        assert_eq!(words("0 9 * * MON#2"), "At 09:00, on the second Monday of the month");
        assert_eq!(words("0 0 12 LW * ? 2030"), "At 12:00, at seconds 0, on the last working day of the month, in 2030".replace(", at seconds 0", ""));
        assert_eq!(words("@reboot"), "When the system starts");
    }

    #[test]
    fn the_runs_before_are_found_the_nearest_first() {
        let zone = TimeZone::UTC;
        let before = |written: &str, at: &str, count: usize| -> Vec<String> { unix(written).previous(at.parse().expect("a moment"), &zone, count).iter().map(|moment| moment.to_zoned(zone.clone()).strftime("%Y-%m-%d %H:%M:%S").to_string()).collect() };
        assert_eq!(before("30 2 * * *", "2024-01-03T00:00:00Z", 2), ["2024-01-02 02:30:00", "2024-01-01 02:30:00"]);
        assert_eq!(before("*/20 * * * *", "2024-01-01T10:05:00Z", 3), ["2024-01-01 10:00:00", "2024-01-01 09:40:00", "2024-01-01 09:20:00"]);
        assert_eq!(before("0 0 29 2 *", "2024-03-01T00:00:00Z", 2), ["2024-02-29 00:00:00", "2020-02-29 00:00:00"]);
        assert_eq!(before("0 0 L * *", "2024-03-15T00:00:00Z", 1), ["2024-02-29 00:00:00"]);
        assert!(before("@reboot", "2024-03-01T00:00:00Z", 2).is_empty());
    }

    #[test]
    fn a_line_is_told_whole() {
        let told = told("0 0 13 * FRI", Numbering::Unix, &TimeZone::UTC, 2, "2024-01-01T00:00:00Z".parse().expect("a moment")).expect("told");
        let names: Vec<&str> = told.iter().map(|(name, _)| *name).collect();
        assert_eq!(names, ["expression", "says", "form", "zone", "zoneIsItsOwn", "fields", "next", "nextUnix", "previous", "previousUnix", "asOther", "eitherDay", "bothDays"]);
        let json = |node: &Node| String::from_utf8(crate::whole::json_text(node, 4, crate::json::Options::of(Style::Minify)).expect("text")).expect("text");
        let member = |name: &str| json(&told.iter().find(|(known, _)| *known == name).expect("a member").1);
        assert_eq!(member("next"), r#"["2024-01-05T00:00:00+00:00","2024-01-12T00:00:00+00:00"]"#);
        assert_eq!(member("nextUnix"), "[1704412800,1705017600]");
        assert_eq!(member("previous"), r#"["2023-12-29T00:00:00+00:00","2023-12-22T00:00:00+00:00"]"#);
        assert!(member("fields").starts_with(r#"{"minute":{"written":"0","every":false,"step":null,"values":[0]},"hour":"#));
        assert!(member("fields").contains(r#""dayOfWeek":{"written":"FRI","every":false,"step":null,"values":[5]}"#));
        let quartz = super::told("0 0 9 ? * MON#2 *", Numbering::Quartz, &TimeZone::UTC, 1, Timestamp::now()).expect("told");
        assert_eq!(json(&quartz[2].1), "\"quartz\"");
        assert!(json(&quartz[5].1).contains(r#""dayOfWeek":{"written":"MON#2","every":false,"step":null,"values":[],"nth":[{"day":1,"nth":2}]}"#));
        assert_eq!(super::told("nonsense", Numbering::Unix, &TimeZone::UTC, 2, Timestamp::now()).err(), Some("bad-cron-fields"));
    }
}
