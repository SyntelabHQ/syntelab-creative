//! Two texts, two files, or two JSON documents, compared.
//!
//! Neither side is held whole. Each is read once, and of every line only where it begins and a number that stands
//! for what it says are kept (sixteen bytes a line): the comparison is made on those numbers, and the lines
//! themselves are read again from where they are, only where they are shown or written. A file is as large as the
//! disk lets it be; what memory must hold grows with how many lines the files have, not with how long they are.
//!
//! The lines are compared with the Myers algorithm (the `similar` crate, as in Scribe), between places both sides
//! have exactly once: those are found first and hold the two sides together, so a long comparison is many short
//! ones, and can be stopped between any two of them. A stretch with no such place that would take too long is
//! compared as well as a second allows: what comes out is still a true account of the differences, though not
//! always the shortest one.
//!
//! What is made of the comparison: a patch in the unified form, and the rows of the two sides, kept as places only
//! and read for the interface a part at a time, with the words that changed marked inside a line that was changed.
//!
//! Two JSON documents are first written the same way, with the keys of every object in order, so that only what
//! they say is compared and not how they were written. What changed is also told value by value, as a JSON Patch
//! (RFC 6902): each change with the JSON Pointer (RFC 6901) of its place.

use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::fs::File;
use std::hash::{Hash, Hasher};
use std::io::{self, BufRead, BufReader, Cursor, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::time::{Duration, Instant};

use syntelab_compare::similar::{capture_diff_slices_deadline, group_diff_ops, Algorithm, DiffOp};
use syntelab_compare::{changed_pair, key, paired, Ignoring, Piece, Side};

use crate::codec::CodecError;
use crate::json::{Options, Style};
use crate::tree::{self, quoted, unquoted, Node};
use crate::whole::{json_text, json_tree};

/// How long one stretch between two places both sides have once may take to compare as well as can be.
const A_STRETCH_MAY_TAKE: Duration = Duration::from_secs(1);
/// Lines of a run that was changed are weighed against each other, to pair those that are alike, up to so many pairs.
const MOST_WEIGHED: usize = 10_000;

/// One of the two sides: a text held in memory, or a file read from where it is.
pub enum Source {
    Text(Vec<u8>),
    File(PathBuf),
}

trait SeekRead: BufRead + Seek {}
impl<T: BufRead + Seek> SeekRead for T {}

impl Source {
    fn reader(&self) -> io::Result<Box<dyn SeekRead + '_>> {
        Ok(match self {
            Source::File(path) => Box::new(BufReader::with_capacity(256 * 1024, File::open(path)?)),
            Source::Text(text) => Box::new(Cursor::new(text.as_slice())),
        })
    }

    pub fn size(&self) -> io::Result<u64> {
        Ok(match self {
            Source::File(path) => std::fs::metadata(path)?.len(),
            Source::Text(text) => text.len() as u64,
        })
    }
}

/// What is kept of a side once it was read: where each of its lines begins, and its number where lines were passed over.
pub struct Lines {
    source: Source,
    starts: Vec<u64>,
    /// The number of each line kept (from 1), when some lines are not kept (empty ones that are passed over).
    numbers: Option<Vec<u64>>,
}

impl Lines {
    pub fn count(&self) -> usize {
        self.starts.len()
    }

    /// The number, from 1, of the line kept at `index`.
    fn number(&self, index: usize) -> u64 {
        self.numbers.as_ref().and_then(|numbers| numbers.get(index).copied()).unwrap_or(index as u64 + 1)
    }
}

