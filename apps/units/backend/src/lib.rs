//! Units: the Rust side of the app.
//!
//! - `number`: exact numbers, read and written.
//! - `reading`: a number as a person types or pastes it.
//! - `catalog`: the converters and their units, from the data files.
//! - `numeral`: whole numbers written in other bases and as Roman numerals.
//! - `formula`: the formulas of a user's own units, read and worked out, never run as code.
//! - `convert`: a value from one unit to another.
//! - `precision`: how a result is written.
//! - `rates`: what currencies are worth, read from two services and kept between uses.
//! - `table`: the rows of a converter's table; only what was typed is kept, and every change can be undone.
//! - `transfer`: a table as text, for copying, pasting, exporting and importing.
//! - `files`: tables written to and read from files, Excel workbooks among them.

pub mod catalog;
pub mod convert;
pub mod files;
pub mod formula;
pub mod number;
pub mod numeral;
pub mod precision;
pub mod rates;
pub mod reading;
pub mod table;
pub mod transfer;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::{json, Value};
use syntelab_app_api::{AppContext, AppError, ResourceReply, ResourceRequest, SyntelabApp};

use catalog::{Converter, OwnUnit};
use precision::Extremes;
use reading::{Read, ReadError};
use table::{Set, Table, TableError, Writing};
use transfer::{Format, Layout, Paste, Pasted};

/// The app id: the folder name and the `id` in `app.json`.
pub const APP_ID: &str = "units";

/// The most units one value is converted to at once.
const MOST_UNITS: usize = 2000;

/// The converter whose units have no fixed factor: their rates are read from the network.
const CURRENCY: &str = "currency";

/// The rows a table starts with.
const FIRST_ROWS: usize = 20;
/// The most rows shown in one answer.
const MOST_SHOWN: usize = 2000;
/// The most rows looked at to fit a column to what it shows.
const MOST_FITTED: usize = 200_000;
/// The most cells handed over to the interface as one text. What goes to the clipboard of the system has no most.
const MOST_COPIED: usize = 3_000_000;

/// How far a long piece of work has got (a paste, an import, an export of very many rows), and whether the user
/// asked for it to stop. Kept apart from the tables, which the work holds while it lasts.
#[derive(Default)]
struct Progress {
    running: AtomicBool,
    /// Rows done, of how many. Nothing is known of how many while what is to be read is still being read.
    done: AtomicUsize,
    total: AtomicUsize,
    stop: AtomicBool,
}

/// Work that is being watched: when it ends, however it ends, nothing is running any more.
struct Running<'a>(&'a Progress);

impl Drop for Running<'_> {
    fn drop(&mut self) {
        self.0.running.store(false, Ordering::Relaxed);
    }
}

impl Progress {
    fn start(&self) -> Running<'_> {
        self.done.store(0, Ordering::Relaxed);
        self.total.store(0, Ordering::Relaxed);
        self.stop.store(false, Ordering::Relaxed);
        self.running.store(true, Ordering::Relaxed);
        Running(self)
    }

    /// So many more rows are done. False when the user asked for the work to stop.
    fn step(&self, rows: usize) -> bool {
        self.done.fetch_add(rows, Ordering::Relaxed);
        !self.stopped()
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::Relaxed)
    }
}

#[derive(Default)]
pub struct Units {
    /// The tables that are open, by the name the interface gave each (a tab and its converter).
    tables: Mutex<HashMap<String, Table>>,
    /// The converters that are not as the catalog has them, as they are now: with the user's own units, with the rates of currencies.
    own: Mutex<HashMap<String, Arc<Converter>>>,
    /// The user's own units, by converter, as the interface gave them.
    own_units: Mutex<HashMap<String, Vec<OwnUnit>>>,
    /// What currencies are worth, once it was read or handed back by the interface.
    rates: Mutex<rates::Rates>,
    progress: Progress,
}

impl Units {
    pub fn new(_context: &AppContext) -> Self {
        Self::default()
    }

    /// A converter, with the user's own units when it has some.
    fn known(&self, id: &str) -> Result<Arc<Converter>, AppError> {
        if let Some(with_own) = self.own.lock().ok().and_then(|own| own.get(id).cloned()) {
            return Ok(with_own);
        }
        catalog::by_id(id).cloned().ok_or_else(|| AppError::InvalidRequest(format!("no converter {id}")))
    }

    /// A converter as it is without the user's own units: the catalog's, and for currencies, with their rates.
    fn plain(&self, id: &str) -> Result<Arc<Converter>, AppError> {
        let catalog = catalog::by_id(id).ok_or_else(|| AppError::InvalidRequest(format!("no converter {id}")))?;
        if id != CURRENCY {
            return Ok(Arc::clone(catalog));
        }
        let rates = self.rates.lock().map(|rates| rates.clone()).unwrap_or_default();
        Ok(Arc::new(catalog::with_rates(catalog, &rates)))
    }

    /// Makes a converter anew from the catalog, the rates and the user's own units, and gives it to the tables that are open.
    /// A unit of the user's own that no longer reads stops the others too: the interface tries them before it sends them.
    fn rebuild(&self, id: &str) -> Result<Arc<Converter>, AppError> {
        let plain = self.plain(id)?;
        let units = self.own_units.lock().ok().and_then(|own| own.get(id).cloned()).unwrap_or_default();
        let built = match catalog::with_own(&plain, &units) {
            Ok(built) if !units.is_empty() => Arc::new(built),
            _ => plain,
        };
        if let Ok(mut own) = self.own.lock() {
            if units.is_empty() && id != CURRENCY {
                own.remove(id);
            } else {
                own.insert(id.to_owned(), Arc::clone(&built));
            }
        }
        if let Ok(mut tables) = self.tables.lock() {
            tables.values_mut().filter(|table| table.converter().id == id).for_each(|table| table.rebased(Arc::clone(&built)));
        }
        Ok(built)
    }

