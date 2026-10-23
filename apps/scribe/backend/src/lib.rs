//! Scribe: the Rust side of the app.
//!
//! Commands (`invoke`), all answered with JSON:
//! - `open_file { path, encoding? }` → `{ text, encoding, mark, lineEnding,
//!   mixedEndings, damaged }`. The text has `\n` between its lines whatever
//!   the file had; `encoding` forces how the bytes are read. Fails with
//!   `cannot-open`, `not-text` or `unknown-encoding`.
//!   A file larger than `LARGEST_OPENED` is refused with `too-large` (`detail`
//!   starts with its size in bytes) unless `whole` is true: it is shown a
//!   page at a time instead (the `large_*` commands).
//! - `large_open { path }` → `{ size, lines, encoding }`. Goes through a
//!   large file once to learn where its lines start. Fails with
//!   `cannot-open`, `not-text` or `not-paged` (a file of two bytes to a
//!   letter, whose lines cannot be found so).
//! - `large_lines { path, from, count }` → `{ lines: [text] }`. A page of
//!   lines, `from` counted from 0; very long lines come cut.
//! - `large_find { path, replacement, from?, most? }` → `{ matches: [{ line,
//!   text, from, to }], next }`. The places the pattern of `replacement` is
//!   found from line `from` on; `next` is the line to go on from when there
//!   may be more, else null. Fails with `bad-pattern`.
//! - `read_bytes { data, encoding? }` → what `open_file` gives. Reads a text
//!   the interface holds only the bytes of (a file dropped on the window),
//!   `data` as base64. Fails with `not-text` or `unknown-encoding`.
//! - `save_file { path, text, encoding, mark, lineEnding }` → `{}`. Fails
//!   with `cannot-save`, `unknown-encoding` or `cannot-encode` (the text has
//!   letters the encoding cannot write: `detail` starts with the first).
//! - `export_text { path, text, format }` → `{}`. Writes the text as a Word
//!   document (`format` "docx", a paragraph to each line) or a PDF ("pdf",
//!   laid out on A4 pages); the text keeps its own file. Fails with
//!   `cannot-save`.
//! - `encodings {}` → `{ encodings: [name] }`. The encodings offered for
//!   saving.
//! - `apply { text, operations: [operation] }` → `{ text, changed }`. Does the
//!   operations one after another (see `ops::Operation` for what each is and
//!   takes); `changed` counts what they changed. Fails with `bad-pattern`
//!   (the regular expression is not valid: `detail` says why) or
//!   `bad-choice`.
//! - `preview { text, operations }` → `{ text, changed, kind, linesBefore,
//!   linesAfter, charactersBefore, charactersAfter, changedLines, movedLines,
//!   addedLines, removedLines, marks: [{ kind, line, pieces?, from? }],
//!   removed: [{ line, text }] }`. What `apply` would give, with how it
//!   differs from the text (see `preview`): `kind` is `same`, `reordered`,
//!   `inPlace`, `removed` or `rewritten`; a mark is of a line of the result
//!   (from 0) that `changed` (with the stretches that differ, in UTF-16
//!   units), `moved` (from which line of the text, from 1) or was `added`;
//!   `removed` are the lines of the text that are gone. Fails as `apply`.
//! - `text_stats { text, top?, minLetters?, longest? }` → `{ characters,
//!   charactersWithoutSpaces, words, differentWords, sentences, paragraphs,
//!   lines, lettersPerWord, wordsPerSentence, topWords: [{ text, count }],
//!   topPairs: [{ text, count }], topTriples: [{ text, count }],
//!   longestSentences: [{ text, words }], shortestSentence: { text, words } |
//!   null, longestWord, shortestWord, bytes, syllables, wordsByLength: [5
//!   counts: 1–3 letters, 4–6, 7–9, 10–12, more], sentencesByLength: [3
//!   counts: up to 10 words, 11–20, more], questions, exclamations }`. What
//!   the text is made of, counted by the rules of every script.
//! - `compare { left, right, ignoreCase?, ignoreSpaces?, ignoreEmptyLines?,
//!   ignoreNumbers?, ignorePunctuation?,
//!   context? }` → `{ identical, added, removed, changed, same, skippedAfter,
//!   hunks: [{ skipped, rows: [{ kind, left?, right? }] }] }`. Two texts line
//!   by line; `kind` is `same`, `removed`, `added` or `changed`; a side is
//!   `{ number, pieces: [{ text, changed }] }`. Only what differs is given,
//!   with `context` lines around it (3 unless asked); `skipped` counts the
//!   lines left out before each place.
//! - `find_in_folder { folder, replacement, endings?, everything?, mostMatches? }`
//!   → `{ files: [{ path, under, count, matches: [{ line, text, from, to }] }],
//!   searched, skipped, stopped }`. Looks for the pattern of `replacement` in
//!   the text files of a folder and of those under it; nothing is written.
//!   Fails with `cannot-open` (the folder) or `bad-pattern`.
//! - `replace_in_files { paths, replacement }` → `{ files: [{ path, changed,
//!   problem }] }`. Replaces in the files named; each is written back in the
//!   encoding and with the line endings it had. `problem` is null, or why a
//!   file was left as it was.
//! - `list_text_files { folder, endings?, everything? }` → `{ files: [{ path,
//!   under }] }`. The files of a folder and of those under it (those with
//!   one of the endings, or all), each with the folders it lies under.
//! - `run_on_files { files: [{ path, under? }], operations, folder? }` →
//!   `{ files: [{ path, written, changed, problem }] }`. Runs the operations
//!   on each file, written back as it was kept: over itself, or, with
//!   `folder`, under its own name there (never over a file that is there).
//!   `problem` is null, or why a file was left as it was. Fails with
//!   `bad-pattern` or `bad-choice` before any file is touched.
//! - `restore_romanian { text, guess? }` → `{ text, changed, doubtful:
//!   [{ from, to, choices }] }`. Romanian typed without diacritics, written
//!   with them; the text stays as long as it was. `doubtful` are the words
//!   that can be read in more than one way and were left as typed: where
//!   each is (in UTF-16 units) and how it can be written, the likelier
//!   first. With `guess` they take the likelier reading and none is given.
//! - `generate { generator }` → `{ text }`. Writes a text instead of changing
//!   one (see `generate::Generator`): filler, random characters, or made-up
//!   data. Fails
//!   with `bad-choice` (nothing, or too much, asked for).
//! - `count_matches { text, replacement, places? }` → `{ count, lines,
//!   different, places: [{ from, to }] }`. `lines` is on how many lines the
//!   matches are, `different` how many different texts they are. How many places a find-and-replace would change,
//!   without changing them, and where the first `places` of them are (in
//!   UTF-16 units; none unless asked).
//!
//! Scribe has no binary resources.

