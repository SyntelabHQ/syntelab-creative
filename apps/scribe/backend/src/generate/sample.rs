//! Made-up data to try things with: names, e-mail addresses, phone numbers,
//! street addresses, dates, numbers — or lines after a pattern of the
//! user's. Everything is put together at random from short lists written
//! here; no one of it is anybody's on purpose.

use serde::Deserialize;

use super::random::uuid;
use super::words::ENGLISH;
use super::{Dice, MOST_CHARACTERS};
use crate::ops::OpError;

/// What is made.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SampleKind {
    #[default]
    Names,
    Emails,
    Phones,
    Addresses,
    Dates,
    Numbers,
    /// Lines after a pattern, with `{name}`, `{email}`… standing for what is made.
    Pattern,
}

/// Where the people and the places are from.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Region {
    #[default]
    Romania,
    English,
}

/// Made-up data with its choices, as the interface asks for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sample {
    pub what: SampleKind,
    /// How many lines.
    pub count: usize,
    pub region: Region,
    /// For `pattern`: the line to write, with `{name}`, `{first}`, `{last}`, `{email}`, `{phone}`, `{street}`,
    /// `{city}`, `{address}`, `{date}`, `{number}`, `{number:1-100}`, `{word}`, `{letter}`, `{digit}`, `{uuid}`, `{row}`.
    pub pattern: String,
    /// For `numbers`: the least and the most.
    pub from: i64,
    pub to: i64,
    /// The same seed gives the same lines.
    pub seed: Option<u64>,
}

impl Default for Sample {
    fn default() -> Self {
        Self { what: SampleKind::default(), count: 10, region: Region::default(), pattern: String::new(), from: 1, to: 100, seed: None }
    }
}

const RO_FIRST: &[&str] = &[
    "Ana", "Maria", "Ioana", "Elena", "Andreea", "Cristina", "Alexandra", "Daniela", "Gabriela", "Mihaela", "Raluca", "Simona", "Diana", "Laura", "Oana", "Irina", "Monica", "Adriana", "Carmen", "Roxana", "Ion", "Andrei", "Mihai",
    "Alexandru", "Cristian", "Daniel", "Gabriel", "Florin", "Bogdan", "Vlad", "Radu", "Ștefan", "George", "Marius", "Adrian", "Sorin", "Cătălin", "Lucian", "Paul", "Victor",
];
const RO_LAST: &[&str] = &[
    "Popescu", "Ionescu", "Popa", "Dumitru", "Stan", "Stoica", "Gheorghe", "Rusu", "Munteanu", "Matei", "Constantin", "Șerban", "Moldovan", "Marin", "Mihai", "Dinu", "Tudor", "Lazăr", "Florea", "Dobre", "Barbu", "Nistor", "Sandu",
    "Vasile", "Ene", "Cristea", "Preda", "Toma", "Anghel", "Neagu", "Diaconu", "Ilie", "Bucur", "Oprea", "Voicu", "Manole", "Zamfir", "Petrescu", "Georgescu", "Enache",
];
const RO_STREETS: &[&str] = &["Strada Teilor", "Strada Mărului", "Strada Morii", "Strada Viilor", "Strada Lalelelor", "Strada Plopilor", "Strada Fântânii", "Strada Podului", "Strada Gării", "Strada Școlii", "Aleea Castanilor", "Aleea Brazilor", "Bulevardul Florilor", "Bulevardul Păcii", "Calea Dealului", "Strada Câmpului"];
const RO_CITIES: &[&str] = &["București", "Cluj-Napoca", "Timișoara", "Iași", "Constanța", "Craiova", "Brașov", "Galați", "Ploiești", "Oradea", "Sibiu", "Arad", "Pitești", "Bacău", "Suceava", "Târgu Mureș"];

