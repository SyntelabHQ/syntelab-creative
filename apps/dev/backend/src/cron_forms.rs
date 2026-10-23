//! The other forms schedules are written in, read into the one schedule of [`crate::cron`], and a schedule written
//! in each of them.
//!
//! - **AWS EventBridge**: `cron(minute hour day-of-month month day-of-week year)`, with the days of the week
//!   numbered from 1 for Sunday and `?`, `L`, `W`, `#` as in Quartz; it runs by universal time. And
//!   `rate(5 minutes)`, which is counted from when its rule was made and has no times that can be told.
//! - **systemd** (`OnCalendar=`): `Mon..Fri *-*-01 08:00:00`, with `..` for ranges, `/` for steps, `~` for days
//!   counted from the end of the month, the short names (`daily`, `weekly`, `quarterly`…), and a time zone after.
//!   There, a day of the week and a date both given mean a day that is both.
//!
//! Which form a line is in is told from how it is written. A schedule is written in another form when that form
//! can say it; when it cannot (seconds in crontab, the nearest working day in systemd), nothing is given for it.

use jiff::tz::TimeZone;

use crate::cron::{day_field, field, read, weekday_field, Field, Numbering, Schedule, DAYS, FIRST_YEAR, LAST_YEAR, MONTHS};

/// What a line was read as.
pub enum Read {
    /// A schedule, the name of the form it was written in, and the zone it names for itself, when it does.
    Schedule(Schedule, &'static str, Option<TimeZone>),
    /// `rate(n unit)`: every so many minutes, hours or days from when the rule was made.
    Rate { value: u32, unit: &'static str },
}

const BAD: &str = "bad-cron-field";

fn aws(inside: &str) -> Result<Schedule, &'static str> {
    let parts: Vec<&str> = inside.split_whitespace().collect();
    if parts.len() != 6 {
        return Err("bad-aws-fields");
    }
    Ok(Schedule {
        second: None,
        minute: field(parts[0], 0, 59, &[]).ok_or(BAD)?,
        hour: field(parts[1], 0, 23, &[]).ok_or(BAD)?,
        day: day_field(parts[2]).ok_or(BAD)?,
        month: field(parts[3], 1, 12, &MONTHS).ok_or(BAD)?,
        weekday: weekday_field(parts[4], Numbering::Quartz).ok_or(BAD)?,
        year: Some(field(parts[5], FIRST_YEAR, LAST_YEAR, &[]).ok_or(BAD)?),
        at_start: false,
        both_days: false,
    })
}

fn rate(inside: &str) -> Result<Read, &'static str> {
    let (value, unit) = inside.trim().split_once(char::is_whitespace).ok_or("bad-rate")?;
    let value = value.parse::<u32>().ok().filter(|&value| value > 0).ok_or("bad-rate")?;
    let unit = match unit.trim().to_ascii_lowercase().trim_end_matches('s') {
        "minute" => "minute",
        "hour" => "hour",
        "day" => "day",
        _ => return Err("bad-rate"),
    };
    Ok(Read::Rate { value, unit })
}

/// A part of a systemd date or time as cron writes the same thing: `..` is a range.
fn part(written: &str, least: u32, most: u32) -> Option<Field> {
    field(&written.replace("..", "-"), least, most, &[])
}

/// A day of the week as systemd names it: by its first three letters or in full.
fn systemd_day(written: &str) -> Option<u32> {
    DAYS.iter().position(|name| (written.len() == 3 && name[..3].eq_ignore_ascii_case(written)) || name.eq_ignore_ascii_case(written)).map(|at| at as u32)
}