// Comparing texts is shared with Dev: it lives in `crates/syntelab-compare`.
pub use syntelab_compare as compare;
pub mod export;
pub mod files;
pub mod folders;
pub mod generate;
pub mod language;
pub mod large;
pub mod ops;
pub mod preview;
pub mod recipes;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use base64::Engine as _;

use serde::Deserialize;
use serde_json::{json, Value};
use syntelab_app_api::{AppContext, AppError, ResourceReply, ResourceRequest, SyntelabApp};

use files::{FileError, LineEnding, WriteAs};
use language::stats::{self, Wanted};
use ops::{OpError, Operation, Replacement};

/// The app id: the folder name and the `id` in `app.json`.
pub const APP_ID: &str = "scribe";

/// A file larger than this is not handed whole to the editor unless it is asked for so.
pub const LARGEST_OPENED: u64 = 64 * 1024 * 1024;
/// How many large files have their lines remembered at once.
const MOST_INDEXED: usize = 4;

#[derive(Default)]
pub struct Scribe {
    /// Where the lines of the large files now shown start, by their paths.
    indexed: Mutex<HashMap<PathBuf, Arc<large::LineIndex>>>,
}

impl Scribe {
    pub fn new(_context: &AppContext) -> Self {
        Self::default()
    }

    /// Where the lines of a large file start: remembered, or found now (also when the file changed since).
    fn indexed(&self, path: &Path) -> Result<Arc<large::LineIndex>, AppError> {
        let known = self.indexed.lock().ok().and_then(|indexed| indexed.get(path).cloned());
        if let Some(index) = known.filter(|index| index.is_current()) {
            return Ok(index);
        }
        let index = Arc::new(large::index(path).map_err(large_error)?);
        if let Ok(mut indexed) = self.indexed.lock() {
            if indexed.len() >= MOST_INDEXED {
                indexed.clear();
            }
            indexed.insert(path.to_owned(), Arc::clone(&index));
        }
        Ok(index)
    }