    /// The user's own units of a converter, all of them: they take the place of those it had. `check` only tries them.
    fn own_units(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            converter: String,
            units: Vec<OwnUnit>,
            #[serde(default)]
            check: bool,
        }
        let Request { converter, units, check } = parse(payload)?;
        let plain = self.plain(&converter)?;
        let built = match catalog::with_own(&plain, &units) {
            Ok(built) => Arc::new(built),
            // Said, not failed: the interface shows which unit is wrong and why.
            Err(error) => return Ok(json!({ "ok": false, "unit": error.unit, "what": error.what, "at": error.at })),
        };
        // What the interface shows of each: one of it in the base unit, and whether its formulas undo each other.
        let said: Vec<Value> = units
            .iter()
            .map(|unit| {
                let id = unit.id.trim();
                let base = built.unit(&built.base);
                let one = catalog::one_in_base(&built, id).zip(base).map(|(one, base)| precision::written_in(Some(&one), base, base.decimals.unwrap_or(precision::USUAL_DECIMALS).max(6), Extremes::Scientific));
                json!({ "id": id, "one": one, "undoesItself": catalog::undoes_itself(&built, id) })
            })
            .collect();
        if !check {
            if let Ok(mut own) = self.own_units.lock() {
                if units.is_empty() {
                    own.remove(&converter);
                } else {
                    own.insert(converter.clone(), units);
                }
            }
            self.rebuild(&converter)?;
        }
        Ok(json!({ "ok": true, "base": built.base, "units": said }))
    }

    /// The rates of currencies: read from their services when they are due, else as they are. `kept` is what the
    /// interface kept of them last time; `asked` is the user pressing "Refresh". Answers when each kind is of, what
    /// could not be read, and what the interface is to keep.
    fn rates(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            #[serde(default)]
            kept: Value,
            #[serde(default)]
            asked: bool,
            /// Reads nothing from the services: only takes what was kept. For when the program may not go online.
            #[serde(default)]
            offline: bool,
        }
        let Request { kept, asked, offline } = parse(payload)?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|since| since.as_secs()).unwrap_or(0);
        let before = self.rates.lock().map(|rates| rates.clone()).unwrap_or_default();
        let mut known = before.clone().with(rates::Rates::from_kept(&kept));
        let mut failed: Vec<&str> = Vec::new();
        if !offline && known.fiat_is_due(now, asked) {
            match syntelab_net::fetch_fiat_rates().ok().and_then(|answer| rates::read_fiat(&answer)) {
                Some(read) => known.fiat = Some(read),
                None => failed.push("fiat"),
            }
        }
        if !offline && known.coins_are_due(now, asked) {
            let coins = catalog::by_id(CURRENCY).map(|converter| catalog::coins_of(converter)).unwrap_or_default();
            match syntelab_net::fetch_coin_prices(&coins).ok().and_then(|answer| rates::read_coins(&answer, now)) {
                Some(read) => known.coins = Some(read),
                None => failed.push("coins"),
            }
        }
        let changed = known != before || self.own.lock().is_ok_and(|own| !own.contains_key(CURRENCY));
        if let Ok(mut rates) = self.rates.lock() {
            *rates = known.clone();
        }
        if changed {
            self.rebuild(CURRENCY)?;
        }
        let said = |read: &Option<rates::Read>| read.as_ref().map(|read| json!({ "time": read.time, "next": read.next, "count": read.rates.len() }));
        Ok(json!({ "now": now, "fiat": said(&known.fiat), "coins": said(&known.coins), "failed": failed, "changed": changed, "keep": known.kept() }))
    }

    /// Does something with a table that is open.
    fn with_table<T>(&self, name: &str, work: impl FnOnce(&mut Table) -> Result<T, AppError>) -> Result<T, AppError> {
        let mut tables = self.tables.lock().map_err(|_| AppError::Failed { code: "failed", detail: "the tables cannot be reached".into() })?;
        work(tables.get_mut(name).ok_or_else(|| AppError::InvalidRequest(format!("no table {name}")))?)
    }

    /// Opens the table of a converter under a name, or finds it as it was left.
    fn table_open(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
            converter: String,
        }
        let Request { table, converter } = parse(payload)?;
        let known = self.known(&converter)?;
        let mut tables = self.tables.lock().map_err(|_| AppError::Failed { code: "failed", detail: "the tables cannot be reached".into() })?;
        let opened = tables.entry(table).or_insert_with(|| Table::new(Arc::clone(&known), FIRST_ROWS));
        // The same name asked for with another converter: a new table takes its place.
        if opened.converter().id != known.id {
            *opened = Table::new(known, FIRST_ROWS);
        }
        Ok(facts(opened))
    }

    /// Forgets a table: its tab was closed, or went to another converter.
    fn table_close(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
        }
        let Request { table } = parse(payload)?;
        if let Ok(mut tables) = self.tables.lock() {
            tables.remove(&table);
        }
        Ok(json!({}))
    }

    /// Types a value into a cell.
    fn table_set(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            table: String,
            row: usize,
            unit: String,
            value: String,
            #[serde(default = "point")]
            decimal_mark: char,
        }
        let Request { table, row, unit, value, decimal_mark } = parse(payload)?;
        self.with_table(&table, |opened| {
            let set = opened.set(row, &unit, &value, decimal_mark).map_err(table_error)?;
            Ok(json!({ "ambiguous": set == Set::Ambiguous, "wrong": set == Set::Wrong, "facts": facts(opened) }))
        })
    }

    /// Empties rows: those listed, a run of them, or all.
    fn table_clear(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
            #[serde(default)]
            rows: Vec<usize>,
            /// A run of rows, from the first to the last, both counted.
            #[serde(default)]
            runs: Vec<(usize, usize)>,
            #[serde(default)]
            all: bool,
            /// Emptied without a way back, where there is no memory to keep the table as it was.
            #[serde(default, rename = "noUndo")]
            no_undo: bool,
        }
        let Request { table, rows, runs, all, no_undo } = parse(payload)?;
        self.with_table(&table, |opened| {
            // Whatever is asked for at once is one change.
            let runs: Vec<(usize, usize)> = rows.into_iter().map(|row| (row, row)).chain(runs).collect();
            let clear = |opened: &mut Table| if all { opened.clear_all() } else { opened.clear_runs(&runs) };
            if no_undo { opened.forgoing_undo(clear) } else { clear(opened) }.map_err(table_error)?;
            Ok(facts(opened))
        })
    }

    /// Makes a table as long as asked.
    fn table_resize(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
            rows: usize,
        }
        let Request { table, rows } = parse(payload)?;
        self.with_table(&table, |opened| {
            opened.resize(rows).map_err(table_error)?;
            Ok(facts(opened))
        })
    }

    /// Some rows of a table, written in the columns asked for.
    fn table_rows(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
            from: usize,
            count: usize,
            units: Vec<String>,
            #[serde(default)]
            decimals: HashMap<String, usize>,
            #[serde(default)]
            extremes: Extremes,
        }
        let Request { table, from, count, units, decimals, extremes } = parse(payload)?;
        self.with_table(&table, |opened| {
            let rows = opened.shown(from, count.min(MOST_SHOWN), &Writing { units: &units, decimals: &decimals, extremes }).map_err(table_error)?;
            Ok(json!({ "from": from, "rows": rows.iter().map(|row| json!({ "driver": row.driver, "cells": row.cells, "wrong": row.wrong })).collect::<Vec<_>>() }))
        })
    }

    /// The longest text each column shows: what a column is fitted to when the edge of its head is double-clicked.
    fn table_longest(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
            units: Vec<String>,
            #[serde(default)]
            decimals: HashMap<String, usize>,
            #[serde(default)]
            extremes: Extremes,
        }
        let Request { table, units, decimals, extremes } = parse(payload)?;
        self.with_table(&table, |opened| {
            let longest = opened.longest(&Writing { units: &units, decimals: &decimals, extremes }, MOST_FITTED).map_err(table_error)?;
            Ok(json!({ "longest": longest }))
        })
    }

    /// Takes the last change of a table back, or makes it again.
    fn table_history(&self, payload: Value, back: bool) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            table: String,
        }
        let Request { table } = parse(payload)?;
        self.with_table(&table, |opened| {
            let done = if back { opened.undo() } else { opened.redo() };
            Ok(json!({ "done": done, "facts": facts(opened) }))
        })
    }

    /// A table as text, to be copied: `table_text`. Or written to a file: `table_export`, which takes a `path` and can write Excel.
    fn table_out(&self, payload: Value, to_file: bool) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            table: String,
            units: Vec<String>,
            #[serde(default)]
            decimals: HashMap<String, usize>,
            #[serde(default)]
            extremes: Extremes,
            /// The titles of the columns, in their order; none for no titles.
            #[serde(default)]
            titles: Option<Vec<String>>,
            #[serde(default)]
            row_numbers: bool,
            #[serde(default)]
            transposed: bool,
            /// The rows wanted, as runs from a first to a last; none for every row down to the last that has a value.
            #[serde(default)]
            runs: Option<Vec<(usize, usize)>>,
            /// `tsv`, `csv`, `json`; to a file, also `excel`.
            format: String,
            #[serde(default = "point")]
            decimal_mark: char,
            #[serde(default)]
            path: Option<String>,
            /// The text goes to the clipboard of the system instead of coming back.
            #[serde(default)]
            clipboard: bool,
        }
        let Request { table, units, decimals, extremes, titles, row_numbers, transposed, runs, format, decimal_mark, path, clipboard } = parse(payload)?;
        if titles.as_ref().is_some_and(|titles| titles.len() != units.len()) {
            return Err(AppError::InvalidRequest("a title for each column".into()));
        }
        let _running = self.progress.start();
        let watch = |rows: usize| self.progress.step(rows);
        self.with_table(&table, |opened| {
            let runs = match runs {
                Some(runs) => runs,
                None => opened.last_filled().map(|last| vec![(0, last)]).unwrap_or_default(),
            };
            let rows: usize = runs.iter().map(|(first, last)| last.saturating_sub(*first) + 1).sum();
            self.progress.total.store(rows, Ordering::Relaxed);
            let text_format = match format.as_str() {
                "tsv" => Some(Format::Tsv),
                "csv" => Some(Format::Csv),
                "json" => Some(Format::Json),
                "excel" if to_file => None,
                other => return Err(AppError::InvalidRequest(format!("no format {other}"))),
            };
            let layout = Layout { writing: Writing { units: &units, decimals: &decimals, extremes }, titles: titles.as_deref(), row_numbers, transposed, runs: &runs, format: text_format.unwrap_or(Format::Tsv), decimal: decimal_mark, watch: Some(&watch) };
            let failed = |error: std::io::Error| {
                let code = match error.kind() {
                    std::io::ErrorKind::Interrupted => "stopped",
                    std::io::ErrorKind::OutOfMemory => "no-memory",
                    std::io::ErrorKind::InvalidInput => "too-large",
                    _ => "not-written",
                };
                AppError::Failed { code, detail: error.to_string() }
            };
            if !to_file {
                if !clipboard && rows.saturating_mul(units.len().max(1)) > MOST_COPIED {
                    return Err(AppError::Failed { code: "too-large", detail: "too much to hand over at once".into() });
                }
                let mut text = files::Held::default();
                let written = transfer::write(opened, &layout, &mut text).map_err(failed)?;
                let text = String::from_utf8(text.0).unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned());
                if clipboard {
                    files::copy(text).map_err(|detail| AppError::Failed { code: "no-clipboard", detail })?;
                    return Ok(json!({ "rows": written }));
                }
                return Ok(json!({ "text": text, "rows": written }));
            }
            let path = path.ok_or_else(|| AppError::InvalidRequest("no path".into()))?;
            let written = match text_format {
                Some(_) => files::write_text(opened, &layout, std::path::Path::new(&path)),
                None => files::write_excel(opened, &layout, std::path::Path::new(&path)),
            };
            // Stopped, or failed halfway: half a file is no file.
            if written.is_err() {
                let _ = std::fs::remove_file(&path);
            }
            Ok(json!({ "rows": written.map_err(failed)? }))
        })
    }

    /// Rows of cells into a table: text that was copied (`table_paste`, with `text`), or a file (`table_import`, with `path`), which takes the place of what the table held.
    fn table_in(&self, payload: Value, from_file: bool) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            table: String,
            #[serde(default)]
            text: String,
            #[serde(default)]
            path: Option<String>,
            /// Of a file: `excel`, `csv`, `tsv`, or `auto` to tell by its name and by what is in it.
            #[serde(default)]
            kind: Option<String>,
            /// The row the first row of cells goes to.
            #[serde(default)]
            row: usize,
            /// The units of the columns the cells go to when no titles say: from the active column on.
            columns: Vec<String>,
            /// What a column may be titled with, and the unit that is.
            #[serde(default)]
            names: HashMap<String, String>,
            #[serde(default)]
            transposed: bool,
            #[serde(default = "point")]
            decimal_mark: char,
            /// The text is what the clipboard of the system holds.
            #[serde(default)]
            clipboard: bool,
            /// Made without a way back, where there is no memory to keep the table as it was.
            #[serde(default)]
            no_undo: bool,
        }
        let Request { table, text, path, kind, row, columns, names, transposed, decimal_mark, clipboard, no_undo } = parse(payload)?;
        let _running = self.progress.start();
        let not_read = |error: std::io::Error| AppError::Failed { code: if error.kind() == std::io::ErrorKind::OutOfMemory { "no-memory" } else { "not-read" }, detail: error.to_string() };
        let source = if from_file {
            let path = path.ok_or_else(|| AppError::InvalidRequest("no path".into()))?;
            files::read(std::path::Path::new(&path), kind.as_deref().unwrap_or("auto"), decimal_mark).map_err(not_read)?
        } else {
            let text = if clipboard { files::copied().map_err(|detail| AppError::Failed { code: "no-clipboard", detail })? } else { text };
            let separator = transfer::separator_of(&text);
            files::Source::Text { text, separator }
        };
        // Cells are all there already; text is read a row at a time, unless its rows are to become columns.
        let (cells, text) = match source {
            files::Source::Cells(cells) => (Some(if transposed { transfer::transposed(&cells) } else { cells }), None),
            files::Source::Text { text, separator } if transposed => (Some(transfer::transposed(&transfer::grid(&text, separator))), None),
            files::Source::Text { text, separator } => (None, Some((text, separator))),
        };
        // How many rows there are (of text: its lines, which a cell in quotes may take several of): what the table needs
        // room for, and what the progress is counted against.
        let count = match (&cells, &text) {
            (Some(cells), _) => cells.len(),
            (_, Some((text, _))) => text.bytes().filter(|byte| *byte == b'\n').count() + usize::from(!text.ends_with('\n')),
            _ => 0,
        };
        self.progress.total.store(count, Ordering::Relaxed);
        let rows: Box<dyn Iterator<Item = Vec<String>> + '_> = match (cells, &text) {
            (Some(cells), _) => Box::new(cells.into_iter()),
            (_, Some((text, separator))) => Box::new(transfer::rows(text, *separator)),
            _ => Box::new(std::iter::empty()),
        };
        // Each row that is taken is counted; when the user asks for the work to stop, there are no more rows.
        let rows = rows.take_while(|_| self.progress.step(1));
        self.with_table(&table, |opened| {
            let paste = Paste { row: if from_file { 0 } else { row }, columns: &columns, names: &names, decimal: decimal_mark };
            let work = |opened: &mut Table| {
                opened.change(count, |opened| {
                    // The room is asked for before anything is touched: a table that cannot hold the rows stays as it is.
                    opened.room(paste.row.saturating_add(count))?;
                    // A file takes the place of what was there: emptying and filling are one change.
                    if from_file {
                        opened.clear_all()?;
                    }
                    transfer::paste(opened, rows, count, &paste)
                })
            };
            let pasted = if no_undo { opened.forgoing_undo(work) } else { work(opened) };
            let pasted: Pasted = match pasted {
                Ok(Ok(pasted)) => pasted,
                Ok(Err(error)) => {
                    opened.take_back();
                    return Err(table_error(error));
                }
                Err(error) => return Err(table_error(error)),
            };
            // Stopped halfway: the table is as it was, unless the change was made without a way back.
            let stopped = self.progress.stopped();
            let taken_back = stopped && opened.take_back();
            Ok(json!({ "rows": if taken_back { 0 } else { pasted.rows }, "wrong": pasted.wrong, "units": if taken_back { Vec::new() } else { pasted.units }, "titled": pasted.titled, "leftOut": pasted.left_out, "stopped": stopped, "facts": facts(opened) }))
        })
    }

    /// How far the long work that is running has got: asked again and again by the interface while it waits.
    fn progress(&self) -> Value {
        json!({ "running": self.progress.running.load(Ordering::Relaxed), "done": self.progress.done.load(Ordering::Relaxed), "total": self.progress.total.load(Ordering::Relaxed) })
    }

    /// The user asked for the long work that is running to stop: it does at its next row.
    fn stop(&self) -> Value {
        self.progress.stop.store(true, Ordering::Relaxed);
        json!({})
    }

    /// The converters, in the order they are listed: what the menus are made of.
    fn converters(&self) -> Value {
        json!({ "converters": catalog::converters().iter().map(|known| json!({ "id": known.id, "category": known.category, "icon": known.icon, "units": known.units.len() })).collect::<Vec<_>>() })
    }

    /// One converter with its units.
    fn converter(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            id: String,
        }
        let Request { id } = parse(payload)?;
        let known = self.known(&id)?;
        Ok(json!({
            "id": known.id,
            "category": known.category,
            "icon": known.icon,
            "base": known.base,
            "startsWith": known.starts_with,
            "groups": known.groups,
            "units": known.units.iter().map(|unit| json!({
                "id": unit.id,
                "symbol": unit.symbol,
                "group": unit.group,
                "popular": unit.popular,
                "decimals": unit.decimals.unwrap_or(precision::USUAL_DECIMALS),
                // Its values are text (base 16, Roman numerals): shown as they are, with no decimals to choose.
                "text": unit.numeral().is_some(),
                // A difference between two values, not a value on a scale: it converts only into other differences.
                "interval": unit.interval,
                // A currency: of a country, or a cryptocurrency. The interface lists the two apart.
                "currency": unit.rate.as_ref().map(|rate| match rate {
                    catalog::RateOf::Fiat(_) => "fiat",
                    catalog::RateOf::Coin(_) => "crypto",
                }),
                // A unit of the user's own carries its name: the translations do not know it.
                "name": unit.name,
                "measured": unit.measured,
                "aliases": unit.aliases,
            })).collect::<Vec<_>>(),
        }))
    }

    /// One value, as typed, in each of the units asked for.
    fn convert(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            converter: String,
            /// The unit the value is in.
            from: String,
            /// The value as it was typed.
            value: String,
            /// The units it is wanted in.
            to: Vec<String>,
            /// Decimals asked for, by unit: the user's settings, and the precision of a column over them.
            #[serde(default)]
            decimals: HashMap<String, usize>,
            #[serde(default)]
            extremes: Extremes,
            /// The mark the language of the program writes before decimals.
            #[serde(default = "point")]
            decimal_mark: char,
        }
        let Request { converter, from, value, to, decimals, extremes, decimal_mark } = parse(payload)?;
        let known = self.known(&converter)?;
        let unit = |id: &str| known.unit(id).ok_or_else(|| AppError::InvalidRequest(format!("no unit {id} in {converter}")));
        let from = unit(&from)?;
        if to.len() > MOST_UNITS {
            return Err(AppError::InvalidRequest("too many units".into()));
        }
        let read = match from.numeral() {
            Some(_) if value.trim().is_empty() => Err(ReadError::Empty),
            Some(kind) => numeral::read(&value, kind).map(|whole| Read { value: number::Number::from_integer(whole), ambiguous: false, decimals: 0 }).ok_or(ReadError::NotANumber),
            None => reading::read(&value, decimal_mark),
        };
        let read = match read {
            Ok(read) => read,
            // Nothing typed is not a problem: there is nothing to show yet.
            Err(ReadError::Empty) => return Ok(json!({ "empty": true, "results": [] })),
            Err(ReadError::NotANumber) => return Err(AppError::Failed { code: "not-a-number", detail: value }),
        };
        let mut results = Vec::with_capacity(to.len());
        for id in &to {
            let target = unit(id)?;
            let converted = convert::convert(&read.value, from, target);
            let asked = decimals.get(id).copied().or(target.decimals).unwrap_or(precision::USUAL_DECIMALS);
            results.push(json!({ "unit": target.id, "text": precision::written_in(converted.as_ref(), target, asked, extremes), "measured": from.measured || target.measured }));
        }
        Ok(json!({ "empty": false, "ambiguous": read.ambiguous, "results": results }))
    }
}

