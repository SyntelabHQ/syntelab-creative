//! CSV looked at as a table, a part at a time.
//!
//! The text is read once from end to end, and only where every hundredth row begins is kept, with how many rows
//! and columns there are. The rows in sight are then read from where they are: a file is as large as the disk lets
//! it be, and what is kept of it grows by eight bytes for a hundred rows.
//!
//! Nothing is refused here: a table is for looking at, so a quote that is never closed takes what is left, and
//! what stands after a closing quote is kept as it is. What is wrong is told by the tool when it converts.

use std::fs::File;
use std::io::{self, BufRead, BufReader, Cursor, Read, Seek, SeekFrom};
use std::path::PathBuf;

use crate::codec::CodecError;

/// Where each row begins is kept for one row in so many.
const EVERY: u64 = 100;
/// How much of the start is read to tell the sign between the fields.
const TOLD_FROM: usize = 1024 * 1024;
/// The longest text kept of a column, in letters: what its width is fitted to.
const LONGEST_KEPT: usize = 300;

pub enum Source {
    File(PathBuf),
    Text(Vec<u8>),
}

pub struct Table {
    source: Source,
    separator: u8,
    /// The names of the columns, when the first row held them.
    pub names: Vec<String>,
    pub rows: u64,
    pub columns: usize,
    /// The longest text of each column.
    pub longest: Vec<String>,
    /// Where rows 0, 100, 200… begin, in bytes.
    starts: Vec<u64>,
}

/// Reads one row. Gives how many bytes it took (0 at the end of the text), and whether it is a line with nothing on it.
fn record(reader: &mut dyn BufRead, separator: u8, fields: &mut Vec<String>) -> io::Result<(u64, bool)> {
    fields.clear();
    let mut field: Vec<u8> = Vec::new();
    let mut taken = 0u64;
    let mut quoted = false;
    let mut any_quote = false;
    let mut at_start = true;
    let mut ended = false;
    while !ended {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            break;
        }
        let mut used = 0usize;
        for &byte in buffer {
            used += 1;
            if quoted {
                if byte == b'"' {
                    quoted = false;
                } else {
                    field.push(byte);
                }
                continue;
            }
            match byte {
                b'"' if at_start => {
                    quoted = true;
                    any_quote = true;
                    at_start = false;
                }
                // A quote right after a closing quote is one of a pair: it is a quote of the field.
                b'"' if any_quote && !at_start => {
                    field.push(b'"');
                    quoted = true;
                }
                b'\n' | b'\r' => {
                    ended = true;
                    break;
                }
                other if other == separator => {
                    fields.push(String::from_utf8_lossy(&field).into_owned());
                    field.clear();
                    at_start = true;
                    any_quote = false;
                    continue;
                }
                other => {
                    field.push(other);
                    at_start = false;
                }
            }
        }
        let last = buffer.get(used.wrapping_sub(1)).copied();
        reader.consume(used);
        taken += used as u64;
        // A line feed right after a carriage return belongs to it.
        if ended && last == Some(b'\r') && reader.fill_buf()?.first() == Some(&b'\n') {
            reader.consume(1);
            taken += 1;
        }
    }
    let blank = fields.is_empty() && field.is_empty() && !any_quote;
    fields.push(String::from_utf8_lossy(&field).into_owned());
    Ok((taken, blank))
}

fn reader(source: &Source) -> io::Result<Box<dyn SeekRead + '_>> {
    Ok(match source {
        Source::File(path) => Box::new(BufReader::with_capacity(256 * 1024, File::open(path)?)),
        Source::Text(text) => Box::new(Cursor::new(text.as_slice())),
    })
}

impl Table {

    /// Reads the text from end to end. `separator`: the sign between the fields, or none to tell it from the first
    /// row. `header`: the first row holds the names of the columns. `watch` is told how many bytes were read, and
    /// stops the reading by answering false.
    pub fn open(source: Source, separator: Option<u8>, header: bool, watch: &mut dyn FnMut(u64) -> bool) -> Result<Table, CodecError> {
        let mut sign = separator.unwrap_or(b',');
        let mut starts: Vec<u64> = Vec::new();
        let mut longest: Vec<(usize, String)> = Vec::new();
        let mut names: Option<Vec<String>> = None;
        let (mut rows, mut columns) = (0u64, 0usize);
        {
            let mut reader = reader(&source)?;
            let mut start = Vec::new();
            reader.by_ref().take(TOLD_FROM as u64).read_to_end(&mut start)?;
            // The mark some programs put before a text is not part of it.
            let mut at = if start.starts_with(&[0xEF, 0xBB, 0xBF]) { 3u64 } else { 0 };
            if separator.is_none() {
                sign = crate::csv::Read::told(&String::from_utf8_lossy(&start[at as usize..]), true).unwrap_or(b',');
            }
            drop(start);
            reader.seek(SeekFrom::Start(at))?;
            let mut fields = Vec::new();
            loop {
                let (taken, blank) = record(&mut *reader, sign, &mut fields)?;
                if taken == 0 {
                    break;
                }
                let began = at;
                at += taken;
                if blank {
                    continue;
                }
                if header && names.is_none() {
                    names = Some(std::mem::take(&mut fields));
                    continue;
                }
                if rows % EVERY == 0 {
                    if starts.try_reserve(1).is_err() {
                        return Err(CodecError::NoMemory);
                    }
                    starts.push(began);
                    if !watch(at) {
                        return Err(CodecError::Stopped);
                    }
                }
                rows += 1;
                columns = columns.max(fields.len());
                for (index, text) in fields.iter().enumerate() {
                    if index >= longest.len() {
                        longest.resize(index + 1, (0, String::new()));
                    }
                    // Counted in bytes first: only a text that may be longer is counted in letters.
                    if text.len() > longest[index].0 {
                        let letters = text.chars().count();
                        if letters > longest[index].0 {
                            longest[index] = (letters, text.chars().take(LONGEST_KEPT).collect());
                        }
                    }
                }
            }
        }
        let names = names.unwrap_or_default();
        Ok(Table { source, separator: sign, columns: columns.max(names.len()), names, rows, longest: longest.into_iter().map(|(_, text)| text).collect(), starts })
    }