    fn large_open(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
        }
        let Request { path } = parse(payload)?;
        let index = self.indexed(&path)?;
        Ok(json!({ "size": index.size, "lines": index.lines, "encoding": index.encoding.name() }))
    }

    fn large_lines(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            from: u64,
            count: usize,
        }
        let Request { path, from, count } = parse(payload)?;
        let lines = self.indexed(&path)?.lines(from, count.min(5000)).map_err(large_error)?;
        Ok(json!({ "lines": lines }))
    }

    fn large_find(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            replacement: Replacement,
            #[serde(default)]
            from: u64,
            #[serde(default)]
            most: Option<usize>,
        }
        let Request { path, replacement, from, most } = parse(payload)?;
        let found = self.indexed(&path)?.find(&replacement, from, most.unwrap_or(200).clamp(1, 5000)).map_err(large_error)?;
        let matches: Vec<Value> = found.matches.iter().map(|found| json!({ "line": found.line, "text": found.text, "from": found.from, "to": found.to })).collect();
        Ok(json!({ "matches": matches, "next": found.next }))
    }

    fn open_file(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            #[serde(default)]
            encoding: Option<String>,
            #[serde(default)]
            whole: bool,
        }
        let Request { path, encoding, whole } = parse(payload)?;
        let size = std::fs::metadata(&path).map_or(0, |facts| facts.len());
        if size > LARGEST_OPENED && !whole {
            return Err(AppError::Failed { code: "too-large", detail: format!("{size} bytes") });
        }
        let read = files::read_text(&path, encoding.as_deref()).map_err(|error| file_error(error, "cannot-open"))?;
        Ok(read_as_json(&read))
    }

    fn read_bytes(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            data: String,
            #[serde(default)]
            encoding: Option<String>,
        }
        let Request { data, encoding } = parse(payload)?;
        let bytes = base64::engine::general_purpose::STANDARD.decode(data.as_bytes()).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        let read = files::decode(&bytes, encoding.as_deref()).map_err(|error| file_error(error, "cannot-open"))?;
        Ok(read_as_json(&read))
    }

    fn save_file(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            path: PathBuf,
            text: String,
            encoding: String,
            #[serde(default)]
            mark: bool,
            line_ending: String,
        }
        let Request { path, text, encoding, mark, line_ending } = parse(payload)?;
        let line_ending = LineEnding::from_name(&line_ending).ok_or_else(|| AppError::InvalidRequest(format!("line ending {line_ending}")))?;
        files::write_text(&path, &text, WriteAs { encoding: &encoding, mark, line_ending }).map_err(|error| file_error(error, "cannot-save"))?;
        Ok(json!({}))
    }

    fn export_text(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            text: String,
            format: String,
        }
        let Request { path, text, format } = parse(payload)?;
        let kind = export::DocumentKind::from_name(&format).ok_or_else(|| AppError::InvalidRequest(format!("format {format}")))?;
        export::write_document(&path, &text, kind).map_err(|detail| AppError::Failed { code: "cannot-save", detail })?;
        Ok(json!({}))
    }
}