const EN_FIRST: &[&str] = &[
    "Anna", "Emma", "Olivia", "Sophia", "Grace", "Lucy", "Ruth", "Clara", "Alice", "Nora", "Helen", "Julia", "Laura", "Sarah", "Emily", "Hannah", "Rachel", "Megan", "Chloe", "Zoe", "James", "John", "Robert", "Michael", "William", "David",
    "Thomas", "Daniel", "Henry", "Samuel", "George", "Edward", "Peter", "Mark", "Paul", "Simon", "Adam", "Oliver", "Jack", "Ethan",
];
const EN_LAST: &[&str] = &[
    "Smith", "Jones", "Taylor", "Brown", "Wilson", "Evans", "Walker", "Wright", "Hall", "Green", "Baker", "Clark", "Turner", "Hill", "Cooper", "Ward", "Morris", "King", "Lee", "Harris", "Carter", "Parker", "Bennett", "Reed", "Cook", "Bell",
    "Murphy", "Bailey", "Collins", "Stewart", "Foster", "Gray", "Hughes", "Price", "Wood", "Barnes", "Ross", "Hayes", "Marsh", "Webb",
];
const EN_STREETS: &[&str] = &["Maple Street", "Oak Avenue", "Mill Lane", "Church Road", "Station Road", "Elm Street", "Cedar Court", "River Road", "Orchard Way", "Hillside Drive", "Park Avenue", "Willow Lane", "Meadow Close", "Bridge Street", "Garden Terrace", "Harbour View"];
const EN_CITIES: &[&str] = &["Springfield", "Riverton", "Fairview", "Greenville", "Lakewood", "Ashford", "Milton", "Kingsbridge", "Westfield", "Oakdale", "Brookside", "Northgate", "Redhill", "Clayton", "Easton", "Stonebridge"];

/// A person and a place, made up together so that what is said of them agrees: the e-mail carries the name.
struct Made {
    first: &'static str,
    last: &'static str,
    street: &'static str,
    number: usize,
    city: &'static str,
    phone: String,
    date: String,
}

/// A name as an address can carry it: small plain letters only.
fn plain(name: &str) -> String {
    name.chars()
        .filter_map(|letter| match letter {
            'ă' | 'â' | 'Ă' | 'Â' => Some('a'),
            'î' | 'Î' => Some('i'),
            'ș' | 'Ș' => Some('s'),
            'ț' | 'Ț' => Some('t'),
            other if other.is_ascii_alphabetic() => Some(other.to_ascii_lowercase()),
            _ => None,
        })
        .collect()
}

fn digits(dice: &mut Dice, count: usize) -> String {
    (0..count).map(|_| char::from(b'0' + dice.below(10) as u8)).collect()
}

fn made(region: Region, dice: &mut Dice) -> Made {
    let (first, last, streets, cities) = match region {
        Region::Romania => (RO_FIRST, RO_LAST, RO_STREETS, RO_CITIES),
        Region::English => (EN_FIRST, EN_LAST, EN_STREETS, EN_CITIES),
    };
    let phone = match region {
        // Shaped like a mobile number of the country.
        Region::Romania => format!("07{} {} {}", digits(dice, 2), digits(dice, 3), digits(dice, 3)),
        // 555-01xx is kept for made-up numbers: nobody answers.
        Region::English => format!("({}) 555-01{}", dice.between(201, 989), digits(dice, 2)),
    };
    let (year, month, day) = (dice.between(1990, 2030), dice.between(1, 12), dice.between(1, 28));
    let date = match region {
        Region::Romania => format!("{day:02}.{month:02}.{year}"),
        Region::English => format!("{year}-{month:02}-{day:02}"),
    };
    Made { first: dice.pick(first), last: dice.pick(last), street: dice.pick(streets), number: dice.between(1, 199), city: dice.pick(cities), phone, date }
}

impl Made {
    fn name(&self) -> String {
        format!("{} {}", self.first, self.last)
    }

    /// At a domain kept for examples: mail sent there reaches no one.
    fn email(&self) -> String {
        format!("{}.{}@example.com", plain(self.first), plain(self.last))
    }

    fn address(&self, region: Region) -> String {
        match region {
            Region::Romania => format!("{} nr. {}, {}", self.street, self.number, self.city),
            Region::English => format!("{} {}, {}", self.number, self.street, self.city),
        }
    }
}

/// A whole number from `from` to `to`, whichever is the larger.
fn number_between(from: i64, to: i64, dice: &mut Dice) -> i64 {
    let (least, most) = (from.min(to), from.max(to));
    let span = most.abs_diff(least).min(usize::MAX as u64 - 1) as usize;
    least.saturating_add(dice.below(span + 1) as i64)
}