/// A line without the break that ends it.
fn trimmed(line: &mut Vec<u8>) {
    if line.last() == Some(&b'\n') {
        line.pop();
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
}

/// Reads a side from end to end: where its lines begin, and a number for what each says once what is passed over
/// is taken out of it. `watch` is told how many bytes were read by now, and stops the reading by answering false.
pub fn read(source: Source, ignoring: Ignoring, watch: &mut dyn FnMut(u64) -> bool) -> Result<(Lines, Vec<u64>), CodecError> {
    let plain = !(ignoring.case || ignoring.spaces || ignoring.numbers || ignoring.punctuation);
    let (mut starts, mut keys, mut numbers): (Vec<u64>, Vec<u64>, Vec<u64>) = (Vec::new(), Vec::new(), Vec::new());
    {
        let mut reader = source.reader()?;
        let mut line = Vec::new();
        let (mut at, mut number) = (0u64, 0u64);
        loop {
            line.clear();
            let taken = reader.read_until(b'\n', &mut line)? as u64;
            if taken == 0 {
                break;
            }
            let began = at;
            at += taken;
            number += 1;
            trimmed(&mut line);
            // The mark some programs put before a text is not part of its first line.
            let said: &[u8] = if began == 0 { line.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&line) } else { &line };
            if ignoring.empty_lines && said.iter().all(u8::is_ascii_whitespace) {
                continue;
            }
            if starts.try_reserve(1).is_err() || keys.try_reserve(1).is_err() || (ignoring.empty_lines && numbers.try_reserve(1).is_err()) {
                return Err(CodecError::NoMemory);
            }
            let mut hasher = DefaultHasher::new();
            if plain {
                said.hash(&mut hasher);
            } else {
                key(&String::from_utf8_lossy(said), ignoring).hash(&mut hasher);
            }
            starts.push(began);
            keys.push(hasher.finish());
            if ignoring.empty_lines {
                numbers.push(number);
            }
            if starts.len() % 4096 == 0 && !watch(at) {
                return Err(CodecError::Stopped);
            }
        }
        if !watch(at) {
            return Err(CodecError::Stopped);
        }
    }
    Ok((Lines { source, starts, numbers: ignoring.empty_lines.then_some(numbers) }, keys))
}

/// Reads lines of a side again, from where they are.
struct Again<'a> {
    lines: &'a Lines,
    reader: Box<dyn SeekRead + 'a>,
    /// Where the reader stands: a line that begins there needs no seeking.
    at: u64,
}

impl<'a> Again<'a> {
    fn new(lines: &'a Lines) -> io::Result<Self> {
        Ok(Again { lines, reader: lines.source.reader()?, at: 0 })
    }

    fn line(&mut self, index: usize) -> io::Result<String> {
        let Some(&start) = self.lines.starts.get(index) else { return Ok(String::new()) };
        if start != self.at {
            self.reader.seek(SeekFrom::Start(start))?;
        }
        let mut line = Vec::new();
        let taken = self.reader.read_until(b'\n', &mut line)? as u64;
        self.at = start + taken;
        trimmed(&mut line);
        let said: &[u8] = if start == 0 { line.strip_prefix(&[0xEF, 0xBB, 0xBF]).unwrap_or(&line) } else { &line };
        Ok(String::from_utf8_lossy(said).into_owned())
    }
}

fn moved(op: DiffOp, by_old: usize, by_new: usize) -> DiffOp {
    match op {
        DiffOp::Equal { old_index, new_index, len } => DiffOp::Equal { old_index: old_index + by_old, new_index: new_index + by_new, len },
        DiffOp::Delete { old_index, old_len, new_index } => DiffOp::Delete { old_index: old_index + by_old, old_len, new_index: new_index + by_new },
        DiffOp::Insert { old_index, new_index, new_len } => DiffOp::Insert { old_index: old_index + by_old, new_index: new_index + by_new, new_len },
        DiffOp::Replace { old_index, old_len, new_index, new_len } => DiffOp::Replace { old_index: old_index + by_old, old_len, new_index: new_index + by_new, new_len },
    }
}

/// Adds lines that are the same to what was found so far; a stretch of them that follows another is one stretch.
fn same(ops: &mut Vec<DiffOp>, old_index: usize, new_index: usize, len: usize) {
    if len == 0 {
        return;
    }
    if let Some(DiffOp::Equal { old_index: before_old, new_index: before_new, len: before }) = ops.last_mut() {
        if *before_old + *before == old_index && *before_new + *before == new_index {
            *before += len;
            return;
        }
    }
    ops.push(DiffOp::Equal { old_index, new_index, len });
}