impl Scribe {
    fn apply(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            text: String,
            operations: Vec<Operation>,
        }
        let Request { text, operations } = parse(payload)?;
        let outcome = ops::apply_all(&text, &operations).map_err(op_error)?;
        Ok(json!({ "text": outcome.text, "changed": outcome.changed }))
    }

    fn preview(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            text: String,
            operations: Vec<Operation>,
        }
        let Request { text, operations } = parse(payload)?;
        let told = preview::preview(&text, &operations).map_err(op_error)?;
        let marks: Vec<Value> = told
            .marks
            .iter()
            .map(|mark| match mark {
                preview::Mark::Changed { line, pieces } => json!({ "kind": "changed", "line": line, "pieces": pieces }),
                preview::Mark::Moved { line, from } => json!({ "kind": "moved", "line": line, "from": from }),
                preview::Mark::Added { line } => json!({ "kind": "added", "line": line }),
            })
            .collect();
        let removed: Vec<Value> = told.removed.iter().map(|(line, text)| json!({ "line": line, "text": text })).collect();
        Ok(json!({
            "text": told.text,
            "changed": told.changed,
            "kind": told.kind.name(),
            "linesBefore": told.lines_before,
            "linesAfter": told.lines_after,
            "charactersBefore": told.characters_before,
            "charactersAfter": told.characters_after,
            "changedLines": told.changed_lines,
            "movedLines": told.moved_lines,
            "addedLines": told.added_lines,
            "removedLines": told.removed_lines,
            "marks": marks,
            "removed": removed,
        }))
    }

    fn text_stats(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            text: String,
            #[serde(default)]
            top: Option<usize>,
            #[serde(default)]
            min_letters: Option<usize>,
            #[serde(default)]
            longest: Option<usize>,
        }
        let Request { text, top, min_letters, longest } = parse(payload)?;
        let usual = Wanted::default();
        let wanted = Wanted { top: top.unwrap_or(usual.top).min(200), min_letters: min_letters.unwrap_or(usual.min_letters).clamp(1, 40), longest: longest.unwrap_or(usual.longest).min(50) };
        let counted = stats::measure(&text, wanted);
        let listed = |items: &[stats::Counted]| items.iter().map(|item| json!({ "text": item.text, "count": item.count })).collect::<Vec<_>>();
        Ok(json!({
            "characters": counted.characters,
            "charactersWithoutSpaces": counted.characters_without_spaces,
            "words": counted.words,
            "differentWords": counted.different_words,
            "sentences": counted.sentences,
            "paragraphs": counted.paragraphs,
            "lines": counted.lines,
            "lettersPerWord": counted.letters_per_word,
            "wordsPerSentence": counted.words_per_sentence,
            "topWords": listed(&counted.top_words),
            "topPairs": listed(&counted.top_pairs),
            "longestSentences": counted.longest_sentences.iter().map(|sentence| json!({ "text": sentence.text, "words": sentence.words })).collect::<Vec<_>>(),
            "topTriples": listed(&counted.top_triples),
            "shortestSentence": counted.shortest_sentence.as_ref().map(|sentence| json!({ "text": sentence.text, "words": sentence.words })),
            "longestWord": counted.longest_word,
            "shortestWord": counted.shortest_word,
            "bytes": counted.bytes,
            "syllables": counted.syllables,
            "wordsByLength": counted.words_by_length,
            "sentencesByLength": counted.sentences_by_length,
            "questions": counted.questions,
            "exclamations": counted.exclamations,
        }))
    }

    fn compare(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            left: String,
            right: String,
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
            #[serde(default)]
            context: Option<usize>,
        }
        let Request { left, right, ignore_case, ignore_spaces, ignore_empty_lines, ignore_numbers, ignore_punctuation, context } = parse(payload)?;
        let ignoring = compare::Ignoring { case: ignore_case, spaces: ignore_spaces, empty_lines: ignore_empty_lines, numbers: ignore_numbers, punctuation: ignore_punctuation };
        let found = compare::compare(&left, &right, ignoring, context.unwrap_or(3).min(1000));
        let side = |side: &Option<compare::Side>| side.as_ref().map(|side| json!({ "number": side.number, "pieces": side.pieces.iter().map(|piece| json!({ "text": piece.text, "changed": piece.changed })).collect::<Vec<_>>() }));
        let hunks: Vec<Value> = found
            .hunks
            .iter()
            .map(|hunk| json!({ "skipped": hunk.skipped, "rows": hunk.rows.iter().map(|row| json!({ "kind": row.kind.name(), "left": side(&row.left), "right": side(&row.right) })).collect::<Vec<_>>() }))
            .collect();
        Ok(json!({ "identical": found.identical(), "added": found.added, "removed": found.removed, "changed": found.changed, "same": found.same, "skippedAfter": found.skipped_after, "hunks": hunks }))
    }

    fn find_in_folder(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            folder: PathBuf,
            replacement: Replacement,
            #[serde(default)]
            endings: Vec<String>,
            #[serde(default)]
            everything: bool,
            #[serde(default)]
            most_matches: Option<usize>,
        }
        let Request { folder, replacement, endings, everything, most_matches } = parse(payload)?;
        let scope = folders::Scope { endings, everything, most_matches: most_matches.unwrap_or(5000).clamp(1, 100_000) };
        let found = folders::find_in_folder(&folder, &replacement, &scope).map_err(|error| match error {
            folders::FolderError::Folder(error) => AppError::Failed { code: "cannot-open", detail: error.to_string() },
            folders::FolderError::Pattern(error) => op_error(error),
        })?;
        let files: Vec<Value> = found
            .files
            .iter()
            .map(|file| {
                let matches: Vec<Value> = file.matches.iter().map(|found| json!({ "line": found.line, "text": found.text, "from": found.from, "to": found.to })).collect();
                json!({ "path": file.path, "under": file.under, "count": file.count, "matches": matches })
            })
            .collect();
        Ok(json!({ "files": files, "searched": found.searched, "skipped": found.skipped, "stopped": found.stopped }))
    }

    fn replace_in_files(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            paths: Vec<PathBuf>,
            replacement: Replacement,
        }
        let Request { paths, replacement } = parse(payload)?;
        let done = folders::replace_in_files(&paths, &replacement).map_err(op_error)?;
        let files: Vec<Value> = done
            .iter()
            .map(|(path, outcome)| match outcome {
                folders::Replaced::Done(changed) => json!({ "path": path, "changed": changed, "problem": Value::Null }),
                folders::Replaced::Unchanged => json!({ "path": path, "changed": 0, "problem": Value::Null }),
                folders::Replaced::Failed(code) => json!({ "path": path, "changed": 0, "problem": code }),
            })
            .collect();
        Ok(json!({ "files": files }))
    }

    fn list_text_files(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            folder: PathBuf,
            #[serde(default)]
            endings: Vec<String>,
            #[serde(default)]
            everything: bool,
        }
        let Request { folder, endings, everything } = parse(payload)?;
        let scope = folders::Scope { endings, everything, most_matches: 0 };
        let found = folders::text_files(&folder, &scope).map_err(|_| AppError::Failed { code: "cannot-open", detail: "the folder cannot be read".into() })?;
        // A slip (a whole disk chosen) does not fill the list for ever.
        let files: Vec<Value> = found.iter().take(5000).map(|(path, under)| json!({ "path": path, "under": under })).collect();
        Ok(json!({ "files": files, "more": found.len() > 5000 }))
    }

    fn run_on_files(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct RequestedFile {
            path: PathBuf,
            #[serde(default)]
            under: String,
        }
        #[derive(Deserialize)]
        struct Request {
            files: Vec<RequestedFile>,
            operations: Vec<Operation>,
            #[serde(default)]
            folder: Option<PathBuf>,
        }
        let Request { files, operations, folder } = parse(payload)?;
        let sources: Vec<recipes::Source> = files.into_iter().map(|file| recipes::Source { path: file.path, under: file.under }).collect();
        let target = folder.map_or(recipes::Target::InPlace, recipes::Target::Folder);
        let ran = recipes::run_on_files(&sources, &operations, &target).map_err(op_error)?;
        let files: Vec<Value> = ran
            .iter()
            .map(|(path, outcome)| match outcome {
                recipes::Ran::Done { written, changed } => json!({ "path": path, "written": written, "changed": changed, "problem": Value::Null }),
                recipes::Ran::Unchanged => json!({ "path": path, "written": Value::Null, "changed": 0, "problem": Value::Null }),
                recipes::Ran::Failed(code) => json!({ "path": path, "written": Value::Null, "changed": 0, "problem": code }),
            })
            .collect();
        Ok(json!({ "files": files }))
    }

    fn restore_romanian(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            text: String,
            #[serde(default)]
            guess: bool,
        }
        let Request { text, guess } = parse(payload)?;
        let restored = language::romanian::restore(&text, guess);
        let doubtful: Vec<Value> = restored.doubtful.iter().map(|doubt| json!({ "from": doubt.from, "to": doubt.to, "choices": doubt.choices })).collect();
        Ok(json!({ "text": restored.text, "changed": restored.changed, "doubtful": doubtful }))
    }

    fn generate(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            generator: generate::Generator,
        }
        let Request { generator } = parse(payload)?;
        Ok(json!({ "text": generate::make(&generator, &mut generate::Dice::system()).map_err(op_error)? }))
    }

    fn count_matches(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            text: String,
            replacement: Replacement,
            #[serde(default)]
            places: usize,
        }
        let Request { text, replacement, places } = parse(payload)?;
        let (count, found) = ops::replace::places(&text, &replacement, places.min(20_000)).map_err(op_error)?;
        let found: Vec<Value> = found.iter().map(|(from, to)| json!({ "from": from, "to": to })).collect();
        let (lines, different) = ops::replace::match_facts(&text, &replacement).map_err(op_error)?;
        Ok(json!({ "count": count, "lines": lines, "different": different, "places": found }))
    }
}

