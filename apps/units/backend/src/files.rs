//! Tables written to files and read from them.
//!
//! Text (CSV, TSV, JSON) is written as `transfer` writes it, straight to the
//! file, a block of rows at a time. Excel workbooks are written with
//! `rust_xlsxwriter` and read with `calamine`: numbers stay numbers there.
//!
//! Nothing here has a most it takes but what Excel itself has: a table longer
//! than a sheet goes on on the next sheet. Memory that is asked for by the
//! size of a file or of a table is asked for in a way that can be refused.
//!
//! The clipboard of the system is read and written here too (`arboard`): the
//! interface would have to ask the user for leave each time it reads it.

use std::fs::File;
use std::io::{self, BufWriter, Read, Write};
use std::path::Path;

use calamine::{Data, Reader};
use rust_xlsxwriter::{Workbook, Worksheet, XlsxError};

use crate::table::Table;
use crate::transfer::{self, Layout};

/// What a sheet of Excel holds at most.
const EXCEL_ROWS: usize = 1_048_576;
const EXCEL_COLUMNS: usize = 16_384;

/// Says that the computer has no memory left: the message is the bytes that were asked for.
pub fn no_memory(bytes: usize) -> io::Error {
    io::Error::new(io::ErrorKind::OutOfMemory, bytes.to_string())
}

/// Text that is written in memory, to be copied: it grows only while the computer has memory for it.
#[derive(Default)]
pub struct Held(pub Vec<u8>);

impl Write for Held {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.0.try_reserve(bytes.len()).is_err() {
            return Err(no_memory(self.0.len().saturating_add(bytes.len())));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Writes a table to a text file. Answers how many rows of the table were written.
pub fn write_text(table: &Table, layout: &Layout<'_>, path: &Path) -> io::Result<usize> {
    let mut out = BufWriter::new(File::create(path)?);
    // Marked as UTF-8, so a spreadsheet reads the letters of every language. Not JSON: its readers refuse the mark.
    if layout.format != transfer::Format::Json {
        out.write_all("\u{feff}".as_bytes())?;
    }
    let written = transfer::write(table, layout, &mut out)?;
    out.flush()?;
    Ok(written)
}

fn too_large() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "more than a sheet holds")
}

/// Where a cell of the table is on its sheet: transposed, rows are columns.
fn place(layout: &Layout<'_>, row: usize, column: usize) -> (u32, u16) {
    if layout.transposed {
        (column as u32, row as u16)
    } else {
        (row as u32, column as u16)
    }
}

/// A new sheet of the workbook, with the titles of the columns when they are asked for.
/// Written row after row, a sheet is not held in memory: a table of millions of rows is written as it goes.
fn new_sheet<'w>(workbook: &'w mut Workbook, layout: &Layout<'_>) -> Result<&'w mut Worksheet, XlsxError> {
    let sheet = if layout.transposed { workbook.add_worksheet() } else { workbook.add_worksheet_with_constant_memory() };
    if let Some(titles) = layout.titles {
        let side = usize::from(layout.row_numbers);
        if layout.row_numbers {
            let (row, column) = place(layout, 0, 0);
            sheet.write_string(row, column, "#")?;
        }
        for (at, title) in titles.iter().enumerate() {
            let (row, column) = place(layout, 0, at + side);
            sheet.write_string(row, column, title)?;
        }
    }
    Ok(sheet)
}

/// Writes a table to an Excel workbook: numbers as numbers, what is not a number as text.
/// What does not fit on a sheet (1,048,576 rows; 16,384 columns) goes on on the next one, under the same titles.
pub fn write_excel(table: &Table, layout: &Layout<'_>, path: &Path) -> io::Result<usize> {
    let other = |error: XlsxError| io::Error::other(error.to_string());
    let failed = transfer::stopped_or(io::ErrorKind::NotFound);
    let text_units: Vec<bool> = layout.writing.units.iter().map(|id| table.converter().unit(id).is_some_and(|unit| unit.numeral().is_some())).collect();
    let (head, side) = (usize::from(layout.titles.is_some()), usize::from(layout.row_numbers));
    // The rows of the table go down the sheet, or across it when transposed; the units go the other way.
    let (rows_fit, units_fit) = if layout.transposed { (EXCEL_COLUMNS, EXCEL_ROWS) } else { (EXCEL_ROWS, EXCEL_COLUMNS) };
    if layout.writing.units.len() + side > units_fit {
        return Err(too_large());
    }
    let on_a_sheet = rows_fit - head;
    let mut workbook = Workbook::new();
    let mut sheet = new_sheet(&mut workbook, layout).map_err(other)?;
    let mut written = 0;
    for row in transfer::rows_of(table, layout) {
        let (number, cells) = row.map_err(&failed)?;
        if written > 0 && written % on_a_sheet == 0 {
            sheet = new_sheet(&mut workbook, layout).map_err(other)?;
        }
        let line = written % on_a_sheet + head;
        if layout.row_numbers {
            let (row, column) = place(layout, line, 0);
            sheet.write_number(row, column, (number + 1) as f64).map_err(other)?;
        }
        for (at, cell) in cells.iter().enumerate() {
            if cell.is_empty() {
                continue;
            }
            let (row, column) = place(layout, line, at + side);
            match cell.parse::<f64>() {
                Ok(value) if !text_units[at] && transfer::is_number(cell) => sheet.write_number(row, column, value),
                _ => sheet.write_string(row, column, cell),
            }
            .map_err(other)?;
        }
        written += 1;
    }
    workbook.save(path).map_err(other)?;
    Ok(written)
}

