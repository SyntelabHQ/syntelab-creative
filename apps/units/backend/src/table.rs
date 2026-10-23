//! The table of a converter: rows of values, each typed in one unit.
//!
//! Only what was typed is kept: for each row, the value and the unit it was
//! typed in (the unit that "drives" the row). What the other columns show is
//! computed when it is asked for, so a table of millions of rows costs a few
//! bytes a row and nothing is ever out of date.
//!
//! A row is sixteen bytes while its value is an ordinary number: the value as
//! a double with the decimals it was typed with, from which the typed digits
//! come back exactly. A value with more digits than a double holds exactly is
//! kept as its text, apart.
//!
//! Every change can be undone: the rows it touched are kept as they were
//! (or, for a change of very many rows, the whole table is), and undoing
//! swaps them back. Redoing is the same swap the other way.
//!
//! A table is as long as the memory of the computer lets it be: there is no
//! most it holds. Room for rows is asked for in a way that can be refused,
//! and a refusal is an answer (`NoMemory`), not the end of the program.

use std::collections::HashMap;
use std::sync::Arc;

use crate::catalog::Converter;
use crate::convert;
use crate::number::{self, Number};
use crate::numeral;
use crate::precision::{self, Extremes};
use crate::reading::{self, Read, ReadError};

/// The digits a double gives back exactly.
const EXACT_DIGITS: usize = 15;
/// No unit drives the row: it is empty.
const NOBODY: u16 = u16::MAX;
/// The most letters kept of something typed that is not a number.
const LONGEST_TEXT: usize = 200;

/// What became of something typed into a cell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Set {
    /// Read as a number.
    Read,
    /// Read as a number, though it could have been read another way.
    Ambiguous,
    /// Nothing was written: the row is empty.
    Emptied,
    /// Not a number: kept as written, and shown as wrong.
    Wrong,
}

/// The most changes that can be undone.
const MOST_UNDONE: usize = 200;
/// A change of more rows than this keeps the whole table as it was, instead of its rows one by one.
const MANY_ROWS: usize = 20_000;

/// What was typed in a row.
#[derive(Clone, Copy, PartialEq)]
struct Typed {
    value: f64,
    /// The decimals it was typed with.
    decimals: u8,
    /// The place, among the units of the converter, of the unit it was typed in.
    driver: u16,
}

const EMPTY: Typed = Typed { value: 0.0, decimals: 0, driver: NOBODY };

/// A row as it is kept: what was typed, and what of it does not fit beside the others.
#[derive(Clone, PartialEq)]
struct Kept {
    typed: Typed,
    long: Option<Box<str>>,
    text: Option<Box<str>>,
}

/// What a change replaced. Swapped with what is there, it undoes the change; swapped again, it does it again.
enum Change {
    /// Some rows.
    Rows(Vec<(usize, Kept)>),
    /// The whole table.
    Whole { rows: Vec<Typed>, long: HashMap<usize, Box<str>>, texts: HashMap<usize, Box<str>> },
}

/// A change while it is being made.
enum Open {
    /// The rows touched so far, as they were.
    Rows(HashMap<usize, Kept>),
    /// The whole table was kept before the first row was touched.
    Whole,
}

#[derive(Default)]
struct History {
    undone: Vec<Change>,
    redone: Vec<Change>,
    open: Option<Open>,
    /// The next change of very many rows is made without keeping the table as it was: there is no room for both.
    forgo: bool,
    /// The change made last left something to undo.
    made: bool,
}

/// A number written plainly: digits, at most one decimal mark, a minus before them, and no more digits than a double
/// keeps exactly. Anything else (thousands, a power of ten, a mark that could be read two ways) is None, and is read
/// the long way.
fn plain(written: &str, decimal: char, driver: u16) -> Option<Typed> {
    let written = written.trim();
    let digits = written.strip_prefix('-').unwrap_or(written);
    let (whole, part) = match digits.split_once(decimal) {
        Some((whole, part)) => (whole, part),
        None => (digits, ""),
    };
    let all_digits = |text: &str| text.bytes().all(|letter| letter.is_ascii_digit());
    if whole.is_empty() || !all_digits(whole) || !all_digits(part) || whole.len() + part.len() > EXACT_DIGITS || part.len() > u8::MAX as usize {
        return None;
    }
    // "1,234" where the comma is the decimal mark could be a thousand written the other way: left to the long way, which says so.
    if part.len() == 3 && (1..=3).contains(&whole.len()) && whole != "0" {
        return None;
    }
    let value: f64 = if decimal == '.' { written.parse().ok()? } else { written.replace(decimal, ".").parse().ok()? };
    Some(Typed { value, decimals: part.len() as u8, driver })
}

