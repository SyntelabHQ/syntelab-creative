//! Sorting lines (or paragraphs): by their letters as a language orders
//! them, or by what they say — numbers, dates, addresses, versions, titles.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::net::{Ipv4Addr, Ipv6Addr};

use serde::Deserialize;

use super::keys::{delimiter_of, KeyOf, Part};
use super::lines::{leading_number, moved, Shuffler};
use super::{lines_of, text_of, Outcome};
use crate::language::collation::Sorter;

/// What lines are sorted by.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SortBy {
    /// By their letters, in the order of the language: as its dictionaries have them.
    #[default]
    Alphabetical,
    /// Like alphabetical, but numbers inside the lines count as numbers: `file2` before `file10`.
    Natural,
    /// By the number each line starts with; lines without one come last.
    Numeric,
    /// By how many characters they have.
    Length,
    /// By how many words they have.
    Words,
    /// By the date they start with; lines without one come last.
    Date,
    /// By the internet address they start with.
    Ip,
    /// By the version number they start with: 1.2.10 after 1.2.9.
    Version,
    /// As titles are sorted: an article at the start does not count.
    Title,
    /// In an order given by the user.
    Custom,
    /// In no order: shuffled.
    Random,
}

/// How a date written with numbers only is read when it could be read both ways: 03/04/2024.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DateOrder {
    /// The day first: 3 April. As most of the world writes.
    #[default]
    DayFirst,
    /// The month first: 4 March. As the United States write.
    MonthFirst,
}

/// A sort with its choices, as the interface asks for it.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Sorting {
    pub by: SortBy,
    pub descending: bool,
    pub case_sensitive: bool,
    /// The code of the language whose order of letters is used: `ro`, `sv`…
    pub language: Option<String>,
    /// The part of each line that is compared.
    pub key: KeyOf,
    pub position: usize,
    pub delimiter: String,
    /// The first line stays first: it names the columns.
    pub keep_header: bool,
    /// Paragraphs are sorted, not lines: each by its first line.
    pub blocks: bool,
    pub date_order: DateOrder,
    /// For `custom`: the values in the order they are to come, one to a line or parted by commas.
    pub order: String,
    /// For `random`: the same seed gives the same order.
    pub seed: Option<u64>,
    /// Before sorting: spaces at the ends of lines go, empty lines go, lines that are there twice stay once.
    pub trim: bool,
    pub remove_empty: bool,
    pub unique: bool,
}

/// A day and a time, as numbers that compare as they follow each other.
type Moment = (i32, u32, u32, u32, u32, u32);

/// The numbers at the start of a text, with what parts them: `2024-03-05`, `5.3.2024 14:30`.
fn numbers_at_start(text: &str, most: usize) -> (Vec<u32>, Vec<char>) {
    let mut numbers = Vec::new();
    let mut between = Vec::new();
    let mut letters = text.trim_start().chars().peekable();
    while numbers.len() < most {
        let mut written = String::new();
        while let Some(digit) = letters.peek().filter(|letter| letter.is_ascii_digit()) {
            written.push(*digit);
            letters.next();
        }
        let Ok(number) = written.parse::<u32>() else {
            break;
        };
        numbers.push(number);
        match letters.peek() {
            Some(mark @ ('-' | '.' | '/' | ':' | ' ' | 'T')) => {
                between.push(*mark);
                letters.next();
            }
            _ => break,
        }
    }
    (numbers, between)
}

/// The date a text starts with, if it starts with one: year first (2024-03-05), or day and month and year.
pub fn date_at_start(text: &str, order: DateOrder) -> Option<Moment> {
    let (numbers, between) = numbers_at_start(text, 6);
    let [first, second, third] = *numbers.get(..3)? else {
        return None;
    };
    if !matches!(between.first(), Some('-' | '.' | '/')) || between.first() != between.get(1) {
        return None;
    }
    let (year, month, day) = if first > 31 {
        (first, second, third)
    } else if third > 31 {
        // Where only one reading is a date, it is that one whatever was asked.
        let month_first = second > 12 || (order == DateOrder::MonthFirst && first <= 12);
        if month_first {
            (third, first, second)
        } else {
            (third, second, first)
        }
    } else {
        return None;
    };
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    // A time follows after a space or a T, its parts parted by colons.
    let timed = matches!(between.get(2), Some(' ' | 'T')) && between.get(3) == Some(&':');
    let time = |at: usize| if timed { numbers.get(at).copied().unwrap_or(0) } else { 0 };
    Some((year as i32, month, day, time(3), time(4), time(5)))
}

