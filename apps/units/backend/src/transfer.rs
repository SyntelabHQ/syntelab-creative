//! A table as text, both ways: what is copied and exported, what is pasted
//! and imported.
//!
//! Text is rows of cells with a tab, a comma or a semicolon between them, as
//! spreadsheets write and read it. Going out, a table is written in the
//! columns that are asked for, row by row. Coming in, each row of the text
//! becomes a row of the table; a first row that names units says which
//! column is which.
//!
//! A row of the table holds one value, in the unit it was typed in. So of a
//! row of text that has several values, the first one is taken: the others
//! are what the table computes from it anyway.

use std::collections::HashMap;
use std::io::{self, Write};

use crate::table::{Set, Table, TableError, Writing};

/// Rows written at a time.
const BLOCK: usize = 2000;

/// What stands between the cells of a row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// Tabs: what a spreadsheet copies and pastes.
    Tsv,
    /// Commas; semicolons where the comma is the decimal mark. Cells that need it are quoted.
    Csv,
    /// A list of rows, each with its values by the title of their column.
    Json,
}

/// How a table is written as text.
pub struct Layout<'a> {
    pub writing: Writing<'a>,
    /// The titles of the columns, written first; None for none.
    pub titles: Option<&'a [String]>,
    /// Each row starts with its number.
    pub row_numbers: bool,
    /// Rows become columns and columns rows.
    pub transposed: bool,
    /// The rows written: runs from a first to a last, in order.
    pub runs: &'a [(usize, usize)],
    pub format: Format,
    /// The mark written before decimals: `.` or `,`.
    pub decimal: char,
    /// Told of the rows about to be written, a block at a time: how far the writing has got. False stops it.
    pub watch: Option<&'a dyn Fn(usize) -> bool>,
}

impl Layout<'_> {
    fn separator(&self) -> char {
        match self.format {
            Format::Tsv => '\t',
            _ if self.decimal == ',' => ';',
            _ => ',',
        }
    }
}

/// A cell as CSV writes it: in quotes when it holds what would be read as the end of a cell or of a row.
fn quoted(cell: &str, separator: char) -> String {
    if cell.contains([separator, '"', '\n', '\r']) {
        format!("\"{}\"", cell.replace('"', "\"\""))
    } else {
        cell.to_owned()
    }
}

/// A cell as tabs carry it: what would break the row is a space.
fn tabbed(cell: &str) -> String {
    cell.replace(['\t', '\n', '\r'], " ")
}

/// Whether a cell is a number as the table writes them, and not text.
pub fn is_number(cell: &str) -> bool {
    let digits = cell.strip_prefix('-').unwrap_or(cell);
    !digits.is_empty() && digits.bytes().next().is_some_and(|first| first.is_ascii_digit()) && cell.parse::<f64>().is_ok_and(f64::is_finite)
}

fn json_text(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

/// The rows of a layout, each as its cells: numbers with a point, as the table writes them.
pub fn rows_of<'a>(table: &'a Table, layout: &'a Layout<'a>) -> impl Iterator<Item = Result<(usize, Vec<String>), TableError>> + 'a {
    let columns = layout.writing.units.len();
    layout.runs.iter().flat_map(move |(first, last)| {
        let last = (*last).min(table.len().saturating_sub(1));
        (*first..=last).step_by(BLOCK).flat_map(move |from| {
            let count = BLOCK.min(last - from + 1);
            if layout.watch.is_some_and(|watch| !watch(count)) {
                return vec![Err(TableError::Stopped)];
            }
            match table.shown(from, count, &layout.writing) {
                Ok(shown) => shown.into_iter().enumerate().map(|(at, row)| Ok((from + at, if row.cells.is_empty() { vec![String::new(); columns] } else { row.cells }))).collect::<Vec<_>>(),
                Err(error) => vec![Err(error)],
            }
        })
    })
}

/// What went wrong with a row, as writing says it: stopped by the user (`Interrupted`), or a unit that is not there.
pub fn stopped_or(kind: io::ErrorKind) -> impl Fn(TableError) -> io::Error {
    move |error| match error {
        TableError::Stopped => io::Error::new(io::ErrorKind::Interrupted, "stopped"),
        _ => io::Error::new(kind, "no such unit"),
    }
}

