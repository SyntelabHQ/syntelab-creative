//! Finding and replacing in the files of a folder.
//!
//! Finding only reads. Replacing writes each file back in the encoding and
//! with the line endings it had, and only the files it is told to: the user
//! sees every match first and chooses.

use std::fs;
use std::path::{Path, PathBuf};

use crate::files::{self, FileError, WriteAs};
use crate::ops::replace::{self, Replacement};
use crate::ops::OpError;

/// A file larger than this is passed over: it is not a text people write (and it is said that it was).
pub const LARGEST_FILE: u64 = 64 * 1024 * 1024;
/// How far under the folder files are looked for.
const DEEPEST: usize = 24;
/// Folders that hold what programs make, not what people write.
const NOT_LOOKED_IN: &[&str] = &["node_modules", "target", "dist", "build", "__pycache__"];

/// What to look through.
#[derive(Debug, Clone, Default)]
pub struct Scope {
    /// The endings of the files to look in, without the dot, any case; empty for every file that is text.
    pub endings: Vec<String>,
    /// Look also in folders and files whose name starts with a dot, and in the folders programs fill.
    pub everything: bool,
    /// The most matches gathered; the search stops there and says so.
    pub most_matches: usize,
}

/// One place where the pattern was found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    /// The number of the line, from 1.
    pub line: usize,
    /// The line it is on, cut to a length that can be shown.
    pub text: String,
    /// Where the match is in `text`, in characters: from, and to (not included).
    pub from: usize,
    pub to: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMatches {
    pub path: PathBuf,
    /// The folders between the searched one and the file, joined with `/`.
    pub under: String,
    /// How many times the pattern is in the file (all of them, also those not listed).
    pub count: usize,
    pub matches: Vec<Match>,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Found {
    pub files: Vec<FileMatches>,
    /// Files looked in.
    pub searched: usize,
    /// Files passed over: not text, too large, or not readable.
    pub skipped: usize,
    /// The search stopped at `most_matches`: there may be more.
    pub stopped: bool,
}

#[derive(Debug)]
pub enum FolderError {
    /// The folder itself cannot be read.
    Folder(std::io::Error),
    Pattern(OpError),
}

/// The most characters of a line shown around a match.
const SHOWN_AROUND: usize = 120;
/// The most matches listed for one file; the rest are counted.
const MOST_PER_FILE: usize = 200;

/// The files of a folder and of those under it that the scope names, in the order of their names, each with the folders it lies under.
pub fn text_files(folder: &Path, scope: &Scope) -> Result<Vec<(PathBuf, String)>, FolderError> {
    fn walk(folder: &Path, under: &str, depth: usize, scope: &Scope, found: &mut Vec<(PathBuf, String)>) {
        let Ok(entries) = fs::read_dir(folder) else {
            return;
        };
        let mut entries: Vec<PathBuf> = entries.filter_map(|entry| entry.ok().map(|entry| entry.path())).collect();
        entries.sort_by_key(|path| path.file_name().map(|name| name.to_string_lossy().to_lowercase()));
        let (folders, files): (Vec<PathBuf>, Vec<PathBuf>) = entries.into_iter().partition(|path| path.is_dir());
        let hidden = |path: &Path| path.file_name().and_then(|name| name.to_str()).is_none_or(|name| name.starts_with('.'));
        for path in files {
            if !scope.everything && hidden(&path) {
                continue;
            }
            let ending = path.extension().and_then(|ending| ending.to_str()).unwrap_or("");
            if scope.endings.is_empty() || scope.endings.iter().any(|wanted| wanted.eq_ignore_ascii_case(ending)) {
                found.push((path, under.to_owned()));
            }
        }
        if depth >= DEEPEST {
            return;
        }
        for path in folders {
            let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
                continue;
            };
            if !scope.everything && (name.starts_with('.') || NOT_LOOKED_IN.contains(&name)) {
                continue;
            }
            let deeper = if under.is_empty() { name.to_owned() } else { format!("{under}/{name}") };
            walk(&path, &deeper, depth + 1, scope, found);
        }
    }
    fs::read_dir(folder).map_err(FolderError::Folder)?;
    let mut found = Vec::new();
    walk(folder, "", 0, scope, &mut found);
    Ok(found)
}