/// The places both sides have exactly once, as many of them as stand in the same order on both sides: the longest
/// such row (found as in patience sorting). Each is the place in `old` and the place in `new`.
fn held_together(old: &[u64], new: &[u64]) -> Vec<(usize, usize)> {
    // For each line: how many times it stands in `old` (2 for more), and where; then the same for `new`.
    let mut seen: HashMap<u64, (u8, usize, u8, usize)> = HashMap::new();
    for (index, line) in old.iter().enumerate() {
        let known = seen.entry(*line).or_insert((0, index, 0, 0));
        known.0 = known.0.saturating_add(1).min(2);
    }
    for (index, line) in new.iter().enumerate() {
        if let Some(known) = seen.get_mut(line) {
            known.2 = known.2.saturating_add(1).min(2);
            known.3 = index;
        }
    }
    let mut once: Vec<(usize, usize)> = seen.values().filter(|known| known.0 == 1 && known.2 == 1).map(|known| (known.1, known.3)).collect();
    drop(seen);
    once.sort_unstable();
    // The longest row of them whose places in `new` only go up: for each length, the pair that ends the row of that
    // length with the lowest place in `new`; and for each pair, the one before it in its row.
    let mut ends: Vec<usize> = Vec::new();
    let mut before: Vec<Option<usize>> = vec![None; once.len()];
    for (index, pair) in once.iter().enumerate() {
        let at = ends.partition_point(|&end| once[end].1 < pair.1);
        before[index] = at.checked_sub(1).map(|shorter| ends[shorter]);
        if at == ends.len() {
            ends.push(index);
        } else {
            ends[at] = index;
        }
    }
    let mut row = Vec::with_capacity(ends.len());
    let mut next = ends.last().copied();
    while let Some(index) = next {
        row.push(once[index]);
        next = before[index];
    }
    row.reverse();
    row
}

/// What differs between two sides, each given as the numbers that stand for its lines. `go_on` is asked between
/// stretches, and stops the comparing by answering false.
pub fn differences(old: &[u64], new: &[u64], go_on: &mut dyn FnMut() -> bool) -> Result<Vec<DiffOp>, CodecError> {
    let mut ops: Vec<DiffOp> = Vec::new();
    // What both begin with, and what both end with, is the same without asking.
    let start = old.iter().zip(new).take_while(|(one, other)| one == other).count();
    let end = old[start..].iter().rev().zip(new[start..].iter().rev()).take_while(|(one, other)| one == other).count();
    let (old_middle, new_middle) = (&old[start..old.len() - end], &new[start..new.len() - end]);
    same(&mut ops, 0, 0, start);
    let mut stretch = |from_old: usize, to_old: usize, from_new: usize, to_new: usize, ops: &mut Vec<DiffOp>| -> Result<(), CodecError> {
        if from_old == to_old && from_new == to_new {
            return Ok(());
        }
        if !go_on() {
            return Err(CodecError::Stopped);
        }
        for op in capture_diff_slices_deadline(Algorithm::Myers, &old_middle[from_old..to_old], &new_middle[from_new..to_new], Some(Instant::now() + A_STRETCH_MAY_TAKE)) {
            match moved(op, start + from_old, start + from_new) {
                DiffOp::Equal { old_index, new_index, len } => same(ops, old_index, new_index, len),
                other => ops.push(other),
            }
        }
        Ok(())
    };
    let (mut at_old, mut at_new) = (0, 0);
    for (in_old, in_new) in held_together(old_middle, new_middle) {
        stretch(at_old, in_old, at_new, in_new, &mut ops)?;
        same(&mut ops, start + in_old, start + in_new, 1);
        at_old = in_old + 1;
        at_new = in_new + 1;
    }
    stretch(at_old, old_middle.len(), at_new, new_middle.len(), &mut ops)?;
    same(&mut ops, old.len() - end, new.len() - end, end);
    Ok(ops)
}

/// One line of what the interface shows of a comparison: the places of the lines, not the lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shown {
    /// So many lines that are the same on both sides are not shown here.
    Skipped(u64),
    Same(usize, usize),
    Removed(usize),
    Added(usize),
    Changed(usize, usize),
}

/// A comparison, kept as the interface shows it.
pub struct Held {
    left: Lines,
    right: Lines,
    pub shown: Vec<Shown>,
    pub added: usize,
    pub removed: usize,
    pub changed: usize,
    pub same: usize,
}

/// A row as the interface is given it.
pub struct Row {
    pub kind: &'static str,
    pub skipped: u64,
    pub left: Option<Side>,
    pub right: Option<Side>,
}