fn systemd(written: &str) -> Result<(Schedule, Option<TimeZone>), &'static str> {
    // A short name may stand alone, or before a zone.
    let (first, after) = written.trim().split_once(char::is_whitespace).unwrap_or((written.trim(), ""));
    let short = match first.to_ascii_lowercase().as_str() {
        "minutely" => Some("*-*-* *:*:00"),
        "hourly" => Some("*-*-* *:00:00"),
        "daily" => Some("*-*-* 00:00:00"),
        "weekly" => Some("Mon *-*-* 00:00:00"),
        "monthly" => Some("*-*-01 00:00:00"),
        "quarterly" => Some("*-01,04,07,10-01 00:00:00"),
        "semiannually" => Some("*-01,07-01 00:00:00"),
        "yearly" | "annually" => Some("*-01-01 00:00:00"),
        _ => None,
    };
    let expanded = short.map(|short| format!("{short} {after}"));
    let mut tokens: Vec<&str> = expanded.as_deref().unwrap_or(written).split_whitespace().collect();
    // A zone may stand last: UTC, or a name of the IANA database.
    let mut zone = None;
    if let Some(last) = tokens.last().filter(|last| tokens.len() > 1 && !last.contains(':') && last.chars().next().is_some_and(char::is_alphabetic) && systemd_day(last.split([',', '.']).next().unwrap_or_default()).is_none()) {
        zone = Some(if last.eq_ignore_ascii_case("UTC") { TimeZone::UTC } else { TimeZone::get(last).map_err(|_| "bad-zone-in-schedule")? });
        tokens.pop();
    }
    let (mut days, mut date, mut time) = (None, None, None);
    for token in tokens {
        if token.contains(':') {
            time = Some(token);
        } else if token.chars().next().is_some_and(char::is_alphabetic) {
            days = Some(token);
        } else {
            date = Some(token);
        }
    }
    if days.is_none() && date.is_none() && time.is_none() {
        return Err("bad-systemd");
    }
    // The days of the week: a list of names and of ranges of names.
    let mut weekday = Field { written: days.unwrap_or("*").to_owned(), values: vec![false; 7], every: days.is_none(), ..Field::default() };
    for range in days.unwrap_or_default().split(',').filter(|range| !range.is_empty()) {
        let (from, to) = match range.split_once("..") {
            Some((from, to)) => (systemd_day(from).ok_or(BAD)?, systemd_day(to).ok_or(BAD)?),
            None => (systemd_day(range).ok_or(BAD)?, systemd_day(range).ok_or(BAD)?),
        };
        // A week of systemd begins on Monday: Mon..Sun is all of it, and a range may go round to Sunday.
        let mut at = from;
        loop {
            weekday.values[at as usize] = true;
            if at == to {
                break;
            }
            at = (at + 1) % 7;
        }
    }
    if weekday.every {
        weekday.values = vec![true; 7];
    }
    // The date: year-month-day, or month-day; the day may be counted from the end of the month after a `~`.
    let date = date.unwrap_or("*-*-*");
    let (before_day, day_written, from_end) = match date.rsplit_once('~') {
        Some((before, day)) => (before, day, true),
        None => match date.rsplit_once('-') {
            Some((before, day)) => (before, day, false),
            None => return Err("bad-systemd"),
        },
    };
    let (year_written, month_written) = before_day.split_once('-').unwrap_or(("*", before_day));
    let mut day = if from_end {
        // `~01` is the last day, `~03` two days before it.
        let before_last = day_written.parse::<u32>().ok().filter(|count| (1..=31).contains(count)).ok_or(BAD)? - 1;
        Field { written: format!("~{day_written}"), values: vec![false; 32], last: Some(before_last), ..Field::default() }
    } else {
        part(day_written, 1, 31).ok_or(BAD)?
    };
    day.every = day_written == "*";
    let month = part(month_written, 1, 12).ok_or(BAD)?;
    let year = if year_written == "*" { None } else { Some(part(year_written, FIRST_YEAR, LAST_YEAR).ok_or(BAD)?) };
    // The time: hour:minute, and seconds when they are written.
    let mut clock = time.unwrap_or("00:00:00").split(':');
    let (hour, minute, second) = (clock.next().unwrap_or("0"), clock.next().ok_or("bad-systemd")?, clock.next().unwrap_or("0"));
    if clock.next().is_some() {
        return Err("bad-systemd");
    }
    let schedule = Schedule { second: Some(part(second, 0, 59).ok_or(BAD)?), minute: part(minute, 0, 59).ok_or(BAD)?, hour: part(hour, 0, 23).ok_or(BAD)?, day, month, weekday, year, at_start: false, both_days: true };
    Ok((schedule, zone))
}