pub struct Table {
    converter: Arc<Converter>,
    rows: Vec<Typed>,
    /// How many rows have a value: counted as they change, so a table of any length says it at once.
    filled: usize,
    /// The rows whose value a double does not hold exactly, as the digits typed.
    long: HashMap<usize, Box<str>>,
    /// The rows where what was typed is not a number, as it was typed: shown as they are, marked wrong, and not converted.
    texts: HashMap<usize, Box<str>>,
    history: History,
}

/// One row as it is shown: the unit that drives it, and its value in each column asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct ShownRow {
    /// The id of the unit the value was typed in; None for an empty row.
    pub driver: Option<String>,
    /// One text for each column asked for; empty for an empty row.
    pub cells: Vec<String>,
    /// What was typed is not a number: only its own cell says anything, and nothing is converted.
    pub wrong: bool,
}

/// How the columns are to be written.
pub struct Writing<'a> {
    /// The ids of the units, in the order of the columns.
    pub units: &'a [String],
    /// Decimals asked for, by unit, over those of the units.
    pub decimals: &'a HashMap<String, usize>,
    pub extremes: Extremes,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TableError {
    NoSuchUnit,
    /// The computer has no memory left for so many rows: the bytes that were asked for.
    NoMemory(usize),
    /// There is no memory to keep the table as it was, so the change could be undone: the bytes that takes.
    NoMemoryToUndo(usize),
    /// The user stopped what was being done.
    Stopped,
}

/// The bytes so many rows take.
pub fn bytes_of(rows: usize) -> usize {
    rows.saturating_mul(std::mem::size_of::<Typed>())
}

impl Table {
    pub fn new(converter: Arc<Converter>, rows: usize) -> Self {
        Self { converter, rows: vec![EMPTY; rows], filled: 0, long: HashMap::new(), texts: HashMap::new(), history: History::default() }
    }

    pub fn converter(&self) -> &Converter {
        &self.converter
    }