fn whole(number: u64, line: String, changed: bool) -> Side {
    Side { number: number as usize, pieces: vec![Piece { text: line, changed }] }
}

impl Held {
    pub fn identical(&self) -> bool {
        self.added + self.removed + self.changed == 0
    }

    /// The rows from `from` on, `count` of them at most, read from where their lines are.
    pub fn rows(&self, from: usize, count: usize) -> io::Result<Vec<Row>> {
        let (mut left, mut right) = (Again::new(&self.left)?, Again::new(&self.right)?);
        let mut rows = Vec::new();
        for shown in self.shown.iter().skip(from).take(count) {
            rows.push(match *shown {
                Shown::Skipped(skipped) => Row { kind: "skipped", skipped, left: None, right: None },
                Shown::Same(old, new) => Row { kind: "same", skipped: 0, left: Some(whole(self.left.number(old), left.line(old)?, false)), right: Some(whole(self.right.number(new), right.line(new)?, false)) },
                Shown::Removed(old) => Row { kind: "removed", skipped: 0, left: Some(whole(self.left.number(old), left.line(old)?, true)), right: None },
                Shown::Added(new) => Row { kind: "added", skipped: 0, left: None, right: Some(whole(self.right.number(new), right.line(new)?, true)) },
                Shown::Changed(old, new) => {
                    let (was, is) = (left.line(old)?, right.line(new)?);
                    let (was, is) = changed_pair((self.left.number(old) as usize, &was), (self.right.number(new) as usize, &is));
                    Row { kind: "changed", skipped: 0, left: Some(was), right: Some(is) }
                }
            });
        }
        Ok(rows)
    }
}