/// Whether a line is written as systemd writes its calendar events, not as cron writes its schedules.
fn looks_like_systemd(line: &str) -> bool {
    let lower = line.split_whitespace().next().unwrap_or_default().to_ascii_lowercase();
    matches!(lower.as_str(), "minutely" | "hourly" | "daily" | "weekly" | "monthly" | "quarterly" | "semiannually" | "yearly" | "annually") || line.contains(':') || line.contains("..") || line.contains('~') || line.split_whitespace().any(|token| token.starts_with("*-") || (token.matches('-').count() == 2 && token.chars().next().is_some_and(|first| first.is_ascii_digit())))
}

/// Reads a line in whichever form it is written. `numbering`: how the days of the week of a cron schedule are
/// numbered (the forms that have a numbering of their own keep it).
pub fn read_any(line: &str, numbering: Numbering) -> Result<Read, &'static str> {
    let written = line.trim();
    let lower = written.to_ascii_lowercase();
    if let Some(inside) = lower.strip_prefix("cron(").and_then(|rest| rest.strip_suffix(')')) {
        // Names are read in any case, so the small letters do no harm; AWS runs by universal time.
        return Ok(Read::Schedule(aws(inside)?, "aws", Some(TimeZone::UTC)));
    }
    if let Some(inside) = lower.strip_prefix("rate(").and_then(|rest| rest.strip_suffix(')')) {
        return rate(inside);
    }
    let written = written.strip_prefix("OnCalendar=").unwrap_or(written).trim();
    if !written.starts_with('@') && looks_like_systemd(written) {
        let (schedule, zone) = systemd(written)?;
        return Ok(Read::Schedule(schedule, "systemd", zone));
    }
    let mut schedule = read(written, numbering)?;
    let quartz = |schedule: &Schedule| schedule.day.special() || schedule.weekday.special() || schedule.year.is_some();
    // Seconds first and what only Quartz writes (a year, `L`, `W`, `#`) say the line is of Quartz: its days of the
    // week are numbered as Quartz numbers them, whatever was asked. Five fields stay crontab's (some crons take `L`
    // and `#` too, with their own numbering); one that Quartz cannot read so (a Sunday written 0) is kept as read.
    if numbering == Numbering::Unix && schedule.second.is_some() && quartz(&schedule) {
        if let Ok(again) = read(written, Numbering::Quartz) {
            schedule = again;
        }
    }
    let form = if schedule.at_start || written.starts_with('@') {
        "alias"
    } else if quartz(&schedule) {
        "quartz"
    } else if schedule.second.is_some() {
        "with seconds"
    } else {
        "crontab"
    };
    Ok(Read::Schedule(schedule, form, None))
}

/// A schedule as each form writes it; nothing where a form cannot say it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Written {
    pub crontab: Option<String>,
    pub with_seconds: Option<String>,
    pub quartz: Option<String>,
    pub aws: Option<String>,
    pub systemd: Option<String>,
}

/// Values in order as a list, three or more that follow one another as a range. `name` writes one value.
fn listed(values: &[u32], range: &str, name: &dyn Fn(u32) -> String) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut at = 0;
    while at < values.len() {
        let mut end = at;
        while end + 1 < values.len() && values[end + 1] == values[end] + 1 {
            end += 1;
        }
        if end - at >= 2 {
            parts.push(format!("{}{range}{}", name(values[at]), name(values[end])));
        } else {
            parts.extend(values[at..=end].iter().map(|&value| name(value)));
        }
        at = end + 1;
    }
    parts.join(",")
}

/// A plain field as cron writes it.
fn cron_field(field: &Field, name: &dyn Fn(u32) -> String) -> String {
    match (field.every, field.step) {
        (true, _) => "*".to_owned(),
        (false, Some(step)) => format!("*/{step}"),
        _ => listed(&field.list(), "-", name),
    }
}

fn number(value: u32) -> String {
    value.to_string()
}