impl SyntelabApp for Scribe {
    fn id(&self) -> &'static str {
        APP_ID
    }

    fn invoke(&self, command: &str, payload: Value) -> Result<Value, AppError> {
        match command {
            "open_file" => self.open_file(payload),
            "read_bytes" => self.read_bytes(payload),
            "large_open" => self.large_open(payload),
            "large_lines" => self.large_lines(payload),
            "large_find" => self.large_find(payload),
            "save_file" => self.save_file(payload),
            "export_text" => self.export_text(payload),
            "encodings" => Ok(json!({ "encodings": files::ENCODINGS })),
            "apply" => self.apply(payload),
            "preview" => self.preview(payload),
            "count_matches" => self.count_matches(payload),
            "generate" => self.generate(payload),
            "restore_romanian" => self.restore_romanian(payload),
            "text_stats" => self.text_stats(payload),
            "compare" => self.compare(payload),
            "find_in_folder" => self.find_in_folder(payload),
            "replace_in_files" => self.replace_in_files(payload),
            "list_text_files" => self.list_text_files(payload),
            "run_on_files" => self.run_on_files(payload),
            other => Err(AppError::NotFound(format!("command {other}"))),
        }
    }

    fn resource(&self, request: ResourceRequest, reply: ResourceReply) {
        reply(Err(AppError::NotFound(format!("resource {}", request.path))));
    }
}

fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, AppError> {
    serde_json::from_value(payload).map_err(|error| AppError::InvalidRequest(error.to_string()))
}

/// A problem with a large file as the interface is told it.
fn large_error(error: large::LargeError) -> AppError {
    match error {
        large::LargeError::File(error) => file_error(error, "cannot-open"),
        large::LargeError::NotPaged => AppError::Failed { code: "not-paged", detail: "the file is written two bytes to a letter".into() },
        large::LargeError::Pattern(error) => op_error(error),
    }
}

/// A text that was read, as the interface is given it.
fn read_as_json(read: &files::ReadText) -> Value {
    json!({
        "text": read.text,
        "encoding": read.encoding,
        "mark": read.mark,
        "lineEnding": read.line_ending.name(),
        "mixedEndings": read.mixed_endings,
        "damaged": read.damaged,
    })
}

/// A problem with an operation as the interface is told it.
fn op_error(error: OpError) -> AppError {
    let code = match &error {
        OpError::BadPattern(_) => "bad-pattern",
        OpError::BadChoice(_) => "bad-choice",
    };
    AppError::Failed { code, detail: error.to_string() }
}

/// A problem with a file as the interface is told it; `io` is the code for one of reading or writing itself.
fn file_error(error: FileError, io: &'static str) -> AppError {
    let code = match &error {
        FileError::Io(_) => io,
        FileError::NotText => "not-text",
        FileError::UnknownEncoding(_) => "unknown-encoding",
        FileError::CannotEncode(_) => "cannot-encode",
    };
    // The letter that cannot be written comes first, so the interface can show it.
    let detail = match &error {
        FileError::CannotEncode(letter) => format!("{letter} {error}"),
        _ => error.to_string(),
    };
    AppError::Failed { code, detail }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> (Scribe, PathBuf) {
        let dir = std::env::temp_dir().join(format!("scribe-app-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).expect("folder");
        (Scribe::new(&AppContext { cache_dir: dir.join("cache") }), dir)
    }

    #[test]
    fn saves_a_text_and_opens_it_again_as_it_was() {
        let (scribe, dir) = app();
        let path = dir.join("note.txt");
        scribe.invoke("save_file", json!({ "path": path, "text": "unu\ndoi", "encoding": "windows-1250", "lineEnding": "crlf" })).expect("saves");
        assert_eq!(std::fs::read(&path).expect("bytes"), b"unu\r\ndoi");
        let opened = scribe.invoke("open_file", json!({ "path": path })).expect("opens");
        assert_eq!(opened["text"], "unu\ndoi");
        assert_eq!(opened["lineEnding"], "crlf");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn shows_a_large_file_a_page_at_a_time() {
        let (scribe, dir) = app();
        let path = dir.join("long.txt");
        std::fs::write(&path, "unu\ndoi\ntrei doi\n").expect("written");
        let opened = scribe.invoke("large_open", json!({ "path": path })).expect("opens");
        assert_eq!((opened["lines"].as_u64(), opened["size"].as_u64(), opened["encoding"].as_str()), (Some(3), Some(17), Some("UTF-8")));
        let page = scribe.invoke("large_lines", json!({ "path": path, "from": 1, "count": 10 })).expect("reads");
        assert_eq!(page["lines"], json!(["doi", "trei doi"]));
        let found = scribe.invoke("large_find", json!({ "path": path, "replacement": { "find": "doi" } })).expect("finds");
        assert_eq!(found["matches"].as_array().map(Vec::len), Some(2));
        assert_eq!((found["matches"][1]["line"].as_u64(), found["next"].clone()), (Some(3), Value::Null));
        // The file changed: its lines are found again.
        std::fs::write(&path, "altul\n").expect("written");
        assert_eq!(scribe.invoke("large_open", json!({ "path": path })).expect("opens")["lines"], 1);
        assert!(matches!(scribe.invoke("large_open", json!({ "path": dir.join("none.txt") })), Err(AppError::Failed { code: "cannot-open", .. })));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_a_text_given_as_bytes() {
        let (scribe, _) = app();
        // "ţară\r\n" in windows-1250, as base64.
        let read = scribe.invoke("read_bytes", json!({ "data": "/mFy4w0K", "encoding": "windows-1250" })).expect("reads");
        assert_eq!((read["text"].as_str(), read["lineEnding"].as_str(), read["encoding"].as_str()), (Some("ţară\n"), Some("crlf"), Some("windows-1250")));
        let binary = scribe.invoke("read_bytes", json!({ "data": "AAECAwAAAAA=" }));
        assert!(matches!(binary, Err(AppError::Failed { code: "not-text", .. })), "{binary:?}");
        assert!(matches!(scribe.invoke("read_bytes", json!({ "data": "not base64!" })), Err(AppError::InvalidRequest(_))));
    }

    #[test]
    fn says_why_a_file_cannot_be_opened_or_saved() {
        let (scribe, dir) = app();
        let missing = scribe.invoke("open_file", json!({ "path": dir.join("none.txt") }));
        assert!(matches!(missing, Err(AppError::Failed { code: "cannot-open", .. })), "{missing:?}");
        let refused = scribe.invoke("save_file", json!({ "path": dir.join("a.txt"), "text": "日本", "encoding": "windows-1250", "lineEnding": "lf" }));
        assert!(matches!(&refused, Err(AppError::Failed { code: "cannot-encode", detail }) if detail.starts_with('日')), "{refused:?}");
        assert!(!dir.join("a.txt").exists(), "nothing is written when the text cannot be encoded");
        assert!(matches!(scribe.invoke("nothing", json!({})), Err(AppError::NotFound(_))));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_operations_asked_for_by_the_interface() {
        let (scribe, _) = app();
        let done = scribe.invoke("apply", json!({ "text": "b
a
b
", "operations": [{ "kind": "removeDuplicates" }, { "kind": "sortLines", "language": "ro" }] })).expect("applies");
        assert_eq!(done["text"], "a
b
");
        assert_eq!(done["changed"], 3);
        let counted = scribe.invoke("count_matches", json!({ "text": "a b a", "replacement": { "find": "a" } })).expect("counts");
        assert_eq!(counted["count"], 2);
        assert_eq!(counted["places"], json!([]));
        let placed = scribe.invoke("count_matches", json!({ "text": "a b a", "replacement": { "find": "a" }, "places": 5 })).expect("counts");
        assert_eq!(placed["places"], json!([{ "from": 0, "to": 1 }, { "from": 4, "to": 5 }]));
        let refused = scribe.invoke("apply", json!({ "text": "a", "operations": [{ "kind": "replace", "find": "(", "regex": true }] }));
        assert!(matches!(refused, Err(AppError::Failed { code: "bad-pattern", .. })), "{refused:?}");
    }

    #[test]
    fn restores_romanian_and_says_what_is_doubtful() {
        let (scribe, _) = app();
        let restored = scribe.invoke("restore_romanian", json!({ "text": "Stiu, ca vine." })).expect("restores");
        assert_eq!(restored["text"], "Știu, ca vine.");
        assert_eq!(restored["doubtful"], json!([{ "from": 6, "to": 8, "choices": ["că", "ca"] }]));
        let guessed = scribe.invoke("restore_romanian", json!({ "text": "Vine ca vrea.", "guess": true })).expect("restores");
        assert_eq!((guessed["text"].as_str(), guessed["doubtful"].as_array().map(Vec::len)), (Some("Vine că vrea."), Some(0)));
    }

    #[test]
    fn writes_what_a_generator_is_asked_for() {
        let (scribe, _) = app();
        let made = scribe.invoke("generate", json!({ "generator": { "kind": "randomText", "what": "digits", "length": 8, "lines": 2 } })).expect("writes");
        assert_eq!(made["text"].as_str().map(str::len), Some(17));
        let refused = scribe.invoke("generate", json!({ "generator": { "kind": "fillerText", "count": 0 } }));
        assert!(matches!(refused, Err(AppError::Failed { code: "bad-choice", .. })), "{refused:?}");
    }

    #[test]
    fn tells_what_operations_would_do_before_they_are_done() {
        let (scribe, _) = app();
        let told = scribe.invoke("preview", json!({ "text": "b\na\nb\n", "operations": [{ "kind": "removeDuplicates" }] })).expect("previews");
        assert_eq!((told["text"].as_str(), told["kind"].as_str(), told["removedLines"].as_u64()), (Some("b\na\n"), Some("removed"), Some(1)));
        assert_eq!(told["removed"], json!([{ "line": 3, "text": "b" }]));
        let sorted = scribe.invoke("preview", json!({ "text": "b\na\n", "operations": [{ "kind": "sortLines" }] })).expect("previews");
        assert_eq!(sorted["marks"][0], json!({ "kind": "moved", "line": 0, "from": 2 }));
        let upper = scribe.invoke("preview", json!({ "text": "ab cd", "operations": [{ "kind": "replace", "find": "cd", "with": "x" }] })).expect("previews");
        assert_eq!(upper["marks"], json!([{ "kind": "changed", "line": 0, "pieces": [[3, 4]] }]));
    }

    #[test]
    fn counts_what_a_text_is_made_of() {
        let (scribe, _) = app();
        let counted = scribe.invoke("text_stats", json!({ "text": "Unu doi. Trei patru cinci!", "minLetters": 1 })).expect("counts");
        assert_eq!((counted["words"].as_u64(), counted["sentences"].as_u64()), (Some(5), Some(2)));
        assert_eq!(counted["longestSentences"][0]["words"], 3);
        assert_eq!(counted["topWords"].as_array().map(Vec::len), Some(5));
    }

    #[test]
    fn compares_two_texts() {
        let (scribe, _) = app();
        let found = scribe.invoke("compare", json!({ "left": "a
b
", "right": "a
B
c
" })).expect("compares");
        assert_eq!((found["identical"].as_bool(), found["changed"].as_u64(), found["added"].as_u64()), (Some(false), Some(1), Some(1)));
        assert_eq!(found["hunks"][0]["rows"][1]["kind"], "changed");
        assert_eq!(found["hunks"][0]["rows"][2]["left"], Value::Null);
        let same = scribe.invoke("compare", json!({ "left": "a
b", "right": "A
b", "ignoreCase": true })).expect("compares");
        assert_eq!(same["identical"], true);
    }

    #[test]
    fn lists_the_encodings_it_offers() {
        let (scribe, _) = app();
        let listed = scribe.invoke("encodings", json!({})).expect("lists");
        assert!(listed["encodings"].as_array().is_some_and(|names| names.iter().any(|name| name == "windows-1250")));
        // Every name offered is one that can be written with.
        for name in files::ENCODINGS {
            files::encode("a", WriteAs { encoding: name, mark: false, line_ending: LineEnding::Lf }).unwrap_or_else(|error| panic!("{name}: {error}"));
        }
    }
}
