//! Dev: the Rust side of the app.
//!
//! - `json`: JSON read as it comes and written again, indented or on one line; or only checked.
//! - `files`: the files a tool reads from and writes to.
//! - `results`: the results of files, kept in a folder of the program's own until the user says where they go.
//! - `kinds`: what some bytes are (a picture, a PDF, text…), told from how they start.
//! - `batch`: many files worked on in one run, one after another.
//! - `codec`: what the tools that turn bytes into other bytes have in common.
//! - `base64`, `url`, `entities` (with `entity_names`), `escape`, `gzip`: each both ways, as bytes come.
//! - `jwt`: a JSON Web Token taken apart, and its signature checked.
//! - `schema`: a document checked against a JSON Schema.
//! - `shape`: the shape of a document, told from a sample of it; `derive`: a JSON Schema and TypeScript declarations written from it.
//! - `jsonpath`: a JSONPath query (RFC 9535) read, and run on a tree.
//! - `tree`: JSON held whole, for what cannot be done as the text goes by (sorted keys, short lists on one line, values taken out or moved).
//!
//! No tool has a most for what it works on: a text is as long as memory
//! holds it, a file as large as the disk does. Work that lasts says how far
//! it has got and can be stopped; memory is asked for in a way that can be
//! refused, and a refusal is told, not crashed on. Nothing a tool is given
//! is written anywhere but where the user says, save the result the
//! interface shows while it is only looked at: that waits in a folder of the
//! app's cache (`results`), and is deleted as soon as it is not shown.
//!
//! Commands:
//! - `open { path, bytes? }`: a file for the interface (with `bytes`, one that is not text is not refused: it
//!   stays on disk, told to be `binary`). `{ name, size, text }` when it
//!   is small enough to be shown whole, else `{ name, size, large: true, head }`.
//! - `save { path, text }`: writes a text as UTF-8.
//! - `json { mode, indent?, text? | path?, out? }`: `mode` is `format`, `minify`
//!   or `validate`; `indent` is `tab` or a number of spaces from `0` to `255`. How it is read and written besides:
//!   `lenient`, `colonSpace`, `lineEnding` (`lf`, `crlf`), `finalNewline`, `ascii`; and, held whole in memory,
//!   `sortKeys`, `oneLineWithin` (letters; 0 for never) and `change` (`drop-nulls`, `drop-empties`, `flatten`,
//!   `unflatten`, `stringify`, `parse`). With `text`, the answer
//!   holds the text written again. With `path`, the file is read from disk;
//!   with `out` too, the result is written there and the answer holds its
//!   start. Answers `{ ok: true, text?, head?, stats }`, or
//!   `{ ok: false, error: { code, line, column, offset } }` for a text that is not JSON.
//! - `find_files { paths, deep, endings }`: the files under what was chosen (a file is itself, a folder is the
//!   files in it with one of the endings). Answers `{ files: [{ path, root, size }] }`.
//! - `json_batch { mode, indent?, files, target, overwrite }`: every file in turn. `target` is
//!   `{ kind: "beside", mark }`, `{ kind: "folder", folder }` or `{ kind: "replace" }`; nothing is written for
//!   `validate`. Answers `{ items: [{ path, out, status, code, line, column, bytesIn, bytesOut, ms }] }` with
//!   `status` one of `done`, `wrong` (not JSON), `skipped` and `failed`.
//! - `codec { tool, options, text? | path?, out? }`: one of `base64`, `url-encode`, `html-entities`, `escape`,
//!   `gzip`, run on a text or on a file read from disk. With `out`, the result is written there. Answers
//!   `{ ok: true, text?, binary?, head?, stats, notes }` (`binary` when the result of a text is not text), or
//!   `{ ok: false, error }` as `json` does.
//! - `codec_batch { tool, options, files, target, overwrite }`: every file in turn, as `json_batch`; `target` may
//!   name the results with `mark`, `append` or `strip` (and `otherwise`), or be `{ kind: "shown" }`: nothing is
//!   written, and each item carries its result as `said` (digests of many files, listed).
//! - `jsonpath { query, show?, indent?, lenient?, text? | path?, out? }`: what a query finds in a document, as a JSON
//!   array: the values (`show` is `values`), the ways to them (`ways`) or both (`both`). Answers as `json`, with
//!   `found`; a query that is wrong is `{ ok: false, error: { code: "bad-query", column } }`.
//! - `derive { what, text? | path?, out?, … }`: from a sample of JSON, a JSON Schema it fits (`what` is `schema`; with
//!   `draft` and `indent`) or TypeScript declarations of its type (`typescript`; with `root`, `interfaces`,
//!   `exported`, `readonly`). Answers as `json`.
//! - `schema_check { schema, draft?, formats?, text? | path? }`: a document checked against a schema. Answers
//!   `{ ok: true, misfits: [{ at, rule, message }], stats }` (no misfits: it fits), or `{ ok: false, error }` for a
//!   document that is not JSON, and for a schema that is not JSON (`schema-not-json`, with its place in the schema)
//!   or no schema (`schema-not-schema`, with `detail`).
//! - `schema_batch { schema, draft?, formats?, files }`: every file checked against one schema; a file that does
//!   not fit is `wrong` with the code `not-valid`.
//! - `tree_open { text? | path?, lenient? }`: a document held as a tree, to be shown a part at a time. Answers
//!   `{ ok: true, tree, root, stats }` (`tree` is the number it is asked for by) or `{ ok: false, error }`.
//!   `tree_rows { tree, way, from, count }` gives rows of the value at the end of a way of places;
//!   `tree_find { tree, sought, most }` the places a text is found in keys and values; `tree_close { tree }` forgets it.
//! - `hex_open { text? | path? }`: bytes held to be shown a part at a time (a file stays on disk). Answers
//!   `{ hex, size }`. `hex_rows { hex, from, count }` gives bytes from a place on, as hexadecimal digits;
//!   `hex_find { hex, sought, from, back?, anyCase? }` where bytes (written as hexadecimal digits) are found, going
//!   forward or back, with progress and `stop`; `hex_copy { hex, from, to, form }` a range as a text (`hex`,
//!   `plain`, `code`, `base64`, `text`); `hex_save { hex, from, to, out }` a range written to a file;
//!   `hex_close { hex }` forgets them.
//! - `keys_make { kind, bits?, comment?, lock? }`: a new key (`rsa`, `p256`, `p384`, `p521`, `ed25519`), told in every
//!   form it is written in (`lock`: a passphrase for those that can be locked). `keys_read { text? | path?,
//!   passphrase?, lock?, comment? }`: keys, certificates and requests read from PEM, DER, OpenSSH or PKCS #12, and
//!   written again. `keys_request { key? | make?, passphrase?, subject, names, selfSigned? }`: a request for a
//!   certificate, or a certificate signed with its own key. `keys_sign { request, certificate, key, passphrase?, days,
//!   authority? }`: a request signed by an authority of one's own. `keys_write { form, text, out, … }`: DER or a PKCS #12
//!   file written to disk. What is wrong with what was given is `{ ok: false, error: { code } }`.
//! - The network tools (through `syntelab-net`, only where the user points them): `net_http { method, url, headers,
//!   body?, redirects, verifyTls, timeoutSeconds, out? }` sends one request and answers with what came back;
//!   `net_dns { name, kinds, server?, timeoutSeconds }` asks a name server (`net_dns_servers` lists the computer's
//!   own); `net_ports { host, ports, timeoutMs }` tries ports; `net_certificate { host, port, name?,
//!   timeoutSeconds }` gives the certificates a site shows. What goes wrong on the way is
//!   `{ ok: false, error: { code, detail } }`.
//! - `jwt { token, secret?, secretForm? }`: the header and the payload as JSON, and how the signature stands.
//! - `result_file`: `{ path }`, a name for a new result of the program's own (a file of its cache, given as `out`
//!   to a tool while its result is only looked at). `result_keep { from, to }` copies such a result to where the
//!   user chose; `result_forget { path }` deletes it. Neither touches any other file.
//! - `look { path }`: what a file is, from its start: `{ look, view, mime, format, size, start }`, `view` being
//!   `picture`, `pdf`, `text` or `other`, and `start` its first bytes as hexadecimal digits. A picture or a PDF is
//!   then served whole as the resource `look/<look>`, with its media type; `look_close { look }` forgets it.
//! - `progress`: `{ running, done, total, file, files }`: bytes read, and which file of how many.
//! - `stop`: asks the work that is running to stop; it fails with the code `stopped`.

pub mod base64;
pub mod bases;
pub mod batch;
pub mod certificate;
pub mod codec;
pub mod cron;
pub mod cron_forms;
pub mod csv;
pub mod csv_table;
pub mod derive;
pub mod diff;
pub mod entities;
mod entity_names;
pub mod escape;
pub mod files;
pub mod folders;
pub mod generate;
pub mod gzip;
pub mod hash;
pub mod hex;
pub mod json;
pub mod keys;
pub mod kinds;
pub mod jsonpath;
pub mod jwt;
pub mod lines;
pub mod markdown;
pub mod markup;
pub mod moments;
pub mod results;
pub mod schema;
pub mod shape;
pub mod sql;
pub mod tree;
pub mod url;
pub mod url_parts;
pub mod whole;
pub mod yaml;

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::{json, Value};
use syntelab_app_api::{AppContext, AppError, Resource, ResourceReply, ResourceRequest, SyntelabApp};

use batch::{Found, ItemError, Outcome, Rename, Target};
use codec::{CodecError, Stage, Wrong};
use files::{FileError, Opened};
use json::{RunError, Stats, Style};

/// The app id: the folder name and the `id` in `app.json`.
pub const APP_ID: &str = "dev";

/// How far a long piece of work has got, and whether the user asked for it to stop.
#[derive(Default)]
struct Progress {
    running: AtomicBool,
    /// Bytes read, of how many.
    done: AtomicU64,
    total: AtomicU64,
    /// In a run over many files: the one being worked on (from 1), of how many. Both 0 otherwise.
    file: AtomicUsize,
    files: AtomicUsize,
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
    fn start(&self, total: u64) -> Running<'_> {
        self.done.store(0, Ordering::Relaxed);
        self.total.store(total, Ordering::Relaxed);
        self.file.store(0, Ordering::Relaxed);
        self.files.store(0, Ordering::Relaxed);
        self.stop.store(false, Ordering::Relaxed);
        self.running.store(true, Ordering::Relaxed);
        Running(self)
    }

    /// So many bytes are read by now. False when the user asked for the work to stop.
    fn at(&self, done: u64) -> bool {
        self.done.store(done, Ordering::Relaxed);
        !self.stop.load(Ordering::Relaxed)
    }
}

/// A run over many files, as the progress is told of it.
struct Watched<'a>(&'a Progress);

impl batch::Watch for Watched<'_> {
    fn file(&mut self, index: usize) {
        self.0.file.store(index + 1, Ordering::Relaxed);
    }

    fn read(&mut self, bytes_in_all: u64) -> bool {
        self.0.at(bytes_in_all)
    }
}

/// A document held as a tree while the interface shows it: with how deep it goes, for what must go as deep.
struct Shown {
    node: tree::Node,
    depth: u64,
}

#[derive(Default)]
pub struct Dev {
    progress: Progress,
    /// The documents the interface is showing as trees, by the number each was given. In memory only: a tree is
    /// forgotten when the interface says so, and all of them when the program closes.
    trees: Mutex<HashMap<u64, Arc<Shown>>>,
    /// The texts of CSV the interface is showing as tables, kept the same way (the numbers are from the same count).
    tables: Mutex<HashMap<u64, Arc<csv_table::Table>>>,
    /// The comparisons the interface is showing side by side, kept the same way.
    diffs: Mutex<HashMap<u64, Arc<diff::Held>>>,
    /// The comparisons of two folders the interface is showing, kept the same way.
    folders: Mutex<HashMap<u64, Arc<folders::Compared>>>,
    /// The bytes the hex viewer is showing, kept the same way.
    hexes: Mutex<HashMap<u64, Arc<hex::Held>>>,
    /// The files the interface shows a preview of, kept the same way.
    looks: Mutex<HashMap<u64, Arc<Look>>>,
    next_tree: AtomicU64,
    /// Where the result of a file goes while it is only looked at.
    results: results::Results,
}

/// A file the interface shows a preview of: where it is, and what it is.
struct Look {
    path: PathBuf,
    kind: kinds::Kind,
    size: u64,
}

/// The largest picture or PDF served whole for a preview; a larger one is told of, and not shown.
const LOOKED_AT_MOST: u64 = 64 * 1024 * 1024;

/// How many of the first bytes of a file are told with its kind.
const START_TOLD: usize = 64;

#[derive(Deserialize)]
struct PathRequest {
    path: PathBuf,
    /// The tool takes any bytes: a file that is not text is not refused, and stays on disk to be worked on from there.
    #[serde(default)]
    bytes: bool,
}

#[derive(Deserialize)]
struct KeepRequest {
    from: PathBuf,
    to: PathBuf,
}

#[derive(Deserialize)]
struct LookRequest {
    look: u64,
}

#[derive(Deserialize)]
struct SaveRequest {
    path: PathBuf,
    text: String,
}

/// How JSON is read and written, as the interface chose it. What is left out is as the tool ships it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct JsonWays {
    mode: String,
    indent: Option<String>,
    lenient: bool,
    colon_space: Option<bool>,
    line_ending: Option<String>,
    final_newline: bool,
    ascii: bool,
    sort_keys: bool,
    one_line_within: usize,
    change: Option<String>,
}

impl JsonWays {
    fn options(&self) -> Result<json::Options, AppError> {
        let mut options = json::Options::of(style_of(&self.mode, self.indent.as_deref())?);
        options.lenient = self.lenient;
        options.colon_space = self.colon_space.unwrap_or(true);
        options.crlf = self.line_ending.as_deref() == Some("crlf");
        options.final_newline = self.final_newline;
        options.ascii = self.ascii;
        Ok(options)
    }

    fn change(&self) -> Result<Option<tree::Change>, AppError> {
        match self.change.as_deref().filter(|name| !name.is_empty()) {
            None => Ok(None),
            Some(name) => tree::Change::of(name).map(Some).ok_or_else(|| AppError::InvalidRequest(format!("change {name}"))),
        }
    }