/// The first run of characters without spaces.
fn first_token(text: &str) -> &str {
    text.split_whitespace().next().unwrap_or("")
}

/// The internet address a text starts with: the older kind (four numbers) before the newer.
fn address_at_start(text: &str) -> Option<(u8, u128)> {
    let token = first_token(text).trim_end_matches([',', ';']);
    // An address may come with a port or with how much of it names the network: 10.0.0.1:80, 10.0.0.0/8.
    let bare = token.split('/').next().unwrap_or(token);
    if let Ok(address) = bare.parse::<Ipv4Addr>() {
        return Some((0, u128::from(u32::from(address))));
    }
    if let Some(address) = bare.rsplit_once(':').and_then(|(address, _)| address.parse::<Ipv4Addr>().ok()) {
        return Some((0, u128::from(u32::from(address))));
    }
    bare.trim_matches(['[', ']']).parse::<Ipv6Addr>().ok().map(|address| (1, u128::from(address)))
}

/// The version a text starts with: its numbers, and whether it is the finished one (1.2.0 comes after 1.2.0-beta).
fn version_at_start(text: &str) -> Option<(Vec<u64>, bool, String)> {
    let token = first_token(text);
    let written = token.strip_prefix(['v', 'V']).unwrap_or(token);
    let (numbers, rest) = written.split_once(['-', '+']).map_or((written, ""), |(numbers, rest)| (numbers, rest));
    let parts: Option<Vec<u64>> = numbers.split('.').map(|part| part.parse().ok()).collect();
    let parts = parts.filter(|parts| !parts.is_empty())?;
    // What follows a hyphen names a version that is not the finished one yet (1.2.0-beta); a plus only adds a note.
    Some((parts, !written.contains('-'), rest.to_lowercase()))
}

/// The words a language puts before a name without their counting when titles are sorted.
fn articles_of(language: Option<&str>) -> &'static [&'static str] {
    match language.map(|code| code.split(['-', '_']).next().unwrap_or(code).to_lowercase()).as_deref() {
        Some("ro") => &["un", "o", "niște"],
        Some("fr") => &["le", "la", "les", "un", "une", "des", "l'", "l’"],
        Some("de") => &["der", "die", "das", "ein", "eine"],
        Some("es") => &["el", "la", "los", "las", "un", "una", "unos", "unas"],
        Some("it") => &["il", "lo", "la", "i", "gli", "le", "un", "uno", "una", "l'", "l’"],
        Some("pt") => &["o", "a", "os", "as", "um", "uma"],
        Some("nl") => &["de", "het", "een"],
        _ => &["the", "a", "an"],
    }
}

/// A title without the article it starts with.
fn without_article<'t>(title: &'t str, articles: &[&str]) -> &'t str {
    let trimmed = title.trim_start();
    for article in articles {
        let Some(start) = trimmed.get(..article.len()) else {
            continue;
        };
        if !start.eq_ignore_ascii_case(article) && start.to_lowercase() != *article {
            continue;
        }
        let rest = &trimmed[article.len()..];
        // An article that ends in an apostrophe is joined to the word; any other is parted from it by a space.
        if article.ends_with(['\'', '’']) {
            return rest;
        }
        if rest.starts_with(char::is_whitespace) && !rest.trim_start().is_empty() {
            return rest.trim_start();
        }
    }
    trimmed
}

/// Two things that may be missing: what is there comes first, in its order (from the last to the first when
/// `descending`). A line without what is sorted by stays after the others whichever way they are sorted, as
/// empty cells do in a table.
fn present_first<T: PartialOrd>(one: Option<T>, other: Option<T>, descending: bool) -> Ordering {
    match (one, other) {
        (Some(first), Some(second)) => {
            let ordering = first.partial_cmp(&second).unwrap_or(Ordering::Equal);
            if descending { ordering.reverse() } else { ordering }
        }
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (None, None) => Ordering::Equal,
    }
}