/// Makes of what differs what is shown and what is written: the rows of each difference with `context` lines that
/// are the same around it, and, into `out`, a patch in the unified form as `diff -u` and Git write it (nothing for
/// two sides that are the same). `go_on` is asked as the work goes, and stops it by answering false.
#[allow(clippy::too_many_arguments)]
pub fn account(left: Lines, right: Lines, ops: Vec<DiffOp>, ignoring: Ignoring, context: usize, names: (&str, &str), out: &mut dyn Write, go_on: &mut dyn FnMut() -> bool) -> Result<Held, CodecError> {
    let mut held = Held { left, right, shown: Vec::new(), added: 0, removed: 0, changed: 0, same: 0 };
    held.same = ops.iter().map(|op| if let DiffOp::Equal { len, .. } = op { *len } else { 0 }).sum();
    if ops.iter().all(|op| matches!(op, DiffOp::Equal { .. })) {
        return Ok(held);
    }
    writeln!(out, "--- {}", names.0)?;
    writeln!(out, "+++ {}", names.1)?;
    let (mut old_lines, mut new_lines) = (Again::new(&held.left)?, Again::new(&held.right)?);
    let mut shown: Vec<Shown> = Vec::new();
    let push = |row: Shown, shown: &mut Vec<Shown>| -> Result<(), CodecError> {
        if shown.try_reserve(1).is_err() {
            return Err(CodecError::NoMemory);
        }
        shown.push(row);
        Ok(())
    };
    let mut behind = 0usize;
    let (mut added, mut removed, mut changed) = (0, 0, 0);
    for group in group_diff_ops(ops, context) {
        let (Some(first), Some(last)) = (group.first(), group.last()) else { continue };
        if !go_on() {
            return Err(CodecError::Stopped);
        }
        let (old_from, old_to) = (first.old_range().start, last.old_range().end);
        let (new_from, new_to) = (first.new_range().start, last.new_range().end);
        if old_from > behind {
            push(Shown::Skipped((old_from - behind) as u64), &mut shown)?;
        }
        behind = old_to;
        // A side with no line in the hunk is told by the line before it.
        let start = |lines: &Lines, from: usize, to: usize| if to > from { lines.number(from) } else if from == 0 { 0 } else { lines.number(from - 1) };
        writeln!(out, "@@ -{},{} +{},{} @@", start(&held.left, old_from, old_to), old_to - old_from, start(&held.right, new_from, new_to), new_to - new_from)?;
        for op in group {
            match op {
                DiffOp::Equal { old_index, new_index, len } => {
                    for offset in 0..len {
                        push(Shown::Same(old_index + offset, new_index + offset), &mut shown)?;
                        writeln!(out, " {}", old_lines.line(old_index + offset)?)?;
                    }
                }
                DiffOp::Delete { old_index, old_len, .. } => {
                    removed += old_len;
                    for old in old_index..old_index + old_len {
                        push(Shown::Removed(old), &mut shown)?;
                        writeln!(out, "-{}", old_lines.line(old)?)?;
                    }
                }
                DiffOp::Insert { new_index, new_len, .. } => {
                    added += new_len;
                    for new in new_index..new_index + new_len {
                        push(Shown::Added(new), &mut shown)?;
                        writeln!(out, "+{}", new_lines.line(new)?)?;
                    }
                }
                DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                    // The lines taken out come before those put in, as patches have them; what each says is kept
                    // while they are few enough to be paired by how alike they are.
                    let weigh = old_len.saturating_mul(new_len) <= MOST_WEIGHED;
                    let (mut was, mut is): (Vec<String>, Vec<String>) = (Vec::new(), Vec::new());
                    for old in old_index..old_index + old_len {
                        let line = old_lines.line(old)?;
                        writeln!(out, "-{line}")?;
                        if weigh {
                            was.push(key(&line, ignoring));
                        }
                    }
                    for new in new_index..new_index + new_len {
                        let line = new_lines.line(new)?;
                        writeln!(out, "+{line}")?;
                        if weigh {
                            is.push(key(&line, ignoring));
                        }
                    }
                    let together = old_len.min(new_len);
                    let pairs: Vec<(Option<usize>, Option<usize>)> = if weigh {
                        paired(&was, &is)
                    } else {
                        // Too many to weigh: they are paired in order, and what is left of the longer side stands alone.
                        (0..together).map(|at| (Some(at), Some(at))).chain((together..old_len).map(|at| (Some(at), None))).chain((together..new_len).map(|at| (None, Some(at)))).collect()
                    };
                    for pair in pairs {
                        match pair {
                            (Some(old), Some(new)) => {
                                changed += 1;
                                push(Shown::Changed(old_index + old, new_index + new), &mut shown)?;
                            }
                            (Some(old), None) => {
                                removed += 1;
                                push(Shown::Removed(old_index + old), &mut shown)?;
                            }
                            (None, Some(new)) => {
                                added += 1;
                                push(Shown::Added(new_index + new), &mut shown)?;
                            }
                            (None, None) => {}
                        }
                    }
                }
            }
        }
    }
    if held.left.count() > behind {
        push(Shown::Skipped((held.left.count() - behind) as u64), &mut shown)?;
    }
    drop((old_lines, new_lines));
    held.shown = shown;
    (held.added, held.removed, held.changed) = (added, removed, changed);
    Ok(held)
}

/// Two sides compared from end to end: read, compared, and made into what is shown and written.
#[allow(clippy::too_many_arguments)]
pub fn compare(left: Source, right: Source, ignoring: Ignoring, context: usize, names: (&str, &str), out: &mut dyn Write, watch: &mut dyn FnMut(u64) -> bool, go_on: &mut dyn FnMut() -> bool) -> Result<Held, CodecError> {
    let (left, old) = read(left, ignoring, watch)?;
    let size = left.source.size().unwrap_or(0);
    let (right, new) = read(right, ignoring, &mut |read| watch(size + read))?;
    let ops = differences(&old, &new, go_on)?;
    drop((old, new));
    account(left, right, ops, ignoring, context, names, out, go_on)
}

/// A JSON document as the text it is compared as: the keys of every object in order, two spaces for each level.
pub fn json_as_compared(text: &str) -> Result<(String, Node, u64), CodecError> {
    let (mut node, depth) = json_tree(text)?;
    tree::deep(depth, || tree::sort_keys(&mut node)).ok_or(CodecError::NoMemory)?;
    let mut options = Options::of(Style::Spaces(2));
    options.final_newline = true;
    let written = String::from_utf8(json_text(&node, depth, options)?).map_err(|_| CodecError::NoMemory)?;
    Ok((written, node, depth))
}

/// A key as a step of a JSON Pointer: `~` and `/` are written `~0` and `~1`.
fn step(key: &str) -> String {
    key.replace('~', "~0").replace('/', "~1")
}