/// Writes a table as text. Answers how many rows of the table were written.
pub fn write(table: &Table, layout: &Layout<'_>, out: &mut dyn Write) -> io::Result<usize> {
    let failed = stopped_or(io::ErrorKind::InvalidInput);
    let text_units: Vec<bool> = layout.writing.units.iter().map(|id| table.converter().unit(id).is_some_and(|unit| unit.numeral().is_some())).collect();
    // A number is written with the decimal mark asked for; what a unit writes as text is left as it is.
    let local = |cell: String, column: usize| if layout.decimal == ',' && !text_units[column] && is_number(&cell) { cell.replace('.', ",") } else { cell };
    let titles: Vec<String> = match layout.titles {
        Some(titles) => titles.to_vec(),
        None => layout.writing.units.to_vec(),
    };
    let mut written = 0;

    if layout.format == Format::Json {
        // Numbers stay numbers; what is not one is text; an empty cell is null.
        let value = |cell: &str, column: usize| if cell.is_empty() { "null".to_owned() } else if !text_units[column] && is_number(cell) { cell.to_owned() } else { json_text(cell) };
        if layout.transposed {
            let mut columns: Vec<Vec<String>> = vec![Vec::new(); titles.len()];
            let mut numbers = Vec::new();
            for row in rows_of(table, layout) {
                let (at, cells) = row.map_err(&failed)?;
                numbers.push((at + 1).to_string());
                cells.iter().enumerate().for_each(|(column, cell)| columns[column].push(value(cell, column)));
                written += 1;
            }
            out.write_all(b"{\n")?;
            if layout.row_numbers {
                writeln!(out, "  \"#\": [{}]{}", numbers.join(", "), if titles.is_empty() { "" } else { "," })?;
            }
            for (column, title) in titles.iter().enumerate() {
                writeln!(out, "  {}: [{}]{}", json_text(title), columns[column].join(", "), if column + 1 < titles.len() { "," } else { "" })?;
            }
            out.write_all(b"}\n")?;
            return Ok(written);
        }
        out.write_all(b"[")?;
        for row in rows_of(table, layout) {
            let (at, cells) = row.map_err(&failed)?;
            let mut fields: Vec<String> = if layout.row_numbers { vec![format!("\"#\": {}", at + 1)] } else { Vec::new() };
            fields.extend(cells.iter().enumerate().map(|(column, cell)| format!("{}: {}", json_text(&titles[column]), value(cell, column))));
            write!(out, "{}\n  {{ {} }}", if written == 0 { "" } else { "," }, fields.join(", "))?;
            written += 1;
        }
        out.write_all(b"\n]\n")?;
        return Ok(written);
    }

    let separator = layout.separator();
    let cell = |text: &str| if layout.format == Format::Csv { quoted(text, separator) } else { tabbed(text) };
    let line = |out: &mut dyn Write, cells: &[String]| -> io::Result<()> {
        let joined = cells.iter().map(|text| cell(text)).collect::<Vec<_>>().join(&separator.to_string());
        out.write_all(joined.as_bytes())?;
        out.write_all(b"\r\n")
    };
    if layout.transposed {
        // Each column of the table is a line: its title, then its values. The whole of it is needed before the first line.
        let mut lines: Vec<Vec<String>> = titles.iter().map(|title| if layout.titles.is_some() { vec![title.clone()] } else { Vec::new() }).collect();
        let mut numbers: Vec<String> = if layout.titles.is_some() { vec!["#".to_owned()] } else { Vec::new() };
        for row in rows_of(table, layout) {
            let (at, cells) = row.map_err(&failed)?;
            numbers.push((at + 1).to_string());
            cells.into_iter().enumerate().for_each(|(column, text)| lines[column].push(local(text, column)));
            written += 1;
        }
        if layout.row_numbers {
            line(out, &numbers)?;
        }
        for cells in &lines {
            line(out, cells)?;
        }
        return Ok(written);
    }
    if layout.titles.is_some() {
        let mut head: Vec<String> = if layout.row_numbers { vec!["#".to_owned()] } else { Vec::new() };
        head.extend(titles.iter().cloned());
        line(out, &head)?;
    }
    for row in rows_of(table, layout) {
        let (at, cells) = row.map_err(&failed)?;
        let mut all: Vec<String> = if layout.row_numbers { vec![(at + 1).to_string()] } else { Vec::new() };
        all.extend(cells.into_iter().enumerate().map(|(column, text)| local(text, column)));
        line(out, &all)?;
        written += 1;
    }
    Ok(written)
}