/// The days of the month and of the week as Quartz and AWS write them; nothing when both are given (they have no
/// way to say "either", and none to say "both" but in one field).
fn quartz_days(schedule: &Schedule) -> Option<(String, String)> {
    if !schedule.day.every && !schedule.weekday.every {
        return None;
    }
    let mut day: Vec<String> = Vec::new();
    if !schedule.day.list().is_empty() {
        day.push(listed(&schedule.day.list(), "-", &number));
    }
    match schedule.day.last {
        Some(0) => day.push("L".to_owned()),
        Some(before) => day.push(format!("L-{before}")),
        None => {}
    }
    if schedule.day.last_working {
        day.push("LW".to_owned());
    }
    day.extend(schedule.day.nearest.iter().map(|near| format!("{near}W")));
    let mut weekday: Vec<String> = Vec::new();
    // Sunday is 1 for them.
    if !schedule.weekday.list().is_empty() {
        weekday.push(listed(&schedule.weekday.list().iter().map(|day| day + 1).collect::<Vec<_>>(), "-", &number));
    }
    weekday.extend(schedule.weekday.last_of.iter().map(|day| format!("{}L", day + 1)));
    weekday.extend(schedule.weekday.nth.iter().map(|(day, nth)| format!("{}#{nth}", day + 1)));
    Some(match (schedule.day.every, schedule.weekday.every) {
        (true, true) => ("*".to_owned(), "?".to_owned()),
        (false, _) => (day.join(","), "?".to_owned()),
        (true, false) => ("?".to_owned(), weekday.join(",")),
    })
}

/// A part of a systemd date or time: `*`, a step from the first value, or a list with `..` for ranges.
fn systemd_part(field: &Field, least: u32, wide: usize) -> String {
    let name = |value: u32| format!("{value:0wide$}");
    match (field.every, field.step) {
        (true, _) => "*".to_owned(),
        (false, Some(step)) => format!("{}/{step}", name(least)),
        _ => listed(&field.list(), "..", &name),
    }
}

fn systemd_written(schedule: &Schedule) -> Option<String> {
    let (day, weekday) = (&schedule.day, &schedule.weekday);
    // What systemd has no words for: either day of two, the nearest working day, the last of a day of the week.
    if schedule.either_day() || day.last_working || !day.nearest.is_empty() || !weekday.last_of.is_empty() || weekday.nth.len() > 1 || (!weekday.nth.is_empty() && (!day.every || !weekday.list().is_empty())) {
        return None;
    }
    let short = |value: u32| DAYS[(value % 7) as usize][..3].to_owned();
    let mut days = if weekday.every {
        String::new()
    } else {
        // A week of systemd begins on Monday: Sunday goes last.
        let mut from_monday: Vec<u32> = weekday.list().iter().map(|&value| if value == 0 { 7 } else { value }).collect();
        from_monday.sort_unstable();
        listed(&from_monday, "..", &short)
    };
    let day_written = match (day.last, weekday.nth.first()) {
        (Some(before), _) if day.list().is_empty() => format!("~{:02}", before + 1),
        (Some(_), _) => return None,
        // The second Monday is the Monday among the days 8 to 14.
        (None, Some(&(of, nth))) => {
            days = short(of);
            format!("-{:02}..{:02}", (nth - 1) * 7 + 1, nth * 7)
        }
        (None, None) => format!("-{}", systemd_part(day, 1, 2)),
    };
    let year = schedule.year.as_ref().map_or("*".to_owned(), |year| systemd_part(year, FIRST_YEAR, 4));
    let second = schedule.second.as_ref().map_or("00".to_owned(), |second| systemd_part(second, 0, 2));
    let date = format!("{year}-{}{day_written}", systemd_part(&schedule.month, 1, 2));
    let time = format!("{}:{}:{second}", systemd_part(&schedule.hour, 0, 2), systemd_part(&schedule.minute, 0, 2));
    Some(format!("{days} {date} {time}").trim().to_owned())
}