/// Text as it is on disk, whatever it is written in: UTF-8, or UTF-16 with its mark, as spreadsheets save "Unicode text".
fn decoded(bytes: Vec<u8>) -> String {
    let wide = |big: bool| {
        let units: Vec<u16> = bytes[2..].chunks_exact(2).map(|pair| if big { u16::from_be_bytes([pair[0], pair[1]]) } else { u16::from_le_bytes([pair[0], pair[1]]) }).collect();
        String::from_utf16_lossy(&units)
    };
    match bytes[..] {
        [0xFF, 0xFE, ..] => wide(false),
        [0xFE, 0xFF, ..] => wide(true),
        // Text that is UTF-8 already is taken as it is, without a second copy of it.
        _ => String::from_utf8(bytes).unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()),
    }
}

/// What a file holds: the cells of a sheet, or text that is read into rows as they are wanted.
pub enum Source {
    Cells(Vec<Vec<String>>),
    Text { text: String, separator: char },
}

/// Reads a file as rows of cells. `kind` is `excel`, `csv`, `tsv`, or `auto` to tell by its name and by what is in it.
/// Numbers of a workbook are written with `decimal` before their decimals, as the rest of what is pasted is read.
pub fn read(path: &Path, kind: &str, decimal: char) -> io::Result<Source> {
    let extension = path.extension().and_then(|extension| extension.to_str()).unwrap_or("").to_ascii_lowercase();
    let workbook = kind == "excel" || (kind == "auto" && matches!(extension.as_str(), "xlsx" | "xlsm" | "xlsb" | "xls" | "ods"));
    if workbook {
        let other = |error: calamine::Error| io::Error::other(error.to_string());
        let mut book = calamine::open_workbook_auto(path).map_err(other)?;
        let Some(range) = book.worksheet_range_at(0) else { return Ok(Source::Cells(Vec::new())) };
        let range = range.map_err(other)?;
        let local = |number: String| if decimal == ',' { number.replace('.', ",") } else { number };
        let cells = range
            .rows()
            .map(|row| {
                row.iter()
                    .map(|cell| match cell {
                        Data::Empty => String::new(),
                        Data::Int(whole) => whole.to_string(),
                        Data::Float(value) => local(value.to_string()),
                        other => other.to_string(),
                    })
                    .collect()
            })
            .collect();
        return Ok(Source::Cells(cells));
    }
    // A text file of any size, while the computer has memory for it.
    let mut file = File::open(path)?;
    let size = usize::try_from(file.metadata()?.len()).unwrap_or(usize::MAX);
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(size.saturating_add(1)).is_err() {
        return Err(no_memory(size));
    }
    file.read_to_end(&mut bytes)?;
    let text = decoded(bytes);
    let separator = match kind {
        "tsv" => '\t',
        // A file called CSV may be written with commas or with semicolons.
        "csv" => match transfer::separator_of(&text) {
            '\t' => ',',
            found => found,
        },
        _ => transfer::separator_of(&text),
    };
    Ok(Source::Text { text, separator })
}

/// Puts text on the clipboard of the system.
pub fn copy(text: String) -> Result<(), String> {
    arboard::Clipboard::new().and_then(|mut clipboard| clipboard.set_text(text)).map_err(|error| error.to_string())
}

/// The text the clipboard of the system holds; nothing when it holds something else.
pub fn copied() -> Result<String, String> {
    match arboard::Clipboard::new().and_then(|mut clipboard| clipboard.get_text()) {
        Ok(text) => Ok(text),
        Err(arboard::Error::ContentNotAvailable) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}
