//! Many files worked on in one run, one after another.
//!
//! A tool gives what it does to one file (read from here, write to there);
//! this module finds the files, decides where each result goes, and keeps
//! going when one of them is wrong. There is no most for how many files or
//! how large: each is read from disk as it comes.
//!
//! Where a result goes:
//! - beside the file it came from, under a name made from its own: a mark before the ending (`data.json` →
//!   `data.formatted.json`), an ending more (`data.json` → `data.json.gz`), or an ending less;
//! - into another folder, under the same folders the file was found under;
//! - over the file itself: written beside it first, and put in its place only once it is whole;
//! - nowhere on disk: kept, to be shown beside its file (digests, which are short whatever the file is).
//!
//! A result never lands on a file that is already there unless that was
//! asked for, and never on the file it is read from by any way but the third.

use std::fs::File;
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;

/// A file to work on, and where it was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Found {
    pub path: PathBuf,
    /// The folder that was chosen and under which the file was found; none for a file chosen by itself.
    pub root: Option<PathBuf>,
    pub size: u64,
}

/// The files under what was chosen: a file is itself, a folder is the files in it (and under it, when `deep`)
/// whose ending is one of `endings` (without the dot, in small letters; none means every file). In the order of
/// their names, so two runs go the same way.
pub fn find(chosen: &[PathBuf], deep: bool, endings: &[String]) -> io::Result<Vec<Found>> {
    let mut found = Vec::new();
    for path in chosen {
        let known = std::fs::metadata(path)?;
        if known.is_dir() {
            walk(path, path, deep, endings, &mut found)?;
        } else {
            found.push(Found { path: path.clone(), root: None, size: known.len() });
        }
    }
    Ok(found)
}

fn wanted(path: &Path, endings: &[String]) -> bool {
    if endings.is_empty() {
        return true;
    }
    path.extension().and_then(|ending| ending.to_str()).is_some_and(|ending| endings.iter().any(|known| known.eq_ignore_ascii_case(ending)))
}

fn walk(root: &Path, folder: &Path, deep: bool, endings: &[String], found: &mut Vec<Found>) -> io::Result<()> {
    let mut entries: Vec<_> = std::fs::read_dir(folder)?.collect::<Result<_, _>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    // Folders that are open are kept in a list, not on the stack of calls: how deep folders go has no most either.
    let mut folders = Vec::new();
    for entry in entries {
        let path = entry.path();
        // What a link points to is not followed: a folder that leads back into itself would never end.
        let kind = entry.file_type()?;
        if kind.is_dir() {
            folders.push(path);
        } else if kind.is_file() && wanted(&path, endings) {
            found.push(Found { size: entry.metadata()?.len(), path, root: Some(root.to_path_buf()) });
        }
    }
    if deep {
        for inner in folders {
            // A folder that cannot be read (no right to it) is passed over; the others are still worked on.
            walk(root, &inner, deep, endings, found).or_else(|error| if error.kind() == io::ErrorKind::PermissionDenied { Ok(()) } else { Err(error) })?;
        }
    }
    Ok(())
}

/// How the name of a result is made from the name of the file it came from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Rename {
    /// A mark before the ending: `data.json` and `min` give `data.min.json`.
    Mark(String),
    /// An ending more: `data.json` and `gz` give `data.json.gz`.
    Append(String),
    /// Another ending: `data.yaml` and `json` give `data.json`; a file with no ending gets this one.
    Ending(String),
    /// An ending less: `data.json.gz` and `gz` give `data.json`. A file that does not end so gets the mark instead.
    Strip { ending: String, otherwise: String },
}

/// Where the results go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    /// Nothing is written: the files are only read.
    Nowhere,
    /// Beside each file, under a name made from its own.
    Beside { rename: Rename },
    /// Into this folder, under the folders each file was found under; under its own name, or one made from it.
    Folder { folder: PathBuf, rename: Option<Rename> },
    /// Over each file.
    Replace,
    /// Nothing is written: the result of each file is kept, to be shown beside it. For results that are short
    /// whatever the file is (digests); of a longer one only the beginning is kept ([`SHOWN_MOST`]).
    Shown,
}