fn point() -> char {
    '.'
}

impl SyntelabApp for Units {
    fn id(&self) -> &'static str {
        APP_ID
    }

    fn invoke(&self, command: &str, payload: Value) -> Result<Value, AppError> {
        match command {
            "converters" => Ok(self.converters()),
            "converter" => self.converter(payload),
            "convert" => self.convert(payload),
            "own_units" => self.own_units(payload),
            "rates" => self.rates(payload),
            "table_open" => self.table_open(payload),
            "table_close" => self.table_close(payload),
            "table_set" => self.table_set(payload),
            "table_clear" => self.table_clear(payload),
            "table_resize" => self.table_resize(payload),
            "table_rows" => self.table_rows(payload),
            "table_longest" => self.table_longest(payload),
            "table_undo" => self.table_history(payload, true),
            "table_redo" => self.table_history(payload, false),
            "table_text" => self.table_out(payload, false),
            "table_export" => self.table_out(payload, true),
            "table_paste" => self.table_in(payload, false),
            "table_import" => self.table_in(payload, true),
            "progress" => Ok(self.progress()),
            "stop" => Ok(self.stop()),
            other => Err(AppError::NotFound(other.to_owned())),
        }
    }

    fn resource(&self, request: ResourceRequest, reply: ResourceReply) {
        reply(Err(AppError::NotFound(request.path)));
    }
}