    /// The rows from `from` on, `count` of them at most; each with as many fields as it has.
    pub fn read(&self, from: u64, count: usize) -> io::Result<Vec<Vec<String>>> {
        let mut rows = Vec::new();
        let Some(&start) = self.starts.get((from / EVERY) as usize) else { return Ok(rows) };
        let mut reader = reader(&self.source)?;
        reader.seek(SeekFrom::Start(start))?;
        let mut to_skip = from % EVERY;
        let mut fields = Vec::new();
        while rows.len() < count {
            let (taken, blank) = record(&mut *reader, self.separator, &mut fields)?;
            if taken == 0 {
                break;
            }
            if blank {
                continue;
            }
            if to_skip > 0 {
                to_skip -= 1;
                continue;
            }
            rows.push(std::mem::take(&mut fields));
        }
        Ok(rows)
    }

    /// The sign between the fields, as it is shown: itself, or `Tab`.
    pub fn separator(&self) -> String {
        match self.separator {
            b'\t' => "Tab".to_owned(),
            other => char::from(other).to_string(),
        }
    }
}

trait SeekRead: BufRead + Seek {}
impl<T: BufRead + Seek> SeekRead for T {}

#[cfg(test)]
mod tests {
    use super::*;

    fn table(text: &str, separator: Option<u8>, header: bool) -> Table {
        Table::open(Source::Text(text.as_bytes().to_vec()), separator, header, &mut |_| true).expect("read")
    }

    #[test]
    fn a_table_is_counted_and_its_rows_are_read_where_they_are() {
        let read = table("\u{feff}name;age;note\r\nAna;30;\"said \"\"hi\"\"; twice\"\n\n\"Bo\nJr\";7\rCy;1;2;3", None, true);
        assert_eq!((read.names.clone(), read.rows, read.columns, read.separator()), (vec!["name".to_string(), "age".into(), "note".into()], 3, 4, ";".to_string()));
        assert_eq!(read.read(0, 10).expect("rows"), vec![vec!["Ana", "30", "said \"hi\"; twice"], vec!["Bo\nJr", "7"], vec!["Cy", "1", "2", "3"]]);
        assert_eq!(read.read(2, 1).expect("rows"), vec![vec!["Cy", "1", "2", "3"]]);
        assert!(read.read(3, 5).expect("rows").is_empty());
        assert_eq!(read.longest, vec!["Bo\nJr", "30", "said \"hi\"; twice", "3"]);
    }

    #[test]
    fn rows_far_into_a_long_table_are_found_without_reading_those_before() {
        let mut text = String::new();
        for row in 0..1234 {
            text.push_str(&format!("{row},\"v{row}\"\n"));
            if row % 7 == 0 {
                text.push('\n');
            }
        }
        let read = table(&text, Some(b','), false);
        assert_eq!((read.rows, read.columns, read.starts.len()), (1234, 2, 13));
        assert_eq!(read.read(999, 3).expect("rows"), vec![vec!["999", "v999"], vec!["1000", "v1000"], vec!["1001", "v1001"]]);
        assert_eq!(read.read(1233, 9).expect("rows"), vec![vec!["1233", "v1233"]]);
    }

    #[test]
    fn nothing_is_refused_and_reading_can_be_stopped() {
        let read = table("a,\"open\nb,c", None, false);
        assert_eq!(read.read(0, 5).expect("rows"), vec![vec!["a", "open\nb,c"]]);
        let read = table("\"x\"y,z\n", None, false);
        assert_eq!(read.read(0, 5).expect("rows"), vec![vec!["xy", "z"]]);
        assert_eq!(table("", None, true).rows, 0);
        assert!(matches!(Table::open(Source::Text(b"a\nb\n".to_vec()), None, false, &mut |_| false), Err(CodecError::Stopped)));
    }

    #[test]
    fn a_file_is_read_from_disk() {
        let path = std::env::temp_dir().join(format!("syntelab-dev-csv-table-{}.csv", std::process::id()));
        std::fs::write(&path, "a\tb\n1\t2\n3\t4\n").expect("written");
        let read = Table::open(Source::File(path.clone()), None, true, &mut |_| true).expect("read");
        assert_eq!((read.rows, read.separator()), (2, "Tab".to_string()));
        assert_eq!(read.read(1, 1).expect("rows"), vec![vec!["3", "4"]]);
        std::fs::remove_file(path).ok();
    }
}