/// What stands between the cells of a text: a tab where there is one; else a semicolon or a comma, whichever the first
/// lines have more of (a comma that is the decimal mark is not counted for much: semicolons win a tie).
pub fn separator_of(text: &str) -> char {
    let sample: String = text.lines().take(20).collect::<Vec<_>>().join("\n");
    if sample.contains('\t') {
        return '\t';
    }
    let count = |mark: char| sample.matches(mark).count();
    if count(';') > 0 && count(';') >= count(',') / 2 {
        ';'
    } else if count(',') > 0 {
        ','
    } else {
        '\t'
    }
}

/// Text as rows of cells, read one row at a time: a text of millions of rows is never held twice.
/// Cells in quotes may hold the separator, line ends, and quotes written twice.
pub struct Rows<'a> {
    letters: std::iter::Peekable<std::str::Chars<'a>>,
    separator: char,
}

/// The rows of a text, one at a time.
pub fn rows(text: &str, separator: char) -> Rows<'_> {
    Rows { letters: text.strip_prefix('\u{feff}').unwrap_or(text).chars().peekable(), separator }
}

impl Iterator for Rows<'_> {
    type Item = Vec<String>;

    fn next(&mut self) -> Option<Vec<String>> {
        self.letters.peek()?;
        let mut row = Vec::new();
        let mut cell = String::new();
        let mut in_quotes = false;
        let mut started = false;
        while let Some(letter) = self.letters.next() {
            if in_quotes {
                match letter {
                    '"' if self.letters.peek() == Some(&'"') => {
                        self.letters.next();
                        cell.push('"');
                    }
                    '"' => in_quotes = false,
                    other => cell.push(other),
                }
                continue;
            }
            match letter {
                '"' if cell.is_empty() && !started => {
                    in_quotes = true;
                    started = true;
                }
                '\r' => {}
                '\n' => {
                    row.push(cell);
                    return Some(row);
                }
                other if other == self.separator => {
                    row.push(std::mem::take(&mut cell));
                    started = false;
                }
                other => cell.push(other),
            }
        }
        row.push(cell);
        Some(row)
    }
}

/// Text as rows of cells, all at once.
pub fn grid(text: &str, separator: char) -> Vec<Vec<String>> {
    rows(text, separator).collect()
}

/// Rows as columns and columns as rows.
pub fn transposed(rows: &[Vec<String>]) -> Vec<Vec<String>> {
    let widest = rows.iter().map(Vec::len).max().unwrap_or(0);
    (0..widest).map(|column| rows.iter().map(|row| row.get(column).cloned().unwrap_or_default()).collect()).collect()
}

/// Where rows of cells go in a table.
pub struct Paste<'a> {
    /// The first row they go to.
    pub row: usize,
    /// The units of the columns they go to when the cells do not say: from the column that is active, in the order drawn.
    pub columns: &'a [String],
    /// What a column may be titled with, and the unit that is: names, symbols, in the language of the program.
    pub names: &'a HashMap<String, String>,
    /// The mark the language of the program writes before decimals.
    pub decimal: char,
}

/// What became of rows of cells.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Pasted {
    /// Rows of the table that took a value.
    pub rows: usize,
    /// Of them, those where what was written is not a number.
    pub wrong: usize,
    /// The units the cells went to, in the order of their columns. With titles, they may not be columns of the table yet.
    pub units: Vec<String>,
    /// The first row was titles.
    pub titled: bool,
    /// Columns that had nowhere to go.
    pub left_out: usize,
}

/// The unit a title names: as it is written, or with other capitals when only one unit answers to that.
fn unit_named(title: &str, table: &Table, names: &HashMap<String, String>) -> Option<String> {
    let title = title.trim();
    if title.is_empty() {
        return None;
    }
    let known = |id: &str| table.converter().unit(id).map(|unit| unit.id.clone());
    if let Some(id) = names.get(title) {
        return known(id);
    }
    if let Some(unit) = table.converter().units.iter().find(|unit| unit.id == title || unit.symbol == title) {
        return Some(unit.id.clone());
    }
    let lower = title.to_lowercase();
    let mut found = names.iter().filter(|(name, _)| name.to_lowercase() == lower).map(|(_, id)| id);
    let first = found.next()?;
    found.all(|other| other == first).then(|| known(first)).flatten()
}