/// A line with a match in it, cut around the match when it is long.
pub(crate) fn shown(line: &str, from_byte: usize, to_byte: usize) -> (String, usize, usize) {
    let before: Vec<char> = line[..from_byte].chars().collect();
    let matched: Vec<char> = line[from_byte..to_byte].chars().take(SHOWN_AROUND * 2).collect();
    let after: Vec<char> = line[to_byte..].chars().take(SHOWN_AROUND).collect();
    let kept_before = &before[before.len().saturating_sub(SHOWN_AROUND)..];
    let cut_start = kept_before.len() < before.len();
    let cut_end = line[to_byte..].chars().count() > after.len();
    let mut text = String::new();
    if cut_start {
        text.push('…');
    }
    text.extend(kept_before);
    let from = text.chars().count();
    text.extend(&matched);
    let to = from + matched.len();
    text.extend(&after);
    if cut_end {
        text.push('…');
    }
    (text, from, to)
}

/// Looks for a pattern in the text files of a folder and of those under it.
pub fn find_in_folder(folder: &Path, what: &Replacement, scope: &Scope) -> Result<Found, FolderError> {
    let pattern = replace::pattern(what).map_err(FolderError::Pattern)?;
    let mut found = Found::default();
    let mut gathered = 0;
    for (path, under) in text_files(folder, scope)? {
        if found.stopped {
            break;
        }
        let small_enough = fs::metadata(&path).map(|file| file.len() <= LARGEST_FILE).unwrap_or(false);
        let Some(read) = small_enough.then(|| files::read_text(&path, None).ok()).flatten() else {
            found.skipped += 1;
            continue;
        };
        found.searched += 1;
        let mut file = FileMatches { path, under, count: 0, matches: Vec::new() };
        // The start of each line, to say on which one a match is.
        let line_starts: Vec<usize> = std::iter::once(0).chain(read.text.match_indices('\n').map(|(at, _)| at + 1)).collect();
        for matched in pattern.find_iter(&read.text) {
            file.count += 1;
            if file.matches.len() >= MOST_PER_FILE {
                continue;
            }
            if gathered >= scope.most_matches {
                found.stopped = true;
                break;
            }
            let line_index = line_starts.partition_point(|start| *start <= matched.start()) - 1;
            let line_start = line_starts[line_index];
            let line_end = read.text[line_start..].find('\n').map_or(read.text.len(), |end| line_start + end);
            // A match that runs over several lines is shown on its first.
            let to = matched.end().min(line_end).max(matched.start());
            let (text, from, to) = shown(&read.text[line_start..line_end], matched.start() - line_start, to - line_start);
            file.matches.push(Match { line: line_index + 1, text, from, to });
            gathered += 1;
        }
        if file.count > 0 {
            found.files.push(file);
        }
    }
    Ok(found)
}