/// One line after a pattern: what stands in braces is made, the rest is written as it is.
fn after_pattern(pattern: &str, sample: &Sample, row: usize, dice: &mut Dice) -> String {
    let person = made(sample.region, dice);
    let mut line = String::with_capacity(pattern.len() * 2);
    let mut rest = pattern;
    while let Some(open) = rest.find('{') {
        line.push_str(&rest[..open]);
        let Some(close) = rest[open..].find('}') else {
            // A brace that is never closed is only a brace.
            rest = &rest[open..];
            break;
        };
        let asked = &rest[open + 1..open + close];
        rest = &rest[open + close + 1..];
        let (name, choice) = asked.split_once(':').map_or((asked, ""), |(name, choice)| (name, choice));
        match name.trim() {
            "name" => line.push_str(&person.name()),
            "first" => line.push_str(person.first),
            "last" => line.push_str(person.last),
            "email" => line.push_str(&person.email()),
            "phone" => line.push_str(&person.phone),
            "street" => line.push_str(person.street),
            "city" => line.push_str(person.city),
            "address" => line.push_str(&person.address(sample.region)),
            "date" => line.push_str(&person.date),
            "word" => line.push_str(dice.pick(ENGLISH)),
            "letter" => line.push(char::from(b'a' + dice.below(26) as u8)),
            "digit" => line.push_str(&digits(dice, 1)),
            "uuid" => line.push_str(&uuid(dice)),
            "row" => line.push_str(&(row + 1).to_string()),
            "number" => {
                // {number:5-20}; a hyphen right after the colon is the sign of the first number.
                let range = choice.trim().char_indices().skip(1).find(|(_, letter)| *letter == '-').map(|(at, _)| (choice.trim()[..at].trim().parse::<i64>(), choice.trim()[at + 1..].trim().parse::<i64>()));
                let (from, to) = match range {
                    Some((Ok(from), Ok(to))) => (from, to),
                    _ => (sample.from, sample.to),
                };
                line.push_str(&number_between(from, to, dice).to_string());
            }
            // Not something that is made: written as it was typed.
            _ => {
                line.push('{');
                line.push_str(asked);
                line.push('}');
            }
        }
    }
    line.push_str(rest);
    line
}