/// Puts rows of cells into a table, as one change. The rows are taken as they come, so a text of millions of rows is
/// read once; `about` says how many there may be (a change of many rows keeps the whole table to undo it).
/// Refused when the computer has no memory left for the rows: what was written till then is part of the change.
pub fn paste(table: &mut Table, rows: impl IntoIterator<Item = Vec<String>>, about: usize, paste: &Paste<'_>) -> Result<Pasted, TableError> {
    let mut rows = rows.into_iter().peekable();
    let Some(first) = rows.peek() else { return Ok(Pasted::default()) };
    // Titles: a first row where something names a unit. Values never do. A "#" there stands over the row numbers.
    let named: Vec<Option<String>> = first.iter().map(|cell| unit_named(cell, table, paste.names)).collect();
    let numbered = first.first().is_some_and(|cell| cell.trim() == "#");
    let titled = named.iter().any(Option::is_some);
    if titled {
        rows.next();
    }
    // The unit a column of the text goes to; None for a column that is left out.
    let unit_of = |column: usize| if titled { named.get(column).cloned().flatten() } else { paste.columns.get(column).cloned() };
    let mut pasted = Pasted { titled, ..Pasted::default() };
    let mut widest = if titled { named.len() } else { 0 };
    let mut used: Vec<bool> = Vec::new();
    table.change(about, |table| {
        for (at, cells) in rows.enumerate() {
            let row = paste.row.saturating_add(at);
            widest = widest.max(cells.len());
            // The first cell with something in it drives the row; the others are what the table computes from it.
            let Some((column, unit, cell)) = cells.iter().enumerate().find_map(|(column, cell)| if cell.trim().is_empty() { None } else { unit_of(column).map(|unit| (column, unit, cell)) }) else { continue };
            if used.len() <= column {
                used.resize(column + 1, false);
            }
            used[column] = true;
            match table.set(row, &unit, cell, paste.decimal)? {
                Set::Emptied => {}
                Set::Wrong => {
                    pasted.rows += 1;
                    pasted.wrong += 1;
                }
                _ => pasted.rows += 1,
            }
        }
        Ok::<(), TableError>(())
    })??;
    // With titles, every unit they name; without, the units of the columns the cells went to.
    pasted.units = (0..widest).filter(|column| titled || used.get(*column).copied().unwrap_or(false)).filter_map(unit_of).collect();
    pasted.left_out = (0..widest).filter(|column| unit_of(*column).is_none() && !(*column == 0 && titled && numbered)).count();
    Ok(pasted)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog;
    use crate::precision::Extremes;

    fn length() -> Table {
        Table::new(std::sync::Arc::clone(catalog::by_id("length").expect("a converter")), 3)
    }

    fn text(table: &Table, units: &[&str], format: Format, decimal: char, transposed: bool, titles: bool, row_numbers: bool) -> String {
        let units: Vec<String> = units.iter().map(|unit| (*unit).to_owned()).collect();
        let none = HashMap::new();
        let titles_of: Vec<String> = units.iter().map(|unit| format!("unit {unit}")).collect();
        let runs = [(0, table.len().saturating_sub(1))];
        let layout = Layout { writing: Writing { units: &units, decimals: &none, extremes: Extremes::Scientific }, titles: titles.then_some(&titles_of[..]), row_numbers, transposed, runs: &runs, format, decimal, watch: None };
        let mut out = Vec::new();
        write(table, &layout, &mut out).expect("written");
        String::from_utf8(out).expect("text")
    }

    #[test]
    fn writes_a_table_as_text() {
        let mut table = length();
        table.set(0, "m", "1.5", '.').expect("set");
        table.set(2, "cm", "abc", '.').expect("set");
        assert_eq!(text(&table, &["m", "cm"], Format::Tsv, '.', false, true, false), "unit m\tunit cm\r\n1.5\t150.00\r\n\t\r\n\tabc\r\n");
        assert_eq!(text(&table, &["m", "cm"], Format::Tsv, ',', false, false, true), "1\t1,5\t150,00\r\n2\t\t\r\n3\t\tabc\r\n");
        // With a comma before the decimals, CSV is written with semicolons.
        assert_eq!(text(&table, &["m", "cm"], Format::Csv, ',', false, false, false), "1,5;150,00\r\n;\r\n;abc\r\n");
        assert_eq!(text(&table, &["m", "cm"], Format::Tsv, '.', true, true, true), "#\t1\t2\t3\r\nunit m\t1.5\t\t\r\nunit cm\t150.00\t\tabc\r\n");
        assert_eq!(text(&table, &["m", "cm"], Format::Json, ',', false, true, false), "[\n  { \"unit m\": 1.5, \"unit cm\": 150.00 },\n  { \"unit m\": null, \"unit cm\": null },\n  { \"unit m\": null, \"unit cm\": \"abc\" }\n]\n");
        assert_eq!(text(&table, &["m"], Format::Json, '.', true, true, false), "{\n  \"unit m\": [1.5, null, null]\n}\n");
        assert_eq!(quoted("a,b \"c\"", ','), "\"a,b \"\"c\"\"\"");
    }

    #[test]
    fn reads_text_as_rows_of_cells() {
        assert_eq!(separator_of("a\tb,c\n1\t2"), '\t');
        assert_eq!(separator_of("a;b\n1,5;2,5"), ';');
        assert_eq!(separator_of("a,b\n1.5,2.5"), ',');
        assert_eq!(grid("a,\"b,\"\"c\"\"\nd\",e\r\n1,2", ','), [vec!["a", "b,\"c\"\nd", "e"], vec!["1", "2"]]);
        assert_eq!(grid("\u{feff}1\t2\n", '\t'), [vec!["1", "2"]]);
        assert_eq!(transposed(&grid("1\t2\n3", '\t')), [vec!["1", "3"], vec!["2", ""]]);
    }

    #[test]
    fn pastes_very_many_rows_quickly() {
        let mut table = length();
        let names = HashMap::new();
        let columns = vec!["m".to_owned()];
        let many = 300_000;
        let text: String = (0..many).map(|at| format!("{}.5\n", at)).collect();
        let started = std::time::Instant::now();
        let pasted = paste(&mut table, rows(&text, '\t'), many, &Paste { row: 0, columns: &columns, names: &names, decimal: '.' }).expect("pasted");
        assert_eq!((pasted.rows, pasted.wrong, table.filled()), (many, 0, many));
        assert_eq!(shown(&table, &["m"]).split(" / ").nth(many - 1), Some("299999.5"));
        assert!(started.elapsed().as_secs() < 20, "{:?}", started.elapsed());
        // One change, however many rows.
        assert!(table.undo());
        assert_eq!(table.filled(), 0);
        // Writing it out can be stopped: nothing more is asked of the table.
        let units = vec!["m".to_owned()];
        let (none, runs) = (HashMap::new(), [(0, many - 1)]);
        let seen = std::cell::Cell::new(0);
        let watch = |more: usize| {
            seen.set(seen.get() + more);
            seen.get() <= 3 * BLOCK
        };
        let layout = Layout { writing: Writing { units: &units, decimals: &none, extremes: Extremes::Scientific }, titles: None, row_numbers: false, transposed: false, runs: &runs, format: Format::Tsv, decimal: '.', watch: Some(&watch) };
        table.redo();
        let stopped = write(&table, &layout, &mut Vec::new()).expect_err("stopped");
        assert_eq!((stopped.kind(), seen.get()), (io::ErrorKind::Interrupted, 4 * BLOCK));
    }

    fn shown(table: &Table, units: &[&str]) -> String {
        text(table, units, Format::Tsv, '.', false, false, false).replace("\r\n", " / ")
    }

    #[test]
    fn pastes_rows_where_they_are_asked() {
        let mut table = length();
        let names: HashMap<String, String> = [("Meter", "m"), ("foot", "ft")].into_iter().map(|(name, id)| (name.to_owned(), id.to_owned())).collect();
        let columns = vec!["cm".to_owned(), "m".to_owned()];
        // No titles: the cells go to the columns from the active one; of a row, the first value drives.
        let pasted = paste(&mut table, grid("5\t9\n\t2\nx\n", '\t'), 3, &Paste { row: 1, columns: &columns, names: &names, decimal: '.' }).expect("pasted");
        assert_eq!(pasted, Pasted { rows: 3, wrong: 1, units: columns.clone(), titled: false, left_out: 0 });
        assert_eq!(shown(&table, &["cm", "m"]), "\t / 5\t0.05 / 200.00\t2 / x\t / ");
        // One change: undone together.
        assert!(table.undo());
        assert_eq!(table.filled(), 0);
        // Titles say which column is which, whatever the columns of the table; "#" stands over row numbers.
        // A column whose title names no unit is left out.
        let pasted = paste(&mut table, grid("#;meter;ft;Price\n1;1,5;;7\n2;;3;8", ';'), 3, &Paste { row: 0, columns: &columns, names: &names, decimal: ',' }).expect("pasted");
        assert_eq!(pasted, Pasted { rows: 2, wrong: 0, units: vec!["m".to_owned(), "ft".to_owned()], titled: true, left_out: 1 });
        assert_eq!(shown(&table, &["m", "ft"]), "1.5\t4.92 / 0.914\t3 / \t / \t / ");
    }
}