fn operation(name: &str, pointer: &str, value: Option<&Node>) -> Node {
    let mut members = vec![("\"op\"".into(), Node::Scalar(quoted(name))), ("\"path\"".into(), Node::Scalar(quoted(pointer)))];
    if let Some(value) = value {
        members.push(("\"value\"".into(), value.clone()));
    }
    Node::Object(members)
}

/// What must be done to `old` to make it `new`, as the operations of a JSON Patch. Objects are compared key by key
/// (their keys are in order), arrays place by place. Call inside [`tree::deep`].
fn patch_into(old: &Node, new: &Node, pointer: &mut String, operations: &mut Vec<Node>) {
    match (old, new) {
        (Node::Object(was), Node::Object(is)) => {
            let (mut at_was, mut at_is) = (0, 0);
            while at_was < was.len() || at_is < is.len() {
                let length = pointer.len();
                // Both are in the order of their keys, as text: the smaller key is only on its side.
                let order = match (was.get(at_was), is.get(at_is)) {
                    (Some((one, _)), Some((other, _))) => one.cmp(other),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    _ => std::cmp::Ordering::Greater,
                };
                match order {
                    std::cmp::Ordering::Less => {
                        pointer.push('/');
                        pointer.push_str(&step(&unquoted(&was[at_was].0)));
                        operations.push(operation("remove", pointer, None));
                        at_was += 1;
                    }
                    std::cmp::Ordering::Greater => {
                        pointer.push('/');
                        pointer.push_str(&step(&unquoted(&is[at_is].0)));
                        operations.push(operation("add", pointer, Some(&is[at_is].1)));
                        at_is += 1;
                    }
                    std::cmp::Ordering::Equal => {
                        pointer.push('/');
                        pointer.push_str(&step(&unquoted(&was[at_was].0)));
                        patch_into(&was[at_was].1, &is[at_is].1, pointer, operations);
                        at_was += 1;
                        at_is += 1;
                    }
                }
                pointer.truncate(length);
            }
        }
        (Node::Array(was), Node::Array(is)) => {
            let length = pointer.len();
            for (index, (one, other)) in was.iter().zip(is).enumerate() {
                pointer.push_str(&format!("/{index}"));
                patch_into(one, other, pointer, operations);
                pointer.truncate(length);
            }
            // What is left of the longer one: taken out from the end back, so each place still stands when its turn comes; or put in at the end.
            for index in (is.len()..was.len()).rev() {
                operations.push(operation("remove", &format!("{pointer}/{index}"), None));
            }
            for item in is.iter().skip(was.len()) {
                operations.push(operation("add", &format!("{pointer}/-"), Some(item)));
            }
        }
        (was, is) if was == is => {}
        (_, is) => operations.push(operation("replace", pointer, Some(is))),
    }
}