    /// What was asked for cannot be done as the text goes by: the document is held whole.
    fn whole(&self, options: &json::Options) -> bool {
        options.style != Style::Check && (self.sort_keys || self.change.as_deref().is_some_and(|name| !name.is_empty()) || (self.one_line_within > 0 && options.style != Style::Minify))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonRequest {
    #[serde(flatten)]
    ways: JsonWays,
    text: Option<String>,
    path: Option<PathBuf>,
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct FindRequest {
    paths: Vec<PathBuf>,
    #[serde(default)]
    deep: bool,
    #[serde(default)]
    endings: Vec<String>,
}

#[derive(Deserialize)]
struct FoundFile {
    path: PathBuf,
    root: Option<PathBuf>,
    #[serde(default)]
    size: u64,
}

#[derive(Deserialize)]
struct TargetRequest {
    kind: String,
    /// How a result is named after its file: one of these three (see [`Rename`]).
    mark: Option<String>,
    append: Option<String>,
    ending: Option<String>,
    strip: Option<String>,
    otherwise: Option<String>,
    folder: Option<PathBuf>,
}

impl TargetRequest {
    fn rename(&self) -> Option<Rename> {
        let given = |text: &Option<String>| text.clone().filter(|text| !text.is_empty());
        if let Some(ending) = given(&self.append) {
            return Some(Rename::Append(ending));
        }
        if let Some(ending) = given(&self.ending) {
            return Some(Rename::Ending(ending));
        }
        if let Some(ending) = given(&self.strip) {
            return Some(Rename::Strip { ending, otherwise: given(&self.otherwise).unwrap_or_else(|| "out".into()) });
        }
        given(&self.mark).map(Rename::Mark)
    }

    /// Where the results go. Beside the files they must be named anew; in a folder they may keep their names.
    fn target(&self) -> Result<Target, AppError> {
        match (self.kind.as_str(), self.rename(), &self.folder) {
            ("beside", Some(rename), _) => Ok(Target::Beside { rename }),
            ("folder", rename, Some(folder)) => Ok(Target::Folder { folder: folder.clone(), rename }),
            ("replace", _, _) => Ok(Target::Replace),
            ("shown", _, _) => Ok(Target::Shown),
            _ => Err(AppError::InvalidRequest("where the results go".into())),
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JsonPathRequest {
    query: String,
    /// What is given of what was found: `values`, `ways` or `both`.
    #[serde(default)]
    show: String,
    #[serde(default)]
    indent: Option<String>,
    #[serde(default)]
    lenient: bool,
    text: Option<String>,
    path: Option<PathBuf>,
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeriveRequest {
    what: String,
    #[serde(default)]
    lenient: bool,
    // For a schema.
    draft: Option<String>,
    indent: Option<String>,
    // For declarations.
    root: Option<String>,
    interfaces: Option<bool>,
    exported: Option<bool>,
    #[serde(default)]
    readonly: bool,
    text: Option<String>,
    path: Option<PathBuf>,
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct SchemaRequest {
    schema: String,
    #[serde(default)]
    draft: String,
    #[serde(default)]
    formats: bool,
    text: Option<String>,
    path: Option<PathBuf>,
    #[serde(default)]
    files: Vec<FoundFile>,
}

impl SchemaRequest {
    /// The schema made ready; or the answer that says why it cannot be.
    fn ready(&self) -> Result<jsonschema::Validator, Value> {
        schema::ready(&self.schema, &self.draft, self.formats).map_err(|bad| match bad {
            schema::BadSchema::NotJson(error) => json!({ "ok": false, "error": { "code": "schema-not-json", "line": error.line, "column": error.column, "offset": error.offset, "detail": error.problem.code() } }),
            schema::BadSchema::NotSchema(detail) => json!({ "ok": false, "error": { "code": "schema-not-schema", "line": 0, "column": 0, "offset": 0, "detail": detail } }),
            schema::BadSchema::Unknown => json!({ "ok": false, "error": { "code": "schema-not-schema", "line": 0, "column": 0, "offset": 0, "detail": "" } }),
        })
    }
}

/// A file read whole as text, for what must hold it whole. Memory is asked for in a way that can be refused.
fn whole_text(mut input: impl std::io::Read, size: u64) -> Result<String, RunError> {
    let mut bytes = Vec::new();
    if bytes.try_reserve_exact(usize::try_from(size).unwrap_or(usize::MAX).saturating_add(1)).is_err() {
        return Err(RunError::NoMemory);
    }
    input.read_to_end(&mut bytes)?;
    String::from_utf8(bytes).map_err(|_| RunError::Json(json::JsonError { problem: json::Problem::NotUtf8, line: 1, column: 1, offset: 0, byte: 0 }))
}

/// One of the two texts that are compared: typed, or read from a file where it is.
#[derive(Deserialize)]
struct DiffSide {
    text: Option<String>,
    path: Option<PathBuf>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffRequest {
    left: DiffSide,
    right: DiffSide,
    /// The two are JSON documents: compared by what they say, with their keys in order.
    #[serde(default)]
    json: bool,
    #[serde(default)]
    ignore_case: bool,
    #[serde(default)]
    ignore_spaces: bool,
    #[serde(default)]
    ignore_empty_lines: bool,
    #[serde(default)]
    ignore_numbers: bool,
    #[serde(default)]
    ignore_punctuation: bool,
    /// How many lines that are the same are kept around each difference.
    context: Option<usize>,
    /// What is written as the result: `unified` (a patch as `diff -u` writes it) or, for JSON, `patch` (a JSON Patch).
    #[serde(default)]
    result: String,
    /// The result goes to this file, not back to the interface.
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct DiffRowsRequest {
    diff: u64,
    #[serde(default)]
    from: usize,
    #[serde(default)]
    count: usize,
}

#[derive(Deserialize)]
struct FoldersRequest {
    left: PathBuf,
    right: PathBuf,
    /// With the folders under them.
    #[serde(default)]
    deep: bool,
    /// Only files that end so, without the dot; none for every file.
    #[serde(default)]
    endings: Vec<String>,
}

#[derive(Deserialize)]
struct FoldersRowsRequest {
    folders: u64,
    #[serde(default)]
    from: usize,
    #[serde(default)]
    count: usize,
    /// Only the files in one of these states (`only-left`, `only-right`, `same`, `different`, `unread`); none for all.
    #[serde(default)]
    states: Vec<String>,
}

#[derive(Deserialize)]
struct GenerateRequest {
    /// What is made: `uuid` or `secrets`.
    tool: String,
    #[serde(default)]
    options: Value,
    /// How many, each on a line.
    count: Option<u64>,
    /// They go to this file, not back to the interface.
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct CsvOpenRequest {
    text: Option<String>,
    path: Option<PathBuf>,
    /// The sign between the fields: `,`, `;`, `tab`, `|`, or `auto` to tell it from the first row.
    #[serde(default)]
    separator: String,
    #[serde(default)]
    header: bool,
}

#[derive(Deserialize)]
struct HexOpenRequest {
    text: Option<String>,
    path: Option<PathBuf>,
}

#[derive(Deserialize)]
struct HexRequest {
    hex: u64,
    #[serde(default)]
    from: u64,
    #[serde(default)]
    count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HexFindRequest {
    hex: u64,
    /// The bytes sought, each as two hexadecimal digits.
    sought: String,
    #[serde(default)]
    from: u64,
    #[serde(default)]
    back: bool,
    #[serde(default)]
    any_case: bool,
}

#[derive(Deserialize)]
struct HexRangeRequest {
    hex: u64,
    from: u64,
    /// The end of the range: the first byte that is not of it.
    to: u64,
    form: Option<String>,
    out: Option<PathBuf>,
}

/// Bytes written as hexadecimal digits, two for each; none when it is not so written.
fn unhex(written: &str) -> Option<Vec<u8>> {
    let digits = written.as_bytes();
    if !digits.len().is_multiple_of(2) {
        return None;
    }
    digits.chunks(2).map(|pair| Some((char::from(pair[0]).to_digit(16)? * 16 + char::from(pair[1]).to_digit(16)?) as u8)).collect()
}

fn hex_error(error: hex::HexError) -> AppError {
    match error {
        hex::HexError::Stopped => AppError::Failed { code: "stopped", detail: "stopped by the user".into() },
        hex::HexError::NoMemory => AppError::Failed { code: "no-memory", detail: "no memory for the bytes".into() },
        hex::HexError::Io(error) => file_error(error.into(), "cannot-open"),
    }
}

#[derive(Deserialize)]
struct KeysMakeRequest {
    /// `rsa`, `p256`, `p384`, `p521` or `ed25519`.
    kind: String,
    #[serde(default)]
    bits: usize,
    comment: Option<String>,
    /// A passphrase to lock what is written with. Never kept, never logged.
    lock: Option<String>,
}

impl KeysMakeRequest {
    fn kind(&self) -> Result<keys::Kind, keys::KeysError> {
        Ok(match self.kind.as_str() {
            "rsa" => keys::Kind::Rsa(self.bits),
            "p256" => keys::Kind::P256,
            "p384" => keys::Kind::P384,
            "p521" => keys::Kind::P521,
            "ed25519" => keys::Kind::Ed25519,
            _ => return Err(keys::KeysError("failed")),
        })
    }
}

/// A file of keys or certificates is small: one larger than this is something else, and is not read into memory.
const KEYS_LARGEST: u64 = 64 * 1024 * 1024;

#[derive(Deserialize)]
struct KeysReadRequest {
    text: Option<String>,
    path: Option<PathBuf>,
    /// Opens a key that is locked, or a PKCS #12 file.
    passphrase: Option<String>,
    /// Locks what is written again.
    lock: Option<String>,
    comment: Option<String>,
}

impl KeysReadRequest {
    fn given(&self) -> Result<Vec<u8>, AppError> {
        match (&self.text, &self.path) {
            (Some(text), None) => Ok(text.clone().into_bytes()),
            (None, Some(path)) => {
                let size = std::fs::metadata(path).map_err(|error| file_error(error.into(), "cannot-open"))?.len();
                if size > KEYS_LARGEST {
                    return Ok(Vec::new());
                }
                std::fs::read(path).map_err(|error| file_error(error.into(), "cannot-open"))
            }
            _ => Err(AppError::InvalidRequest("one of text and path".into())),
        }
    }
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct KeysSubjectRequest {
    common_name: String,
    organization: String,
    unit: String,
    locality: String,
    state: String,
    country: String,
    email: String,
}

#[derive(Deserialize)]
struct KeysSelfSignedRequest {
    days: u64,
    #[serde(default)]
    authority: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeysRequestRequest {
    /// A key to use, as a text in any of the forms keys are written in; else one is made.
    key: Option<String>,
    passphrase: Option<String>,
    make: Option<KeysMakeRequest>,
    #[serde(default)]
    subject: KeysSubjectRequest,
    #[serde(default)]
    names: Vec<String>,
    /// A certificate signed with its own key is made, and not a request.
    self_signed: Option<KeysSelfSignedRequest>,
    lock: Option<String>,
}

#[derive(Deserialize)]
struct KeysSignRequest {
    /// The request to sign, the certificate of the authority and its key, each as a text.
    request: String,
    certificate: String,
    key: String,
    passphrase: Option<String>,
    days: u64,
    /// What is signed may sign others too.
    #[serde(default)]
    authority: bool,
}

#[derive(Deserialize)]
struct KeysWriteRequest {
    /// `der` or `pkcs12`.
    form: String,
    text: String,
    passphrase: Option<String>,
    /// What the PKCS #12 file is locked with.
    password: Option<String>,
    name: Option<String>,
    #[serde(default)]
    compatible: bool,
    out: PathBuf,
}

/// What is wrong with what was given, as an answer: it is the user's to put right.
fn keys_wrong(error: keys::KeysError) -> Value {
    json!({ "ok": false, "error": { "code": error.0 } })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetHttpRequest {
    method: String,
    url: String,
    #[serde(default)]
    headers: Vec<(String, String)>,
    body: Option<String>,
    /// A file sent as the body, in place of `body`.
    body_file: Option<PathBuf>,
    #[serde(default)]
    redirects: u32,
    #[serde(default = "yes")]
    verify_tls: bool,
    /// 0 waits as long as it takes.
    #[serde(default)]
    timeout_seconds: u64,
    /// The body of the answer is written here, however large, and not shown.
    out: Option<PathBuf>,
    /// A result file of the program's own (`result_file`): a body that is not text, and was read whole, is written
    /// there to be shown from there.
    keep: Option<PathBuf>,
}

fn yes() -> bool {
    true
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetDnsRequest {
    name: String,
    /// The kinds of record asked for: `A`, `AAAA`, `MX`…
    kinds: Vec<String>,
    /// The name server to ask (an address, with a port after a colon when it is not 53), or the `https://` address of a
    /// resolver asked over HTTPS; the computer's own when none.
    server: Option<String>,
    #[serde(default)]
    timeout_seconds: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetPortsRequest {
    host: String,
    /// As they are typed: `22, 80, 443, 8000-8010`.
    ports: String,
    #[serde(default)]
    timeout_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct NetCertificateRequest {
    host: String,
    port: u16,
    /// The name asked for in the handshake, when it is not the host.
    name: Option<String>,
    /// How the connection comes to TLS: `tls`, `smtp`, `imap`, `pop3`, `ftp`, or by the port (`auto`).
    #[serde(default)]
    begin: String,
    #[serde(default)]
    timeout_seconds: u64,
}

/// What went wrong on the way, as an answer: the address is the user's to put right, and the network is what it is.
fn net_wrong(error: syntelab_net::tools::ToolError) -> Value {
    json!({ "ok": false, "error": { "code": error.code, "detail": error.detail } })
}

#[derive(Deserialize)]
struct CsvRequest {
    table: u64,
    #[serde(default)]
    from: u64,
    #[serde(default)]
    count: usize,
}

#[derive(Deserialize)]
struct TreeOpenRequest {
    #[serde(default)]
    lenient: bool,
    text: Option<String>,
    path: Option<PathBuf>,
}

#[derive(Deserialize)]
struct TreeRequest {
    tree: u64,
    #[serde(default)]
    way: Vec<usize>,
    #[serde(default)]
    from: usize,
    #[serde(default)]
    count: usize,
    #[serde(default)]
    sought: String,
    #[serde(default)]
    most: usize,
}

fn row_as_json(row: &tree::Row) -> Value {
    json!({ "key": row.key, "kind": row.kind, "children": row.children, "text": row.text })
}

#[derive(Deserialize)]
struct CodecRequest {
    tool: String,
    #[serde(default)]
    options: Value,
    /// The result of a file is short (digests): it comes back as a text when no file is given for it.
    #[serde(default)]
    show: bool,
    text: Option<String>,
    path: Option<PathBuf>,
    out: Option<PathBuf>,
}

#[derive(Deserialize)]
struct CodecBatchRequest {
    tool: String,
    #[serde(default)]
    options: Value,
    files: Vec<FoundFile>,
    target: Option<TargetRequest>,
    #[serde(default)]
    overwrite: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct JwtRequest {
    token: String,
    secret: Option<String>,
    /// How the secret is written: `text` (its bytes as UTF-8), `base64` or `hex`.
    secret_form: Option<String>,
}

#[derive(Deserialize)]
struct JsonBatchRequest {
    #[serde(flatten)]
    ways: JsonWays,
    files: Vec<FoundFile>,
    target: Option<TargetRequest>,
    #[serde(default)]
    overwrite: bool,
}

impl Dev {
    pub fn new(context: &AppContext) -> Self {
        Self { results: results::Results::new(context.cache_dir.join("results")), ..Self::default() }
    }

    fn open(&self, payload: Value) -> Result<Value, AppError> {
        let request: PathRequest = parse(payload)?;
        let name = name_of(&request.path);
        match files::open(&request.path, !request.bytes) {
            Ok(Opened::Whole { text, size, encoding }) => {
                let mut opened = json!({ "name": name, "size": size, "text": text });
                // Said only when the file was read from another encoding than UTF-8.
                if let Some(encoding) = encoding {
                    opened["encoding"] = json!(encoding);
                }
                Ok(opened)
            }
            Ok(Opened::Large { head, size }) => Ok(json!({ "name": name, "size": size, "large": true, "head": head })),
            Err(FileError::NotUtf8) if request.bytes => {
                let size = std::fs::metadata(&request.path).map(|known| known.len()).unwrap_or(0);
                Ok(json!({ "name": name, "size": size, "large": true, "binary": true, "head": "" }))
            }
            Err(error) => Err(file_error(error, "cannot-open")),
        }
    }

    fn save(&self, payload: Value) -> Result<Value, AppError> {
        let request: SaveRequest = parse(payload)?;
        std::fs::write(&request.path, request.text.as_bytes()).map_err(|error| file_error(error.into(), "cannot-save"))?;
        Ok(json!({ "size": request.text.len() }))
    }

    fn json(&self, payload: Value) -> Result<Value, AppError> {
        let request: JsonRequest = parse(payload)?;
        let options = request.ways.options()?;
        let change = request.ways.change()?;
        let whole = request.ways.whole(&options);
        let started = Instant::now();
        let done = match (&request.text, &request.path) {
            (Some(text), None) if whole => {
                let _running = self.progress.start(text.len() as u64);
                let mut grown = json::Grown::default();
                json_whole(text.as_bytes(), &mut grown, &request.ways, options, change, &mut |read| self.progress.at(read)).and_then(|stats| {
                    let written = String::from_utf8(grown.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
                    Ok((stats, Some(written), None))
                })
            }
            (Some(text), None) => {
                let _running = self.progress.start(text.len() as u64);
                json::transform_text_with(text, options, &mut |read| self.progress.at(read)).map(|(text, stats)| (stats, Some(text), None))
            }
            (None, Some(path)) => self.json_file(path, request.out.as_deref(), &request.ways, options, change)?.map(|(stats, head)| (stats, None, head)),
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        match done {
            Ok((stats, text, head)) => Ok(json!({ "ok": true, "text": text, "head": head, "stats": stats_as_json(&stats, started) })),
            Err(RunError::Json(error)) => Ok(json!({ "ok": false, "error": { "code": error.problem.code(), "line": error.line, "column": error.column, "offset": error.offset } })),
            // What was asked for cannot be done to this document: told as a problem with the document, without a place.
            Err(RunError::Io(error)) if error.kind() == std::io::ErrorKind::Unsupported => Ok(json!({ "ok": false, "error": { "code": "cannot-change", "line": 0, "column": 0, "offset": 0 } })),
            Err(RunError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(RunError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for the result".into() }),
            Err(RunError::Io(error)) => Err(file_error(error.into(), "failed")),
        }
    }

    /// JSON read from a file where it is. With `out`, written there as it is made; what was written of a result
    /// that did not come to its end (not JSON, stopped, the disk full) is taken away again.
    fn json_file(&self, path: &Path, out: Option<&Path>, ways: &JsonWays, options: json::Options, change: Option<tree::Change>) -> Result<Result<(Stats, Option<String>), RunError>, AppError> {
        let style = options.style;
        let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
        let total = input.metadata().map(|known| known.len()).unwrap_or(0);
        let Some(out) = out.filter(|_| style != Style::Check) else {
            let _running = self.progress.start(total);
            let mut only_read = options;
            only_read.style = Style::Check;
            return Ok(json::transform_with(input, std::io::sink(), only_read, &mut |read| self.progress.at(read)).map(|stats| (stats, None)));
        };
        if files::same_file(path, out) {
            return Err(AppError::Failed { code: "same-file", detail: "the result cannot be written over the file it is read from".into() });
        }
        let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
        let _running = self.progress.start(total);
        let written = if ways.whole(&options) {
            json_whole(input, BufWriter::new(output), ways, options, change, &mut |read| self.progress.at(read))
        } else {
            json::transform_with(input, BufWriter::new(output), options, &mut |read| self.progress.at(read))
        };
        match written {
            Ok(stats) => {
                let head = files::head(out).map_err(|error| file_error(error, "cannot-open"))?;
                Ok(Ok((stats, Some(head))))
            }
            Err(error) => {
                std::fs::remove_file(out).ok();
                Ok(Err(error))
            }
        }
    }

    fn find_files(&self, payload: Value) -> Result<Value, AppError> {
        let request: FindRequest = parse(payload)?;
        let found = batch::find(&request.paths, request.deep, &request.endings).map_err(|error| file_error(error.into(), "cannot-open"))?;
        let files: Vec<Value> = found.iter().map(|file| json!({ "path": file.path, "root": file.root, "size": file.size })).collect();
        Ok(json!({ "files": files }))
    }

    /// Every file in turn, each read from disk as it comes. One that is not JSON, or cannot be read, does not stop the others.
    fn json_batch(&self, payload: Value) -> Result<Value, AppError> {
        let request: JsonBatchRequest = parse(payload)?;
        let options = request.ways.options()?;
        let change = request.ways.change()?;
        let whole = request.ways.whole(&options);
        let style = options.style;
        let target = match (style, &request.target) {
            (Style::Check, _) => Target::Nowhere,
            // The results of JSON keep their names in a folder: they are told from their files by where they are.
            (_, Some(target)) if target.kind == "folder" => Target::Folder { folder: target.folder.clone().ok_or_else(|| AppError::InvalidRequest("where the results go".into()))?, rename: None },
            (_, Some(target)) => target.target()?,
            _ => return Err(AppError::InvalidRequest("where the results go".into())),
        };
        let files: Vec<Found> = request.files.into_iter().map(|file| Found { path: file.path, root: file.root, size: file.size }).collect();
        let _running = self.progress.start(files.iter().map(|file| file.size).sum());
        self.progress.files.store(files.len(), Ordering::Relaxed);
        let items = batch::run(&files, &target, request.overwrite, &mut Watched(&self.progress), &mut |input, output, read| {
            let done = if whole { json_whole(input, output, &request.ways, options, change, read) } else { json::transform_with(input, output, options, read) };
            done.map(|stats| (stats.bytes_in, stats.bytes_out)).map_err(|error| match error {
                RunError::Io(error) if error.kind() == std::io::ErrorKind::Unsupported => ItemError::Wrong { code: "cannot-change", line: 0, column: 0 },
                RunError::Json(error) => ItemError::Wrong { code: error.problem.code(), line: error.line, column: error.column },
                RunError::Io(error) => ItemError::Io(error),
                RunError::Stopped => ItemError::Stopped,
                RunError::NoMemory => ItemError::NoMemory,
            })
        });
        Ok(items_as_json(&items))
    }

    /// What a JSONPath query finds in a document, written as a JSON array.
    fn jsonpath(&self, payload: Value) -> Result<Value, AppError> {
        let request: JsonPathRequest = parse(payload)?;
        let query = match jsonpath::Query::read(&request.query) {
            Ok(query) => query,
            Err(bad) => return Ok(json!({ "ok": false, "error": { "code": "bad-query", "line": 0, "column": bad.column, "offset": bad.column.saturating_sub(1) } })),
        };
        let mut options = json::Options::of(style_of("format", request.indent.as_deref())?);
        options.lenient = request.lenient;
        let show = request.show.as_str();
        let started = Instant::now();
        let mut found = 0;
        let done = match (&request.text, &request.path, &request.out) {
            (Some(text), None, _) => {
                let _running = self.progress.start(text.len() as u64);
                let mut grown = json::Grown::default();
                jsonpath_whole(text.as_bytes(), &mut grown, &query, show, options, &mut found, &mut |read| self.progress.at(read)).and_then(|stats| {
                    let written = String::from_utf8(grown.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
                    Ok((stats, Some(written), None))
                })
            }
            (None, Some(path), Some(out)) => {
                if files::same_file(path, out) {
                    return Err(AppError::Failed { code: "same-file", detail: "the result cannot be written over the file it is read from".into() });
                }
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let total = input.metadata().map(|known| known.len()).unwrap_or(0);
                let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                let _running = self.progress.start(total);
                match jsonpath_whole(input, BufWriter::new(output), &query, show, options, &mut found, &mut |read| self.progress.at(read)) {
                    Ok(stats) => Ok((stats, None, Some(files::head(out).map_err(|error| file_error(error, "cannot-open"))?))),
                    Err(error) => {
                        std::fs::remove_file(out).ok();
                        Err(error)
                    }
                }
            }
            // A file that is only read: whether it is JSON, and how many values the query finds in it.
            (None, Some(path), None) => {
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let _running = self.progress.start(input.metadata().map(|known| known.len()).unwrap_or(0));
                jsonpath_whole(input, std::io::sink(), &query, show, options, &mut found, &mut |read| self.progress.at(read)).map(|stats| (stats, None, None))
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        match done {
            Ok((stats, text, head)) => Ok(json!({ "ok": true, "text": text, "head": head, "found": found, "stats": stats_as_json(&stats, started) })),
            Err(RunError::Json(error)) => Ok(json!({ "ok": false, "error": { "code": error.problem.code(), "line": error.line, "column": error.column, "offset": error.offset } })),
            Err(RunError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(RunError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for the document".into() }),
            Err(RunError::Io(error)) => Err(file_error(error.into(), "failed")),
        }
    }

    /// What is written from the shape of a sample: a schema, or declarations.
    fn derive(&self, payload: Value) -> Result<Value, AppError> {
        let request: DeriveRequest = parse(payload)?;
        let write: Box<dyn Fn(&tree::Node) -> Result<Vec<u8>, RunError> + Send + Sync> = match request.what.as_str() {
            "schema" => {
                let draft = derive::draft_address(request.draft.as_deref().unwrap_or("2020-12")).ok_or_else(|| AppError::InvalidRequest("draft".into()))?;
                let options = json::Options::of(style_of("format", request.indent.as_deref())?);
                Box::new(move |node| {
                    let mut written = json::Grown::default();
                    tree::write(&derive::schema(&shape::of(node), draft), &mut written, &tree::Writing { options, one_line_within: 0 })?;
                    Ok(written.0)
                })
            }
            "typescript" => {
                let how = derive::Declared { root: request.root.clone().filter(|name| !name.trim().is_empty()).unwrap_or_else(|| "Root".into()), interfaces: request.interfaces.unwrap_or(true), exported: request.exported.unwrap_or(true), readonly: request.readonly };
                Box::new(move |node| Ok(derive::typescript(&shape::of(node), &how).into_bytes()))
            }
            other => return Err(AppError::InvalidRequest(format!("what {other}"))),
        };
        let started = Instant::now();
        let done = match (&request.text, &request.path, &request.out) {
            (Some(text), None, _) => {
                let _running = self.progress.start(text.len() as u64);
                let mut grown = json::Grown::default();
                from_whole(text.as_bytes(), &mut grown, request.lenient, &*write, &mut |read| self.progress.at(read)).and_then(|stats| {
                    let written = String::from_utf8(grown.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
                    Ok((stats, Some(written), None))
                })
            }
            (None, Some(path), out) => {
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let total = input.metadata().map(|known| known.len()).unwrap_or(0);
                match out {
                    None => {
                        let _running = self.progress.start(total);
                        from_whole(input, std::io::sink(), request.lenient, &*write, &mut |read| self.progress.at(read)).map(|stats| (stats, None, None))
                    }
                    Some(out) => {
                        if files::same_file(path, out) {
                            return Err(AppError::Failed { code: "same-file", detail: "the result cannot be written over the file it is read from".into() });
                        }
                        let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                        let _running = self.progress.start(total);
                        match from_whole(input, BufWriter::new(output), request.lenient, &*write, &mut |read| self.progress.at(read)) {
                            Ok(stats) => Ok((stats, None, Some(files::head(out).map_err(|error| file_error(error, "cannot-open"))?))),
                            Err(error) => {
                                std::fs::remove_file(out).ok();
                                Err(error)
                            }
                        }
                    }
                }
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        match done {
            Ok((stats, text, head)) => Ok(json!({ "ok": true, "text": text, "head": head, "stats": stats_as_json(&stats, started) })),
            Err(RunError::Json(error)) => Ok(json!({ "ok": false, "error": { "code": error.problem.code(), "line": error.line, "column": error.column, "offset": error.offset } })),
            Err(RunError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(RunError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for the document".into() }),
            Err(RunError::Io(error)) => Err(file_error(error.into(), "failed")),
        }
    }

    /// A document checked against a schema.
    fn schema_check(&self, payload: Value) -> Result<Value, AppError> {
        let request: SchemaRequest = parse(payload)?;
        let validator = match request.ready() {
            Ok(validator) => validator,
            Err(answer) => return Ok(answer),
        };
        let started = Instant::now();
        let read = match (&request.text, &request.path) {
            (Some(text), None) => Ok(std::borrow::Cow::Borrowed(text.as_str())),
            (None, Some(path)) => {
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let size = input.metadata().map(|known| known.len()).unwrap_or(0);
                let _running = self.progress.start(size);
                whole_text(input, size).map(std::borrow::Cow::Owned)
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        let checked = read.and_then(|document| schema::check(&validator, &document).map(|misfits| (misfits, document.len())));
        match checked {
            Ok((misfits, size)) => {
                let listed: Vec<Value> = misfits.iter().map(|misfit| json!({ "at": misfit.at, "rule": misfit.rule, "message": misfit.message })).collect();
                Ok(json!({ "ok": true, "misfits": listed, "stats": { "bytesIn": size, "bytesOut": 0, "ms": started.elapsed().as_millis() as u64 } }))
            }
            Err(RunError::Json(error)) => Ok(json!({ "ok": false, "error": { "code": error.problem.code(), "line": error.line, "column": error.column, "offset": error.offset } })),
            Err(RunError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(RunError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for the document".into() }),
            Err(RunError::Io(error)) => Err(file_error(error.into(), "failed")),
        }
    }

    /// Every file checked against one schema. Nothing is written.
    fn schema_batch(&self, payload: Value) -> Result<Value, AppError> {
        let request: SchemaRequest = parse(payload)?;
        let validator = match request.ready() {
            Ok(validator) => validator,
            Err(answer) => return Ok(answer),
        };
        let files: Vec<Found> = request.files.iter().map(|file| Found { path: file.path.clone(), root: file.root.clone(), size: file.size }).collect();
        let _running = self.progress.start(files.iter().map(|file| file.size).sum());
        self.progress.files.store(files.len(), Ordering::Relaxed);
        let items = batch::run(&files, &Target::Nowhere, false, &mut Watched(&self.progress), &mut |input, _output, read| {
            let size = input.metadata().map(|known| known.len()).unwrap_or(0);
            let checked = whole_text(input, size).and_then(|document| schema::check(&validator, &document));
            if !read(size) {
                return Err(ItemError::Stopped);
            }
            match checked {
                Ok(misfits) if misfits.is_empty() => Ok((size, 0)),
                Ok(_) => Err(ItemError::Wrong { code: "not-valid", line: 0, column: 0 }),
                Err(RunError::Json(error)) => Err(ItemError::Wrong { code: error.problem.code(), line: error.line, column: error.column }),
                Err(RunError::Io(error)) => Err(ItemError::Io(error)),
                Err(RunError::Stopped) => Err(ItemError::Stopped),
                Err(RunError::NoMemory) => Err(ItemError::NoMemory),
            }
        });
        Ok(items_as_json(&items))
    }

    /// A document read whole and kept as a tree, for the interface to show a part at a time.
    fn tree_open(&self, payload: Value) -> Result<Value, AppError> {
        let request: TreeOpenRequest = parse(payload)?;
        let started = Instant::now();
        let mut read = json::Options::of(Style::Minify);
        read.lenient = request.lenient;
        let mut minified = json::Grown::default();
        let checked = match (&request.text, &request.path) {
            (Some(text), None) => {
                let _running = self.progress.start(text.len() as u64);
                json::transform_with(text.as_bytes(), &mut minified, read, &mut |read| self.progress.at(read))
            }
            (None, Some(path)) => {
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let _running = self.progress.start(input.metadata().map(|known| known.len()).unwrap_or(0));
                json::transform_with(input, &mut minified, read, &mut |read| self.progress.at(read))
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        let stats = match checked {
            Ok(stats) => stats,
            Err(RunError::Json(error)) => return Ok(json!({ "ok": false, "error": { "code": error.problem.code(), "line": error.line, "column": error.column, "offset": error.offset } })),
            Err(RunError::Stopped) => return Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(RunError::NoMemory) => return Err(AppError::Failed { code: "no-memory", detail: "no memory for the document".into() }),
            Err(RunError::Io(error)) => return Err(file_error(error.into(), "failed")),
        };
        let no_memory = || AppError::Failed { code: "no-memory", detail: "no memory for the tree".into() };
        let minified = String::from_utf8(minified.0).map_err(|_| AppError::Failed { code: "failed", detail: "not text".into() })?;
        let node = tree::build(&minified).ok_or_else(no_memory)?;
        drop(minified);
        let root = row_as_json(&node.as_row());
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        self.trees.lock().map_err(|_| no_memory())?.insert(number, Arc::new(Shown { node, depth: stats.depth }));
        Ok(json!({ "ok": true, "tree": number, "root": root, "stats": stats_as_json(&stats, started) }))
    }

    fn shown(&self, number: u64) -> Result<Arc<Shown>, AppError> {
        self.trees.lock().ok().and_then(|trees| trees.get(&number).cloned()).ok_or_else(|| AppError::Failed { code: "no-tree", detail: format!("tree {number} is not held") })
    }

    fn tree_rows(&self, payload: Value) -> Result<Value, AppError> {
        let request: TreeRequest = parse(payload)?;
        let shown = self.shown(request.tree)?;
        let node = shown.node.at(&request.way).ok_or_else(|| AppError::InvalidRequest("no value at the end of this way".into()))?;
        let rows: Vec<Value> = node.rows(request.from, request.count).iter().map(row_as_json).collect();
        Ok(json!({ "rows": rows }))
    }

    fn tree_find(&self, payload: Value) -> Result<Value, AppError> {
        let request: TreeRequest = parse(payload)?;
        let shown = self.shown(request.tree)?;
        let sought = request.sought;
        let most = request.most;
        let (hits, count) = tree::deep(shown.depth, || tree::find(&shown.node, &sought, most)).ok_or_else(|| AppError::Failed { code: "no-memory", detail: "no memory to search the tree".into() })?;
        let hits: Vec<Value> = hits.iter().map(|hit| json!({ "way": hit.way, "row": row_as_json(&hit.row) })).collect();
        Ok(json!({ "hits": hits, "count": count }))
    }

    fn tree_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: TreeRequest = parse(payload)?;
        let gone = self.trees.lock().ok().and_then(|mut trees| trees.remove(&request.tree));
        // The tree is taken apart off the stack of the one who asked: it may be deep.
        drop(gone);
        Ok(json!({}))
    }

    /// Two texts, two files or two JSON documents compared: the patch as the result, and the comparison kept to be
    /// shown side by side. Files are read from where they are and never held whole; JSON is, since it is written anew.
    fn diff(&self, payload: Value) -> Result<Value, AppError> {
        let request: DiffRequest = parse(payload)?;
        let started = Instant::now();
        let no_memory = || AppError::Failed { code: "no-memory", detail: "no memory for the comparison".into() };
        let failed = |error: CodecError| match error {
            CodecError::Stopped => AppError::Failed { code: "stopped", detail: "stopped by the user".into() },
            CodecError::NoMemory => AppError::Failed { code: "no-memory", detail: "no memory for the comparison".into() },
            CodecError::Io(error) => file_error(error.into(), "cannot-open"),
            CodecError::Wrong(_) => AppError::Failed { code: "failed", detail: "not compared".into() },
        };
        let side = |side: &DiffSide| -> Result<(diff::Source, String), AppError> {
            match (&side.text, &side.path) {
                (Some(text), None) => Ok((diff::Source::Text(text.clone().into_bytes()), String::new())),
                (None, Some(path)) => Ok((diff::Source::File(path.clone()), name_of(path))),
                _ => Err(AppError::InvalidRequest("one of text and path for each side".into())),
            }
        };
        let (mut left, left_name) = side(&request.left)?;
        let (mut right, right_name) = side(&request.right)?;
        let size = |source: &diff::Source| source.size().map_err(|error| file_error(error.into(), "cannot-open"));
        let bytes_in = size(&left)? + size(&right)?;
        let _running = self.progress.start(bytes_in);
        let mut patch: Option<(Vec<u8>, usize)> = None;
        if request.json {
            let mut trees = Vec::new();
            for (name, source) in [("left", &mut left), ("right", &mut right)] {
                let text = match &*source {
                    diff::Source::Text(bytes) => String::from_utf8_lossy(bytes).into_owned(),
                    diff::Source::File(path) => {
                        let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                        let size = input.metadata().map(|known| known.len()).unwrap_or(0);
                        match whole_text(input, size) {
                            Ok(text) => text,
                            Err(RunError::NoMemory) => return Err(no_memory()),
                            Err(RunError::Json(_)) => return Ok(json!({ "ok": false, "error": { "code": "not-utf8", "line": 0, "column": 0, "offset": 0, "side": name } })),
                            Err(RunError::Io(error)) => return Err(file_error(error.into(), "cannot-open")),
                            Err(RunError::Stopped) => return Err(failed(CodecError::Stopped)),
                        }
                    }
                };
                match diff::json_as_compared(&text) {
                    Ok((written, node, depth)) => {
                        *source = diff::Source::Text(written.into_bytes());
                        trees.push((node, depth));
                    }
                    Err(CodecError::Wrong(wrong)) => return Ok(json!({ "ok": false, "error": { "code": wrong.code, "line": wrong.line, "column": wrong.column, "offset": wrong.offset, "side": name } })),
                    Err(other) => return Err(failed(other)),
                }
            }
            if request.result == "patch" {
                let depth = trees[0].1.max(trees[1].1);
                patch = Some(diff::json_patch(&trees[0].0, &trees[1].0, depth).map_err(failed)?);
            }
            // The trees are taken apart off this stack: they may be deep.
            let deepest = trees.iter().map(|(_, depth)| *depth).max().unwrap_or(0);
            tree::deep(deepest, move || drop(trees));
        }
        let ignoring = syntelab_compare::Ignoring { case: request.ignore_case, spaces: request.ignore_spaces, empty_lines: request.ignore_empty_lines, numbers: request.ignore_numbers, punctuation: request.ignore_punctuation };
        let context = request.context.unwrap_or(3).min(1_000_000);
        let named = |name: &str, otherwise: &str| if name.is_empty() { otherwise.to_owned() } else { name.to_owned() };
        let (left_name, right_name) = (named(&left_name, "original"), named(&right_name, "changed"));
        let names = (left_name.as_str(), right_name.as_str());
        let stop = &self.progress.stop;
        let mut watch = |read: u64| self.progress.at(read);
        let mut go_on = || !stop.load(Ordering::Relaxed);
        let operations = patch.as_ref().map(|(_, count)| *count);
        let mut answer = json!({});
        let (held, bytes_out) = match (&request.out, patch) {
            // The patch of two files goes straight to its file, as it is made: it is as long as what differs.
            (Some(out), None) => {
                for source in [&left, &right] {
                    if matches!(source, diff::Source::File(path) if files::same_file(path, out)) {
                        return Err(AppError::Failed { code: "same-file", detail: "the result cannot be written over a file it is read from".into() });
                    }
                }
                let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                let mut counted = CountedOut(BufWriter::new(output), 0);
                let compared = diff::compare(left, right, ignoring, context, names, &mut counted, &mut watch, &mut go_on).and_then(|held| std::io::Write::flush(&mut counted).map(|()| held).map_err(Into::into));
                let written = counted.1;
                drop(counted);
                match compared {
                    Ok(held) => {
                        answer["head"] = json!(files::head(out).map_err(|error| file_error(error, "cannot-open"))?);
                        (held, written)
                    }
                    Err(error) => {
                        std::fs::remove_file(out).ok();
                        return Err(failed(error));
                    }
                }
            }
            (out, patch) => {
                let mut grown = json::Grown::default();
                let held = diff::compare(left, right, ignoring, context, names, &mut grown, &mut watch, &mut go_on).map_err(failed)?;
                let written = patch.map_or(grown.0, |(patch, _)| patch);
                match out {
                    Some(out) => {
                        std::fs::write(out, &written).map_err(|error| file_error(error.into(), "cannot-save"))?;
                        answer["head"] = json!(files::head(out).map_err(|error| file_error(error, "cannot-open"))?);
                    }
                    None => answer["text"] = json!(String::from_utf8_lossy(&written)),
                }
                (held, written.len() as u64)
            }
        };
        for (name, value) in [("ok", json!(true)), ("identical", json!(held.identical())), ("added", json!(held.added)), ("removed", json!(held.removed)), ("changed", json!(held.changed)), ("same", json!(held.same)), ("shown", json!(held.shown.len())), ("operations", json!(operations))] {
            answer[name] = value;
        }
        answer["stats"] = json!({ "bytesIn": bytes_in, "bytesOut": bytes_out, "ms": started.elapsed().as_millis() as u64 });
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        self.diffs.lock().map_err(|_| no_memory())?.insert(number, Arc::new(held));
        answer["diff"] = json!(number);
        Ok(answer)
    }

    fn diff_rows(&self, payload: Value) -> Result<Value, AppError> {
        let request: DiffRowsRequest = parse(payload)?;
        let held = self.diffs.lock().ok().and_then(|diffs| diffs.get(&request.diff).cloned()).ok_or_else(|| AppError::Failed { code: "no-diff", detail: format!("comparison {} is not held", request.diff) })?;
        let side = |side: &Option<syntelab_compare::Side>| side.as_ref().map(|side| json!({ "number": side.number, "pieces": side.pieces.iter().map(|piece| json!({ "text": piece.text, "changed": piece.changed })).collect::<Vec<_>>() }));
        let rows: Vec<Value> = held
            .rows(request.from, request.count.min(10_000))
            .map_err(|error| file_error(error.into(), "cannot-open"))?
            .iter()
            .map(|row| if row.kind == "skipped" { json!({ "skipped": row.skipped }) } else { json!({ "kind": row.kind, "left": side(&row.left), "right": side(&row.right) }) })
            .collect();
        Ok(json!({ "from": request.from, "rows": rows }))
    }

    fn diff_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: DiffRowsRequest = parse(payload)?;
        if let Ok(mut diffs) = self.diffs.lock() {
            diffs.remove(&request.diff);
        }
        Ok(json!({}))
    }

    /// Two folders compared file by file; what was found is kept, for the interface to show a part at a time.
    fn folders_compare(&self, payload: Value) -> Result<Value, AppError> {
        let request: FoldersRequest = parse(payload)?;
        let started = Instant::now();
        let _running = self.progress.start(0);
        let compared = folders::compare(&request.left, &request.right, request.deep, &request.endings, &mut |done, total| {
            self.progress.total.store(total, Ordering::Relaxed);
            self.progress.at(done)
        });
        let compared = match compared {
            Ok(compared) => compared,
            Err(CodecError::Stopped) => return Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(CodecError::NoMemory) => return Err(AppError::Failed { code: "no-memory", detail: "no memory for the list of files".into() }),
            Err(CodecError::Io(error)) => return Err(file_error(error.into(), "cannot-open")),
            Err(CodecError::Wrong(_)) => return Err(AppError::Failed { code: "failed", detail: "not compared".into() }),
        };
        use folders::State;
        let answer = json!({
            "files": compared.entries.len(),
            "onlyLeft": compared.count(State::OnlyLeft),
            "onlyRight": compared.count(State::OnlyRight),
            "same": compared.count(State::Same),
            "different": compared.count(State::Different),
            "unread": compared.count(State::Unread),
            "ms": started.elapsed().as_millis() as u64,
        });
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        self.folders.lock().map_err(|_| AppError::Failed { code: "no-memory", detail: "no memory for the list of files".into() })?.insert(number, Arc::new(compared));
        let mut answer = answer;
        answer["folders"] = json!(number);
        Ok(answer)
    }

    fn folders_rows(&self, payload: Value) -> Result<Value, AppError> {
        let request: FoldersRowsRequest = parse(payload)?;
        let compared = self.folders.lock().ok().and_then(|folders| folders.get(&request.folders).cloned()).ok_or_else(|| AppError::Failed { code: "no-folders", detail: format!("comparison {} is not held", request.folders) })?;
        let wanted = |entry: &&folders::Entry| request.states.is_empty() || request.states.iter().any(|state| state == entry.state.name());
        let facts = |facts: &Option<folders::Facts>| facts.map(|facts| json!({ "size": facts.size, "modified": facts.modified }));
        let rows: Vec<Value> = compared
            .entries
            .iter()
            .filter(wanted)
            .skip(request.from)
            .take(request.count.min(10_000))
            .map(|entry| json!({ "path": entry.path, "state": entry.state.name(), "left": facts(&entry.left), "right": facts(&entry.right), "leftFile": entry.left.map(|_| compared.file(entry, false)), "rightFile": entry.right.map(|_| compared.file(entry, true)) }))
            .collect();
        Ok(json!({ "from": request.from, "rows": rows, "count": compared.entries.iter().filter(wanted).count() }))
    }

    fn folders_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: FoldersRowsRequest = parse(payload)?;
        if let Ok(mut folders) = self.folders.lock() {
            folders.remove(&request.folders);
        }
        Ok(json!({}))
    }

    /// Identifiers, or passwords and secrets, made as many as asked for. Nothing of them is kept here.
    fn generate(&self, payload: Value) -> Result<Value, AppError> {
        let request: GenerateRequest = parse(payload)?;
        let started = Instant::now();
        let options = &request.options;
        let text = |name: &str| options.get(name).and_then(Value::as_str).unwrap_or_default();
        let flag = |name: &str, otherwise: bool| options.get(name).and_then(Value::as_bool).unwrap_or(otherwise);
        let count = request.count.unwrap_or(1).max(1);
        let wrong = |code: &str| Ok(json!({ "ok": false, "error": { "code": code, "line": 0, "column": 0, "offset": 0 } }));
        // What is made, as something that writes it: told how many are made, and stopped, as it goes.
        type Make<'a> = Box<dyn Fn(&mut dyn std::io::Write, &mut dyn FnMut(u64) -> bool) -> Result<(), CodecError> + 'a>;
        let mut notes: Vec<(&'static str, String)> = Vec::new();
        let make: Make = match request.tool.as_str() {
            "uuid" => {
                let space = || generate::namespace(if text("namespace").is_empty() { "dns" } else { text("namespace") });
                let kind = match text("version") {
                    "1" => generate::Kind::V1,
                    "" | "4" => generate::Kind::V4,
                    "6" => generate::Kind::V6,
                    "7" => generate::Kind::V7,
                    "nil" => generate::Kind::Nil,
                    "max" => generate::Kind::Max,
                    version @ ("3" | "5") => {
                        let Some(space) = space() else { return wrong("bad-namespace") };
                        if version == "3" {
                            generate::Kind::V3(space, text("name").to_owned())
                        } else {
                            generate::Kind::V5(space, text("name").to_owned())
                        }
                    }
                    other => return Err(AppError::InvalidRequest(format!("version {other}"))),
                };
                let written = match text("format") {
                    "" | "hyphens" => generate::Written::Hyphens,
                    "plain" => generate::Written::Plain,
                    "urn" => generate::Written::Urn,
                    "braces" => generate::Written::Braces,
                    other => return Err(AppError::InvalidRequest(format!("format {other}"))),
                };
                let upper = flag("upper", false);
                Box::new(move |out, go_on| generate::uuids(&kind, written, upper, count, out, go_on))
            }
            "secrets" => {
                let secret = match text("kind") {
                    "" | "password" => match generate::password(flag("small", true), flag("capital", true), flag("digits", true), flag("signs", true), flag("noLookAlikes", false)) {
                        Some(secret) => secret,
                        None => return wrong("no-characters"),
                    },
                    "hex" => generate::Secret::Hex,
                    "base64" => generate::Secret::Base64 { for_urls: false },
                    "base64url" => generate::Secret::Base64 { for_urls: true },
                    "words" => generate::Secret::Words { separator: options.get("separator").and_then(Value::as_str).unwrap_or("-").to_owned(), capital: flag("capitalWords", false), digit: flag("digitInWords", false) },
                    other => return Err(AppError::InvalidRequest(format!("kind {other}"))),
                };
                let length = options.get("length").and_then(Value::as_u64).unwrap_or(20).max(1);
                notes.push(("secret-bits", format!("{:.0}", generate::bits(&secret, length).floor())));
                Box::new(move |out, go_on| generate::secrets(&secret, length, count, out, go_on))
            }
            other => return Err(AppError::NotFound(format!("tool {other}"))),
        };
        let _running = self.progress.start(count);
        let mut watch = |made: u64| self.progress.at(made);
        let mut answer = json!({});
        let made = match &request.out {
            Some(out) => {
                let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                let mut counted = CountedOut(BufWriter::new(output), 0);
                let made = make(&mut counted, &mut watch).and_then(|()| std::io::Write::flush(&mut counted).map_err(Into::into));
                let written = counted.1;
                drop(counted);
                if made.is_err() {
                    std::fs::remove_file(out).ok();
                } else {
                    answer["head"] = json!(files::head(out).map_err(|error| file_error(error, "cannot-open"))?);
                }
                made.map(|()| written)
            }
            None => {
                let mut grown = json::Grown::default();
                make(&mut grown, &mut watch).map(|()| {
                    let written = grown.0.len() as u64;
                    answer["text"] = json!(String::from_utf8_lossy(&grown.0));
                    // What was made is in the answer now: the copy it was written into is wiped.
                    grown.0.iter_mut().for_each(|byte| *byte = 0);
                    written
                })
            }
        };
        match made {
            Ok(written) => {
                answer["ok"] = json!(true);
                answer["count"] = json!(count);
                answer["stats"] = json!({ "bytesIn": 0, "bytesOut": written, "ms": started.elapsed().as_millis() as u64 });
                answer["notes"] = notes_as_json(&notes);
                Ok(answer)
            }
            Err(CodecError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(CodecError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for what is made".into() }),
            Err(CodecError::Io(error)) => Err(file_error(error.into(), "failed")),
            Err(CodecError::Wrong(wrong)) => Ok(json!({ "ok": false, "error": { "code": wrong.code, "line": 0, "column": 0, "offset": 0 } })),
        }
    }

    /// A text of CSV read once from end to end and kept as a table, for the interface to show a part at a time.
    fn csv_open(&self, payload: Value) -> Result<Value, AppError> {
        let request: CsvOpenRequest = parse(payload)?;
        let separator = match request.separator.as_str() {
            "" | "auto" => None,
            "," => Some(b','),
            ";" => Some(b';'),
            "tab" => Some(b'\t'),
            "|" => Some(b'|'),
            other => return Err(AppError::InvalidRequest(format!("separator {other}"))),
        };
        let (source, total) = match (request.text, request.path) {
            (Some(text), None) => {
                let size = text.len() as u64;
                (csv_table::Source::Text(text.into_bytes()), size)
            }
            (None, Some(path)) => {
                let size = std::fs::metadata(&path).map_err(|error| file_error(error.into(), "cannot-open"))?.len();
                (csv_table::Source::File(path), size)
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        let _running = self.progress.start(total);
        let table = match csv_table::Table::open(source, separator, request.header, &mut |read| self.progress.at(read)) {
            Ok(table) => table,
            Err(CodecError::Stopped) => return Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(CodecError::NoMemory) => return Err(AppError::Failed { code: "no-memory", detail: "no memory for the table".into() }),
            Err(CodecError::Io(error)) => return Err(file_error(error.into(), "cannot-open")),
            Err(CodecError::Wrong(_)) => return Err(AppError::Failed { code: "failed", detail: "not a table".into() }),
        };
        let answer = json!({ "rows": table.rows, "columns": table.columns, "names": table.names, "longest": table.longest, "separator": table.separator() });
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        let no_memory = || AppError::Failed { code: "no-memory", detail: "no memory for the table".into() };
        self.tables.lock().map_err(|_| no_memory())?.insert(number, Arc::new(table));
        let mut answer = answer;
        answer["table"] = json!(number);
        Ok(answer)
    }

    fn csv_rows(&self, payload: Value) -> Result<Value, AppError> {
        let request: CsvRequest = parse(payload)?;
        let table = self.tables.lock().ok().and_then(|tables| tables.get(&request.table).cloned()).ok_or_else(|| AppError::Failed { code: "no-table", detail: format!("table {} is not held", request.table) })?;
        let rows = table.read(request.from, request.count.min(10_000)).map_err(|error| file_error(error.into(), "cannot-open"))?;
        Ok(json!({ "from": request.from, "rows": rows }))
    }

    fn csv_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: CsvRequest = parse(payload)?;
        if let Ok(mut tables) = self.tables.lock() {
            tables.remove(&request.table);
        }
        Ok(json!({}))
    }

    fn hex_held(&self, number: u64) -> Result<Arc<hex::Held>, AppError> {
        self.hexes.lock().ok().and_then(|hexes| hexes.get(&number).cloned()).ok_or_else(|| AppError::Failed { code: "no-bytes", detail: format!("bytes {number} are not held") })
    }

    /// Bytes held to be shown a part at a time: a file stays on disk, a text is kept as its bytes.
    fn hex_open(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexOpenRequest = parse(payload)?;
        let source = match (request.text, request.path) {
            (Some(text), None) => hex::Source::Bytes(text.into_bytes()),
            (None, Some(path)) => hex::Source::File(path),
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        let held = hex::Held::open(source).map_err(|error| file_error(error.into(), "cannot-open"))?;
        let size = held.size;
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        self.hexes.lock().map_err(|_| AppError::Failed { code: "no-memory", detail: "no memory for the bytes".into() })?.insert(number, Arc::new(held));
        Ok(json!({ "hex": number, "size": size }))
    }

    /// Bytes from a place on, written as two hexadecimal digits each.
    fn hex_rows(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexRequest = parse(payload)?;
        let held = self.hex_held(request.hex)?;
        // What is in sight is asked for, never the whole: a page is small whatever is asked.
        let bytes = held.read(request.from, request.count.min(1024 * 1024)).map_err(hex_error)?;
        let written = hex::written(&bytes, hex::Form::Plain).ok_or(AppError::Failed { code: "no-memory", detail: "no memory for the bytes".into() })?;
        Ok(json!({ "from": request.from.min(held.size), "bytes": written, "size": held.size }))
    }

    /// Where bytes are found, going forward or back from a place. `sought` is written as hexadecimal digits.
    fn hex_find(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexFindRequest = parse(payload)?;
        let held = self.hex_held(request.hex)?;
        let sought = unhex(&request.sought).filter(|sought| !sought.is_empty()).ok_or_else(|| AppError::InvalidRequest("what is sought".into()))?;
        let started = Instant::now();
        let _running = self.progress.start(if request.back { request.from.min(held.size) } else { held.size.saturating_sub(request.from) });
        let at = held.find(&sought, request.from, request.back, request.any_case, &mut |done| self.progress.at(done)).map_err(hex_error)?;
        Ok(json!({ "at": at, "length": sought.len(), "ms": started.elapsed().as_millis() as u64 }))
    }

    /// A range of the bytes as a text to copy, in the form asked for.
    fn hex_copy(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexRangeRequest = parse(payload)?;
        let held = self.hex_held(request.hex)?;
        let form = hex::Form::of(request.form.as_deref().unwrap_or("hex")).ok_or_else(|| AppError::InvalidRequest("form".into()))?;
        let count = usize::try_from(request.to.min(held.size).saturating_sub(request.from)).map_err(|_| AppError::Failed { code: "no-memory", detail: "no memory for the bytes".into() })?;
        let bytes = held.read(request.from, count).map_err(hex_error)?;
        let text = hex::written(&bytes, form).ok_or(AppError::Failed { code: "no-memory", detail: "no memory for the text".into() })?;
        Ok(json!({ "text": text, "count": bytes.len() }))
    }

    /// A range of the bytes written to a file, as they are.
    fn hex_save(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexRangeRequest = parse(payload)?;
        let held = self.hex_held(request.hex)?;
        let out = request.out.ok_or_else(|| AppError::InvalidRequest("where to write".into()))?;
        let _running = self.progress.start(request.to.min(held.size).saturating_sub(request.from));
        let file = std::fs::File::create(&out).map_err(|error| file_error(error.into(), "cannot-save"))?;
        let mut output = std::io::BufWriter::new(file);
        let written = held.write_range(request.from, request.to, &mut output, &mut |done| self.progress.at(done)).and_then(|written| std::io::Write::flush(&mut output).map(|()| written).map_err(hex::HexError::from));
        match written {
            Ok(written) => Ok(json!({ "written": written })),
            Err(error) => {
                // What did not come to its end is not left behind.
                drop(output);
                std::fs::remove_file(&out).ok();
                Err(match error {
                    hex::HexError::Io(error) => file_error(error.into(), "cannot-save"),
                    other => hex_error(other),
                })
            }
        }
    }

    fn hex_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: HexRequest = parse(payload)?;
        if let Ok(mut hexes) = self.hexes.lock() {
            hexes.remove(&request.hex);
        }
        Ok(json!({}))
    }

    /// A new key, told in every form it is written in.
    fn keys_make(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeysMakeRequest = parse(payload)?;
        let started = Instant::now();
        let made = request.kind().and_then(keys::Key::make).and_then(|key| keys::told_key(&key, request.comment.as_deref().unwrap_or_default(), request.lock.as_deref()));
        Ok(match made {
            Ok(key) => json!({ "ok": true, "key": key, "ms": started.elapsed().as_millis() as u64 }),
            Err(error) => keys_wrong(error),
        })
    }

    /// Whatever is given, read by what it is: keys, certificates, requests, alone or together, in PEM, DER, the
    /// forms of OpenSSH or a PKCS #12 file. What was read is told, and written again in the other forms.
    fn keys_read(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeysReadRequest = parse(payload)?;
        let given = request.given()?;
        let found = match keys::read(&given, request.passphrase.as_deref()) {
            Ok(found) => found,
            Err(error) => return Ok(keys_wrong(error)),
        };
        let told = (|| -> Result<Value, keys::KeysError> {
            let comment = request.comment.clone().filter(|comment| !comment.is_empty()).unwrap_or_else(|| found.comment.clone());
            let key = found.key.as_ref().map(|key| keys::told_key(key, &comment, request.lock.as_deref())).transpose()?;
            let public = found.public.as_ref().map(|public| keys::told_public(public, &comment)).transpose()?;
            let certificates = found.certificates.iter().map(|der| keys::told_certificate(der)).collect::<Result<Vec<_>, _>>()?;
            let requests = found.requests.iter().map(|der| keys::told_request(der)).collect::<Result<Vec<_>, _>>()?;
            // Whether the key is that of the first certificate: what is asked most of a key and a certificate.
            let matches = match (&found.key, certificates.first()) {
                (Some(key), Some(certificate)) => Some(certificate["digest"] == json!(key.public().digest()?)),
                _ => None,
            };
            Ok(json!({ "ok": true, "form": found.form, "locked": found.locked, "key": key, "public": public, "certificates": certificates, "requests": requests, "matches": matches }))
        })();
        Ok(told.unwrap_or_else(keys_wrong))
    }

    /// A request for a certificate, or a certificate signed with its own key; with a new key, or one that is given.
    fn keys_request(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeysRequestRequest = parse(payload)?;
        let started = Instant::now();
        let made = (|| -> Result<Value, keys::KeysError> {
            let (key, comment) = match (&request.key, &request.make) {
                (Some(text), _) if !text.trim().is_empty() => {
                    let found = keys::read(text.as_bytes(), request.passphrase.as_deref())?;
                    (found.key.ok_or(keys::KeysError("no-key"))?, found.comment)
                }
                (_, Some(make)) => (keys::Key::make(make.kind()?)?, String::new()),
                _ => return Err(keys::KeysError("no-key")),
            };
            let subject = keys::Subject {
                common_name: request.subject.common_name.clone(),
                organization: request.subject.organization.clone(),
                unit: request.subject.unit.clone(),
                locality: request.subject.locality.clone(),
                state: request.subject.state.clone(),
                country: request.subject.country.clone(),
                email: request.subject.email.clone(),
            };
            let told_key = keys::told_key(&key, &comment, request.lock.as_deref())?;
            Ok(match &request.self_signed {
                Some(signed) => {
                    let certificate = keys::self_signed(&key, &subject, &request.names, signed.days, signed.authority)?;
                    json!({ "ok": true, "key": told_key, "certificate": keys::told_certificate(&certificate)? })
                }
                None => json!({ "ok": true, "key": told_key, "request": keys::told_request(&keys::request(&key, &subject, &request.names)?)? }),
            })
        })();
        Ok(match made {
            Ok(mut answer) => {
                answer["ms"] = json!(started.elapsed().as_millis() as u64);
                answer
            }
            Err(error) => keys_wrong(error),
        })
    }

    /// A request signed by an authority of one's own: its certificate and its key are given, and the request.
    fn keys_sign(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeysSignRequest = parse(payload)?;
        let started = Instant::now();
        let signed = (|| -> Result<Value, keys::KeysError> {
            let authority = keys::read(request.certificate.as_bytes(), None)?.certificates.into_iter().next().ok_or(keys::KeysError("no-authority"))?;
            let key = keys::read(request.key.as_bytes(), request.passphrase.as_deref())?.key.ok_or(keys::KeysError("no-key"))?;
            let asked = keys::read(request.request.as_bytes(), None)?.requests.into_iter().next().ok_or(keys::KeysError("no-request"))?;
            let certificate = keys::sign_request(&key, &authority, &asked, request.days, request.authority)?;
            // What was signed first, then who signed it: the order a server is given them in.
            Ok(json!({ "ok": true, "certificates": [keys::told_certificate(&certificate)?, keys::told_certificate(&authority)?] }))
        })();
        Ok(match signed {
            Ok(mut answer) => {
                answer["ms"] = json!(started.elapsed().as_millis() as u64);
                answer
            }
            Err(error) => keys_wrong(error),
        })
    }

    /// What is given written to a file in a form that is bytes: DER (the first thing of a PEM text, as it is), or a
    /// PKCS #12 file holding the key and the certificates of the text.
    fn keys_write(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeysWriteRequest = parse(payload)?;
        let bytes = (|| -> Result<Vec<u8>, keys::KeysError> {
            let found = keys::read(request.text.as_bytes(), request.passphrase.as_deref())?;
            match request.form.as_str() {
                "pkcs12" => {
                    let key = found.key.ok_or(keys::KeysError("no-key"))?;
                    keys::pkcs12(&key, &found.certificates, request.password.as_deref().unwrap_or_default(), request.name.as_deref().unwrap_or_default(), request.compatible)
                }
                _ => match (found.certificates.first(), found.requests.first(), &found.key, &found.public) {
                    (Some(certificate), ..) => Ok(certificate.clone()),
                    (_, Some(asked), ..) => Ok(asked.clone()),
                    (_, _, Some(key), _) => Ok(key.pkcs8()?.as_bytes().to_vec()),
                    (_, _, _, Some(public)) => public.spki(),
                    _ => Err(keys::KeysError("not-recognized")),
                },
            }
        })();
        let bytes = match bytes {
            Ok(bytes) => bytes,
            Err(error) => return Ok(keys_wrong(error)),
        };
        std::fs::write(&request.out, &bytes).map_err(|error| file_error(error.into(), "cannot-save"))?;
        Ok(json!({ "ok": true, "written": bytes.len() }))
    }

    /// One request to a server, as the user wrote it. What is wrong with it, or with the way to the server, is an answer.
    fn net_http(&self, payload: Value) -> Result<Value, AppError> {
        use syntelab_net::tools::http;
        let request: NetHttpRequest = parse(payload)?;
        let asked = http::HttpRequest {
            method: request.method,
            url: request.url,
            headers: request.headers,
            body: request.body.filter(|body| !body.is_empty()).map(String::into_bytes),
            body_file: request.body_file,
            redirects: request.redirects,
            verify_tls: request.verify_tls,
            timeout: (request.timeout_seconds > 0).then(|| Duration::from_secs(request.timeout_seconds)),
        };
        let _running = self.progress.start(0);
        let mut watch = |done: u64, total: Option<u64>| {
            self.progress.total.store(total.unwrap_or(0), Ordering::Relaxed);
            self.progress.at(done)
        };
        let answered = match &request.out {
            Some(out) => {
                let file = std::fs::File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                let mut output = std::io::BufWriter::new(file);
                let answered = http::send(&asked, Some(&mut output), 0, &mut watch).and_then(|answer| std::io::Write::flush(&mut output).map(|()| answer).map_err(|error| syntelab_net::tools::ToolError { code: "cannot-save", detail: error.to_string() }));
                if answered.is_err() {
                    // What did not come to its end is not left behind.
                    drop(output);
                    std::fs::remove_file(out).ok();
                }
                answered
            }
            None => http::send(&asked, None, files::LARGEST_SHOWN as usize, &mut watch),
        };
        let answer = match answered {
            Ok(answer) => answer,
            Err(error) => return Ok(net_wrong(error)),
        };
        let mut told = json!({
            "ok": true,
            "status": answer.status,
            "reason": answer.reason,
            "version": answer.version,
            "headers": answer.headers,
            "url": answer.url,
            "sentOnFrom": answer.sent_on_from,
            "size": answer.size,
            "msToHeaders": answer.ms_to_headers,
            "ms": answer.ms,
        });
        match answer.body {
            http::Body::Saved => told["saved"] = json!(true),
            http::Body::Shown(bytes) if std::str::from_utf8(&bytes).is_err() && !bytes.is_empty() => {
                // Not text: told to be so. Read whole, it goes to the result file it was given, to be shown from there.
                told["binary"] = json!(true);
                if let Some(keep) = request.keep.as_ref().filter(|keep| self.results.holds(keep)) {
                    std::fs::write(keep, &bytes).map_err(|error| file_error(error.into(), "cannot-save"))?;
                    told["kept"] = json!(true);
                }
            }
            http::Body::TooLarge(bytes) if std::str::from_utf8(&bytes).is_err() && !bytes.is_empty() => {
                // Only its beginning, and not text: it is saved by asking again with a file named.
                told["binary"] = json!(true);
            }
            http::Body::Shown(bytes) => told["text"] = json!(String::from_utf8_lossy(&bytes)),
            http::Body::TooLarge(bytes) => {
                told["text"] = json!(String::from_utf8_lossy(&bytes));
                told["tooLarge"] = json!(true);
            }
        }
        Ok(told)
    }

    /// The name servers the computer is set to use.
    fn net_dns_servers(&self) -> Value {
        json!({ "servers": syntelab_net::tools::dns::system_servers().iter().map(ToString::to_string).collect::<Vec<_>>() })
    }

    /// Questions put to a name server: one for each kind of record asked for.
    fn net_dns(&self, payload: Value) -> Result<Value, AppError> {
        use syntelab_net::tools::dns;
        let request: NetDnsRequest = parse(payload)?;
        let typed = request.name.trim();
        // A name with letters beyond ASCII is asked for as it is written on the wire (`xn--…`).
        let name = if typed.is_ascii() { typed.to_owned() } else { idna::domain_to_ascii(typed).unwrap_or_default() };
        // A space, or any sign that is no letter, cannot be in a name the DNS is asked for.
        if name.is_empty() || name.chars().any(|letter| letter.is_whitespace() || letter.is_control()) {
            return Ok(json!({ "ok": false, "error": { "code": "bad-name" } }));
        }
        let over_https = request.server.as_deref().map(str::trim).filter(|server| server.starts_with("https://")).map(str::to_owned);
        let (server, port) = match request.server.as_deref().map(str::trim).filter(|server| !server.is_empty() && over_https.is_none()) {
            Some(server) => match (server.parse::<std::net::IpAddr>(), server.parse::<std::net::SocketAddr>()) {
                (Ok(address), _) => (address, 53),
                (_, Ok(address)) => (address.ip(), address.port()),
                _ => return Ok(json!({ "ok": false, "error": { "code": "bad-server" } })),
            },
            None if over_https.is_some() => (std::net::IpAddr::from([0, 0, 0, 0]), 0),
            None => match dns::system_servers().first() {
                Some(server) => (*server, 53),
                None => return Ok(json!({ "ok": false, "error": { "code": "no-system-server" } })),
            },
        };
        let timeout = Duration::from_secs(request.timeout_seconds.max(1));
        let _running = self.progress.start(request.kinds.len() as u64);
        let mut results = Vec::new();
        for (index, kind) in request.kinds.iter().enumerate() {
            let Some(number) = dns::kind_of(kind) else {
                return Err(AppError::InvalidRequest(format!("kind {kind}")));
            };
            let asked = match &over_https {
                Some(resolver) => dns::ask_over_https(&name, number, resolver, timeout),
                None => dns::ask(&name, number, server, port, timeout),
            };
            results.push(match asked {
                Ok(answer) => {
                    let records = |records: &[dns::Record]| records.iter().map(|record| json!({ "name": record.name, "kind": record.kind, "ttl": record.ttl, "data": record.data })).collect::<Vec<_>>();
                    json!({ "kind": kind, "name": answer.name, "code": answer.code, "answers": records(&answer.answers), "authority": records(&answer.authority), "authoritative": answer.authoritative, "overTcp": answer.over_tcp, "ms": answer.ms })
                }
                Err(error) => json!({ "kind": kind, "error": { "code": error.code, "detail": error.detail } }),
            });
            if !self.progress.at(index as u64 + 1) {
                break;
            }
        }
        Ok(json!({ "ok": true, "name": name, "server": over_https.unwrap_or_else(|| server.to_string()), "results": results }))
    }

    /// Whether ports of a host take connections.
    fn net_ports(&self, payload: Value) -> Result<Value, AppError> {
        use syntelab_net::tools::port;
        let request: NetPortsRequest = parse(payload)?;
        let Some(ports) = port::ports_of(&request.ports) else {
            return Ok(json!({ "ok": false, "error": { "code": "bad-ports" } }));
        };
        let _running = self.progress.start(ports.len() as u64);
        let checked = port::check(request.host.trim(), &ports, Duration::from_millis(request.timeout_ms.max(50)), &mut |done| self.progress.at(done as u64));
        Ok(match checked {
            Ok(check) => {
                let state = |state: port::State| match state {
                    port::State::Open => "open",
                    port::State::Closed => "closed",
                    port::State::NoAnswer => "no-answer",
                    port::State::Failed => "failed",
                };
                let count = |wanted: port::State| check.ports.iter().filter(|port| port.state == wanted).count();
                json!({
                    "ok": true,
                    "address": check.address.to_string(),
                    "addresses": check.addresses.iter().map(ToString::to_string).collect::<Vec<_>>(),
                    "asked": ports.len(),
                    "open": count(port::State::Open),
                    "closed": count(port::State::Closed),
                    "noAnswer": count(port::State::NoAnswer),
                    "stopped": check.stopped,
                    "ports": check.ports.iter().map(|port| json!({ "port": port.port, "state": state(port.state), "ms": port.ms })).collect::<Vec<_>>(),
                })
            }
            Err(error) => net_wrong(error),
        })
    }

    /// The certificates a site shows, told as the certificate decoder tells them, and whether the computer trusts them.
    fn net_certificate(&self, payload: Value) -> Result<Value, AppError> {
        let request: NetCertificateRequest = parse(payload)?;
        let host = request.host.trim();
        // A name with letters beyond ASCII is asked for as it is written on the wire.
        let host = if host.is_ascii() { host.to_owned() } else { idna::domain_to_ascii(host).unwrap_or_default() };
        let begin = syntelab_net::tools::tls::Begin::of(&request.begin, request.port).ok_or_else(|| AppError::InvalidRequest("begin".into()))?;
        let shown = match syntelab_net::tools::tls::certificates(&host, request.port, request.name.as_deref(), begin, Duration::from_secs(request.timeout_seconds.max(1))) {
            Ok(shown) => shown,
            Err(error) => return Ok(net_wrong(error)),
        };
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_secs() as i64);
        let mut certificates = Vec::new();
        let mut details = Vec::new();
        for der in &shown.chain {
            certificates.push(keys::told_certificate(der).unwrap_or_else(|_| json!({ "pem": keys::pem("CERTIFICATE", der) })));
            if let Ok(mut read) = certificate::read(der, now) {
                details.append(&mut read);
            }
        }
        let mut written = Vec::new();
        tree::write(&tree::Node::Array(details), &mut written, &tree::Writing { options: json::Options::of(json::Style::Spaces(2)), one_line_within: 0 }).ok();
        Ok(json!({
            "ok": true,
            "host": host,
            "begin": format!("{begin:?}").to_ascii_lowercase(),
            "address": shown.address.to_string(),
            "protocol": shown.protocol,
            "cipher": shown.cipher,
            "alpn": shown.alpn,
            "notTrusted": shown.not_trusted,
            "certificates": certificates,
            "details": String::from_utf8_lossy(&written),
            "ms": shown.ms,
        }))
    }

    /// One of the tools that turn bytes into other bytes, on a text or on a file read from disk.
    fn codec(&self, payload: Value) -> Result<Value, AppError> {
        let request: CodecRequest = parse(payload)?;
        let mut stage = stage_of(&request.tool, &request.options)?;
        let started = Instant::now();
        let done = match (&request.text, &request.path, &request.out) {
            // A text, and its result as a text (or told to be bytes that no text box can hold).
            (Some(text), None, None) => {
                let _running = self.progress.start(text.len() as u64);
                let mut grown = json::Grown::default();
                codec::drive(text.as_bytes(), &mut grown, stage.as_mut(), &mut |read| self.progress.at(read)).map(|done| match String::from_utf8(grown.0) {
                    Ok(written) => (done, json!({ "text": written })),
                    Err(_) => (done, json!({ "binary": true })),
                })
            }
            // A text, and its result written to a file: how bytes that are not text are kept.
            (Some(text), None, Some(out)) => {
                let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                let _running = self.progress.start(text.len() as u64);
                let written = codec::drive(text.as_bytes(), BufWriter::new(output), stage.as_mut(), &mut |read| self.progress.at(read));
                if written.is_err() {
                    std::fs::remove_file(out).ok();
                }
                written.map(|done| (done, json!({})))
            }
            // A file read where it is: only checked, or its result written to another file.
            (None, Some(path), out) => {
                let input = File::open(path).map_err(|error| file_error(error.into(), "cannot-open"))?;
                let total = input.metadata().map(|known| known.len()).unwrap_or(0);
                match out {
                    None if request.show => {
                        let _running = self.progress.start(total);
                        let mut grown = json::Grown::default();
                        codec::drive(input, &mut grown, stage.as_mut(), &mut |read| self.progress.at(read)).map(|done| (done, json!({ "text": String::from_utf8_lossy(&grown.0) })))
                    }
                    None => {
                        let _running = self.progress.start(total);
                        codec::drive(input, std::io::sink(), stage.as_mut(), &mut |read| self.progress.at(read)).map(|done| (done, json!({})))
                    }
                    Some(out) => {
                        if files::same_file(path, out) {
                            return Err(AppError::Failed { code: "same-file", detail: "the result cannot be written over the file it is read from".into() });
                        }
                        let output = File::create(out).map_err(|error| file_error(error.into(), "cannot-save"))?;
                        let _running = self.progress.start(total);
                        let written = codec::drive(input, BufWriter::new(output), stage.as_mut(), &mut |read| self.progress.at(read));
                        match written {
                            Ok(done) => {
                                let head = files::head(out).map_err(|error| file_error(error, "cannot-open"))?;
                                Ok((done, json!({ "head": head })))
                            }
                            Err(error) => {
                                std::fs::remove_file(out).ok();
                                Err(error)
                            }
                        }
                    }
                }
            }
            _ => return Err(AppError::InvalidRequest("one of text and path".into())),
        };
        match done {
            Ok((done, mut answer)) => {
                answer["ok"] = json!(true);
                answer["stats"] = json!({ "bytesIn": done.bytes_in, "bytesOut": done.bytes_out, "ms": started.elapsed().as_millis() as u64 });
                answer["notes"] = notes_as_json(&done.notes);
                Ok(answer)
            }
            // What a library said of the problem, in its own words, goes with it.
            Err(CodecError::Wrong(wrong)) => {
                let mut error = json!({ "code": wrong.code, "line": wrong.line, "column": wrong.column, "offset": wrong.offset });
                if let Some(said) = stage.said() {
                    error["detail"] = json!(said);
                }
                Ok(json!({ "ok": false, "error": error }))
            }
            Err(CodecError::Stopped) => Err(AppError::Failed { code: "stopped", detail: "stopped by the user".into() }),
            Err(CodecError::NoMemory) => Err(AppError::Failed { code: "no-memory", detail: "no memory for the result".into() }),
            Err(CodecError::Io(error)) => Err(file_error(error.into(), "failed")),
        }
    }

    /// Every file in turn through one of those tools. One that is wrong, or cannot be read, does not stop the others.
    fn codec_batch(&self, payload: Value) -> Result<Value, AppError> {
        let request: CodecBatchRequest = parse(payload)?;
        // Asked for once before the run, so what is wrong with the options is told at once and not file by file.
        stage_of(&request.tool, &request.options)?;
        let target = match &request.target {
            Some(target) => target.target()?,
            None => Target::Nowhere,
        };
        let files: Vec<Found> = request.files.into_iter().map(|file| Found { path: file.path, root: file.root, size: file.size }).collect();
        let _running = self.progress.start(files.iter().map(|file| file.size).sum());
        self.progress.files.store(files.len(), Ordering::Relaxed);
        let items = batch::run(&files, &target, request.overwrite, &mut Watched(&self.progress), &mut |input, output, read| {
            let mut stage = stage_of(&request.tool, &request.options).map_err(|_| ItemError::Io(std::io::ErrorKind::InvalidInput.into()))?;
            codec::drive(input, output, stage.as_mut(), read).map(|done| (done.bytes_in, done.bytes_out)).map_err(|error| match error {
                CodecError::Wrong(wrong) => ItemError::Wrong { code: wrong.code, line: wrong.line, column: wrong.column },
                CodecError::Io(error) => ItemError::Io(error),
                CodecError::Stopped => ItemError::Stopped,
                CodecError::NoMemory => ItemError::NoMemory,
            })
        });
        Ok(items_as_json(&items))
    }

    /// A JSON Web Token taken apart. What is wrong with it is an answer, as for the other tools.
    fn jwt(&self, payload: Value) -> Result<Value, AppError> {
        let request: JwtRequest = parse(payload)?;
        let started = Instant::now();
        let wrong = |wrong: Wrong| json!({ "ok": false, "error": { "code": wrong.code, "line": wrong.line, "column": wrong.column, "offset": wrong.offset } });
        let secret = match request.secret.as_deref().filter(|secret| !secret.is_empty()) {
            None => None,
            Some(secret) => match secret_bytes(secret, request.secret_form.as_deref().unwrap_or("text")) {
                Some(bytes) => Some(bytes),
                None => return Ok(wrong(Wrong::nowhere("bad-secret"))),
            },
        };
        match jwt::read(&request.token, secret.as_deref()) {
            Ok(token) => Ok(json!({
                "ok": true,
                "header": token.header,
                "payload": token.payload,
                "algorithm": token.algorithm,
                "signature": token.signature.code(),
                "stats": { "bytesIn": request.token.len(), "bytesOut": token.header.len() + token.payload.len(), "ms": started.elapsed().as_millis() as u64 },
            })),
            Err(error) => Ok(wrong(error)),
        }
    }

    /// A name for a new result of the program's own.
    fn result_file(&self) -> Result<Value, AppError> {
        let path = self.results.make().map_err(|error| file_error(error.into(), "cannot-save"))?;
        Ok(json!({ "path": path }))
    }

    /// A result of the program's own copied to where the user chose.
    fn result_keep(&self, payload: Value) -> Result<Value, AppError> {
        let request: KeepRequest = parse(payload)?;
        if !self.results.holds(&request.from) {
            return Err(AppError::InvalidRequest("only a result of the program's own is kept".into()));
        }
        let size = self.results.keep(&request.from, &request.to).map_err(|error| file_error(error.into(), "cannot-save"))?;
        Ok(json!({ "size": size }))
    }

    fn result_forget(&self, payload: Value) -> Result<Value, AppError> {
        let request: PathRequest = parse(payload)?;
        self.results.forget(&request.path);
        Ok(json!({}))
    }

    /// What a file is, from its start; a picture or a PDF is then served whole to be shown.
    fn look(&self, payload: Value) -> Result<Value, AppError> {
        let request: PathRequest = parse(payload)?;
        let mut start = Vec::with_capacity(kinds::START);
        let mut file = File::open(&request.path).map_err(|error| file_error(error.into(), "cannot-open"))?;
        let size = file.metadata().map(|known| known.len()).unwrap_or(0);
        std::io::Read::read_to_end(&mut std::io::Read::take(&mut file, kinds::START as u64), &mut start).map_err(|error| file_error(error.into(), "cannot-open"))?;
        let kind = kinds::of(&start);
        let told = hex::written(&start[..start.len().min(START_TOLD)], hex::Form::Hex).unwrap_or_default();
        let number = self.next_tree.fetch_add(1, Ordering::Relaxed) + 1;
        self.looks.lock().map_err(|_| AppError::Failed { code: "no-memory", detail: "no memory for the preview".into() })?.insert(number, Arc::new(Look { path: request.path, kind, size }));
        // A picture or a PDF too large to be served whole is told of as any other file.
        let view = if size > LOOKED_AT_MOST && kind.view != kinds::View::Text { kinds::View::Other } else { kind.view };
        Ok(json!({ "look": number, "view": view.name(), "mime": kind.mime, "format": kind.format, "size": size, "start": told }))
    }

    fn look_close(&self, payload: Value) -> Result<Value, AppError> {
        let request: LookRequest = parse(payload)?;
        if let Ok(mut looks) = self.looks.lock() {
            looks.remove(&request.look);
        }
        Ok(json!({}))
    }

    /// The bytes of a picture or a PDF looked at, read on a thread of their own.
    fn look_bytes(&self, number: &str, reply: ResourceReply) {
        let look = number.parse::<u64>().ok().and_then(|number| self.looks.lock().ok().and_then(|looks| looks.get(&number).cloned()));
        let Some(look) = look.filter(|look| matches!(look.kind.view, kinds::View::Picture | kinds::View::Pdf) && look.size <= LOOKED_AT_MOST) else {
            return reply(Err(AppError::NotFound(format!("look {number}"))));
        };
        std::thread::spawn(move || {
            reply(match std::fs::read(&look.path) {
                Ok(bytes) => Ok(Resource { mime: look.kind.mime, bytes }),
                Err(error) => Err(file_error(error.into(), "cannot-open")),
            });
        });
    }

    fn progress(&self) -> Value {
        json!({
            "running": self.progress.running.load(Ordering::Relaxed),
            "done": self.progress.done.load(Ordering::Relaxed),
            "total": self.progress.total.load(Ordering::Relaxed),
            "file": self.progress.file.load(Ordering::Relaxed),
            "files": self.progress.files.load(Ordering::Relaxed),
        })
    }

    fn stop(&self) -> Value {
        self.progress.stop.store(true, Ordering::Relaxed);
        json!({})
    }
}

impl SyntelabApp for Dev {
    fn id(&self) -> &'static str {
        APP_ID
    }

    fn invoke(&self, command: &str, payload: Value) -> Result<Value, AppError> {
        match command {
            "open" => self.open(payload),
            "save" => self.save(payload),
            "json" => self.json(payload),
            "find_files" => self.find_files(payload),
            "json_batch" => self.json_batch(payload),
            "jsonpath" => self.jsonpath(payload),
            "derive" => self.derive(payload),
            "tree_open" => self.tree_open(payload),
            "tree_rows" => self.tree_rows(payload),
            "tree_find" => self.tree_find(payload),
            "tree_close" => self.tree_close(payload),
            "schema_check" => self.schema_check(payload),
            "schema_batch" => self.schema_batch(payload),
            "codec" => self.codec(payload),
            "generate" => self.generate(payload),
            "diff" => self.diff(payload),
            "folders_compare" => self.folders_compare(payload),
            "folders_rows" => self.folders_rows(payload),
            "folders_close" => self.folders_close(payload),
            "diff_rows" => self.diff_rows(payload),
            "diff_close" => self.diff_close(payload),
            "csv_open" => self.csv_open(payload),
            "csv_rows" => self.csv_rows(payload),
            "csv_close" => self.csv_close(payload),
            "hex_open" => self.hex_open(payload),
            "hex_rows" => self.hex_rows(payload),
            "hex_find" => self.hex_find(payload),
            "hex_copy" => self.hex_copy(payload),
            "hex_save" => self.hex_save(payload),
            "hex_close" => self.hex_close(payload),
            "keys_make" => self.keys_make(payload),
            "keys_read" => self.keys_read(payload),
            "keys_request" => self.keys_request(payload),
            "keys_write" => self.keys_write(payload),
            "keys_sign" => self.keys_sign(payload),
            "net_http" => self.net_http(payload),
            "net_dns" => self.net_dns(payload),
            "net_dns_servers" => Ok(self.net_dns_servers()),
            "net_ports" => self.net_ports(payload),
            "net_certificate" => self.net_certificate(payload),
            "codec_batch" => self.codec_batch(payload),
            "jwt" => self.jwt(payload),
            "result_file" => self.result_file(),
            "result_keep" => self.result_keep(payload),
            "result_forget" => self.result_forget(payload),
            "look" => self.look(payload),
            "look_close" => self.look_close(payload),
            "progress" => Ok(self.progress()),
            "stop" => Ok(self.stop()),
            other => Err(AppError::NotFound(format!("command {other}"))),
        }
    }

    fn resource(&self, request: ResourceRequest, reply: ResourceReply) {
        match request.path.split_once('/') {
            Some(("look", number)) => self.look_bytes(number, reply),
            _ => reply(Err(AppError::NotFound(format!("resource {}", request.path)))),
        }
    }
}

fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, AppError> {
    serde_json::from_value(payload).map_err(|error| AppError::InvalidRequest(error.to_string()))
}

/// How the files of a run came out, as the interface is told.
fn items_as_json(items: &[batch::Item]) -> Value {
    let items: Vec<Value> = items
        .iter()
        .map(|item| {
            let (status, code, line, column) = match &item.outcome {
                Outcome::Done => ("done", None, None, None),
                Outcome::Wrong { code, line, column } => ("wrong", Some(*code), Some(*line), Some(*column)),
                Outcome::Skipped { code } => ("skipped", Some(*code), None, None),
                Outcome::Failed { code, .. } => ("failed", Some(*code), None, None),
            };
            json!({ "path": item.path, "out": item.out, "said": item.said, "status": status, "code": code, "line": line, "column": column, "bytesIn": item.bytes_in, "bytesOut": item.bytes_out, "ms": item.ms })
        })
        .collect();
    json!({ "items": items })
}

fn notes_as_json(notes: &[(&'static str, String)]) -> Value {
    Value::Array(notes.iter().map(|(code, text)| json!({ "code": code, "text": text })).collect())
}

/// The secret a token may have been signed with, as bytes; none when it is not written as it is said to be.
fn secret_bytes(secret: &str, form: &str) -> Option<Vec<u8>> {
    match form {
        "text" => Some(secret.as_bytes().to_vec()),
        "base64" => {
            let mut bytes = Vec::new();
            let mut decode = base64::Decode::default();
            decode.push(secret.as_bytes(), &mut bytes).and_then(|()| decode.finish(&mut bytes)).ok().map(|()| bytes)
        }
        "hex" => {
            let digits: Vec<u8> = secret.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect();
            if !digits.len().is_multiple_of(2) {
                return None;
            }
            digits.chunks(2).map(|pair| Some(((pair[0] as char).to_digit(16)? * 16 + (pair[1] as char).to_digit(16)?) as u8)).collect()
        }
        _ => None,
    }
}

/// The tool that was asked for, set as its options say. Options that are left out are as the tool ships them.
fn stage_of(tool: &str, options: &Value) -> Result<Box<dyn Stage>, AppError> {
    let text = |name: &str| options.get(name).and_then(Value::as_str).unwrap_or_default();
    let flag = |name: &str, otherwise: bool| options.get(name).and_then(Value::as_bool).unwrap_or(otherwise);
    let number = |name: &str, otherwise: u64| options.get(name).and_then(Value::as_u64).unwrap_or(otherwise);
    let decode = match text("direction") {
        "" | "encode" => false,
        "decode" => true,
        other => return Err(AppError::InvalidRequest(format!("direction {other}"))),
    };
    Ok(match tool {
        "base64" if decode => Box::new(base64::Decode::default()),
        "base64" => Box::new(base64::Encode::new(text("alphabet") == "url", flag("padding", true), number("wrap", 0) as usize)),
        "url-encode" => {
            let way = match text("way") {
                "" | "component" => url::Way::Component,
                "address" => url::Way::WholeAddress,
                "form" => url::Way::Form,
                other => return Err(AppError::InvalidRequest(format!("way {other}"))),
            };
            if decode {
                Box::new(url::Decode::new(way))
            } else {
                Box::new(url::Encode::new(way))
            }
        }
        "html-entities" if decode => Box::new(entities::Decode::default()),
        "html-entities" => {
            let form = match text("form") {
                "" | "named" => entities::Form::Named,
                "decimal" => entities::Form::Decimal,
                "hex" => entities::Form::Hexadecimal,
                other => return Err(AppError::InvalidRequest(format!("form {other}"))),
            };
            Box::new(entities::Encode::new(flag("beyondAscii", false), form))
        }
        "escape" => {
            let flavor = match text("flavor") {
                "" | "json" => escape::Flavor::Json,
                "javascript" => escape::Flavor::JavaScript,
                "c" => escape::Flavor::C,
                other => return Err(AppError::InvalidRequest(format!("flavor {other}"))),
            };
            if decode {
                Box::new(escape::Unescape::new(flavor))
            } else {
                Box::new(escape::Escape::new(flavor))
            }
        }
        "yaml-json" if decode => Box::new(yaml::to_json(json::Options::of(style_of(if text("indent") == "min" { "minify" } else { "format" }, options.get("indent").and_then(Value::as_str))?))),
        "yaml-json" => Box::new(yaml::from_json(number("yamlIndent", 2) as usize)),
        "csv-json" => {
            let separator = match text("separator") {
                "" | "auto" => None,
                "," => Some(b','),
                ";" => Some(b';'),
                "tab" => Some(b'\t'),
                "|" => Some(b'|'),
                other => return Err(AppError::InvalidRequest(format!("separator {other}"))),
            };
            if decode {
                let style = style_of(if text("indent") == "min" { "minify" } else { "format" }, options.get("indent").and_then(Value::as_str))?;
                Box::new(csv::Read::new(csv::Reading { separator, header: flag("header", true), typed: flag("typed", true), style }))
            } else {
                Box::new(csv::write(csv::Writing { separator: separator.unwrap_or(b','), header: flag("header", true), flatten: flag("flatten", true), quote_all: flag("quoteAll", false), crlf: flag("crlf", false) }))
            }
        }
        "markup" => {
            let kind = match text("kind") {
                "" | "auto" => markup::Kind::Auto,
                "xml" => markup::Kind::Xml,
                "html" => markup::Kind::Html,
                other => return Err(AppError::InvalidRequest(format!("kind {other}"))),
            };
            let mode = if text("mode").is_empty() { "format" } else { text("mode") };
            Box::new(markup::Markup::new(kind, style_of(mode, options.get("indent").and_then(Value::as_str))?, flag("dropComments", false)))
        }
        "sql" => {
            let case = match text("case") {
                "" | "upper" => sql::Case::Upper,
                "lower" => sql::Case::Lower,
                "keep" => sql::Case::Keep,
                other => return Err(AppError::InvalidRequest(format!("case {other}"))),
            };
            let mode = if text("mode").is_empty() { "format" } else { text("mode") };
            if mode == "validate" {
                return Err(AppError::InvalidRequest("mode validate".into()));
            }
            Box::new(sql::Sql::new(style_of(mode, options.get("indent").and_then(Value::as_str))?, case))
        }
        "hash" => {
            let algorithms: Vec<hash::Algorithm> = options.get("algorithms").and_then(Value::as_array).map(|names| names.iter().filter_map(Value::as_str).filter_map(hash::Algorithm::of).collect()).unwrap_or_else(|| vec![hash::Algorithm::Sha256]);
            let key = match text("key") {
                "" => None,
                // A key that is not what its form says is no key: the tool is told so by a key of no bytes being refused below.
                key => Some(secret_bytes(key, if text("keyForm").is_empty() { "text" } else { text("keyForm") }).ok_or_else(|| AppError::Failed { code: "bad-key", detail: "the key is not written in the form chosen".into() })?),
            };
            let form = match text("form") {
                "" | "hex" => hash::Form::Hex,
                "upper" => hash::Form::UpperHex,
                "base64" => hash::Form::Base64,
                other => return Err(AppError::InvalidRequest(format!("form {other}"))),
            };
            Box::new(hash::Hash::new(&algorithms, key.as_deref(), form, flag("lines", false), Some(text("expected")).filter(|expected| !expected.is_empty())))
        }
        "uuid" => Box::new(generate::TakeApart::new(style_of(if text("indent") == "min" { "minify" } else { "format" }, options.get("indent").and_then(Value::as_str))?)),
        "timestamp" | "cron" | "url-parser" | "certificate" | "number-base" => {
            let style = style_of(if text("indent") == "min" { "minify" } else { "format" }, options.get("indent").and_then(Value::as_str))?;
            let zone = || moments::zone(text("zone")).ok_or_else(|| AppError::Failed { code: "bad-zone", detail: format!("no time zone is named {}", text("zone")) });
            match tool {
                "timestamp" => Box::new(moments::stage(style, zone()?)),
                "cron" => Box::new(cron::stage(style, if text("numbering") == "quartz" { cron::Numbering::Quartz } else { cron::Numbering::Unix }, zone()?, number("count", 5).clamp(1, 1000) as usize)),
                "url-parser" => Box::new(url_parts::stage(style)),
                "number-base" => {
                    let from = match text("from") {
                        "" | "auto" => bases::From::Told,
                        base => bases::From::Base(base.parse::<u32>().ok().filter(|base| (2..=36).contains(base)).ok_or_else(|| AppError::InvalidRequest("base".into()))?),
                    };
                    Box::new(bases::stage(style, from, number("other", 36) as u32))
                }
                _ => Box::new(certificate::Certificates::new(style)),
            }
        }
        "markdown" => Box::new(markdown::stage()),
        "gzip" if decode => Box::new(gzip::Decompress::default()),
        "gzip" => Box::new(gzip::Compress::new(number("level", 6) as u32, flag("asText", false))),
        other => return Err(AppError::NotFound(format!("tool {other}"))),
    })
}

/// How JSON is written again, from what the interface chose.
fn style_of(mode: &str, indent: Option<&str>) -> Result<Style, AppError> {
    match (mode, indent) {
        ("validate", _) => Ok(Style::Check),
        ("minify", _) => Ok(Style::Minify),
        ("format", Some("tab")) => Ok(Style::Tab),
        ("format", None) => Ok(Style::Spaces(2)),
        // Any number of spaces a person may want, from none (each item on its line, nothing pushed in) to 255.
        ("format", Some(spaces)) if spaces.parse::<u8>().is_ok() => Ok(Style::Spaces(spaces.parse().unwrap_or(2))),
        (mode, indent) => Err(AppError::InvalidRequest(format!("mode {mode}, indent {indent:?}"))),
    }
}

/// The name of a file, without the folders it is in.
fn name_of(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default()
}

fn stats_as_json(stats: &Stats, started: Instant) -> Value {
    json!({ "bytesIn": stats.bytes_in, "bytesOut": stats.bytes_out, "values": stats.values, "depth": stats.depth, "objects": stats.objects, "arrays": stats.arrays, "keys": stats.keys, "ms": started.elapsed().as_millis() as u64 })
}

/// A document read whole, a query run on it, and what it found written as a JSON array.
fn jsonpath_whole(mut input: impl std::io::Read, output: impl std::io::Write + Send, query: &jsonpath::Query, show: &str, options: json::Options, found: &mut usize, watch: &mut dyn FnMut(u64) -> bool) -> Result<Stats, RunError> {
    let mut read = json::Options::of(Style::Minify);
    read.lenient = options.lenient;
    let mut minified = json::Grown::default();
    let mut stats = json::transform_with(&mut input, &mut minified, read, watch)?;
    let minified = String::from_utf8(minified.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
    let node = tree::build(&minified).ok_or(RunError::NoMemory)?;
    drop(minified);
    let mut counted = CountedOut(output, 0);
    let done = tree::deep(stats.depth, || -> Result<usize, RunError> {
        let all = query.find(&node);
        let count = all.len();
        let way = |found: &jsonpath::Found| tree::Node::Scalar(tree::quoted(&found.way));
        let listed: Vec<tree::Node> = match show {
            "ways" => all.iter().map(way).collect(),
            "both" => all.iter().map(|found| tree::Node::Object(vec![("\"path\"".into(), way(found)), ("\"value\"".into(), found.node.clone())])).collect(),
            _ => all.iter().map(|found| found.node.clone()).collect(),
        };
        drop(all);
        let listed = tree::Node::Array(listed);
        tree::write(&listed, &mut counted, &tree::Writing { options, one_line_within: 0 })?;
        drop(listed);
        drop(node);
        Ok(count)
    });
    *found = done.ok_or(RunError::NoMemory)??;
    stats.bytes_out = counted.1;
    Ok(stats)
}

/// A document read whole, and something written from its tree (`work` gives the bytes; it runs on a stack as deep
/// as the document is).
fn from_whole(mut input: impl std::io::Read, mut output: impl std::io::Write, lenient: bool, work: &(dyn Fn(&tree::Node) -> Result<Vec<u8>, RunError> + Send + Sync), watch: &mut dyn FnMut(u64) -> bool) -> Result<Stats, RunError> {
    let mut read = json::Options::of(Style::Minify);
    read.lenient = lenient;
    let mut minified = json::Grown::default();
    let mut stats = json::transform_with(&mut input, &mut minified, read, watch)?;
    let minified = String::from_utf8(minified.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
    let node = tree::build(&minified).ok_or(RunError::NoMemory)?;
    drop(minified);
    let written = tree::deep(stats.depth, || {
        let written = work(&node);
        drop(node);
        written
    })
    .ok_or(RunError::NoMemory)??;
    output.write_all(&written)?;
    output.flush()?;
    stats.bytes_out = written.len() as u64;
    Ok(stats)
}

/// Counts what is written through it.
struct CountedOut<W: std::io::Write>(W, u64);

impl<W: std::io::Write> std::io::Write for CountedOut<W> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let written = self.0.write(bytes)?;
        self.1 += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.0.flush()
    }
}

/// JSON read whole into memory, changed as asked, and written again: what cannot be done as the text goes by.
/// The text is checked first, by the reader that holds nothing; only then is its tree built. Memory is asked for
/// in ways that can be refused: a document too large for it is told so, and nothing is half done.
fn json_whole(mut input: impl std::io::Read, output: impl std::io::Write + Send, ways: &JsonWays, options: json::Options, change: Option<tree::Change>, watch: &mut dyn FnMut(u64) -> bool) -> Result<Stats, RunError> {
    let mut read = json::Options::of(Style::Minify);
    read.lenient = options.lenient;
    let mut minified = json::Grown::default();
    let mut stats = json::transform_with(&mut input, &mut minified, read, watch)?;
    let minified = String::from_utf8(minified.0).map_err(|_| RunError::Io(std::io::ErrorKind::InvalidData.into()))?;
    let node = tree::build(&minified).ok_or(RunError::NoMemory)?;
    drop(minified);
    let writing = tree::Writing { options, one_line_within: ways.one_line_within };
    let sort = ways.sort_keys;
    let mut counted = CountedOut(output, 0);
    // One level of calls for each level of nesting: on a stack made as deep as the document is.
    let done = tree::deep(stats.depth, || -> Result<(), RunError> {
        let mut node = match change {
            Some(change) => tree::change(node, change).ok_or_else(|| RunError::Io(std::io::ErrorKind::Unsupported.into()))?,
            None => node,
        };
        if sort {
            tree::sort_keys(&mut node);
        }
        tree::write(&node, &mut counted, &writing)?;
        // The tree is taken apart here, where the stack is deep enough for whatever its parts do.
        drop(node);
        Ok(())
    });
    done.ok_or(RunError::NoMemory)??;
    stats.bytes_out = counted.1;
    Ok(stats)
}

/// A problem with a file as the interface is told it. `otherwise` is the code of what has no code of its own.
fn file_error(error: FileError, otherwise: &'static str) -> AppError {
    match error {
        FileError::NotUtf8 => AppError::Failed { code: "not-utf8", detail: "the file is not text written as UTF-8".into() },
        FileError::NoMemory => AppError::Failed { code: "no-memory", detail: "no memory for the file".into() },
        FileError::Io(error) => {
            let code = match error.kind() {
                std::io::ErrorKind::NotFound => "not-found",
                std::io::ErrorKind::PermissionDenied => "no-access",
                std::io::ErrorKind::StorageFull => "disk-full",
                std::io::ErrorKind::OutOfMemory => "no-memory",
                _ => otherwise,
            };
            AppError::Failed { code, detail: error.to_string() }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev() -> Dev {
        Dev::default()
    }

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("dev-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        folder
    }

    #[test]
    fn a_text_is_written_again_as_asked() {
        let dev = dev();
        let formatted = dev.invoke("json", json!({ "mode": "format", "indent": "4", "text": "{\"a\":[1,2]}" })).expect("answered");
        assert_eq!(formatted["text"], "{\n    \"a\": [\n        1,\n        2\n    ]\n}");
        assert_eq!((formatted["ok"].clone(), formatted["stats"]["values"].clone(), formatted["stats"]["depth"].clone()), (json!(true), json!(4), json!(2)));
        let three = dev.invoke("json", json!({ "mode": "format", "indent": "3", "text": "[1]" })).expect("answered");
        assert_eq!(three["text"], "[\n   1\n]");
        assert!(matches!(dev.invoke("json", json!({ "mode": "format", "indent": "wide", "text": "[1]" })), Err(AppError::InvalidRequest(_))));
        let small = dev.invoke("json", json!({ "mode": "minify", "text": "[ 1 , 2 ]" })).expect("answered");
        assert_eq!(small["text"], "[1,2]");
        let checked = dev.invoke("json", json!({ "mode": "validate", "text": "[1,2]" })).expect("answered");
        assert_eq!((checked["ok"].clone(), checked["text"].clone()), (json!(true), json!("")));
        assert_eq!(dev.invoke("progress", json!({})).expect("progress"), json!({ "running": false, "done": 5, "total": 5, "file": 0, "files": 0 }));
    }

    #[test]
    fn a_text_that_is_not_json_is_an_answer_not_a_failure() {
        let wrong = dev().invoke("json", json!({ "mode": "format", "text": "{\n  \"a\": 1,\n}" })).expect("answered");
        assert_eq!(wrong, json!({ "ok": false, "error": { "code": "expected-key", "line": 3, "column": 1, "offset": 12 } }));
    }

    #[test]
    fn a_file_is_worked_on_where_it_is() {
        let dev = dev();
        let folder = folder("file");
        let path = folder.join("in.json");
        let out = folder.join("out.json");
        std::fs::write(&path, "{\"a\": [1, 2]}").expect("written");
        let opened = dev.invoke("open", json!({ "path": path })).expect("opened");
        assert_eq!(opened, json!({ "name": "in.json", "size": 13, "text": "{\"a\": [1, 2]}" }));

        let done = dev.invoke("json", json!({ "mode": "minify", "path": path, "out": out })).expect("answered");
        assert_eq!((done["ok"].clone(), done["head"].clone(), done["stats"]["bytesOut"].clone()), (json!(true), json!("{\"a\":[1,2]}"), json!(11)));
        assert_eq!(std::fs::read_to_string(&out).expect("read"), "{\"a\":[1,2]}");

        // Not over the file it is read from.
        let refused = dev.invoke("json", json!({ "mode": "minify", "path": path, "out": path }));
        assert!(matches!(refused, Err(AppError::Failed { code: "same-file", .. })));
        assert_eq!(std::fs::read_to_string(&path).expect("read"), "{\"a\": [1, 2]}");

        // What is not JSON leaves no half of a file behind.
        std::fs::write(&path, "{\"a\": [1, 2}").expect("written");
        let wrong = dev.invoke("json", json!({ "mode": "format", "path": path, "out": out })).expect("answered");
        assert_eq!((wrong["ok"].clone(), wrong["error"]["code"].clone()), (json!(false), json!("expected-comma-or-bracket")));
        assert!(!out.exists());

        // Only checked: nothing is written.
        let checked = dev.invoke("json", json!({ "mode": "validate", "path": path })).expect("answered");
        assert_eq!(checked["ok"], false);

        dev.invoke("save", json!({ "path": out, "text": "[1]" })).expect("saved");
        assert_eq!(std::fs::read_to_string(&out).expect("read"), "[1]");
        assert!(matches!(dev.invoke("open", json!({ "path": folder.join("none.json") })), Err(AppError::Failed { code: "not-found", .. })));
        // Bytes that are not text: refused by a tool of text, left on disk for a tool that takes bytes.
        std::fs::write(&out, [0xff, 0x00, 0x01, 0x02, 0x00, 0x07, 0xfe, 0x00, 0x00, 0x03]).expect("written");
        assert!(matches!(dev.invoke("open", json!({ "path": out })), Err(AppError::Failed { code: "not-utf8", .. })));
        assert_eq!(dev.invoke("open", json!({ "path": out, "bytes": true })).expect("opened"), json!({ "name": "out.json", "size": 10, "large": true, "binary": true, "head": "" }));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn json_is_written_in_the_other_ways_too() {
        let dev = dev();
        let run = |ways: Value, text: &str| {
            let mut request = ways;
            request["text"] = json!(text);
            dev.invoke("json", request).expect("answered")
        };
        let text = r#"{"b":[1,2],"a":{"d":null,"c":"é"}}"#;
        assert_eq!(run(json!({ "mode": "minify", "sortKeys": true }), text)["text"], r#"{"a":{"c":"é","d":null},"b":[1,2]}"#);
        assert_eq!(run(json!({ "mode": "format", "oneLineWithin": 80, "sortKeys": true }), text)["text"], r#"{"a": {"c": "é", "d": null}, "b": [1, 2]}"#);
        assert_eq!(run(json!({ "mode": "format", "oneLineWithin": 20 }), text)["text"], "{\n  \"b\": [1, 2],\n  \"a\": {\n    \"d\": null,\n    \"c\": \"é\"\n  }\n}");
        assert_eq!(run(json!({ "mode": "minify", "ascii": true, "finalNewline": true, "lineEnding": "crlf" }), text)["text"], "{\"b\":[1,2],\"a\":{\"d\":null,\"c\":\"\\u00e9\"}}\r\n");
        assert_eq!(run(json!({ "mode": "minify", "lenient": true }), "[1, /* two */ 2,]")["text"], "[1,2]");
        assert_eq!(run(json!({ "mode": "minify" }), "[1, 2,]")["ok"], false);
        assert_eq!(run(json!({ "mode": "minify", "change": "drop-nulls" }), text)["text"], r#"{"b":[1,2],"a":{"c":"é"}}"#);
        assert_eq!(run(json!({ "mode": "minify", "change": "flatten", "sortKeys": true }), text)["text"], r#"{"a.c":"é","a.d":null,"b.0":1,"b.1":2}"#);
        // A change that cannot be made to this document is an answer, and names no place.
        assert_eq!(run(json!({ "mode": "minify", "change": "parse" }), text)["error"], json!({ "code": "cannot-change", "line": 0, "column": 0, "offset": 0 }));
        // What is wrong with the text is told with its place, whichever way it is then written.
        assert_eq!(run(json!({ "mode": "format", "sortKeys": true }), "{\n  \"a\": 1,\n}")["error"]["line"], 3);
        let counted = run(json!({ "mode": "validate" }), text);
        assert_eq!((counted["stats"]["objects"].clone(), counted["stats"]["arrays"].clone(), counted["stats"]["keys"].clone()), (json!(2), json!(1), json!(4)));

        // A file, held whole, to a file; and many files the same way.
        let folder = folder("ways");
        std::fs::write(folder.join("in.json"), text).expect("written");
        let done = dev.invoke("json", json!({ "mode": "minify", "sortKeys": true, "path": folder.join("in.json"), "out": folder.join("out.json") })).expect("answered");
        assert_eq!((done["ok"].clone(), done["stats"]["bytesOut"].clone()), (json!(true), json!(35)));
        assert_eq!(std::fs::read_to_string(folder.join("out.json")).expect("read"), r#"{"a":{"c":"é","d":null},"b":[1,2]}"#);
        let files = dev.invoke("find_files", json!({ "paths": [folder.join("in.json")] })).expect("found")["files"].clone();
        let batch = dev.invoke("json_batch", json!({ "mode": "minify", "change": "drop-nulls", "files": files, "target": { "kind": "beside", "mark": "min" } })).expect("answered");
        assert_eq!(batch["items"][0]["status"], "done");
        assert_eq!(std::fs::read_to_string(folder.join("in.min.json")).expect("read"), r#"{"b":[1,2],"a":{"c":"é"}}"#);
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn a_query_is_run_through_the_command() {
        let dev = dev();
        let text = r#"{"a":[{"b":1},{"b":2},{"c":3}]}"#;
        let values = dev.invoke("jsonpath", json!({ "query": "$.a[?@.b].b", "indent": "2", "text": text })).expect("answered");
        assert_eq!((values["text"].clone(), values["found"].clone()), (json!("[\n  1,\n  2\n]"), json!(2)));
        let ways = dev.invoke("jsonpath", json!({ "query": "$..b", "show": "ways", "indent": "2", "text": text })).expect("answered");
        assert_eq!(ways["text"], "[\n  \"$['a'][0]['b']\",\n  \"$['a'][1]['b']\"\n]");
        let both = dev.invoke("jsonpath", json!({ "query": "$.a[2]", "show": "both", "indent": "tab", "text": text })).expect("answered");
        assert_eq!(both["text"], "[\n\t{\n\t\t\"path\": \"$['a'][2]\",\n\t\t\"value\": {\n\t\t\t\"c\": 3\n\t\t}\n\t}\n]");
        assert_eq!(dev.invoke("jsonpath", json!({ "query": "$.none", "text": text })).expect("answered")["text"], "[]");
        // A query that is wrong, and a document that is: each is an answer.
        assert_eq!(dev.invoke("jsonpath", json!({ "query": "$.a[", "text": text })).expect("answered")["error"], json!({ "code": "bad-query", "line": 0, "column": 5, "offset": 4 }));
        assert_eq!(dev.invoke("jsonpath", json!({ "query": "$", "text": "{" })).expect("answered")["error"]["code"], "unexpected-end");
    }

    #[test]
    fn a_schema_and_declarations_are_written_from_a_sample() {
        let dev = dev();
        let sample = r#"{"id": 1, "tags": ["a"]}"#;
        let schema = dev.invoke("derive", json!({ "what": "schema", "draft": "07", "indent": "2", "text": sample })).expect("answered");
        assert_eq!(schema["text"], "{\n  \"$schema\": \"http://json-schema.org/draft-07/schema#\",\n  \"type\": \"object\",\n  \"properties\": {\n    \"id\": {\n      \"type\": \"integer\"\n    },\n    \"tags\": {\n      \"type\": \"array\",\n      \"items\": {\n        \"type\": \"string\"\n      }\n    }\n  },\n  \"required\": [\n    \"id\",\n    \"tags\"\n  ]\n}");
        let declared = dev.invoke("derive", json!({ "what": "typescript", "root": "Thing", "exported": false, "text": sample })).expect("answered");
        assert_eq!(declared["text"], "interface Thing {\n  id: number;\n  tags: string[];\n}\n");
        assert_eq!(dev.invoke("derive", json!({ "what": "typescript", "text": "{" })).expect("answered")["error"]["code"], "unexpected-end");
        assert!(matches!(dev.invoke("derive", json!({ "what": "schema", "draft": "99", "text": "1" })), Err(AppError::InvalidRequest(_))));
    }

    #[test]
    fn documents_are_checked_against_a_schema() {
        let dev = dev();
        let schema = r#"{"type": "object", "required": ["id"], "properties": {"id": {"type": "integer"}}}"#;
        let fits = dev.invoke("schema_check", json!({ "schema": schema, "text": r#"{"id": 1}"# })).expect("answered");
        assert_eq!((fits["ok"].clone(), fits["misfits"].clone()), (json!(true), json!([])));
        let misfits = dev.invoke("schema_check", json!({ "schema": schema, "text": r#"{"id": "x"}"# })).expect("answered");
        assert_eq!((misfits["misfits"][0]["at"].clone(), misfits["misfits"][0]["rule"].clone()), (json!("/id"), json!("/properties/id/type")));
        assert_eq!(dev.invoke("schema_check", json!({ "schema": schema, "text": "{" })).expect("answered")["error"]["code"], "unexpected-end");
        assert_eq!(dev.invoke("schema_check", json!({ "schema": "{\n  \"type\": }", "text": "1" })).expect("answered")["error"], json!({ "code": "schema-not-json", "line": 2, "column": 11, "offset": 12, "detail": "expected-value" }));
        assert_eq!(dev.invoke("schema_check", json!({ "schema": r#"{"type": 5}"#, "text": "1" })).expect("answered")["error"]["code"], "schema-not-schema");

        let folder = folder("schema");
        std::fs::write(folder.join("a.json"), r#"{"id": 1}"#).expect("written");
        std::fs::write(folder.join("b.json"), r#"{"id": null}"#).expect("written");
        std::fs::write(folder.join("c.json"), r#"{"id": "#).expect("written");
        assert_eq!(dev.invoke("schema_check", json!({ "schema": schema, "path": folder.join("b.json") })).expect("answered")["misfits"].as_array().map(Vec::len), Some(1));
        let files = dev.invoke("find_files", json!({ "paths": [folder], "endings": ["json"] })).expect("found")["files"].clone();
        let checked = dev.invoke("schema_batch", json!({ "schema": schema, "files": files })).expect("answered");
        let told: Vec<(Value, Value)> = checked["items"].as_array().expect("items").iter().map(|item| (item["status"].clone(), item["code"].clone())).collect();
        assert_eq!(told, [(json!("done"), Value::Null), (json!("wrong"), json!("not-valid")), (json!("wrong"), json!("unexpected-end"))]);
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn a_document_is_shown_as_a_tree_a_part_at_a_time() {
        let dev = dev();
        let opened = dev.invoke("tree_open", json!({ "text": r#"{"a": [10, 20, 30, {"b": "x"}], "c": null}"# })).expect("answered");
        assert_eq!((opened["ok"].clone(), opened["root"].clone()), (json!(true), json!({ "key": null, "kind": "object", "children": 2, "text": "" })));
        let tree = opened["tree"].clone();
        let top = dev.invoke("tree_rows", json!({ "tree": tree, "way": [], "from": 0, "count": 50 })).expect("rows");
        assert_eq!(top["rows"], json!([{ "key": "a", "kind": "array", "children": 4, "text": "" }, { "key": "c", "kind": "null", "children": 0, "text": "null" }]));
        let part = dev.invoke("tree_rows", json!({ "tree": tree, "way": [0], "from": 1, "count": 2 })).expect("rows");
        assert_eq!(part["rows"], json!([{ "key": null, "kind": "number", "children": 0, "text": "20" }, { "key": null, "kind": "number", "children": 0, "text": "30" }]));
        let found = dev.invoke("tree_find", json!({ "tree": tree, "sought": "X", "most": 10 })).expect("found");
        assert_eq!((found["count"].clone(), found["hits"][0]["way"].clone()), (json!(1), json!([0, 3, 0])));
        dev.invoke("tree_close", json!({ "tree": tree })).expect("closed");
        assert!(matches!(dev.invoke("tree_rows", json!({ "tree": tree, "count": 1 })), Err(AppError::Failed { code: "no-tree", .. })));
        assert_eq!(dev.invoke("tree_open", json!({ "text": "[1," })).expect("answered")["error"]["code"], "unexpected-end");
    }

    #[test]
    fn many_files_are_worked_on_in_one_run() {
        let dev = dev();
        let folder = folder("many");
        std::fs::create_dir_all(folder.join("in/sub")).expect("a folder");
        std::fs::write(folder.join("in/a.json"), "[1, 2]").expect("written");
        std::fs::write(folder.join("in/b.json"), "[1, 2").expect("written");
        std::fs::write(folder.join("in/sub/c.json"), r#"{"c": null}"#).expect("written");
        std::fs::write(folder.join("in/readme.txt"), "not asked for").expect("written");

        let found = dev.invoke("find_files", json!({ "paths": [folder.join("in")], "deep": true, "endings": ["json"] })).expect("found");
        let files = found["files"].as_array().expect("files").clone();
        assert_eq!(files.len(), 3);

        let checked = dev.invoke("json_batch", json!({ "mode": "validate", "files": files })).expect("answered");
        let statuses = |answer: &Value| answer["items"].as_array().expect("items").iter().map(|item| item["status"].as_str().unwrap_or_default().to_owned()).collect::<Vec<_>>();
        assert_eq!(statuses(&checked), ["done", "wrong", "done"]);
        assert_eq!((checked["items"][1]["code"].clone(), checked["items"][1]["line"].clone(), checked["items"][1]["column"].clone()), (json!("unexpected-end"), json!(1), json!(6)));

        let out = folder.join("out");
        let minified = dev.invoke("json_batch", json!({ "mode": "minify", "files": files, "target": { "kind": "folder", "folder": out } })).expect("answered");
        assert_eq!(statuses(&minified), ["done", "wrong", "done"]);
        assert_eq!(std::fs::read_to_string(out.join("a.json")).expect("read"), "[1,2]");
        assert_eq!(std::fs::read_to_string(out.join("sub/c.json")).expect("read"), r#"{"c":null}"#);
        assert!(!out.join("b.json").exists());
        assert_eq!(dev.invoke("progress", json!({})).expect("progress"), json!({ "running": false, "done": 22, "total": 22, "file": 3, "files": 3 }));

        let beside = dev.invoke("json_batch", json!({ "mode": "format", "indent": "2", "files": files, "target": { "kind": "beside", "mark": "formatted" } })).expect("answered");
        assert_eq!(statuses(&beside), ["done", "wrong", "done"]);
        assert_eq!(std::fs::read_to_string(folder.join("in/a.formatted.json")).expect("read"), "[\n  1,\n  2\n]");
        // A format or a minify that is not told where to write is refused, not guessed.
        assert!(matches!(dev.invoke("json_batch", json!({ "mode": "minify", "files": files })), Err(AppError::InvalidRequest(_))));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn the_tools_of_encode_work_on_texts_and_on_files() {
        let dev = dev();
        let run = |tool: &str, options: Value, text: &str| dev.invoke("codec", json!({ "tool": tool, "options": options, "text": text })).expect("answered");
        assert_eq!(run("base64", json!({}), "hello")["text"], "aGVsbG8=");
        assert_eq!(run("base64", json!({ "direction": "decode" }), "aGVsbG8=")["text"], "hello");
        assert_eq!(run("base64", json!({ "alphabet": "url", "padding": false }), "\u{fb}\u{ff}")["text"], "w7vDvw");
        assert_eq!(run("url-encode", json!({ "way": "form" }), "a b&c")["text"], "a+b%26c");
        assert_eq!(run("html-entities", json!({ "beyondAscii": true }), "<é>")["text"], "&lt;&eacute;&gt;");
        assert_eq!(run("escape", json!({ "flavor": "json" }), "a\"b")["text"], "a\\\"b");
        assert_eq!(run("gzip", json!({ "asText": true }), "hello")["text"].as_str().map(|text| &text[..4]), Some("H4sI"));
        assert_eq!(run("gzip", json!({ "direction": "decode" }), "H4sIAAAAAAACA8tIzcnJBwCGphA2BQAAAA==")["text"], "hello");

        // What is wrong is an answer with its place; bytes that are no text are told to be so.
        let wrong = run("base64", json!({ "direction": "decode" }), "aGVs*G8=");
        assert_eq!(wrong, json!({ "ok": false, "error": { "code": "bad-character", "line": 1, "column": 5, "offset": 4 } }));
        let bytes = run("base64", json!({ "direction": "decode" }), "//79");
        assert_eq!((bytes["binary"].clone(), bytes["text"].clone(), bytes["stats"]["bytesOut"].clone()), (json!(true), Value::Null, json!(3)));
        let noted = run("html-entities", json!({ "direction": "decode" }), "&lt;&zzz;");
        assert_eq!((noted["text"].clone(), noted["notes"][0]["code"].clone()), (json!("<&zzz;"), json!("unknown-names")));
        assert!(matches!(dev.invoke("codec", json!({ "tool": "rot13", "text": "a" })), Err(AppError::NotFound(_))));

        let folder = folder("codec");
        let path = folder.join("in.bin");
        std::fs::write(&path, [0xff, 0xfe, 0x00, 0x41]).expect("written");
        // Bytes that are not text, kept by writing them to a file.
        dev.invoke("codec", json!({ "tool": "base64", "options": { "direction": "decode" }, "text": "//4AQQ==", "out": folder.join("out.bin") })).expect("answered");
        assert_eq!(std::fs::read(folder.join("out.bin")).expect("read"), [0xff, 0xfe, 0x00, 0x41]);
        // A file read where it is, to another file; then every file of a run, each named after its own.
        let written = dev.invoke("codec", json!({ "tool": "base64", "path": path, "out": folder.join("in.b64") })).expect("answered");
        assert_eq!((written["ok"].clone(), written["head"].clone()), (json!(true), json!("//4AQQ==")));
        let files = dev.invoke("find_files", json!({ "paths": [path] })).expect("found")["files"].clone();
        let zipped = dev.invoke("codec_batch", json!({ "tool": "gzip", "files": files, "target": { "kind": "beside", "append": "gz" } })).expect("answered");
        assert_eq!(zipped["items"][0]["status"], "done");
        let gz = dev.invoke("find_files", json!({ "paths": [folder.join("in.bin.gz")] })).expect("found")["files"].clone();
        let opened = dev.invoke("codec_batch", json!({ "tool": "gzip", "options": { "direction": "decode" }, "files": gz, "target": { "kind": "folder", "folder": folder.join("out"), "strip": "gz", "otherwise": "opened" } })).expect("answered");
        assert_eq!(opened["items"][0]["status"], "done");
        assert_eq!(std::fs::read(folder.join("out/in.bin")).expect("read"), [0xff, 0xfe, 0x00, 0x41]);
        // Digests of many files, shown beside them: each as the tool gives it for the file alone, and nothing written.
        let alone = dev.invoke("codec", json!({ "tool": "hash", "options": { "algorithms": ["sha256"] }, "path": path, "show": true })).expect("answered");
        let shown = dev.invoke("codec_batch", json!({ "tool": "hash", "options": { "algorithms": ["sha256"] }, "files": files, "target": { "kind": "shown" } })).expect("answered");
        assert_eq!((shown["items"][0]["status"].clone(), shown["items"][0]["out"].clone()), (json!("done"), Value::Null));
        assert_eq!(shown["items"][0]["said"].as_str().map(str::len), Some(64));
        assert_eq!(shown["items"][0]["said"].as_str(), alone["text"].as_str().map(str::trim_end));
        assert!(!folder.join("in.bin.sha256").exists());
        // Only read, to say whether the tool takes it.
        let checked = dev.invoke("codec_batch", json!({ "tool": "gzip", "options": { "direction": "decode" }, "files": files })).expect("answered");
        assert_eq!((checked["items"][0]["status"].clone(), checked["items"][0]["code"].clone()), (json!("wrong"), json!("bad-gzip")));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn a_token_is_read_through_the_command() {
        let dev = dev();
        let token = "eyJ0eXAiOiJKV1QiLA0KICJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJqb2UiLA0KICJleHAiOjEzMDA4MTkzODAsDQogImh0dHA6Ly9leGFtcGxlLmNvbS9pc19yb290Ijp0cnVlfQ.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let key = "AyM1SysPpbyDfgZld3umj1qzKObwVMkoqQ-EstJQLr_T-1qS0gZH75aKtMN3Yj0iPS4hcgUuTwjAzZr1Z9CAow";
        let read = dev.invoke("jwt", json!({ "token": token, "secret": key, "secretForm": "base64" })).expect("answered");
        assert_eq!((read["ok"].clone(), read["algorithm"].clone(), read["signature"].clone()), (json!(true), json!("HS256"), json!("valid")));
        assert_eq!(dev.invoke("jwt", json!({ "token": token })).expect("answered")["signature"], "not-checked");
        assert_eq!(dev.invoke("jwt", json!({ "token": token, "secret": "zz", "secretForm": "hex" })).expect("answered")["error"]["code"], "bad-secret");
        assert_eq!(dev.invoke("jwt", json!({ "token": "a.b" })).expect("answered")["error"]["code"], "not-three-parts");
        assert_eq!(secret_bytes("0a FF", "hex"), Some(vec![0x0a, 0xff]));
    }

    /// A file of a third of a gigabyte, larger than is ever shown whole: written again from disk to disk, with memory
    /// that does not grow with it. Run by hand (`cargo test -p dev-backend --release -- --ignored --nocapture`).
    #[test]
    #[ignore = "writes about 1 GB to the temporary folder"]
    fn a_very_large_file_goes_from_disk_to_disk() {
        use std::io::Write;
        let dev = dev();
        let folder = folder("large");
        let path = folder.join("large.json");
        let out = folder.join("large-out.json");
        {
            let mut file = BufWriter::new(File::create(&path).expect("created"));
            file.write_all(b"[").expect("written");
            let item = br#"{"id":123456,"name":"A name of some length","tags":["one","two","three"],"nested":{"ok":true,"none":null,"ratio":0.123456789}}"#;
            let many = 350 * 1024 * 1024 / item.len();
            for index in 0..many {
                if index > 0 {
                    file.write_all(b",").expect("written");
                }
                file.write_all(item).expect("written");
            }
            file.write_all(b"]").expect("written");
        }
        let size = std::fs::metadata(&path).expect("there").len();
        let opened = dev.invoke("open", json!({ "path": path })).expect("opened");
        assert_eq!((opened["large"].clone(), opened["size"].clone()), (json!(true), json!(size)));
        let started = Instant::now();
        let done = dev.invoke("json", json!({ "mode": "format", "path": path, "out": out })).expect("answered");
        println!("{size} bytes formatted in {:?}: {}", started.elapsed(), done["stats"]);
        assert_eq!(done["ok"], true);
        let back = dev.invoke("json", json!({ "mode": "minify", "path": out, "out": folder.join("back.json") })).expect("answered");
        assert_eq!(back["stats"]["bytesOut"], json!(size));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn the_converters_and_formatters_answer_as_the_other_tools_do() {
        let dev = dev();
        let run = |tool: &str, options: Value, text: &str| dev.invoke("codec", json!({ "tool": tool, "options": options, "text": text })).expect("answered");
        assert_eq!(run("yaml-json", json!({ "direction": "decode", "indent": "min" }), "a: [1, x]")["text"], json!("{\"a\":[1,\"x\"]}"));
        assert_eq!(run("yaml-json", json!({ "direction": "encode", "yamlIndent": 2 }), "{\"a\":[1,\"x\"]}")["text"], json!("a:\n  - 1\n  - x\n"));
        // What the library said of a YAML that is wrong goes with the place.
        let wrong = run("yaml-json", json!({ "direction": "decode" }), "a: [1");
        assert_eq!((wrong["ok"].clone(), wrong["error"]["code"].clone(), wrong["error"]["detail"].is_string()), (json!(false), json!("bad-yaml"), true));
        assert_eq!(run("csv-json", json!({ "direction": "decode", "indent": "min" }), "a;b\n1;x")["text"], json!("[{\"a\":1,\"b\":\"x\"}]"));
        assert_eq!(run("csv-json", json!({ "direction": "encode", "separator": "tab" }), "[{\"a\":1,\"b\":\"x\"}]")["text"], json!("a\tb\n1\tx\n"));
        assert_eq!(run("markup", json!({ "mode": "format", "indent": "2" }), "<a><b>x</b></a>")["text"], json!("<a>\n  <b>x</b>\n</a>"));
        assert_eq!(run("markup", json!({ "mode": "validate", "kind": "xml" }), "<a><b></a>")["error"]["code"], json!("mismatched-tag"));
        assert_eq!(run("sql", json!({ "mode": "format", "indent": "2", "case": "upper" }), "select 1")["text"], json!("SELECT\n  1"));
        assert_eq!(run("sql", json!({ "mode": "minify", "case": "keep" }), "select  1 ;")["text"], json!("select 1;"));
        assert!(matches!(dev.invoke("codec", json!({ "tool": "sql", "options": { "mode": "validate" }, "text": "x" })), Err(AppError::InvalidRequest(_))));
    }

    #[test]
    fn two_texts_and_two_documents_are_compared() {
        let dev = dev();
        let found = dev.invoke("diff", json!({ "left": { "text": "a\nb\nc\n" }, "right": { "text": "a\nB\nc\n" }, "context": 1 })).expect("answered");
        assert_eq!((found["ok"].clone(), found["identical"].clone(), found["changed"].clone(), found["shown"].clone()), (json!(true), json!(false), json!(1), json!(3)));
        assert_eq!(found["text"], json!("--- original\n+++ changed\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n"));
        let rows = dev.invoke("diff_rows", json!({ "diff": found["diff"], "from": 1, "count": 1 })).expect("answered");
        assert_eq!(rows["rows"][0]["kind"], json!("changed"));
        assert_eq!(rows["rows"][0]["right"]["pieces"][0], json!({ "text": "B", "changed": true }));
        dev.invoke("diff_close", json!({ "diff": found["diff"] })).expect("answered");
        assert!(dev.invoke("diff_rows", json!({ "diff": found["diff"] })).is_err());
        assert_eq!(dev.invoke("diff", json!({ "left": { "text": "A b" }, "right": { "text": "a  b" }, "ignoreCase": true, "ignoreSpaces": true })).expect("answered")["identical"], json!(true));
        // JSON: the order of keys is no difference; what is wrong is told with its side.
        let same = dev.invoke("diff", json!({ "json": true, "left": { "text": "{\"a\":1,\"b\":2}" }, "right": { "text": "{\"b\": 2, \"a\": 1}" } })).expect("answered");
        assert_eq!((same["identical"].clone(), same["text"].clone()), (json!(true), json!("")));
        let patched = dev.invoke("diff", json!({ "json": true, "result": "patch", "left": { "text": "{\"a\":1}" }, "right": { "text": "{\"a\":2}" } })).expect("answered");
        assert_eq!((patched["operations"].clone(), patched["text"].as_str().is_some_and(|text| text.contains("replace"))), (json!(1), true));
        let wrong = dev.invoke("diff", json!({ "json": true, "left": { "text": "{}" }, "right": { "text": "{\"a\":}" } })).expect("answered");
        assert_eq!((wrong["ok"].clone(), wrong["error"]["side"].clone(), wrong["error"]["column"].clone()), (json!(false), json!("right"), json!(6)));
    }

    #[test]
    fn folders_are_compared_and_listed_a_part_at_a_time() {
        let dev = dev();
        let root = std::env::temp_dir().join(format!("syntelab-dev-folders-command-{}", std::process::id()));
        for (side, files) in [("a", [("one.txt", "1"), ("two.txt", "2")]), ("b", [("one.txt", "1"), ("two.txt", "3")])] {
            std::fs::create_dir_all(root.join(side)).expect("folder");
            for (name, said) in files {
                std::fs::write(root.join(side).join(name), said).expect("written");
            }
        }
        std::fs::write(root.join("b").join("three.txt"), "3").expect("written");
        let found = dev.invoke("folders_compare", json!({ "left": root.join("a"), "right": root.join("b"), "deep": true })).expect("answered");
        assert_eq!((found["files"].clone(), found["same"].clone(), found["different"].clone(), found["onlyRight"].clone(), found["onlyLeft"].clone()), (json!(3), json!(1), json!(1), json!(1), json!(0)));
        let rows = dev.invoke("folders_rows", json!({ "folders": found["folders"], "count": 10, "states": ["different", "only-right"] })).expect("answered");
        assert_eq!((rows["count"].clone(), rows["rows"][0]["path"].clone(), rows["rows"][1]["state"].clone()), (json!(2), json!("three.txt"), json!("different")));
        assert_eq!(rows["rows"][1]["rightFile"], json!(root.join("b").join("two.txt")));
        // The pair that differs, compared as two files.
        let compared = dev.invoke("diff", json!({ "left": { "path": rows["rows"][1]["leftFile"] }, "right": { "path": rows["rows"][1]["rightFile"] }, "ignoreNumbers": true })).expect("answered");
        assert_eq!(compared["identical"], json!(true));
        dev.invoke("folders_close", json!({ "folders": found["folders"] })).expect("answered");
        assert!(dev.invoke("folders_rows", json!({ "folders": found["folders"] })).is_err());
        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn digests_identifiers_and_secrets_are_made() {
        let dev = dev();
        let run = |tool: &str, options: Value, text: &str| dev.invoke("codec", json!({ "tool": tool, "options": options, "text": text })).expect("answered");
        assert_eq!(run("hash", json!({}), "abc")["text"], json!("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad\n"));
        assert_eq!(run("hash", json!({ "algorithms": ["md5", "crc32"], "form": "upper" }), "abc")["text"], json!("MD5: 900150983CD24FB0D6963F7D28E17F72\nCRC-32: 352441C2\n"));
        assert_eq!(run("hash", json!({ "algorithms": ["sha256"], "key": "4a656665", "keyForm": "hex" }), "what do ya want for nothing?")["text"], json!("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843\n"));
        assert_eq!(run("hash", json!({ "algorithms": ["md5"], "expected": "900150983cd24fb0d6963f7d28e17f72  abc.txt" }), "abc")["notes"][0]["code"], json!("hash-match"));
        assert_eq!(run("hash", json!({ "algorithms": ["md5"], "expected": "00" }), "abc")["notes"][0]["code"], json!("hash-no-match"));
        assert!(dev.invoke("codec", json!({ "tool": "hash", "options": { "key": "zz", "keyForm": "hex" }, "text": "abc" })).is_err());
        assert_eq!(run("uuid", json!({ "indent": "min" }), "2ed6657d-e927-568b-95e1-2665a8aea6a2")["text"], json!("[{\"uuid\":\"2ed6657d-e927-568b-95e1-2665a8aea6a2\",\"version\":5,\"kind\":\"name, SHA-1\",\"variant\":\"RFC 9562\"}]"));

        let made = dev.invoke("generate", json!({ "tool": "uuid", "options": { "version": "5", "namespace": "dns", "name": "www.example.com", "format": "braces" }, "count": 2 })).expect("answered");
        assert_eq!((made["text"].clone(), made["count"].clone()), (json!("{2ed6657d-e927-568b-95e1-2665a8aea6a2}\n{2ed6657d-e927-568b-95e1-2665a8aea6a2}\n"), json!(2)));
        assert_eq!(dev.invoke("generate", json!({ "tool": "uuid", "options": { "version": "3", "namespace": "nowhere" } })).expect("answered")["error"]["code"], json!("bad-namespace"));
        let seven = dev.invoke("generate", json!({ "tool": "uuid", "options": { "version": "7" }, "count": 1000 })).expect("answered");
        assert_eq!(seven["text"].as_str().map(|text| text.lines().count()), Some(1000));
        let secret = dev.invoke("generate", json!({ "tool": "secrets", "options": { "kind": "password", "length": 24, "signs": false }, "count": 3 })).expect("answered");
        assert_eq!(secret["text"].as_str().map(|text| text.lines().map(str::len).collect::<Vec<_>>()), Some(vec![24, 24, 24]));
        assert_eq!(secret["notes"][0], json!({ "code": "secret-bits", "text": "142" }));
        assert_eq!(dev.invoke("generate", json!({ "tool": "secrets", "options": { "small": false, "capital": false, "digits": false, "signs": false } })).expect("answered")["error"]["code"], json!("no-characters"));
        // Many, straight into a file.
        let out = std::env::temp_dir().join(format!("syntelab-dev-generate-{}.txt", std::process::id()));
        let filed = dev.invoke("generate", json!({ "tool": "secrets", "options": { "kind": "hex", "length": 16 }, "count": 20000, "out": out })).expect("answered");
        assert_eq!((filed["stats"]["bytesOut"].clone(), filed["text"].is_null()), (json!(20000 * 33), true));
        assert_eq!(std::fs::read_to_string(&out).expect("read").lines().count(), 20000);
        std::fs::remove_file(out).ok();
    }

    #[test]
    fn moments_schedules_addresses_and_certificates_are_told() {
        let dev = dev();
        let run = |tool: &str, options: Value, text: &str| dev.invoke("codec", json!({ "tool": tool, "options": options, "text": text })).expect("answered");
        let moment = run("timestamp", json!({ "zone": "Europe/Bucharest", "indent": "min" }), "1700000000");
        assert!(moment["text"].as_str().is_some_and(|text| text.contains("\"inZone\":\"2023-11-15T00:13:20.000+02:00\"")));
        assert_eq!(run("timestamp", json!({ "zone": "UTC" }), "soon")["error"]["code"], json!("bad-time"));
        assert!(matches!(dev.invoke("codec", json!({ "tool": "timestamp", "options": { "zone": "Mars/Olympus" }, "text": "0" })), Err(AppError::Failed { code: "bad-zone", .. })));
        let schedule = run("cron", json!({ "zone": "UTC", "count": 2, "indent": "min" }), "30 2 * * *");
        assert!(schedule["text"].as_str().is_some_and(|text| text.contains("\"says\":\"At 02:30, every day\"")));
        assert_eq!(run("cron", json!({ "zone": "UTC" }), "every day")["error"]["code"], json!("bad-cron-fields"));
        assert!(run("url-parser", json!({ "indent": "min" }), "https://example.com/a?b=c")["text"].as_str().is_some_and(|text| text.contains("\"parameters\":[{\"name\":\"b\",\"value\":\"c\",\"raw\":\"b=c\"}]")));
        let certificate = run("certificate", json!({ "indent": "min" }), include_str!("../fixtures/certificate.pem"));
        assert!(certificate["text"].as_str().is_some_and(|text| text.contains("CN=dev.example.test")));
        assert_eq!(certificate["notes"][0], json!({ "code": "certificates-read", "text": "1" }));
    }

    #[test]
    fn shows_the_bytes_of_a_file_a_part_at_a_time() {
        let dev = dev();
        let folder = std::env::temp_dir().join(format!("dev-hex-commands-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let path = folder.join("in.bin");
        std::fs::write(&path, b"\x00\x01PK\x03\x04hello PK\xff").expect("written");
        let opened = dev.invoke("hex_open", json!({ "path": path })).expect("opened");
        assert_eq!(opened["size"], 15);
        let hex = opened["hex"].clone();
        let rows = dev.invoke("hex_rows", json!({ "hex": hex, "from": 2, "count": 4 })).expect("read");
        assert_eq!((rows["from"].clone(), rows["bytes"].clone()), (json!(2), json!("504b0304")));
        // Sought forward and back, as bytes; as a text in any case.
        let found = dev.invoke("hex_find", json!({ "hex": hex, "sought": "504b", "from": 3 })).expect("sought");
        assert_eq!((found["at"].clone(), found["length"].clone()), (json!(12), json!(2)));
        assert_eq!(dev.invoke("hex_find", json!({ "hex": hex, "sought": "504b", "from": 12, "back": true })).expect("sought")["at"], 2);
        assert_eq!(dev.invoke("hex_find", json!({ "hex": hex, "sought": "48454c4c4f", "from": 0, "anyCase": true })).expect("sought")["at"], 6);
        assert_eq!(dev.invoke("hex_find", json!({ "hex": hex, "sought": "48454c4c4f", "from": 0 })).expect("sought")["at"], Value::Null);
        assert!(dev.invoke("hex_find", json!({ "hex": hex, "sought": "5", "from": 0 })).is_err());
        // A range, copied in a form and written to a file as it is.
        assert_eq!(dev.invoke("hex_copy", json!({ "hex": hex, "from": 2, "to": 6, "form": "code" })).expect("copied")["text"], "0x50, 0x4B, 0x03, 0x04");
        assert_eq!(dev.invoke("hex_copy", json!({ "hex": hex, "from": 6, "to": 99, "form": "text" })).expect("copied")["text"], "hello PK\u{FFFD}");
        let out = folder.join("out.bin");
        assert_eq!(dev.invoke("hex_save", json!({ "hex": hex, "from": 2, "to": 6, "out": out })).expect("saved")["written"], 4);
        assert_eq!(std::fs::read(&out).expect("read"), b"PK\x03\x04");
        // A text is held as its bytes; what was let go is no longer there.
        let text = dev.invoke("hex_open", json!({ "text": "aș" })).expect("opened");
        assert_eq!(text["size"], 3);
        assert_eq!(dev.invoke("hex_rows", json!({ "hex": text["hex"], "from": 0, "count": 16 })).expect("read")["bytes"], "61c899");
        dev.invoke("hex_close", json!({ "hex": hex })).expect("closed");
        assert!(dev.invoke("hex_rows", json!({ "hex": hex, "from": 0, "count": 1 })).is_err());
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn makes_keys_requests_and_certificates_and_reads_them_back() {
        let dev = dev();
        let made = dev.invoke("keys_make", json!({ "kind": "ed25519", "comment": "me@here" })).expect("answered");
        assert_eq!((made["ok"].clone(), made["key"]["kind"].clone(), made["key"]["locked"].clone()), (json!(true), json!("Ed25519"), json!(false)));
        assert!(made["key"]["publicOpenssh"].as_str().expect("a line").starts_with("ssh-ed25519 "));
        assert_eq!(made["key"]["traditional"], Value::Null);
        assert_eq!(dev.invoke("keys_make", json!({ "kind": "rsa", "bits": 512 })).expect("answered")["error"]["code"], "rsa-too-small");

        // A certificate signed with a key that is given; then both read from one text, and told to belong together.
        let signed = dev.invoke("keys_request", json!({ "key": made["key"]["pkcs8"], "subject": { "commonName": "example.test", "country": "RO" }, "names": ["example.test"], "selfSigned": { "days": 30 } })).expect("answered");
        assert_eq!((signed["ok"].clone(), signed["certificate"]["subject"].clone()), (json!(true), json!("CN=example.test,C=RO")));
        assert_eq!(signed["certificate"]["digest"], made["key"]["digest"]);
        let both = format!("{}{}", signed["certificate"]["pem"].as_str().expect("PEM"), made["key"]["openssh"].as_str().expect("PEM"));
        let read = dev.invoke("keys_read", json!({ "text": both })).expect("answered");
        assert_eq!((read["matches"].clone(), read["certificates"].as_array().map(Vec::len), read["key"]["digest"].clone()), (json!(true), Some(1), made["key"]["digest"].clone()));
        // The words written after an OpenSSH key are kept when it is written again.
        assert!(read["key"]["publicOpenssh"].as_str().expect("a line").ends_with(" me@here"));

        // A request with a new key of its own.
        let asked = dev.invoke("keys_request", json!({ "make": { "kind": "p256" }, "subject": { "commonName": "example.test" } })).expect("answered");
        assert!(asked["request"]["pem"].as_str().expect("PEM").starts_with("-----BEGIN CERTIFICATE REQUEST-----"));
        assert_eq!(asked["request"]["digest"], asked["key"]["digest"]);
        assert_eq!(dev.invoke("keys_request", json!({ "subject": { "commonName": "x" } })).expect("answered")["error"]["code"], "no-key");

        // A root of one's own signs the request.
        let root = dev.invoke("keys_request", json!({ "make": { "kind": "ed25519" }, "subject": { "commonName": "My Root" }, "selfSigned": { "days": 3650, "authority": true } })).expect("answered");
        let by_root = dev.invoke("keys_sign", json!({ "request": asked["request"]["pem"], "certificate": root["certificate"]["pem"], "key": root["key"]["pkcs8"], "days": 90 })).expect("answered");
        assert_eq!((by_root["ok"].clone(), by_root["certificates"][0]["issuer"].clone(), by_root["certificates"][1]["subject"].clone()), (json!(true), json!("CN=My Root"), json!("CN=My Root")));
        assert_eq!(by_root["certificates"][0]["digest"], asked["key"]["digest"]);
        assert_eq!(dev.invoke("keys_sign", json!({ "request": "", "certificate": root["certificate"]["pem"], "key": root["key"]["pkcs8"], "days": 90 })).expect("answered")["error"]["code"], "not-recognized");
        assert_eq!(dev.invoke("keys_sign", json!({ "request": asked["request"]["pem"], "certificate": signed["certificate"]["pem"], "key": made["key"]["pkcs8"], "days": 90 })).expect("answered")["error"]["code"], "not-authority");

        // Written as bytes: DER, and a PKCS #12 file that is read back with its password only.
        let folder = std::env::temp_dir().join(format!("dev-keys-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("a folder");
        let der = folder.join("certificate.der");
        dev.invoke("keys_write", json!({ "form": "der", "text": signed["certificate"]["pem"], "out": der })).expect("written");
        assert_eq!(dev.invoke("keys_read", json!({ "path": der })).expect("answered")["form"], "der");
        let pfx = folder.join("both.pfx");
        assert_eq!(dev.invoke("keys_write", json!({ "form": "pkcs12", "text": both, "password": "secret", "out": pfx })).expect("answered")["ok"], true);
        assert_eq!(dev.invoke("keys_read", json!({ "path": pfx })).expect("answered")["error"]["code"], "needs-passphrase");
        let opened = dev.invoke("keys_read", json!({ "path": pfx, "passphrase": "secret" })).expect("answered");
        assert_eq!((opened["form"].clone(), opened["matches"].clone()), (json!("pkcs12"), json!(true)));
        assert_eq!(dev.invoke("keys_write", json!({ "form": "pkcs12", "text": made["key"]["pkcs8"], "password": "secret", "out": folder.join("none.pfx") })).expect("answered")["error"]["code"], "no-certificate");
        assert!(!folder.join("none.pfx").exists());
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn a_result_is_written_to_a_file_of_its_own_looked_at_and_kept() {
        let folder = folder("results");
        let dev = Dev::new(&AppContext { cache_dir: folder.join("cache") });
        // A picture decoded from Base64 goes to a result of the program's own.
        let result = dev.invoke("result_file", json!({})).expect("answered")["path"].as_str().map(PathBuf::from).expect("a path");
        let picture = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==";
        dev.invoke("codec", json!({ "tool": "base64", "options": { "direction": "decode" }, "text": picture, "out": result })).expect("answered");
        let looked = dev.invoke("look", json!({ "path": result })).expect("answered");
        assert_eq!((looked["view"].clone(), looked["mime"].clone(), looked["format"].clone(), looked["size"].clone()), (json!("picture"), json!("image/png"), json!("PNG"), json!(67)));
        assert!(looked["start"].as_str().is_some_and(|start| start.starts_with("89 50 4E 47 0D 0A 1A 0A")));

        // Its bytes are served whole, with their media type, as long as it is looked at.
        let number = looked["look"].as_u64().expect("a number");
        let (sender, received) = std::sync::mpsc::channel();
        let ask = |path: String| {
            let sender = sender.clone();
            dev.resource(ResourceRequest { path, query: Default::default() }, Box::new(move |answer| sender.send(answer).expect("sent")));
            received.recv().expect("an answer")
        };
        let served = ask(format!("look/{number}")).expect("served");
        assert_eq!((served.mime, served.bytes.len()), ("image/png", 67));
        dev.invoke("look_close", json!({ "look": number })).expect("answered");
        assert!(matches!(ask(format!("look/{number}")), Err(AppError::NotFound(_))));
        // Text is told to be text, and is not served: the tools show it themselves.
        std::fs::write(folder.join("a.txt"), "plain").expect("written");
        let text = dev.invoke("look", json!({ "path": folder.join("a.txt") })).expect("answered");
        assert_eq!((text["view"].clone(), text["format"].clone()), (json!("text"), Value::Null));
        assert!(ask(format!("look/{}", text["look"])).is_err());

        // Save copies the result where the user chose; a file that is not a result of the program's own is never copied or deleted.
        let kept = folder.join("kept.png");
        assert_eq!(dev.invoke("result_keep", json!({ "from": result, "to": kept })).expect("answered")["size"], 67);
        assert!(matches!(dev.invoke("result_keep", json!({ "from": folder.join("a.txt"), "to": folder.join("b.txt") })), Err(AppError::InvalidRequest(_))));
        dev.invoke("result_forget", json!({ "path": folder.join("a.txt") })).expect("answered");
        assert!(folder.join("a.txt").exists());
        dev.invoke("result_forget", json!({ "path": result })).expect("answered");
        assert!(!result.exists() && kept.exists());
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn sends_a_request_and_tries_ports_on_this_computer() {
        use std::io::{Read, Write};
        let dev = dev();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("an address").port();
        let server = std::thread::spawn(move || {
            // The first connection is the try at the port; the second is the request.
            drop(listener.accept().expect("a connection"));
            let (mut stream, _) = listener.accept().expect("a connection");
            let mut asked = [0u8; 2048];
            let read = stream.read(&mut asked).expect("a request");
            stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 8\r\nConnection: close\r\n\r\n{\"a\": 1}").expect("answered");
            String::from_utf8_lossy(&asked[..read]).into_owned()
        });
        let tried = dev.invoke("net_ports", json!({ "host": "127.0.0.1", "ports": port.to_string(), "timeoutMs": 3000 })).expect("answered");
        assert_eq!((tried["ok"].clone(), tried["open"].clone(), tried["ports"][0]["state"].clone()), (json!(true), json!(1), json!("open")));
        assert_eq!(dev.invoke("net_ports", json!({ "host": "127.0.0.1", "ports": "http" })).expect("answered")["error"]["code"], "bad-ports");

        let answer = dev.invoke("net_http", json!({ "method": "GET", "url": format!("http://127.0.0.1:{port}/x"), "headers": [["X-Mine", "1"]], "timeoutSeconds": 10 })).expect("answered");
        assert_eq!((answer["ok"].clone(), answer["status"].clone(), answer["text"].clone()), (json!(true), json!(200), json!("{\"a\": 1}")));
        assert!(server.join().expect("the server").to_ascii_lowercase().contains("x-mine: 1"));
        assert_eq!(dev.invoke("net_http", json!({ "method": "GET", "url": "nothing" })).expect("answered")["error"]["code"], "bad-url");
        assert_eq!(dev.invoke("net_dns", json!({ "name": " ", "kinds": ["A"] })).expect("answered")["error"]["code"], "bad-name");
        assert_eq!(dev.invoke("net_dns", json!({ "name": "exa mple.com", "kinds": ["A"] })).expect("answered")["error"]["code"], "bad-name");
        assert_eq!(dev.invoke("net_dns", json!({ "name": "example.com", "kinds": ["A"], "server": "nowhere" })).expect("answered")["error"]["code"], "bad-server");
        assert!(dev.invoke("net_dns_servers", json!({})).expect("answered")["servers"].is_array());
        assert_eq!(dev.invoke("net_certificate", json!({ "host": "not a host", "port": 443 })).expect("answered")["error"]["code"], "bad-host");
    }

    #[test]
    fn a_body_that_is_not_text_goes_to_the_result_file_it_is_given() {
        use std::io::{Read, Write};
        let dev = dev();
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("an address").port();
        let server = std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut stream, _) = listener.accept().expect("a connection");
                let mut asked = [0u8; 2048];
                let _ = stream.read(&mut asked).expect("a request");
                stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\nContent-Length: 4\r\nConnection: close\r\n\r\n\x89PN\xff").expect("answered");
            }
        });
        let result = dev.invoke("result_file", json!({})).expect("answered")["path"].as_str().map(PathBuf::from).expect("a path");
        let url = format!("http://127.0.0.1:{port}/p.png");
        let answer = dev.invoke("net_http", json!({ "method": "GET", "url": url, "timeoutSeconds": 10, "keep": result })).expect("answered");
        assert_eq!((answer["binary"].clone(), answer["kept"].clone()), (json!(true), json!(true)));
        assert_eq!(std::fs::read(&result).expect("kept"), b"\x89PN\xff");
        // A file that is not a result of the program's own is not written.
        let elsewhere = std::env::temp_dir().join(format!("not-a-result-{port}.bin"));
        let answer = dev.invoke("net_http", json!({ "method": "GET", "url": url, "timeoutSeconds": 10, "keep": elsewhere })).expect("answered");
        assert_eq!((answer["binary"].clone(), answer["kept"].clone()), (json!(true), Value::Null));
        assert!(!elsewhere.exists());
        server.join().expect("the server");
        dev.invoke("result_forget", json!({ "path": result })).expect("answered");
    }
}