/// A schedule written in each of the forms.
pub fn written_as(schedule: &Schedule) -> Written {
    if schedule.at_start {
        return Written { crontab: Some("@reboot".to_owned()), ..Written::default() };
    }
    let at_second_zero = schedule.second.as_ref().is_none_or(|second| second.list() == [0]);
    let every_year = schedule.year.as_ref().is_none_or(|year| year.every);
    let plain_days = !schedule.day.special() && !schedule.weekday.special();
    // Cron says "either" for two days given; a schedule that means "both" is cron's only when one of the two is every day.
    let cron_days = plain_days && (!schedule.both_days || schedule.day.every || schedule.weekday.every);
    let five = format!(
        "{} {} {} {} {}",
        cron_field(&schedule.minute, &number),
        cron_field(&schedule.hour, &number),
        cron_field(&schedule.day, &number),
        cron_field(&schedule.month, &number),
        cron_field(&schedule.weekday, &number)
    );
    let second = schedule.second.as_ref().map_or("0".to_owned(), |second| cron_field(second, &number));
    let year = schedule.year.as_ref().map_or("*".to_owned(), |year| cron_field(year, &number));
    let quartz_days = quartz_days(schedule);
    let month = cron_field(&schedule.month, &number);
    let (minute, hour) = (cron_field(&schedule.minute, &number), cron_field(&schedule.hour, &number));
    Written {
        crontab: (at_second_zero && every_year && cron_days).then(|| five.clone()),
        with_seconds: (every_year && cron_days).then(|| format!("{second} {five}")),
        quartz: quartz_days.as_ref().map(|(day, weekday)| format!("{second} {minute} {hour} {day} {month} {weekday}{}", if every_year { String::new() } else { format!(" {year}") })),
        aws: quartz_days.as_ref().filter(|_| at_second_zero).map(|(day, weekday)| format!("cron({minute} {hour} {day} {month} {weekday} {year})")),
        systemd: systemd_written(schedule),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use jiff::Timestamp;

    fn schedule(line: &str) -> (Schedule, &'static str) {
        match read_any(line, Numbering::Unix).expect("read") {
            Read::Schedule(schedule, form, _) => (schedule, form),
            Read::Rate { .. } => panic!("a rate"),
        }
    }

    fn next(line: &str, after: &str, count: usize) -> Vec<String> {
        let zone = TimeZone::UTC;
        schedule(line).0.next(after.parse::<Timestamp>().expect("a moment"), &zone, count).iter().map(|moment| moment.to_zoned(zone.clone()).strftime("%Y-%m-%d %H:%M:%S").to_string()).collect()
    }

    #[test]
    fn the_form_of_a_line_is_told_from_how_it_is_written() {
        for (line, form) in [("30 2 * * *", "crontab"), ("0 30 2 * * *", "with seconds"), ("0 0 9 ? * 2#2 *", "quartz"), ("0 0 L * *", "quartz"), ("@daily", "alias"), ("cron(0 12 * * ? *)", "aws"), ("Mon..Fri *-*-* 08:00:00", "systemd"), ("daily", "systemd"), ("OnCalendar=*-*-01 00:00", "systemd"), ("*:0/15", "systemd")] {
            assert_eq!(schedule(line).1, form, "{line}");
        }
        assert!(matches!(read_any("rate(5 minutes)", Numbering::Unix), Ok(Read::Rate { value: 5, unit: "minute" })));
        assert!(matches!(read_any("rate(1 hour)", Numbering::Unix), Ok(Read::Rate { value: 1, unit: "hour" })));
        assert_eq!(read_any("rate(0 days)", Numbering::Unix).err(), Some("bad-rate"));
        assert_eq!(read_any("cron(0 12 * * ?)", Numbering::Unix).err(), Some("bad-aws-fields"));
    }

    #[test]
    fn a_line_of_quartz_is_read_with_its_numbering() {
        // 6#3 is the third Friday for Quartz (1 is Sunday), and 2-6 Monday to Friday, whatever numbering was asked.
        assert_eq!(next("0 0 9 ? * 6#3", "2024-01-01T00:00:00Z", 2), ["2024-01-19 09:00:00", "2024-02-16 09:00:00"]);
        assert_eq!(schedule("0 0 9 ? * 2-6 *").0.weekday.list(), [1, 2, 3, 4, 5]);
        assert_eq!(schedule("0 0 9 ? * 6L").0.weekday.last_of, [5]);
        // Five fields are crontab's: 5#3 is the third Friday there; and a line Quartz cannot read keeps the asked numbering.
        assert_eq!(next("0 9 * * 5#3", "2024-01-01T00:00:00Z", 1), ["2024-01-19 09:00:00"]);
        assert_eq!(schedule("0 0 9 ? * 0 *").0.weekday.list(), [0]);
        // Seconds without anything of Quartz's own (Spring) keep the numbering asked for.
        assert_eq!(schedule("0 0 9 * * 1").0.weekday.list(), [1]);
    }

    #[test]
    fn aws_schedules_are_read_with_their_own_numbering() {
        // 10:15 on the last Friday of each month (6 is Friday for AWS), and weekdays at 18:00.
        assert_eq!(next("cron(15 10 ? * 6L *)", "2024-01-01T00:00:00Z", 2), ["2024-01-26 10:15:00", "2024-02-23 10:15:00"]);
        assert_eq!(next("cron(0 18 ? * MON-FRI *)", "2024-01-05T19:00:00Z", 2), ["2024-01-08 18:00:00", "2024-01-09 18:00:00"]);
        assert_eq!(next("cron(0 8 1 * ? 2030)", "2024-01-01T00:00:00Z", 1), ["2030-01-01 08:00:00"]);
        assert!(matches!(read_any("cron(0 8 1 * ? *)", Numbering::Unix), Ok(Read::Schedule(_, "aws", Some(_)))));
    }

    #[test]
    fn systemd_calendar_events_are_read() {
        assert_eq!(next("Mon..Fri *-*-* 08:00:00", "2024-01-05T09:00:00Z", 2), ["2024-01-08 08:00:00", "2024-01-09 08:00:00"]);
        assert_eq!(next("*-*-01 00:00", "2024-01-15T00:00:00Z", 2), ["2024-02-01 00:00:00", "2024-03-01 00:00:00"]);
        assert_eq!(next("*:0/15", "2024-01-01T10:05:00Z", 2), ["2024-01-01 10:15:00", "2024-01-01 10:30:00"]);
        assert_eq!(next("quarterly", "2024-01-15T00:00:00Z", 2), ["2024-04-01 00:00:00", "2024-07-01 00:00:00"]);
        assert_eq!(next("weekly", "2024-01-02T00:00:00Z", 1), ["2024-01-08 00:00:00"]);
        // The last day of the month, and two days before it; a date with a year; a day of the week and a date mean both.
        assert_eq!(next("*-*~01 12:00", "2024-02-01T00:00:00Z", 1), ["2024-02-29 12:00:00"]);
        assert_eq!(next("*-*~03 12:00", "2024-02-01T00:00:00Z", 1), ["2024-02-27 12:00:00"]);
        assert_eq!(next("2030-06-15 10:30:45", "2024-01-01T00:00:00Z", 2), ["2030-06-15 10:30:45"]);
        assert_eq!(next("Fri *-*-13 00:00", "2024-01-01T00:00:00Z", 2), ["2024-09-13 00:00:00", "2024-12-13 00:00:00"]);
        assert_eq!(next("Sat,Sun 20:00", "2024-01-01T00:00:00Z", 2), ["2024-01-06 20:00:00", "2024-01-07 20:00:00"]);
        // A zone written after the event is the zone it runs by.
        assert!(matches!(read_any("daily Europe/Bucharest", Numbering::Unix), Ok(Read::Schedule(_, "systemd", Some(zone))) if zone.iana_name() == Some("Europe/Bucharest")));
        assert!(matches!(read_any("*-*-* 02:00 UTC", Numbering::Unix), Ok(Read::Schedule(_, "systemd", Some(_)))));
        assert_eq!(read_any("*-13-01 00:00", Numbering::Unix).err(), Some("bad-cron-field"));
        assert_eq!(read_any("daily Mars/Olympus", Numbering::Unix).err(), Some("bad-zone-in-schedule"));
    }

    fn written(line: &str) -> Written {
        written_as(&schedule(line).0)
    }

    #[test]
    fn a_schedule_is_written_in_the_other_forms() {
        let weekdays = written("*/15 9-17 * * MON-FRI");
        assert_eq!(weekdays.crontab.as_deref(), Some("*/15 9-17 * * 1-5"));
        assert_eq!(weekdays.with_seconds.as_deref(), Some("0 */15 9-17 * * 1-5"));
        assert_eq!(weekdays.quartz.as_deref(), Some("0 */15 9-17 ? * 2-6"));
        assert_eq!(weekdays.aws.as_deref(), Some("cron(*/15 9-17 ? * 2-6 *)"));
        assert_eq!(weekdays.systemd.as_deref(), Some("Mon..Fri *-*-* 09..17:00/15:00"));
        let monthly = written("30 2 1,15 * *");
        assert_eq!((monthly.quartz.as_deref(), monthly.systemd.as_deref()), (Some("0 30 2 1,15 * ?"), Some("*-*-01,15 02:30:00")));
        // Sunday goes last in a week of systemd.
        assert_eq!(written("0 0 * * 0,6").systemd.as_deref(), Some("Sat,Sun *-*-* 00:00:00"));
    }

    #[test]
    fn what_a_form_cannot_say_is_not_written_in_it() {
        // Seconds: not in crontab, not in AWS.
        let seconds = written("*/10 * * * * *");
        assert_eq!((seconds.crontab, seconds.aws, seconds.quartz.as_deref()), (None, None, Some("*/10 * * * * ?")));
        // Either of two days: only cron says it.
        let either = written("0 0 13 * FRI");
        assert_eq!((either.crontab.as_deref(), either.quartz, either.aws, either.systemd), (Some("0 0 13 * 5"), None, None, None));
        // Both of two days: only systemd says it.
        let both = written("Fri *-*-13 00:00");
        assert_eq!((both.crontab, both.quartz, both.systemd.as_deref()), (None, None, Some("Fri *-*-13 00:00:00")));
        // What Quartz adds: the last day and the second Monday reach systemd, the nearest working day does not.
        let last = written("0 0 L * *");
        assert_eq!((last.crontab, last.quartz.as_deref(), last.aws.as_deref(), last.systemd.as_deref()), (None, Some("0 0 0 L * ?"), Some("cron(0 0 L * ? *)"), Some("*-*~01 00:00:00")));
        let second_monday = written("0 9 * * MON#2");
        assert_eq!((second_monday.quartz.as_deref(), second_monday.systemd.as_deref()), (Some("0 0 9 ? * 2#2"), Some("Mon *-*-08..14 09:00:00")));
        assert_eq!(written("0 0 15W * *").systemd, None);
        // A year: not in crontab.
        let year = written("0 0 12 1 1 ? 2030");
        assert_eq!((year.crontab, year.quartz.as_deref(), year.aws.as_deref(), year.systemd.as_deref()), (None, Some("0 0 12 1 1 ? 2030"), Some("cron(0 12 1 1 ? 2030)"), Some("2030-01-01 12:00:00")));
        assert_eq!(written("@reboot"), Written { crontab: Some("@reboot".to_owned()), ..Written::default() });
    }

    #[test]
    fn what_was_written_in_another_form_runs_at_the_same_times() {
        for line in ["*/15 9-17 * * MON-FRI", "30 2 1,15 * *", "0 0 L * *", "0 9 * * MON#2", "0 0 12 1 1 ? 2030", "5 4 * 2,8 *", "0 */6 * * 0,6"] {
            let at = "2024-01-01T00:00:00Z";
            let own = next(line, at, 6);
            let other = written(line);
            for (form, in_form) in [("crontab", &other.crontab), ("with seconds", &other.with_seconds), ("aws", &other.aws), ("systemd", &other.systemd)] {
                if let Some(in_form) = in_form {
                    assert_eq!(next(in_form, at, 6), own, "{line} as {form}: {in_form}");
                }
            }
            // Quartz numbers its days from 1: it is read back so.
            if let Some(quartz) = &other.quartz {
                let zone = TimeZone::UTC;
                let read_back = read(quartz, Numbering::Quartz).expect("a schedule").next(at.parse().expect("a moment"), &zone, 6);
                assert_eq!(read_back.iter().map(|moment| moment.to_zoned(zone.clone()).strftime("%Y-%m-%d %H:%M:%S").to_string()).collect::<Vec<_>>(), own, "{line} as quartz: {quartz}");
            }
        }
    }
}