/// The JSON Patch that makes `old` into `new`, both with their keys in order, written spread out; and how many
/// operations it holds.
pub fn json_patch(old: &Node, new: &Node, depth: u64) -> Result<(Vec<u8>, usize), CodecError> {
    let operations = tree::deep(depth, || {
        let mut operations = Vec::new();
        patch_into(old, new, &mut String::new(), &mut operations);
        operations
    })
    .ok_or(CodecError::NoMemory)?;
    let count = operations.len();
    let patch = Node::Array(operations);
    Ok((json_text(&patch, depth + 2, Options::of(Style::Spaces(2)))?, count))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compared(left: &str, right: &str, ignoring: Ignoring, context: usize) -> (Held, String) {
        let mut out = Vec::new();
        let held = compare(Source::Text(left.as_bytes().to_vec()), Source::Text(right.as_bytes().to_vec()), ignoring, context, ("a", "b"), &mut out, &mut |_| true, &mut || true).expect("compared");
        (held, String::from_utf8(out).expect("text"))
    }

    fn patch(left: &str, right: &str, context: usize) -> String {
        compared(left, right, Ignoring::default(), context).1
    }

    #[test]
    fn a_patch_is_written_as_diff_writes_it() {
        // What `diff -u` gives for these two files, less the dates after the names.
        assert_eq!(patch("one\ntwo\nthree\nfour\nfive\nsix\nseven\n", "one\n2\nthree\nfour\nfive\nsix\nseven\neight\n", 1), "--- a\n+++ b\n@@ -1,3 +1,3 @@\n one\n-two\n+2\n three\n@@ -7,1 +7,2 @@\n seven\n+eight\n");
        assert_eq!(patch("a\nb\nc\n", "a\nb\nc\n", 3), "");
        assert_eq!(patch("", "new\n", 3), "--- a\n+++ b\n@@ -0,0 +1,1 @@\n+new\n");
        assert_eq!(patch("x\ny\n", "y\n", 0), "--- a\n+++ b\n@@ -1,1 +0,0 @@\n-x\n");
        assert_eq!(patch("a\nb\nc\nd\n", "a\nB\nC\nd\n", 3), "--- a\n+++ b\n@@ -1,4 +1,4 @@\n a\n-b\n-c\n+B\n+C\n d\n");
        // How lines end is no difference, and a last line need not end.
        assert_eq!(patch("a\r\nb\r\n", "a\nb", 3), "");
    }

    #[test]
    fn what_is_passed_over_is_no_difference() {
        let ignoring = |case, spaces| Ignoring { case, spaces, ..Ignoring::default() };
        assert!(compared("Hello  World\n", "hello world\n", ignoring(true, true), 3).0.identical());
        assert!(!compared("Hello  World\n", "hello world\n", ignoring(true, false), 3).0.identical());
        assert!(!compared("Hello World\n", "hello world\n", ignoring(false, true), 3).0.identical());
        assert!(compared("a1, b2!\n", "a, b\n", Ignoring { numbers: true, punctuation: true, ..Ignoring::default() }, 3).0.identical());
        // Empty lines passed over: the lines keep the numbers they have in their texts.
        let (held, patch) = compared("a\n\n\nb\nc\n", "a\nb\n\nC\n", Ignoring { empty_lines: true, ..Ignoring::default() }, 0);
        assert_eq!((held.changed, held.same), (1, 2));
        assert_eq!(patch, "--- a\n+++ b\n@@ -5,1 +4,1 @@\n-c\n+C\n");
        let rows = held.rows(0, 10).expect("rows");
        assert_eq!((rows[0].kind, rows[0].skipped, rows[1].kind, rows[1].left.as_ref().map(|side| side.number), rows[1].right.as_ref().map(|side| side.number)), ("skipped", 2, "changed", Some(5), Some(4)));
    }

    #[test]
    fn a_comparison_is_kept_as_places_and_read_as_rows() {
        let lines: String = (1..=30).map(|line| format!("{line}\n")).collect();
        let (held, _) = compared(&lines, &lines.replace("15\n", "fifteen 15\n").replace("20\n", ""), Ignoring::default(), 2);
        let kinds: Vec<String> = held.rows(0, 100).expect("rows").iter().map(|row| if row.kind == "skipped" { format!("skip {}", row.skipped) } else { row.kind.to_owned() }).collect();
        assert_eq!(kinds, ["skip 12", "same", "same", "changed", "same", "same", "same", "same", "removed", "same", "same", "skip 8"]);
        assert_eq!((held.changed, held.removed, held.added, held.same, held.identical()), (1, 1, 0, 28, false));
        // A part of them, from the middle; and the words that changed, marked.
        let part = held.rows(3, 1).expect("rows");
        let right = part[0].right.as_ref().expect("a line");
        assert_eq!((part.len(), right.number), (1, 15));
        assert!(right.pieces.iter().any(|piece| piece.changed && piece.text.contains("fifteen")));
    }

    #[test]
    fn long_sides_are_held_together_by_what_both_have_once() {
        // Lines that come again and again around a few that stand once: the differences are found where they are.
        let mut left = String::new();
        let mut right = String::new();
        for block in 0..2000 {
            for side in [&mut left, &mut right] {
                side.push_str("{\n  \"kind\": \"row\",\n");
                side.push_str(&format!("  \"id\": {block},\n"));
            }
            left.push_str("  \"value\": 1\n},\n");
            right.push_str(if block % 500 == 7 { "  \"value\": 2\n},\n" } else { "  \"value\": 1\n},\n" });
            if block == 1000 {
                right.push_str("extra\n");
            }
        }
        let (held, _) = compared(&left, &right, Ignoring::default(), 1);
        assert_eq!((held.changed, held.added, held.removed), (4, 1, 0));
        assert_eq!(held.same, 2000 * 5 - 4);
    }

    #[test]
    fn the_places_both_sides_have_once_are_found_in_their_order() {
        // 5 stands once on both sides but out of order with the rest: the longest row that keeps the order leaves it out.
        assert_eq!(held_together(&[1, 2, 9, 3, 4, 5, 9], &[5, 1, 2, 3, 8, 4, 8]), vec![(0, 1), (1, 2), (3, 3), (4, 5)]);
        assert!(held_together(&[7, 7], &[7]).is_empty());
    }

    #[test]
    fn files_are_compared_from_disk_and_the_work_can_be_stopped() {
        let folder = std::env::temp_dir().join(format!("syntelab-dev-diff-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("folder");
        let (one, other) = (folder.join("one.txt"), folder.join("other.txt"));
        let lines: String = (0..50_000).map(|line| format!("line {line}\n")).collect();
        std::fs::write(&one, format!("\u{feff}{lines}")).expect("written");
        std::fs::write(&other, lines.replace("line 40000\n", "line forty thousand\n")).expect("written");
        let mut out = Vec::new();
        let mut most = 0;
        let held = compare(Source::File(one.clone()), Source::File(other.clone()), Ignoring::default(), 0, ("one", "other"), &mut out, &mut |read| { most = most.max(read); true }, &mut || true).expect("compared");
        assert_eq!((held.changed, held.same), (1, 49_999));
        assert_eq!(String::from_utf8(out).expect("text"), "--- one\n+++ other\n@@ -40001,1 +40001,1 @@\n-line 40000\n+line forty thousand\n");
        assert!(most as usize >= lines.len() * 2);
        let rows = held.rows(1, 1).expect("rows");
        assert_eq!(rows[0].left.as_ref().map(|side| side.number), Some(40_001));
        assert!(matches!(compare(Source::File(one.clone()), Source::File(other.clone()), Ignoring::default(), 0, ("", ""), &mut Vec::new(), &mut |_| false, &mut || true), Err(CodecError::Stopped)));
        assert!(matches!(compare(Source::File(one), Source::File(other), Ignoring::default(), 0, ("", ""), &mut Vec::new(), &mut |_| true, &mut || false), Err(CodecError::Stopped)));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn json_is_compared_by_what_it_says() {
        let (left, old, depth) = json_as_compared(r#"{"b":1,"a":{"y":[1,2,3],"x":"k/~"},"gone":true}"#).expect("JSON");
        let (_, new, _) = json_as_compared(r#"{"a":{"x":"k/~","y":[1,5],"a/b":null},"b":1,"new":{"n":1}}"#).expect("JSON");
        assert!(left.starts_with("{\n  \"a\": {\n    \"x\""));
        // Keys in another order are no difference.
        let (same, _, _) = json_as_compared(r#"{"gone":true, "a":{"x":"k/~","y":[1,2,3]}, "b":1}"#).expect("JSON");
        assert_eq!(left, same);
        let (patch, count) = json_patch(&old, &new, depth).expect("patch");
        let (compact, _) = crate::whole::json_tree(&String::from_utf8(patch).expect("text")).expect("JSON");
        assert_eq!(count, 5);
        assert_eq!(
            String::from_utf8(json_text(&compact, 5, Options::of(Style::Minify)).expect("text")).expect("text"),
            r#"[{"op":"add","path":"/a/a~1b","value":null},{"op":"replace","path":"/a/y/1","value":5},{"op":"remove","path":"/a/y/2"},{"op":"remove","path":"/gone"},{"op":"add","path":"/new","value":{"n":1}}]"#
        );
        assert!(matches!(json_as_compared("{\"a\": }"), Err(CodecError::Wrong(wrong)) if wrong.column == 7));
        assert_eq!(json_patch(&old, &old, depth).expect("patch").1, 0);
        // A whole document that is another kind of value is replaced at the root.
        let (patch, _) = json_patch(&old, &Node::Array(Vec::new()), depth).expect("patch");
        assert!(String::from_utf8(patch).expect("text").contains("\"path\": \"\""));
    }
}