/// What is known of a table at a glance: how long it is and how much of it is filled.
fn facts(table: &Table) -> Value {
    json!({ "rows": table.len(), "filled": table.filled(), "wrong": table.wrong(), "lastFilled": table.last_filled(), "canUndo": table.can_undo(), "canRedo": table.can_redo() })
}

fn table_error(error: TableError) -> AppError {
    match error {
        TableError::NoSuchUnit => AppError::InvalidRequest("no such unit".into()),
        // The detail is the bytes that could not be had: the interface says them as the user reads them.
        TableError::NoMemory(bytes) => AppError::Failed { code: "no-memory", detail: bytes.to_string() },
        TableError::NoMemoryToUndo(bytes) => AppError::Failed { code: "no-memory-to-undo", detail: bytes.to_string() },
        TableError::Stopped => AppError::Failed { code: "stopped", detail: "stopped".into() },
    }
}

fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, AppError> {
    serde_json::from_value(payload).map_err(|error| AppError::InvalidRequest(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(payload: Value) -> Result<Value, AppError> {
        Units::default().invoke("convert", payload)
    }

    fn texts(answer: &Value) -> Vec<String> {
        answer["results"].as_array().expect("results").iter().map(|result| format!("{} {}", result["text"].as_str().unwrap_or(""), result["unit"].as_str().unwrap_or(""))).collect()
    }

    #[test]
    fn lists_the_converters_and_their_units() {
        let units = Units::default();
        let all = units.invoke("converters", json!({})).expect("the converters");
        assert_eq!(all["converters"][0]["id"], "length");
        let length = units.invoke("converter", json!({ "id": "length" })).expect("a converter");
        assert_eq!(length["startsWith"], json!(["m", "ft"]));
        assert!(length["units"].as_array().is_some_and(|units| units.len() > 40));
        assert!(units.invoke("converter", json!({ "id": "nothing" })).is_err());
    }

    #[test]
    fn converts_a_typed_value_with_the_decimals_of_each_unit() {
        // 5 cm: two decimals, as lengths have; kilometres with the floor of digits that say something.
        let answer = asked(json!({ "converter": "length", "from": "cm", "value": "5", "to": ["in", "km", "mm", "m"] })).expect("converted");
        assert_eq!(texts(&answer), ["1.97 in", "0.00005 km", "50.00 mm", "0.05 m"]);
        // The precision asked for a unit stands over its own.
        let asked_for = asked(json!({ "converter": "length", "from": "cm", "value": "5", "to": ["in"], "decimals": { "in": 5 } })).expect("converted");
        assert_eq!(texts(&asked_for), ["1.96850 in"]);
        let body = asked(json!({ "converter": "temperature", "from": "C", "value": "36,6", "to": ["F", "K"], "decimalMark": "," })).expect("converted");
        assert_eq!(texts(&body), ["97.88 F", "309.75 K"]);
    }

    #[test]
    fn says_what_it_could_not_read_and_what_was_ambiguous() {
        let empty = asked(json!({ "converter": "length", "from": "m", "value": "  ", "to": ["ft"] })).expect("nothing to convert");
        assert_eq!(empty["empty"], true);
        assert!(matches!(asked(json!({ "converter": "length", "from": "m", "value": "abc", "to": ["ft"] })), Err(AppError::Failed { code: "not-a-number", .. })));
        let thousand = asked(json!({ "converter": "length", "from": "m", "value": "1,234", "to": ["km"] })).expect("converted");
        assert_eq!((thousand["ambiguous"].clone(), texts(&thousand)), (json!(true), vec!["1.23 km".to_owned()]));
        let one = asked(json!({ "converter": "length", "from": "m", "value": "1,234", "to": ["mm"], "decimalMark": "," })).expect("converted");
        assert_eq!(texts(&one), ["1234.00 mm"]);
        assert!(asked(json!({ "converter": "length", "from": "m", "value": "1", "to": ["nothing"] })).is_err());
    }

    #[test]
    fn keeps_a_table_between_requests() {
        let units = Units::default();
        let opened = units.invoke("table_open", json!({ "table": "t1", "converter": "length" })).expect("opened");
        assert_eq!((opened["rows"].clone(), opened["filled"].clone()), (json!(20), json!(0)));
        let set = units.invoke("table_set", json!({ "table": "t1", "row": 2, "unit": "ft", "value": "10" })).expect("set");
        assert_eq!(set["facts"]["lastFilled"], 2);
        let rows = units.invoke("table_rows", json!({ "table": "t1", "from": 2, "count": 2, "units": ["m", "ft"], "decimals": { "m": 4 } })).expect("rows");
        assert_eq!(rows["rows"], json!([{ "driver": "ft", "cells": ["3.0480", "10"], "wrong": false }, { "driver": null, "cells": [], "wrong": false }]));
        // What is not a number is kept, and said to be wrong.
        let wrong = units.invoke("table_set", json!({ "table": "t1", "row": 0, "unit": "m", "value": "x" })).expect("kept");
        assert_eq!((wrong["wrong"].clone(), wrong["facts"]["wrong"].clone()), (json!(true), json!(1)));
        units.invoke("table_set", json!({ "table": "t1", "row": 0, "unit": "m", "value": "" })).expect("emptied");
        // Opened again under the same name: as it was left. With another converter: a new one.
        assert_eq!(units.invoke("table_open", json!({ "table": "t1", "converter": "length" })).expect("opened")["filled"], 1);
        assert_eq!(units.invoke("table_open", json!({ "table": "t1", "converter": "temperature" })).expect("opened")["filled"], 0);
        units.invoke("table_set", json!({ "table": "t1", "row": 0, "unit": "C", "value": "20" })).expect("set");
        assert_eq!(units.invoke("table_clear", json!({ "table": "t1", "runs": [[0, 5]] })).expect("cleared")["filled"], 0);
        units.invoke("table_close", json!({ "table": "t1" })).expect("closed");
        assert!(units.invoke("table_rows", json!({ "table": "t1", "from": 0, "count": 1, "units": ["C"] })).is_err());
    }

    #[test]
    fn copies_pastes_undoes_and_goes_through_files() {
        let units = Units::default();
        units.invoke("table_open", json!({ "table": "t2", "converter": "length" })).expect("opened");
        let pasted = units.invoke("table_paste", json!({ "table": "t2", "text": "1,5\t\n2\t\n", "row": 1, "columns": ["m", "ft"], "decimalMark": "," })).expect("pasted");
        assert_eq!((pasted["rows"].clone(), pasted["facts"]["filled"].clone(), pasted["facts"]["canUndo"].clone()), (json!(2), json!(2), json!(true)));
        let copied = units.invoke("table_text", json!({ "table": "t2", "units": ["m", "ft"], "titles": ["meter", "foot"], "format": "tsv", "decimalMark": "," })).expect("copied");
        assert_eq!(copied["text"], "meter\tfoot\r\n\t\r\n1,5\t4,92\r\n2\t6,56\r\n");
        let selected = units.invoke("table_text", json!({ "table": "t2", "units": ["ft"], "runs": [[2, 2]], "format": "csv", "rowNumbers": true })).expect("copied");
        assert_eq!(selected["text"], "3,6.56\r\n");
        // Out to files and back in: text and Excel, the second one transposed.
        let folder = std::env::temp_dir().join(format!("units-test-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        for (name, format, transposed) in [("t.csv", "csv", false), ("t.xlsx", "excel", true)] {
            let path = folder.join(name).to_string_lossy().into_owned();
            let written = units.invoke("table_export", json!({ "table": "t2", "units": ["m", "ft"], "titles": ["meter", "foot"], "format": format, "transposed": transposed, "path": path, "decimalMark": "," })).expect("exported");
            assert_eq!(written["rows"], 3, "{name}");
            units.invoke("table_clear", json!({ "table": "t2", "all": true })).expect("cleared");
            let read = units.invoke("table_import", json!({ "table": "t2", "path": path, "transposed": transposed, "columns": ["m", "ft"], "names": { "meter": "m", "foot": "ft" }, "decimalMark": "," })).expect("imported");
            assert_eq!((read["rows"].clone(), read["titled"].clone(), read["units"].clone()), (json!(2), json!(true), json!(["m", "ft"])), "{name}");
            let rows = units.invoke("table_rows", json!({ "table": "t2", "from": 1, "count": 2, "units": ["m"] })).expect("rows");
            assert_eq!(rows["rows"], json!([{ "driver": "m", "cells": ["1.5"], "wrong": false }, { "driver": "m", "cells": ["2"], "wrong": false }]), "{name}");
        }
        let _ = std::fs::remove_dir_all(&folder);
        // The import is one change: taken back, the table is empty as it was just before.
        let undone = units.invoke("table_undo", json!({ "table": "t2" })).expect("undone");
        assert_eq!((undone["done"].clone(), undone["facts"]["filled"].clone(), undone["facts"]["canRedo"].clone()), (json!(true), json!(0), json!(true)));
        assert_eq!(units.invoke("table_redo", json!({ "table": "t2" })).expect("redone")["facts"]["filled"], 2);
    }

    #[test]
    fn takes_the_users_own_units_and_keeps_open_tables_going() {
        let units = Units::default();
        units.invoke("table_open", json!({ "table": "t3", "converter": "length" })).expect("opened");
        let pace = json!({ "id": "own-1", "name": "pace", "symbol": "pc.", "reference": "m", "factor": "0.75" });
        let tried = units.invoke("own_units", json!({ "converter": "length", "units": [pace], "check": true })).expect("tried");
        assert_eq!((tried["ok"].clone(), tried["units"][0]["one"].clone()), (json!(true), json!("0.750000")));
        // Only tried: the converter does not have it yet.
        assert!(units.invoke("table_set", json!({ "table": "t3", "row": 0, "unit": "own-1", "value": "4" })).is_err());
        units.invoke("own_units", json!({ "converter": "length", "units": [pace] })).expect("kept");
        units.invoke("table_set", json!({ "table": "t3", "row": 0, "unit": "own-1", "value": "4" })).expect("set");
        let rows = units.invoke("table_rows", json!({ "table": "t3", "from": 0, "count": 1, "units": ["m"] })).expect("rows");
        assert_eq!(rows["rows"][0]["cells"], json!(["3.00"]));
        let listed = units.invoke("converter", json!({ "id": "length" })).expect("a converter");
        let last = listed["units"].as_array().and_then(|all| all.last()).expect("a unit");
        assert_eq!((last["name"].clone(), last["group"].clone()), (json!("pace"), json!("custom")));
        let wrong = units.invoke("own_units", json!({ "converter": "length", "units": [{ "id": "own-2", "name": "x", "symbol": "x", "reference": "m", "toReference": "x *", "fromReference": "x" }] })).expect("said");
        assert_eq!((wrong["ok"].clone(), wrong["unit"].clone(), wrong["what"].clone(), wrong["at"].clone()), (json!(false), json!("own-2"), json!("expected"), json!(3)));
        // Taken out again: the row typed in it is emptied.
        units.invoke("own_units", json!({ "converter": "length", "units": [] })).expect("kept");
        assert_eq!(units.invoke("table_open", json!({ "table": "t3", "converter": "length" })).expect("opened")["filled"], 0);
    }

    #[test]
    fn takes_back_the_rates_it_was_handed_without_going_online() {
        let units = Units::default();
        let kept = json!({ "fiat": { "time": 100, "next": 200, "rates": { "USD": "1", "EUR": "0.8" } }, "coins": { "time": 100, "next": 0, "rates": { "bitcoin": "50000" } } });
        let answer = units.invoke("rates", json!({ "kept": kept, "offline": true })).expect("rates");
        assert_eq!((answer["fiat"]["time"].clone(), answer["fiat"]["count"].clone(), answer["coins"]["count"].clone(), answer["failed"].clone()), (json!(100), json!(2), json!(1), json!([])));
        assert_eq!(answer["keep"]["fiat"]["rates"]["EUR"], "4/5");
        let converted = units.invoke("convert", json!({ "converter": "currency", "from": "btc", "value": "2", "to": ["eur", "usd", "jpy"] })).expect("converted");
        assert_eq!(texts(&converted), ["80000.00 eur", "100000.00 usd", "— jpy"]);
        // A table of currencies that is open goes on with the rates, and with the user's own units over them.
        units.invoke("table_open", json!({ "table": "t4", "converter": "currency" })).expect("opened");
        units.invoke("table_set", json!({ "table": "t4", "row": 0, "unit": "eur", "value": "8" })).expect("set");
        units.invoke("own_units", json!({ "converter": "currency", "units": [{ "id": "own-1", "name": "ten", "symbol": "10$", "reference": "usd", "factor": "10" }] })).expect("kept");
        let newer = json!({ "fiat": { "time": 300, "next": 400, "rates": { "USD": "1", "EUR": "0.5" } } });
        units.invoke("rates", json!({ "kept": newer, "offline": true })).expect("rates");
        let rows = units.invoke("table_rows", json!({ "table": "t4", "from": 0, "count": 1, "units": ["usd", "own-1"] })).expect("rows");
        assert_eq!(rows["rows"][0]["cells"], json!(["16.00", "1.60"]));
        assert_eq!(units.invoke("table_undo", json!({ "table": "t4" })).expect("undone")["done"], true);
    }

    /// Not run with the others: it takes minutes and gigabytes. Run by hand, optimised, to see what very many rows cost:
    /// `UNITS_MANY_ROWS=20000000 cargo test --release -p units-backend -- --ignored --nocapture very_many_rows`
    #[test]
    #[ignore = "takes minutes: run by hand"]
    fn very_many_rows_go_in_and_out() {
        let many: usize = std::env::var("UNITS_MANY_ROWS").ok().and_then(|rows| rows.parse().ok()).unwrap_or(2_200_000);
        let units = Units::default();
        units.invoke("table_open", json!({ "table": "big", "converter": "length" })).expect("opened");
        let text: String = (1..=many).map(|at| format!("{at}.5\r\n")).collect();
        let timed = |what: &str, started: std::time::Instant| println!("{what}: {:.1} s", started.elapsed().as_secs_f64());
        let started = std::time::Instant::now();
        let pasted = units.invoke("table_paste", json!({ "table": "big", "text": text, "columns": ["m", "ft"] })).expect("pasted");
        timed("pasted", started);
        assert_eq!((pasted["rows"].clone(), pasted["stopped"].clone(), units.invoke("progress", json!({})).expect("progress")), (json!(many), json!(false), json!({ "running": false, "done": many, "total": many })));
        let folder = std::env::temp_dir().join(format!("units-many-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let path = |name: &str| folder.join(name).to_string_lossy().into_owned();
        let started = std::time::Instant::now();
        let written = units.invoke("table_export", json!({ "table": "big", "units": ["m", "ft"], "titles": ["meter", "foot"], "format": "csv", "path": path("big.csv") })).expect("exported");
        timed("written as CSV", started);
        assert_eq!(written["rows"], many);
        // A workbook goes on on the next sheet where one is full, each under the titles.
        let started = std::time::Instant::now();
        units.invoke("table_export", json!({ "table": "big", "units": ["m", "ft"], "titles": ["meter", "foot"], "format": "excel", "path": path("big.xlsx") })).expect("exported");
        timed("written as Excel", started);
        let mut book = calamine::open_workbook_auto(path("big.xlsx")).expect("a workbook");
        let sheets = calamine::Reader::sheet_names(&book);
        assert_eq!(sheets.len(), many.div_ceil(1_048_575));
        let last = calamine::Reader::worksheet_range(&mut book, sheets.last().expect("a sheet")).expect("a sheet");
        assert_eq!((last.rows().next().map(|row| row[0].to_string()), last.rows().next_back().map(|row| row[0].to_string())), (Some("meter".to_owned()), Some(format!("{many}.5"))));
        let started = std::time::Instant::now();
        let read = units.invoke("table_import", json!({ "table": "big", "path": path("big.csv"), "columns": ["m", "ft"], "names": { "meter": "m", "foot": "ft" } })).expect("imported");
        timed("read from CSV", started);
        assert_eq!((read["rows"].clone(), read["facts"]["filled"].clone()), (json!(many), json!(many)));
        let _ = std::fs::remove_dir_all(&folder);
    }

    #[test]
    fn writes_extremes_as_asked() {
        let small = asked(json!({ "converter": "length", "from": "planck", "value": "1", "to": ["m"] })).expect("converted");
        assert_eq!(texts(&small), ["1.61626e-35 m"]);
        let full = asked(json!({ "converter": "length", "from": "ly", "value": "1", "to": ["mm"], "extremes": "full" })).expect("converted");
        assert_eq!(texts(&full), ["9460730472580800000.00 mm"]);
    }
}