/// As many lines of made-up data as asked.
pub fn write(sample: &Sample, dice: &mut Dice) -> Result<String, OpError> {
    if sample.count == 0 {
        return Err(OpError::BadChoice("nothing to write"));
    }
    if sample.what == SampleKind::Pattern && sample.pattern.trim().is_empty() {
        return Err(OpError::BadChoice("a pattern is needed"));
    }
    if sample.count.saturating_mul(sample.pattern.len().max(64)) > MOST_CHARACTERS {
        return Err(OpError::BadChoice("too much to write"));
    }
    let mut lines = Vec::with_capacity(sample.count);
    for row in 0..sample.count {
        lines.push(match sample.what {
            SampleKind::Names => made(sample.region, dice).name(),
            SampleKind::Emails => made(sample.region, dice).email(),
            SampleKind::Phones => made(sample.region, dice).phone,
            SampleKind::Addresses => made(sample.region, dice).address(sample.region),
            SampleKind::Dates => made(sample.region, dice).date,
            SampleKind::Numbers => number_between(sample.from, sample.to, dice).to_string(),
            SampleKind::Pattern => after_pattern(&sample.pattern, sample, row, dice),
        });
    }
    Ok(lines.join("\n"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(what: SampleKind, count: usize) -> Sample {
        Sample { what, count, ..Sample::default() }
    }

    fn lines(sample: &Sample, seed: u64) -> Vec<String> {
        write(sample, &mut Dice::seeded(seed)).expect("writes").split('\n').map(str::to_owned).collect()
    }

    #[test]
    fn makes_people_of_a_region() {
        let names = lines(&sample(SampleKind::Names, 30), 1);
        assert_eq!(names.len(), 30);
        assert!(names.iter().all(|name| RO_FIRST.iter().any(|first| name.starts_with(first)) && RO_LAST.iter().any(|last| name.ends_with(last))), "{names:?}");
        let english = lines(&Sample { region: Region::English, ..sample(SampleKind::Names, 30) }, 1);
        assert!(english.iter().all(|name| EN_LAST.iter().any(|last| name.ends_with(last))));
        assert!(names.iter().any(|name| name != &names[0]));
    }

    #[test]
    fn makes_addresses_no_mail_reaches_and_numbers_no_one_answers() {
        for email in lines(&sample(SampleKind::Emails, 50), 2) {
            assert!(email.ends_with("@example.com") && email.is_ascii() && email.matches('.').count() == 2 && !email.contains(' '), "{email}");
        }
        for phone in lines(&Sample { region: Region::English, ..sample(SampleKind::Phones, 50) }, 3) {
            assert!(phone.contains(" 555-01") && phone.len() == 14, "{phone}");
        }
        for phone in lines(&sample(SampleKind::Phones, 20), 3) {
            assert!(phone.starts_with("07") && phone.len() == 12, "{phone}");
        }
        assert_eq!(plain("Ștefan Șerban-Țăranu"), "stefanserbantaranu");
    }

    #[test]
    fn makes_places_dates_and_numbers() {
        assert!(lines(&sample(SampleKind::Addresses, 20), 4).iter().all(|address| address.contains(" nr. ") && address.contains(", ")));
        assert!(lines(&Sample { region: Region::English, ..sample(SampleKind::Addresses, 20) }, 4).iter().all(|address| address.chars().next().is_some_and(|first| first.is_ascii_digit())));
        for date in lines(&sample(SampleKind::Dates, 30), 5) {
            let parts: Vec<&str> = date.split('.').collect();
            assert!(parts.len() == 3 && parts[0].len() == 2 && parts[2].len() == 4, "{date}");
        }
        let numbers = lines(&Sample { from: -5, to: 5, ..sample(SampleKind::Numbers, 400) }, 6);
        let read: Vec<i64> = numbers.iter().map(|number| number.parse().expect("a number")).collect();
        assert!(read.iter().all(|number| (-5..=5).contains(number)));
        assert!(read.contains(&-5) && read.contains(&5));
        // Given the wrong way round, the range is the same.
        assert!(lines(&Sample { from: 9, to: 7, ..sample(SampleKind::Numbers, 50) }, 6).iter().all(|number| ["7", "8", "9"].contains(&number.as_str())));
    }

    #[test]
    fn writes_lines_after_a_pattern() {
        let rows = lines(&Sample { pattern: "{row};{name};{email};{number:10-12};{nothing};{digit}{letter}".into(), ..sample(SampleKind::Pattern, 20) }, 7);
        for (index, row) in rows.iter().enumerate() {
            let parts: Vec<&str> = row.split(';').collect();
            assert_eq!(parts.len(), 6, "{row}");
            assert_eq!(parts[0], (index + 1).to_string());
            // The address is of the person named beside it.
            let last = plain(parts[1].rsplit(' ').next().unwrap_or(""));
            assert!(parts[2].contains(&last), "{row}");
            assert!(["10", "11", "12"].contains(&parts[3]), "{row}");
            assert_eq!(parts[4], "{nothing}");
            assert!(parts[5].len() == 2);
        }
        assert_eq!(lines(&Sample { pattern: "fără nimic {".into(), ..sample(SampleKind::Pattern, 1) }, 7), ["fără nimic {"]);
        let negative = lines(&Sample { pattern: "{number:-3--1}".into(), ..sample(SampleKind::Pattern, 40) }, 8);
        assert!(negative.iter().all(|number| ["-3", "-2", "-1"].contains(&number.as_str())), "{negative:?}");
        assert_eq!(lines(&Sample { pattern: "{uuid}".into(), ..sample(SampleKind::Pattern, 1) }, 8)[0].len(), 36);
    }

    #[test]
    fn gives_the_same_lines_for_the_same_seed() {
        assert_eq!(lines(&sample(SampleKind::Names, 10), 42), lines(&sample(SampleKind::Names, 10), 42));
        assert_ne!(lines(&sample(SampleKind::Names, 10), 42), lines(&sample(SampleKind::Names, 10), 43));
    }

    #[test]
    fn refuses_nothing_no_pattern_and_too_much() {
        assert_eq!(write(&sample(SampleKind::Names, 0), &mut Dice::seeded(1)), Err(OpError::BadChoice("nothing to write")));
        assert_eq!(write(&sample(SampleKind::Pattern, 3), &mut Dice::seeded(1)), Err(OpError::BadChoice("a pattern is needed")));
        assert_eq!(write(&sample(SampleKind::Names, 10_000_000), &mut Dice::seeded(1)), Err(OpError::BadChoice("too much to write")));
    }
}