/// How much of a result that is shown is kept, in bytes.
pub const SHOWN_MOST: usize = 64 * 1024;

/// What a result that is shown is written to: its beginning is kept, the rest only counted.
#[derive(Default)]
struct Kept(Vec<u8>);

impl Write for Kept {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let room = SHOWN_MOST.saturating_sub(self.0.len()).min(bytes.len());
        self.0.extend_from_slice(&bytes[..room]);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// The name of a file with a mark before its ending: `data.json` and `min` give `data.min.json`.
fn marked(path: &Path, mark: &str) -> PathBuf {
    let stem = path.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let name = match path.extension() {
        Some(ending) => format!("{stem}.{mark}.{}", ending.to_string_lossy()),
        None => format!("{stem}.{mark}"),
    };
    path.with_file_name(name)
}

/// The path of a file under the name its result gets.
fn renamed(path: &Path, rename: &Rename) -> PathBuf {
    let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
    match rename {
        Rename::Mark(mark) => marked(path, mark),
        Rename::Append(ending) => path.with_file_name(format!("{name}.{ending}")),
        Rename::Ending(ending) => path.with_extension(ending),
        Rename::Strip { ending, otherwise } => {
            let cut = name.len().saturating_sub(ending.len() + 1);
            // Only a whole ending is taken off, and never the whole name.
            if cut > 0 && name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(&format!(".{ending}")) {
                path.with_file_name(&name[..cut])
            } else {
                marked(path, otherwise)
            }
        }
    }
}

/// Where the result of one file is written; none when nothing is.
pub fn place(found: &Found, target: &Target) -> Option<PathBuf> {
    match target {
        Target::Nowhere | Target::Shown => None,
        Target::Beside { rename } => Some(renamed(&found.path, rename)),
        Target::Folder { folder, rename } => {
            let under = found.root.as_deref().and_then(|root| found.path.strip_prefix(root).ok());
            let placed = match under {
                Some(under) => folder.join(under),
                None => folder.join(found.path.file_name().unwrap_or_default()),
            };
            Some(match rename {
                Some(rename) => renamed(&placed, rename),
                None => placed,
            })
        }
        Target::Replace => Some(found.path.clone()),
    }
}

/// How one file came out.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Done,
    /// The file is not what the tool takes: why (a code of the tool), and where in the file.
    Wrong { code: &'static str, line: u64, column: u64 },
    /// Not worked on: `exists` (a file is already where the result would go), `same-file`, `stopped`.
    Skipped { code: &'static str },
    /// The file could not be read or its result written: a code of `files`, and what the system said.
    Failed { code: &'static str, detail: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub path: PathBuf,
    /// Where its result was written.
    pub out: Option<PathBuf>,
    /// Its result, when that is shown and not written ([`Target::Shown`]).
    pub said: Option<String>,
    pub outcome: Outcome,
    pub bytes_in: u64,
    pub bytes_out: u64,
    pub ms: u64,
}

/// What working on one file may end in, other than well.
pub enum ItemError {
    Wrong { code: &'static str, line: u64, column: u64 },
    Io(io::Error),
    Stopped,
    NoMemory,
}

/// What the one who runs the files is told as they go: a file starts, bytes of it were read. False from `read` stops the run.
pub trait Watch {
    fn file(&mut self, index: usize);
    fn read(&mut self, bytes_in_all: u64) -> bool;
}

fn io_code(error: &io::Error, otherwise: &'static str) -> &'static str {
    match error.kind() {
        io::ErrorKind::NotFound => "not-found",
        io::ErrorKind::PermissionDenied => "no-access",
        io::ErrorKind::StorageFull => "disk-full",
        io::ErrorKind::OutOfMemory => "no-memory",
        _ => otherwise,
    }
}

fn failed(error: &io::Error, otherwise: &'static str) -> Outcome {
    Outcome::Failed { code: io_code(error, otherwise), detail: error.to_string() }
}

/// Runs `work` on each file in turn. `work` reads the file it is given and writes its result to what it is given
/// (which goes nowhere when `target` is [`Target::Nowhere`]); it is told through its last argument how many bytes
/// of this file it has read, and stops when that answers false. It returns how many bytes it read and wrote.
///
/// One file that is wrong, or cannot be read, does not stop the others. Once the run is stopped, the file that was
/// being worked on and those after it are skipped; what was written of a result that did not come to its end is
/// taken away.
pub fn run<W: Watch>(files: &[Found], target: &Target, overwrite: bool, watch: &mut W, work: &mut dyn FnMut(File, &mut (dyn Write + Send), &mut dyn FnMut(u64) -> bool) -> Result<(u64, u64), ItemError>) -> Vec<Item> {
    let mut items = Vec::with_capacity(files.len().min(4096));
    let mut before = 0u64;
    let mut stopped = false;
    for (index, found) in files.iter().enumerate() {
        let started = Instant::now();
        let out = place(found, target);
        let mut item = Item { path: found.path.clone(), out: None, said: None, outcome: Outcome::Done, bytes_in: 0, bytes_out: 0, ms: 0 };
        if stopped {
            item.outcome = Outcome::Skipped { code: "stopped" };
            items.push(item);
            continue;
        }
        watch.file(index);
        item.outcome = one(found, target, out.as_deref(), overwrite, &mut item, &mut |read| watch.read(before + read), work);
        if item.outcome == (Outcome::Skipped { code: "stopped" }) {
            stopped = true;
        }
        before += found.size;
        // A file is counted as read whole once it is done with, however it ended.
        stopped = !watch.read(before) || stopped;
        item.ms = started.elapsed().as_millis() as u64;
        items.push(item);
    }
    items
}

fn one(found: &Found, target: &Target, out: Option<&Path>, overwrite: bool, item: &mut Item, read: &mut dyn FnMut(u64) -> bool, work: &mut dyn FnMut(File, &mut (dyn Write + Send), &mut dyn FnMut(u64) -> bool) -> Result<(u64, u64), ItemError>) -> Outcome {
    let replace = *target == Target::Replace;
    // Over the file itself: the result is written beside it under a name of its own, and takes its place once whole.
    let written_to = match out {
        Some(out) if replace => Some(out.with_file_name(format!("{}.syntelab-{}.tmp", out.file_name().unwrap_or_default().to_string_lossy(), std::process::id()))),
        Some(out) => {
            if crate::files::same_file(&found.path, out) {
                return Outcome::Skipped { code: "same-file" };
            }
            if !overwrite && out.exists() {
                return Outcome::Skipped { code: "exists" };
            }
            Some(out.to_path_buf())
        }
        None => None,
    };
    let input = match File::open(&found.path) {
        Ok(input) => input,
        Err(error) => return failed(&error, "cannot-open"),
    };
    let done = match &written_to {
        Some(path) => {
            if let Some(folder) = path.parent() {
                if let Err(error) = std::fs::create_dir_all(folder) {
                    return failed(&error, "cannot-save");
                }
            }
            match File::create(path) {
                Ok(output) => {
                    let mut output = BufWriter::new(output);
                    work(input, &mut output, read).and_then(|sizes| output.flush().map(|()| sizes).map_err(ItemError::Io))
                }
                Err(error) => return failed(&error, "cannot-save"),
            }
        }
        None if *target == Target::Shown => {
            let mut kept = Kept::default();
            let done = work(input, &mut kept, read);
            if done.is_ok() {
                item.said = Some(String::from_utf8_lossy(&kept.0).trim_end().to_owned());
            }
            done
        }
        None => work(input, &mut io::sink(), read),
    };
    match done {
        Ok((bytes_in, bytes_out)) => {
            item.bytes_in = bytes_in;
            item.bytes_out = bytes_out;
            if let (Some(temporary), Some(out), true) = (&written_to, out, replace) {
                if let Err(error) = std::fs::rename(temporary, out) {
                    std::fs::remove_file(temporary).ok();
                    return failed(&error, "cannot-save");
                }
            }
            item.out = out.map(Path::to_path_buf);
            Outcome::Done
        }
        Err(error) => {
            if let Some(path) = &written_to {
                std::fs::remove_file(path).ok();
            }
            match error {
                ItemError::Wrong { code, line, column } => Outcome::Wrong { code, line, column },
                ItemError::Stopped => Outcome::Skipped { code: "stopped" },
                ItemError::NoMemory => Outcome::Failed { code: "no-memory", detail: "no memory for the file".into() },
                ItemError::Io(error) => failed(&error, "failed"),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Quiet;
    impl Watch for Quiet {
        fn file(&mut self, _index: usize) {}
        fn read(&mut self, _bytes: u64) -> bool {
            true
        }
    }

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!("dev-batch-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&folder).ok();
        std::fs::create_dir_all(folder.join("in/deep")).expect("a folder");
        std::fs::write(folder.join("in/b.json"), "bb").expect("written");
        std::fs::write(folder.join("in/a.json"), "a").expect("written");
        std::fs::write(folder.join("in/notes.txt"), "no").expect("written");
        std::fs::write(folder.join("in/deep/c.JSON"), "ccc").expect("written");
        folder
    }

    /// Writes the file again in capital letters; a file that holds `bb` is "wrong".
    fn shout(mut input: File, output: &mut (dyn Write + Send), read: &mut dyn FnMut(u64) -> bool) -> Result<(u64, u64), ItemError> {
        let mut text = String::new();
        io::Read::read_to_string(&mut input, &mut text).map_err(ItemError::Io)?;
        if text == "bb" {
            return Err(ItemError::Wrong { code: "doubled", line: 1, column: 2 });
        }
        if !read(text.len() as u64) {
            return Err(ItemError::Stopped);
        }
        output.write_all(text.to_uppercase().as_bytes()).map_err(ItemError::Io)?;
        Ok((text.len() as u64, text.len() as u64))
    }

    fn names(found: &[Found], under: &Path) -> Vec<String> {
        found.iter().map(|file| file.path.strip_prefix(under).expect("under").to_string_lossy().replace('\\', "/")).collect()
    }

    #[test]
    fn finds_the_files_of_a_folder_by_their_ending() {
        let folder = folder("find");
        let json = vec!["json".to_owned()];
        let chosen = vec![folder.join("in")];
        assert_eq!(names(&find(&chosen, true, &json).expect("found"), &folder), ["in/a.json", "in/b.json", "in/deep/c.JSON"]);
        assert_eq!(names(&find(&chosen, false, &json).expect("found"), &folder), ["in/a.json", "in/b.json"]);
        assert_eq!(find(&chosen, true, &[]).expect("found").len(), 4);
        // A file chosen by itself is taken whatever its ending.
        let one = find(&[folder.join("in/notes.txt")], true, &json).expect("found");
        assert_eq!((one.len(), one[0].root.clone(), one[0].size), (1, None, 2));
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn results_go_beside_the_files_and_one_wrong_file_stops_nothing() {
        let folder = folder("beside");
        let files = find(&[folder.join("in")], true, &["json".to_owned()]).expect("found");
        let target = Target::Beside { rename: Rename::Mark("loud".into()) };
        let items = run(&files, &target, false, &mut Quiet, &mut shout);
        assert_eq!(items.iter().map(|item| item.outcome.clone()).collect::<Vec<_>>(), [Outcome::Done, Outcome::Wrong { code: "doubled", line: 1, column: 2 }, Outcome::Done]);
        assert_eq!(std::fs::read_to_string(folder.join("in/a.loud.json")).expect("read"), "A");
        assert_eq!(std::fs::read_to_string(folder.join("in/deep/c.loud.JSON")).expect("read"), "CCC");
        assert!(!folder.join("in/b.loud.json").exists());
        // Run again: what is there is not written over, unless asked.
        let again = run(&files, &target, false, &mut Quiet, &mut shout);
        assert_eq!(again[0].outcome, Outcome::Skipped { code: "exists" });
        assert_eq!(run(&files, &target, true, &mut Quiet, &mut shout)[0].outcome, Outcome::Done);
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn results_go_into_a_folder_under_the_same_folders() {
        let folder = folder("folder");
        let mut files = find(&[folder.join("in")], true, &["json".to_owned()]).expect("found");
        files.extend(find(&[folder.join("in/notes.txt")], true, &[]).expect("found"));
        let items = run(&files, &Target::Folder { folder: folder.join("out"), rename: None }, false, &mut Quiet, &mut shout);
        assert_eq!(std::fs::read_to_string(folder.join("out/deep/c.JSON")).expect("read"), "CCC");
        assert_eq!(std::fs::read_to_string(folder.join("out/notes.txt")).expect("read"), "NO");
        assert_eq!(items[0].out, Some(folder.join("out/a.json")));
        // Into the folder the files are in: a result would land on its own file, and is not written.
        let onto = run(&files[..1], &Target::Folder { folder: folder.join("in"), rename: None }, true, &mut Quiet, &mut shout);
        assert_eq!(onto[0].outcome, Outcome::Skipped { code: "same-file" });
        assert_eq!(std::fs::read_to_string(folder.join("in/a.json")).expect("read"), "a");
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn a_result_is_named_after_its_file() {
        let found = |name: &str| Found { path: PathBuf::from("in").join(name), root: None, size: 0 };
        let beside = |name: &str, rename: Rename| place(&found(name), &Target::Beside { rename }).expect("a place").file_name().expect("a name").to_string_lossy().into_owned();
        let strip = || Rename::Strip { ending: "gz".into(), otherwise: "opened".into() };
        assert_eq!(beside("data.json", Rename::Mark("min".into())), "data.min.json");
        assert_eq!(beside("data.json", Rename::Append("gz".into())), "data.json.gz");
        assert_eq!(beside("data.v2.yaml", Rename::Ending("json".into())), "data.v2.json");
        assert_eq!(beside("data", Rename::Ending("json".into())), "data.json");
        assert_eq!(beside("data.json.GZ", strip()), "data.json");
        assert_eq!(beside("data.bin", strip()), "data.opened.bin");
        assert_eq!(beside(".gz", strip()), ".gz.opened");
        let into = place(&found("data.json"), &Target::Folder { folder: PathBuf::from("out"), rename: Some(Rename::Append("b64".into())) });
        assert_eq!(into, Some(PathBuf::from("out").join("data.json.b64")));
    }

    #[test]
    fn a_file_is_replaced_only_by_a_whole_result() {
        let folder = folder("replace");
        let files = find(&[folder.join("in")], false, &["json".to_owned()]).expect("found");
        let items = run(&files, &Target::Replace, false, &mut Quiet, &mut shout);
        assert_eq!(std::fs::read_to_string(folder.join("in/a.json")).expect("read"), "A");
        // The wrong one is as it was, and nothing is left beside it.
        assert_eq!(std::fs::read_to_string(folder.join("in/b.json")).expect("read"), "bb");
        assert_eq!(items[1].out, None);
        assert_eq!(std::fs::read_dir(folder.join("in")).expect("listed").count(), 4);
        std::fs::remove_dir_all(folder).ok();
    }

    #[test]
    fn nothing_is_written_when_the_files_are_only_read_and_a_stop_skips_the_rest() {
        let folder = folder("stop");
        let files = find(&[folder.join("in")], true, &["json".to_owned()]).expect("found");
        let checked = run(&files, &Target::Nowhere, false, &mut Quiet, &mut shout);
        assert_eq!((checked[0].outcome.clone(), checked[0].out.clone(), checked[0].bytes_in), (Outcome::Done, None, 1));
        assert_eq!(std::fs::read_dir(folder.join("in")).expect("listed").count(), 4);

        struct StopsAtOnce;
        impl Watch for StopsAtOnce {
            fn file(&mut self, _index: usize) {}
            fn read(&mut self, _bytes: u64) -> bool {
                false
            }
        }
        let stopped = run(&files, &Target::Beside { rename: Rename::Mark("loud".into()) }, false, &mut StopsAtOnce, &mut shout);
        assert!(stopped.iter().all(|item| item.outcome == Outcome::Skipped { code: "stopped" }));
        assert!(!folder.join("in/a.loud.json").exists());
        std::fs::remove_dir_all(folder).ok();
    }
}