/// How replacing went in one file.
#[derive(Debug, PartialEq, Eq)]
pub enum Replaced {
    /// Written, with this many places changed.
    Done(usize),
    /// Nothing to change in it any more (it was changed since it was searched).
    Unchanged,
    /// Not written; the code says why (`cannot-open`, `not-text`, `cannot-encode`, `cannot-save`).
    Failed(&'static str),
}

/// Replaces in the files named, each written back as it was kept. A file that fails is left as it was.
pub fn replace_in_files(paths: &[PathBuf], what: &Replacement) -> Result<Vec<(PathBuf, Replaced)>, OpError> {
    replace::pattern(what)?;
    Ok(paths
        .iter()
        .map(|path| {
            let outcome = match files::read_text(path, None) {
                Err(FileError::NotText) => Replaced::Failed("not-text"),
                Err(_) => Replaced::Failed("cannot-open"),
                Ok(read) => match replace::replace(&read.text, what) {
                    Err(_) => Replaced::Failed("cannot-save"),
                    Ok(outcome) if outcome.changed == 0 || outcome.text == read.text => Replaced::Unchanged,
                    Ok(outcome) => match files::write_text(path, &outcome.text, WriteAs { encoding: read.encoding, mark: read.mark, line_ending: read.line_ending }) {
                        Ok(()) => Replaced::Done(outcome.changed),
                        Err(FileError::CannotEncode(_)) => Replaced::Failed("cannot-encode"),
                        Err(_) => Replaced::Failed("cannot-save"),
                    },
                },
            };
            (path.clone(), outcome)
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("scribe-folders-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("notes/old")).expect("folders");
        fs::create_dir_all(dir.join(".git")).expect("folders");
        fs::create_dir_all(dir.join("node_modules/x")).expect("folders");
        fs::write(dir.join("a.txt"), "The cat sat.\nNo match here.\nA Cat again, cat!\n").expect("file");
        fs::write(dir.join("notes/b.md"), "cat\r\n").expect("file");
        fs::write(dir.join("notes/old/c.txt"), files::encode("pisică și cat", WriteAs { encoding: "ISO-8859-16", mark: false, line_ending: files::LineEnding::Lf }).expect("encodes")).expect("file");
        fs::write(dir.join("picture.bin"), [0_u8, 1, 2, 0, 0, 9, 0, 0, 0, 3]).expect("file");
        fs::write(dir.join(".git/config"), "cat").expect("file");
        fs::write(dir.join("node_modules/x/index.js"), "cat").expect("file");
        dir
    }

    fn cat() -> Replacement {
        Replacement { find: "cat".to_owned(), with: "dog".to_owned(), regex: false, case_sensitive: false, whole_word: true, keep_case: true, fill: false, today: String::new(), now: String::new() }
    }

    fn scope() -> Scope {
        Scope { endings: Vec::new(), everything: false, most_matches: 1000 }
    }

    #[test]
    fn finds_in_the_files_of_a_folder_and_under_it() {
        let dir = folder("find");
        let found = find_in_folder(&dir, &cat(), &scope()).expect("searches");
        let said: Vec<(String, &str, usize)> = found.files.iter().map(|file| (file.path.file_name().unwrap().to_string_lossy().into_owned(), file.under.as_str(), file.count)).collect();
        assert_eq!(said, [("a.txt".to_owned(), "", 3), ("b.md".to_owned(), "notes", 1), ("c.txt".to_owned(), "notes/old", 1)]);
        // What is not text is passed over and counted; hidden folders and those programs fill are not looked in.
        assert_eq!((found.searched, found.skipped, found.stopped), (3, 1, false));
        let first = &found.files[0].matches;
        assert_eq!((first[0].line, first[0].text.as_str(), first[0].from, first[0].to), (1, "The cat sat.", 4, 7));
        assert_eq!((first[1].line, first[2].line), (3, 3));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn looks_only_in_the_kinds_of_files_asked_for() {
        let dir = folder("kinds");
        let only_md = find_in_folder(&dir, &cat(), &Scope { endings: vec!["MD".to_owned()], ..scope() }).expect("searches");
        assert_eq!(only_md.files.len(), 1);
        let everything = find_in_folder(&dir, &cat(), &Scope { everything: true, ..scope() }).expect("searches");
        assert_eq!(everything.files.len(), 5);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stops_at_the_most_matches_asked_for_and_says_so() {
        let dir = folder("stop");
        let found = find_in_folder(&dir, &cat(), &Scope { most_matches: 2, ..scope() }).expect("searches");
        assert!(found.stopped);
        assert_eq!(found.files.iter().map(|file| file.matches.len()).sum::<usize>(), 2);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn cuts_a_long_line_around_the_match() {
        let line = format!("{}needle{}", "a".repeat(500), "b".repeat(500));
        let (text, from, to) = shown(&line, 500, 506);
        assert!(text.starts_with('…') && text.ends_with('…'));
        assert_eq!(text.chars().skip(from).take(to - from).collect::<String>(), "needle");
        assert!(text.chars().count() < 260);
    }

    #[test]
    fn replaces_in_the_files_named_and_keeps_how_they_were_written() {
        let dir = folder("replace");
        let done = replace_in_files(&[dir.join("a.txt"), dir.join("notes/b.md"), dir.join("notes/old/c.txt"), dir.join("picture.bin"), dir.join("none.txt")], &cat()).expect("replaces");
        let said: Vec<&Replaced> = done.iter().map(|(_, outcome)| outcome).collect();
        assert_eq!(said, [&Replaced::Done(3), &Replaced::Done(1), &Replaced::Done(1), &Replaced::Failed("not-text"), &Replaced::Failed("cannot-open")]);
        assert_eq!(fs::read_to_string(dir.join("a.txt")).expect("reads"), "The dog sat.\nNo match here.\nA Dog again, dog!\n");
        // Windows line endings and an old encoding come back as they were.
        assert_eq!(fs::read(dir.join("notes/b.md")).expect("reads"), b"dog\r\n");
        let old = files::read_text(&dir.join("notes/old/c.txt"), Some("ISO-8859-16")).expect("reads");
        assert_eq!(old.text, "pisică și dog");
        // Asked again, nothing is left to change.
        assert_eq!(replace_in_files(&[dir.join("a.txt")], &cat()).expect("replaces")[0].1, Replaced::Unchanged);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn refuses_a_pattern_that_is_not_valid_before_touching_any_file() {
        let bad = Replacement { find: "(".to_owned(), regex: true, ..cat() };
        assert!(matches!(find_in_folder(Path::new("."), &bad, &scope()), Err(FolderError::Pattern(OpError::BadPattern(_)))));
        assert!(replace_in_files(&[], &bad).is_err());
        assert!(matches!(find_in_folder(Path::new("no such folder"), &cat(), &scope()), Err(FolderError::Folder(_))));
    }
}