/// The values of an order given by the user, each with its place in it.
fn places_in_order(order: &str, case_sensitive: bool) -> HashMap<String, usize> {
    let values: Vec<&str> = if order.contains('\n') { order.split('\n').collect() } else { order.split(',').collect() };
    let mut places = HashMap::new();
    for value in values.iter().map(|value| value.trim()).filter(|value| !value.is_empty()) {
        let known = if case_sensitive { value.to_owned() } else { value.to_lowercase() };
        let next = places.len();
        places.entry(known).or_insert(next);
    }
    places
}

/// Sorts the lines of a text (or its paragraphs) as asked.
pub fn sort(text: &str, sorting: &Sorting) -> Outcome {
    let (lines, ended) = lines_of(text);
    // What is done before sorting.
    let mut kept: Vec<&str> = lines.iter().map(|line| if sorting.trim { line.trim() } else { line }).filter(|line| !(sorting.remove_empty && line.trim().is_empty())).collect();
    if sorting.unique {
        let mut seen = std::collections::HashSet::new();
        kept.retain(|line| seen.insert(if sorting.case_sensitive { (*line).to_owned() } else { line.to_lowercase() }));
    }
    let header = if sorting.keep_header && !kept.is_empty() { Some(kept.remove(0)) } else { None };

    // What is sorted: lines, or paragraphs (each a run of lines that are not empty).
    let mut units: Vec<Vec<&str>> = if sorting.blocks {
        kept.split(|line| line.trim().is_empty()).filter(|block| !block.is_empty()).map(<[&str]>::to_vec).collect()
    } else {
        kept.iter().map(|line| vec![*line]).collect()
    };

    let delimiter = delimiter_of(&sorting.delimiter);
    let part = Part { of: sorting.key, position: sorting.position, delimiter: &delimiter };
    let language = sorting.language.as_deref();
    let letters = Sorter::new(language, sorting.case_sensitive, sorting.by == SortBy::Natural);
    let articles = articles_of(language);
    let in_order = places_in_order(&sorting.order, sorting.case_sensitive);
    // Lines the language holds for the same (they differ in case only) keep a fixed order among themselves.
    let by_letters = |one: &str, other: &str| letters.compare(one, other).then_with(|| one.cmp(other));
    let descending = sorting.descending;
    let directed = |ordering: Ordering| if descending { ordering.reverse() } else { ordering };
    let compare = |one: &Vec<&str>, other: &Vec<&str>| {
        let (first, second) = (part.of(one[0]), part.of(other[0]));
        let by_what_they_say = match sorting.by {
            SortBy::Alphabetical | SortBy::Natural | SortBy::Random => Ordering::Equal,
            SortBy::Numeric => present_first(leading_number(first), leading_number(second), descending),
            SortBy::Length => directed(first.chars().count().cmp(&second.chars().count())),
            SortBy::Words => directed(first.split_whitespace().count().cmp(&second.split_whitespace().count())),
            SortBy::Date => present_first(date_at_start(first, sorting.date_order), date_at_start(second, sorting.date_order), descending),
            SortBy::Ip => present_first(address_at_start(first), address_at_start(second), descending),
            SortBy::Version => present_first(version_at_start(first), version_at_start(second), descending),
            SortBy::Title => directed(by_letters(without_article(first, articles), without_article(second, articles))),
            SortBy::Custom => {
                let place = |value: &str| in_order.get(&if sorting.case_sensitive { value.trim().to_owned() } else { value.trim().to_lowercase() }).copied();
                present_first(place(first), place(second), descending)
            }
        };
        by_what_they_say.then_with(|| directed(by_letters(first, second))).then_with(|| directed(one[0].cmp(other[0])))
    };

    if sorting.by == SortBy::Random {
        let seed = sorting.seed.unwrap_or_else(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(1, |since| since.as_nanos() as u64));
        let mut numbers = Shuffler::new(seed);
        for index in (1..units.len()).rev() {
            units.swap(index, numbers.below(index + 1));
        }
    } else {
        units.sort_by(compare);
    }

    let mut sorted: Vec<&str> = header.into_iter().collect();
    for (index, unit) in units.iter().enumerate() {
        // Paragraphs stay parted by one empty line.
        if sorting.blocks && (index > 0 || !sorted.is_empty()) {
            sorted.push("");
        }
        sorted.extend(unit);
    }
    let changed = moved(&lines, &sorted) + lines.len().abs_diff(sorted.len());
    Outcome { changed, text: text_of(&sorted, ended) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lines_without_what_is_sorted_by_stay_last_both_ways() {
        let numbers = Sorting { by: SortBy::Numeric, ..Sorting::default() };
        assert_eq!(sort("10 x\nnone\n-2 y\n3 z", &numbers).text, "-2 y\n3 z\n10 x\nnone");
        assert_eq!(sort("10 x\nnone\n-2 y\n3 z", &Sorting { descending: true, ..numbers }).text, "10 x\n3 z\n-2 y\nnone");
        let own = Sorting { by: SortBy::Custom, order: "small, large".into(), ..Sorting::default() };
        assert_eq!(sort("other\nlarge\nsmall", &Sorting { descending: true, ..own }).text, "large\nsmall\nother");
    }

    fn by(by: SortBy) -> Sorting {
        Sorting { by, ..Sorting::default() }
    }

    fn sorted(text: &str, sorting: &Sorting) -> String {
        sort(text, sorting).text
    }

    #[test]
    fn sorts_as_a_dictionary_would() {
        assert_eq!(sorted("pear\nApple\nfig", &by(SortBy::Alphabetical)), "Apple\nfig\npear");
        assert_eq!(sorted("b\nA\na\nB", &Sorting { case_sensitive: true, ..Sorting::default() }), "a\nA\nb\nB");
        assert_eq!(sorted("a\nb\nc\n", &Sorting { descending: true, ..Sorting::default() }), "c\nb\na\n");
    }

    #[test]
    fn sorts_by_the_order_of_the_language_asked_for() {
        let romanian = Sorting { language: Some("ro".into()), ..Sorting::default() };
        assert_eq!(sorted("șarpe\nsus\nsoare\ntata\nțară", &romanian), "soare\nsus\nșarpe\ntata\nțară");
    }

    #[test]
    fn sorts_numbers_and_lengths_and_words() {
        assert_eq!(sorted("file10\nfile2\nfile1", &by(SortBy::Natural)), "file1\nfile2\nfile10");
        assert_eq!(sorted("10 mere\n9 pere\nfără\n-2 prune\n1,5 kg", &by(SortBy::Numeric)), "-2 prune\n1,5 kg\n9 pere\n10 mere\nfără");
        assert_eq!(sorted("lung\nab\nabc\na", &by(SortBy::Length)), "a\nab\nabc\nlung");
        assert_eq!(sorted("unu doi trei\nunu\nunu doi", &by(SortBy::Words)), "unu\nunu doi\nunu doi trei");
    }

    #[test]
    fn says_how_many_lines_moved() {
        assert_eq!(sort("a\nb\nc", &Sorting::default()).changed, 0);
        assert_eq!(sort("b\na\nc", &Sorting::default()).changed, 2);
    }

    #[test]
    fn sorts_dates_however_they_are_written() {
        assert_eq!(sorted("2024-03-05 a\n2023-12-31 b\nfără dată\n2024-01-01 c", &by(SortBy::Date)), "2023-12-31 b\n2024-01-01 c\n2024-03-05 a\nfără dată");
        assert_eq!(sorted("05.03.2024\n31.12.2023\n01.01.2024", &by(SortBy::Date)), "31.12.2023\n01.01.2024\n05.03.2024");
        // 03/04/2024: 3 April for most, 4 March where the month is written first.
        assert_eq!(sorted("03/04/2024\n20/03/2024", &by(SortBy::Date)), "20/03/2024\n03/04/2024");
        let american = Sorting { date_order: DateOrder::MonthFirst, ..by(SortBy::Date) };
        assert_eq!(sorted("03/04/2024\n02/20/2024\n04/01/2024", &american), "02/20/2024\n03/04/2024\n04/01/2024");
        assert_eq!(sorted("2024-03-05 14:30\n2024-03-05 09:05\n2024-03-05T08:00:10", &by(SortBy::Date)), "2024-03-05T08:00:10\n2024-03-05 09:05\n2024-03-05 14:30");
        assert_eq!(date_at_start("12.34", DateOrder::DayFirst), None);
        assert_eq!(date_at_start("1.2.3", DateOrder::DayFirst), None);
        assert_eq!(date_at_start("2024-13-01", DateOrder::DayFirst), None);
    }

    #[test]
    fn sorts_addresses_and_versions_by_their_numbers() {
        assert_eq!(sorted("192.168.1.10\n10.0.0.1\n192.168.1.9\nnu\n::1\n10.0.0.1:8080 x", &by(SortBy::Ip)), "10.0.0.1\n10.0.0.1:8080 x\n192.168.1.9\n192.168.1.10\n::1\nnu");
        assert_eq!(sorted("v1.10.0\n1.2.0\nv1.2.0-beta\n1.9\nnimic", &by(SortBy::Version)), "v1.2.0-beta\n1.2.0\n1.9\nv1.10.0\nnimic");
    }

    #[test]
    fn sorts_titles_without_their_articles() {
        assert_eq!(sorted("The Zebra\nA Bear\nAn Ant\nCat", &by(SortBy::Title)), "An Ant\nA Bear\nCat\nThe Zebra");
        let french = Sorting { language: Some("fr".into()), ..by(SortBy::Title) };
        assert_eq!(sorted("Le Zèbre\nL'Abeille\nUne Chèvre", &french), "L'Abeille\nUne Chèvre\nLe Zèbre");
        // A word that only starts like an article is not one, and an article alone is the title.
        assert_eq!(without_article("Theatre", articles_of(None)), "Theatre");
        assert_eq!(without_article("The", articles_of(None)), "The");
    }

    #[test]
    fn sorts_by_a_part_of_the_line() {
        let second_word = Sorting { key: KeyOf::Word, position: 2, ..Sorting::default() };
        assert_eq!(sorted("Ana Popescu\nIon Albu\nMaria Ionescu", &second_word), "Ion Albu\nMaria Ionescu\nAna Popescu");
        let third_column = Sorting { key: KeyOf::Column, position: 3, delimiter: ";".into(), keep_header: true, ..by(SortBy::Numeric) };
        assert_eq!(sorted("nume;oraș;vârsta\nAna;Iași;34\nIon;Cluj;9\nDan;Arad;120", &third_column), "nume;oraș;vârsta\nIon;Cluj;9\nAna;Iași;34\nDan;Arad;120");
        let from_fourth = Sorting { key: KeyOf::Character, position: 4, ..Sorting::default() };
        assert_eq!(sorted("01 zebra\n02 arici", &from_fourth), "02 arici\n01 zebra");
    }

    #[test]
    fn sorts_in_an_order_that_is_given() {
        let sizes = Sorting { order: "mic, mediu, mare".into(), ..by(SortBy::Custom) };
        assert_eq!(sorted("mare\nMic\naltceva\nmediu\nmic", &sizes), "Mic\nmic\nmediu\nmare\naltceva");
        let listed = Sorting { order: "luni\nmarți\nmiercuri".into(), key: KeyOf::Word, position: 1, ..by(SortBy::Custom) };
        assert_eq!(sorted("miercuri\nluni\nmarți", &listed), "luni\nmarți\nmiercuri");
    }

    #[test]
    fn sorts_paragraphs_by_their_first_line() {
        let blocks = Sorting { blocks: true, ..Sorting::default() };
        assert_eq!(sorted("pere\n  galbene\n\n\nmere\n  roșii\n\ncaise\n", &blocks), "caise\n\nmere\n  roșii\n\npere\n  galbene\n");
    }

    #[test]
    fn shuffles_the_same_way_for_the_same_seed() {
        let random = Sorting { seed: Some(7), ..by(SortBy::Random) };
        let shuffled = sorted("1\n2\n3\n4\n5\n6\n7\n8", &random);
        assert_eq!(shuffled, sorted("1\n2\n3\n4\n5\n6\n7\n8", &random));
        assert_ne!(shuffled, "1\n2\n3\n4\n5\n6\n7\n8");
        let mut lines: Vec<&str> = shuffled.split('\n').collect();
        lines.sort_unstable();
        assert_eq!(lines.join(""), "12345678");
    }

    #[test]
    fn tidies_before_sorting_when_asked() {
        let tidy = Sorting { trim: true, remove_empty: true, unique: true, ..Sorting::default() };
        let outcome = sort("  pere \n\nmere\nPere\n   \nmere\n", &tidy);
        assert_eq!(outcome.text, "mere\npere\n");
        assert!(outcome.changed > 0);
    }
}