    /// Gives the table its converter anew, after the user's own units or the rates of currencies changed.
    /// A row typed in a unit that is gone is emptied. When the units changed places, what could be undone is
    /// forgotten: it names units by their place.
    pub fn rebased(&mut self, converter: Arc<Converter>) {
        let places: Vec<u16> = self.converter.units.iter().map(|unit| converter.units.iter().position(|known| known.id == unit.id).map_or(NOBODY, |place| place as u16)).collect();
        for row in 0..self.rows.len() {
            let driver = self.rows[row].driver;
            if driver == NOBODY {
                continue;
            }
            match places.get(driver as usize).copied().unwrap_or(NOBODY) {
                NOBODY => self.place(row, Kept { typed: EMPTY, long: None, text: None }),
                place => self.rows[row].driver = place,
            }
        }
        if places.iter().enumerate().any(|(before, now)| *now != before as u16) {
            self.history = History::default();
        }
        self.converter = converter;
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    /// How many rows have a value.
    pub fn filled(&self) -> usize {
        self.filled
    }

    /// Makes sure the table can be `rows` long without asking for memory again. Refused when the computer has none left.
    pub fn room(&mut self, rows: usize) -> Result<(), TableError> {
        let more = rows.saturating_sub(self.rows.len());
        if self.rows.capacity() - self.rows.len() >= more {
            return Ok(());
        }
        // With room to spare for the rows that come next; where that is refused, with just what was asked.
        if self.rows.try_reserve(more).is_ok() || self.rows.try_reserve_exact(more).is_ok() {
            return Ok(());
        }
        Err(TableError::NoMemory(bytes_of(rows)))
    }

    /// Whatever `work` changes is changed without a way back, where the way back would take a copy of the whole table:
    /// asked for by the user, when there is no memory for both. What could be undone before is forgotten then.
    pub fn forgoing_undo<T>(&mut self, work: impl FnOnce(&mut Self) -> T) -> T {
        self.history.forgo = true;
        let answer = work(self);
        self.history.forgo = false;
        answer
    }

    /// The last row that has a value, from 0; None when the table is empty.
    pub fn last_filled(&self) -> Option<usize> {
        self.rows.iter().rposition(|row| row.driver != NOBODY)
    }

    /// Makes the table as long as asked; rows beyond the new end are dropped.
    pub fn resize(&mut self, rows: usize) -> Result<(), TableError> {
        self.room(rows)?;
        // Rows that are dropped with something in them are emptied first, so undoing brings them back.
        if rows < self.rows.len() {
            let dropped: Vec<usize> = (rows..self.rows.len()).filter(|row| self.rows[*row].driver != NOBODY).collect();
            if !dropped.is_empty() {
                self.change(dropped.len(), |table| dropped.iter().for_each(|row| table.put(*row, Kept { typed: EMPTY, long: None, text: None })))?;
            }
        }
        self.rows.resize(rows, EMPTY);
        Ok(())
    }

    /// A row as it is kept; an empty one beyond the end.
    fn kept(&self, row: usize) -> Kept {
        match self.rows.get(row) {
            Some(typed) => Kept { typed: *typed, long: self.long.get(&row).cloned(), text: self.texts.get(&row).cloned() },
            None => Kept { typed: EMPTY, long: None, text: None },
        }
    }

    /// Writes a row, without a word to the history. The table grows to hold it.
    fn place(&mut self, row: usize, kept: Kept) {
        if row >= self.rows.len() {
            if kept.typed.driver == NOBODY {
                return;
            }
            self.rows.resize(row + 1, EMPTY);
        }
        self.filled = self.filled + usize::from(kept.typed.driver != NOBODY) - usize::from(self.rows[row].driver != NOBODY);
        self.rows[row] = kept.typed;
        match kept.long {
            Some(long) => self.long.insert(row, long),
            None => self.long.remove(&row),
        };
        match kept.text {
            Some(text) => self.texts.insert(row, text),
            None => self.texts.remove(&row),
        };
    }

    /// Writes a row as part of the change being made: how it was is kept, the first time it is touched.
    fn put(&mut self, row: usize, kept: Kept) {
        if let Some(Open::Rows(before)) = &self.history.open {
            if !before.contains_key(&row) {
                let was = self.kept(row);
                if let Some(Open::Rows(before)) = &mut self.history.open {
                    before.insert(row, was);
                }
            }
        }
        self.place(row, kept);
    }

    /// The whole table as it is, to be swapped back when a change of very many rows is undone. Where there is no
    /// memory for it, the oldest changes that could be undone are forgotten, one by one, to make some.
    fn copy(&mut self) -> Result<Change, TableError> {
        self.history.redone.clear();
        loop {
            let mut rows: Vec<Typed> = Vec::new();
            if rows.try_reserve_exact(self.rows.len()).is_ok() {
                rows.extend_from_slice(&self.rows);
                return Ok(Change::Whole { rows, long: self.long.clone(), texts: self.texts.clone() });
            }
            if self.history.undone.is_empty() {
                return Err(TableError::NoMemoryToUndo(bytes_of(self.rows.len())));
            }
            self.history.undone.remove(0);
        }
    }

    /// Makes one change of the table, of about `rows` rows: whatever `work` writes is undone, and done again, together.
    /// A change made inside another is part of it. Refused, before anything is written, when it is of very many rows
    /// and there is no memory to keep the table as it was (unless that was forgone: see `forgoing_undo`).
    pub fn change<T>(&mut self, rows: usize, work: impl FnOnce(&mut Self) -> T) -> Result<T, TableError> {
        if self.history.open.is_some() {
            return Ok(work(self));
        }
        self.history.made = false;
        let many = rows > MANY_ROWS;
        let whole = match many {
            true if self.history.forgo => {
                // No way back to before this change: nor, then, to before the ones it comes after.
                self.history.undone.clear();
                self.history.redone.clear();
                None
            }
            true => Some(self.copy()?),
            false => None,
        };
        self.history.open = Some(if many { Open::Whole } else { Open::Rows(HashMap::new()) });
        let answer = work(self);
        let change = match (self.history.open.take(), whole) {
            (_, Some(whole)) => Some(whole),
            (Some(Open::Rows(before)), None) => {
                let mut rows: Vec<(usize, Kept)> = before.into_iter().filter(|(row, was)| self.kept(*row) != *was).collect();
                rows.sort_by_key(|(row, _)| *row);
                (!rows.is_empty()).then_some(Change::Rows(rows))
            }
            _ => None,
        };
        if let Some(change) = change {
            self.history.redone.clear();
            self.history.undone.push(change);
            self.history.made = true;
            if self.history.undone.len() > MOST_UNDONE {
                self.history.undone.remove(0);
            }
        }
        Ok(answer)
    }

    /// Takes back the change that was just made, as if it never was: it was stopped halfway.
    /// False when it cannot be (it was made without a way back): what it wrote stays.
    pub fn take_back(&mut self) -> bool {
        let taken = self.history.made && self.undo();
        if taken {
            self.history.redone.pop();
        }
        taken
    }

    /// Swaps what a change kept with what is there.
    fn swap(&mut self, change: &mut Change) {
        match change {
            Change::Rows(rows) => {
                for (row, kept) in rows.iter_mut() {
                    let now = self.kept(*row);
                    self.place(*row, std::mem::replace(kept, now));
                }
            }
            Change::Whole { rows, long, texts } => {
                std::mem::swap(&mut self.rows, rows);
                std::mem::swap(&mut self.long, long);
                std::mem::swap(&mut self.texts, texts);
                self.filled = self.rows.iter().filter(|row| row.driver != NOBODY).count();
            }
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.history.undone.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.history.redone.is_empty()
    }

    /// Takes the last change back. False when there is none.
    pub fn undo(&mut self) -> bool {
        let Some(mut change) = self.history.undone.pop() else { return false };
        self.swap(&mut change);
        self.history.redone.push(change);
        true
    }

    /// Makes again the change that was taken back last. False when there is none.
    pub fn redo(&mut self) -> bool {
        let Some(mut change) = self.history.redone.pop() else { return false };
        self.swap(&mut change);
        self.history.undone.push(change);
        true
    }

    fn unit_place(&self, unit: &str) -> Result<u16, TableError> {
        self.converter.units.iter().position(|known| known.id == unit).map(|place| place as u16).ok_or(TableError::NoSuchUnit)
    }

    /// Types `written` into the cell of `row` under `unit`: that unit drives the row from now on. Nothing written empties the row.
    /// What is not a number is kept as it was written and shown as wrong: the row converts nothing until it is put right.
    pub fn set(&mut self, row: usize, unit: &str, written: &str, decimal: char) -> Result<Set, TableError> {
        let driver = self.unit_place(unit)?;
        // A plain number ("12", "-3.75") is kept as it is, without the long way round: what a paste of millions of rows is made of.
        if self.converter.units[driver as usize].numeral().is_none() {
            if let Some(typed) = plain(written, decimal, driver) {
                self.room(row.saturating_add(1))?;
                self.change(1, |table| table.put(row, Kept { typed, long: None, text: None }))?;
                return Ok(Set::Read);
            }
        }
        // A unit that writes whole numbers its own way (base 16, Roman numerals) reads them that way.
        let read = match self.converter.units[driver as usize].numeral() {
            Some(_) if written.trim().is_empty() => Err(ReadError::Empty),
            Some(kind) => numeral::read(written, kind).map(|whole| Read { value: Number::from_integer(whole), ambiguous: false, decimals: 0 }).ok_or(ReadError::NotANumber),
            None => reading::read(written, decimal),
        };
        let read = match read {
            Ok(read) => Some(read),
            Err(ReadError::Empty) => {
                self.clear(row)?;
                return Ok(Set::Emptied);
            }
            Err(ReadError::NotANumber) => None,
        };
        self.room(row.saturating_add(1))?;
        let Some(read) = read else {
            let text = written.trim().chars().take(LONGEST_TEXT).collect::<String>().into_boxed_str();
            self.change(1, |table| table.put(row, Kept { typed: Typed { value: 0.0, decimals: 0, driver }, long: None, text: Some(text) }))?;
            return Ok(Set::Wrong);
        };
        // The digits as they were typed, with a point: what comes back when the row is shown.
        let digits = number::to_decimals(&read.value, read.decimals);
        let significant = digits.bytes().filter(u8::is_ascii_digit).count();
        let kept = match digits.parse::<f64>() {
            Ok(value) if significant <= EXACT_DIGITS && read.decimals <= u8::MAX as usize && value.is_finite() => Kept { typed: Typed { value, decimals: read.decimals as u8, driver }, long: None, text: None },
            _ => Kept { typed: Typed { value: 0.0, decimals: 0, driver }, long: Some(digits.into_boxed_str()), text: None },
        };
        self.change(1, |table| table.put(row, kept))?;
        Ok(if read.ambiguous { Set::Ambiguous } else { Set::Read })
    }

    pub fn clear(&mut self, row: usize) -> Result<(), TableError> {
        if self.rows.get(row).is_some_and(|typed| typed.driver != NOBODY) {
            self.change(1, |table| table.put(row, Kept { typed: EMPTY, long: None, text: None }))?;
        }
        Ok(())
    }

    /// Empties runs of rows, from a first to a last, as one change.
    pub fn clear_runs(&mut self, runs: &[(usize, usize)]) -> Result<(), TableError> {
        let last = self.rows.len().saturating_sub(1);
        let rows: usize = runs.iter().map(|(first, end)| (*end).min(last).saturating_sub(*first) + 1).sum();
        self.change(rows, |table| {
            for (first, end) in runs {
                for row in *first..=(*end).min(last) {
                    // Inside the change, a row is emptied without a word of its own.
                    if table.rows.get(row).is_some_and(|typed| typed.driver != NOBODY) {
                        table.put(row, Kept { typed: EMPTY, long: None, text: None });
                    }
                }
            }
        })
    }

    pub fn clear_all(&mut self) -> Result<(), TableError> {
        if self.filled() == 0 {
            return Ok(());
        }
        // The whole table is kept aside, however long it is, and emptied where it stands.
        self.change(usize::MAX, |table| {
            table.rows.iter_mut().for_each(|row| *row = EMPTY);
            table.filled = 0;
            table.long.clear();
            table.texts.clear();
        })
    }

    /// How many rows hold something that is not a number.
    pub fn wrong(&self) -> usize {
        self.texts.len()
    }

    /// The digits typed in a row, with a point before the decimals; None for an empty row.
    fn typed(&self, row: usize) -> Option<String> {
        let typed = self.rows.get(row).filter(|typed| typed.driver != NOBODY)?;
        Some(match self.long.get(&row) {
            Some(digits) => digits.to_string(),
            None => format!("{:.*}", typed.decimals as usize, typed.value),
        })
    }

    /// `count` rows from `from`, each written in the columns asked for. Rows beyond the end are empty.
    pub fn shown(&self, from: usize, count: usize, writing: &Writing<'_>) -> Result<Vec<ShownRow>, TableError> {
        let converter = Arc::clone(&self.converter);
        let columns: Vec<_> = writing.units.iter().map(|id| converter.unit(id).ok_or(TableError::NoSuchUnit)).collect::<Result<_, _>>()?;
        let decimals: Vec<usize> = columns.iter().map(|unit| writing.decimals.get(&unit.id).copied().or(unit.decimals).unwrap_or(precision::USUAL_DECIMALS)).collect();
        let mut rows = Vec::with_capacity(count);
        for row in from..from.saturating_add(count) {
            if let Some(text) = self.texts.get(&row) {
                let driver = &converter.units[self.rows[row].driver as usize];
                let cells = columns.iter().map(|unit| if unit.id == driver.id { text.to_string() } else { String::new() }).collect();
                rows.push(ShownRow { driver: Some(driver.id.clone()), cells, wrong: true });
                continue;
            }
            let shown = self.typed(row).and_then(|digits| {
                let driver = &converter.units[self.rows[row].driver as usize];
                let value: Number = number::exact(&digits)?;
                let cells = columns
                    .iter()
                    .zip(&decimals)
                    // The cell that was typed in shows what was typed; the others, the value in their unit.
                    .map(|(unit, decimals)| if unit.id == driver.id && unit.numeral().is_none() { digits.clone() } else { precision::written_in(convert::convert(&value, driver, unit).as_ref(), unit, *decimals, writing.extremes) })
                    .collect();
                Some(ShownRow { driver: Some(driver.id.clone()), cells, wrong: false })
            });
            rows.push(shown.unwrap_or(ShownRow { driver: None, cells: Vec::new(), wrong: false }));
        }
        Ok(rows)
    }
}

impl Table {
    /// The longest text each column asked for shows, over the rows that have a value: what a column is fitted to.
    /// At most `most` rows are looked at, from the top.
    pub fn longest(&self, writing: &Writing<'_>, most: usize) -> Result<Vec<String>, TableError> {
        let mut longest = vec![String::new(); writing.units.len()];
        let filled = self.rows.iter().enumerate().filter(|(_, row)| row.driver != NOBODY).map(|(at, _)| at).take(most);
        for row in filled {
            for shown in self.shown(row, 1, writing)? {
                for (kept, cell) in longest.iter_mut().zip(shown.cells) {
                    if cell.chars().count() > kept.chars().count() {
                        *kept = cell;
                    }
                }
            }
        }
        Ok(longest)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;

    #[test]
    fn finds_the_longest_text_of_each_column() {
        let mut table = length(5);
        table.set(0, "m", "1", '.').expect("set");
        table.set(3, "m", "1234.5", '.').expect("set");
        let units = vec!["m".to_owned(), "cm".to_owned()];
        let none = HashMap::new();
        let longest = table.longest(&Writing { units: &units, decimals: &none, extremes: Extremes::Scientific }, 100).expect("longest");
        assert_eq!(longest, ["1234.5", "123450.00"]);
    }

    fn length(rows: usize) -> Table {
        Table::new(Arc::clone(catalog::by_id("length").expect("a converter")), rows)
    }

    fn shown(table: &Table, from: usize, count: usize, units: &[&str]) -> Vec<String> {
        let units: Vec<String> = units.iter().map(|unit| (*unit).to_owned()).collect();
        let none = HashMap::new();
        let rows = table.shown(from, count, &Writing { units: &units, decimals: &none, extremes: Extremes::Scientific }).expect("rows");
        rows.into_iter().map(|row| format!("{}: {}", row.driver.as_deref().unwrap_or("-"), row.cells.join(" | "))).collect()
    }

    #[test]
    fn the_cell_typed_in_drives_its_row() {
        let mut table = length(3);
        assert_eq!(table.set(0, "cm", "5", '.'), Ok(Set::Read));
        assert_eq!(table.set(1, "in", "2.00", '.'), Ok(Set::Read));
        assert_eq!(shown(&table, 0, 3, &["cm", "in", "m"]), ["cm: 5 | 1.97 | 0.05", "in: 5.08 | 2.00 | 0.0508", "-: "]);
        // Typed again under another unit: that one drives the row now.
        assert_eq!(table.set(0, "m", "1,5", ','), Ok(Set::Read));
        assert_eq!(shown(&table, 0, 1, &["cm", "in", "m"]), ["m: 150.00 | 59.06 | 1.5"]);
        assert_eq!((table.filled(), table.last_filled()), (2, Some(1)));
    }

    #[test]
    fn nothing_typed_empties_the_row_and_what_is_not_a_number_is_kept_as_wrong() {
        let mut table = length(2);
        table.set(0, "m", "7", '.').expect("set");
        assert_eq!(table.set(0, "m", " abc ", '.'), Ok(Set::Wrong));
        // Its own cell says what was typed; the others say nothing.
        assert_eq!(shown(&table, 0, 1, &["cm", "m"]), ["m:  | abc"]);
        assert_eq!((table.filled(), table.wrong()), (1, 1));
        // Put right: it converts again.
        assert_eq!(table.set(0, "m", "7", '.'), Ok(Set::Read));
        assert_eq!((shown(&table, 0, 1, &["m"]), table.wrong()), (vec!["m: 7".to_owned()], 0));
        assert_eq!(table.set(0, "m", "  ", '.'), Ok(Set::Emptied));
        assert_eq!(shown(&table, 0, 1, &["m"]), ["-: "]);
        assert_eq!(table.set(0, "parsnip", "1", '.'), Err(TableError::NoSuchUnit));
    }

    #[test]
    fn grows_when_a_row_beyond_its_end_is_typed_in() {
        let mut table = length(2);
        table.set(9, "m", "1", '.').expect("set");
        assert_eq!(table.len(), 10);
        assert_eq!(shown(&table, 8, 3, &["cm"]), ["-: ", "m: 100.00", "-: "]);
        // No most it holds: a row the computer has no memory for is refused, and the table is as it was.
        assert!(matches!(table.set(usize::MAX / 64, "m", "1", '.'), Err(TableError::NoMemory(_))));
        assert_eq!((table.len(), table.filled()), (10, 1));
        table.resize(5).expect("resized");
        assert_eq!((table.len(), table.filled()), (5, 0));
    }

    #[test]
    fn keeps_every_digit_of_a_value_a_double_cannot_hold() {
        let mut table = length(1);
        let long = "123456789012345678901234567890.123456789";
        table.set(0, "m", long, '.').expect("set");
        // The typed cell shows every digit typed; the other, an extreme value, is written with a power of ten.
        assert_eq!(shown(&table, 0, 1, &["m", "km"]), [format!("m: {long} | 1.23457e26")]);
        // Back to an ordinary value: the long one is forgotten.
        table.set(0, "m", "0.1", '.').expect("set");
        assert_eq!(shown(&table, 0, 1, &["m", "mm"]), ["m: 0.1 | 100.00"]);
        assert!(table.long.is_empty());
    }

    #[test]
    fn undoes_and_redoes_changes() {
        let mut table = length(3);
        table.set(0, "m", "1", '.').expect("set");
        table.set(0, "m", "2", '.').expect("set");
        table.set(1, "cm", "abc", '.').expect("set");
        assert!(table.can_undo() && !table.can_redo());
        assert!(table.undo());
        assert_eq!((shown(&table, 0, 2, &["m"]), table.wrong()), (vec!["m: 2".to_owned(), "-: ".to_owned()], 0));
        assert!(table.undo());
        assert_eq!(shown(&table, 0, 1, &["m"]), ["m: 1"]);
        assert!(table.redo() && table.redo() && !table.redo());
        assert_eq!((shown(&table, 0, 2, &["m", "cm"]), table.wrong()), (vec!["m: 2 | 200.00".to_owned(), "cm:  | abc".to_owned()], 1));
        // A new change forgets what was undone.
        table.undo();
        table.set(2, "m", "9", '.').expect("set");
        assert!(!table.can_redo());
        // Emptying is one change, whatever it empties; so is a run of rows.
        table.clear_all().expect("cleared");
        assert_eq!(table.filled(), 0);
        table.undo();
        assert_eq!(table.filled(), 2);
        table.clear_runs(&[(0, 2)]).expect("cleared");
        assert_eq!(table.filled(), 0);
        table.undo();
        assert_eq!(shown(&table, 0, 3, &["m"]), ["m: 2", "-: ", "m: 9"]);
        // Typing the same again, or emptying what is empty, is no change.
        let before = table.history.undone.len();
        table.set(0, "m", "2", '.').expect("set");
        table.clear(1).expect("cleared");
        assert_eq!(table.history.undone.len(), before);
        // Rows dropped by making the table shorter come back.
        table.resize(1).expect("resized");
        table.undo();
        assert_eq!(shown(&table, 2, 1, &["m"]), ["m: 9"]);
    }

    #[test]
    fn a_change_of_many_rows_is_taken_back_or_made_without_a_way_back() {
        let mut table = length(3);
        table.set(0, "m", "1", '.').expect("set");
        // Stopped halfway: as if it never was, and what was undone before it is not brought back by it.
        table.change(MANY_ROWS + 1, |table| table.set(1, "m", "2", '.')).expect("changed").expect("set");
        assert!(table.take_back());
        assert_eq!((table.filled(), table.can_redo(), table.can_undo()), (1, false, true));
        // Without a way back: nothing before it can be undone either.
        table.forgoing_undo(|table| table.change(MANY_ROWS + 1, |table| table.set(2, "m", "3", '.'))).expect("changed").expect("set");
        assert_eq!((table.filled(), table.can_undo(), table.take_back()), (2, false, false));
        // A small change is undone as ever, forgone or not.
        table.forgoing_undo(|table| table.set(1, "m", "5", '.')).expect("set");
        assert!(table.undo());
        assert_eq!(table.filled(), 2);
    }

    #[test]
    fn keeps_its_rows_when_the_users_own_units_change() {
        let length = catalog::by_id("length").expect("a converter");
        let own = |id: &str| catalog::OwnUnit { id: id.to_owned(), name: id.to_owned(), symbol: id.to_owned(), reference: "m".to_owned(), factor: Some("2".to_owned()), offset: None, to_reference: None, from_reference: None, decimals: None };
        let mut table = Table::new(Arc::new(catalog::with_own(length, &[own("a"), own("b")]).expect("built")), 3);
        table.set(0, "a", "1", '.').expect("set");
        table.set(1, "b", "1", '.').expect("set");
        table.set(2, "ft", "1", '.').expect("set");
        // "a" is taken out: its row is emptied; the others stay as they were typed.
        table.rebased(Arc::new(catalog::with_own(length, &[own("b")]).expect("built")));
        assert_eq!(shown(&table, 0, 3, &["m"]), ["-: ", "b: 2.00", "ft: 0.305"]);
        assert!(!table.can_undo());
    }

    #[test]
    fn reads_and_writes_whole_numbers_as_their_unit_does() {
        let mut table = Table::new(Arc::clone(catalog::by_id("number-base").expect("a converter")), 2);
        assert_eq!(table.set(0, "hexadecimal", "ff", '.'), Ok(Set::Read));
        assert_eq!(shown(&table, 0, 1, &["hexadecimal", "decimal", "binary", "roman"]), ["hexadecimal: FF | 255 | 11111111 | CCLV"]);
        assert_eq!(table.set(1, "binary", "102", '.'), Ok(Set::Wrong));
        assert_eq!(table.set(1, "roman", "XIV", '.'), Ok(Set::Read));
        assert_eq!(shown(&table, 1, 1, &["decimal", "base60"]), ["roman: 14 | 14"]);
    }

    #[test]
    fn says_so_where_a_unit_has_no_such_value() {
        let mut table = Table::new(Arc::clone(catalog::by_id("sound").expect("a converter")), 1);
        table.set(0, "pascal", "0", '.').expect("set");
        assert_eq!(shown(&table, 0, 1, &["pascal", "db-spl"]), ["pascal: 0 | —"]);
    }

    #[test]
    fn says_when_what_was_typed_was_ambiguous() {
        let mut table = length(1);
        assert_eq!(table.set(0, "m", "1,234", '.'), Ok(Set::Ambiguous));
        assert_eq!(shown(&table, 0, 1, &["m"]), ["m: 1234"]);
    }

    #[test]
    fn a_table_of_a_million_rows_is_small_and_quick_to_read_anywhere() {
        let mut table = length(1_000_000);
        assert_eq!(std::mem::size_of::<Typed>(), 16, "what a row costs, with the room the processor leaves between its parts");
        table.set(999_999, "km", "42", '.').expect("set");
        assert_eq!(shown(&table, 999_998, 2, &["m"]), ["-: ", "km: 42000.00"]);
    }
}
