//! Reading the text of scanned pages (OCR) with the Tesseract engine, run
//! as a program of its own: a picture of the page goes in, the words it finds
//! come out, each with where it stands.
//!
//! The engine is not part of this program. It is looked for where it is
//! usually installed; the add-on that brings it along (see
//! `apps/pdf-organizer/addons/ocr`) is still to come.

use std::env;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use super::EngineError;

/// A word found on a picture: what it says and its box, in dots of the picture from its top-left corner.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// How sure the engine must be of a word (0 to 100) for it to be kept: below
/// this it is mostly specks and lines taken for letters.
const LEAST_CONFIDENCE: f32 = 30.0;

/// The name of the engine's program on this system.
const PROGRAM: &str = if cfg!(windows) { "tesseract.exe" } else { "tesseract" };

/// Where the engine is, when the computer has it: a place named by
/// `SYNTELAB_TESSERACT`, the folders it installs into, or anywhere programs
/// are looked for.
pub fn find_engine() -> Option<PathBuf> {
    let named = env::var_os("SYNTELAB_TESSERACT").map(PathBuf::from);
    let installed = ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"].into_iter().filter_map(env::var_os).flat_map(|folder| {
        let folder = PathBuf::from(folder);
        [folder.join("Tesseract-OCR").join(PROGRAM), folder.join("Programs").join("Tesseract-OCR").join(PROGRAM)]
    });
    let on_the_path = env::var_os("PATH").map(|path| env::split_paths(&path).map(|folder| folder.join(PROGRAM)).collect::<Vec<_>>()).unwrap_or_default();
    named.into_iter().chain(installed).chain(on_the_path).find(|candidate| candidate.is_file())
}

fn run(engine: &Path) -> Command {
    let mut command = Command::new(engine);
    command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up beside the program.
        command.creation_flags(0x0800_0000);
    }
    command
}

/// The languages the engine can read, by the names it gives them (`eng`, `ron`…).
pub fn languages(engine: &Path) -> Result<Vec<String>, EngineError> {
    let output = run(engine).arg("--list-langs").output().map_err(|error| EngineError::Failed(error.to_string()))?;
    // The first line is a heading; `osd` finds how a page lies and reads nothing.
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .skip(1)
        .map(str::trim)
        .filter(|language| !language.is_empty() && *language != "osd" && language.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '_'))
        .map(str::to_owned)
        .collect())
}

/// Reads the words of a picture (PNG data) in the given languages.
pub fn recognize(engine: &Path, picture: &[u8], languages: &[String]) -> Result<Vec<FoundWord>, EngineError> {
    // Only names the engine itself could have listed are handed to it.
    let wanted: Vec<&str> = languages.iter().map(String::as_str).filter(|language| !language.is_empty() && language.chars().all(|letter| letter.is_ascii_alphanumeric() || letter == '_')).collect();
    if wanted.is_empty() {
        return Err(EngineError::Failed("no language to read in".into()));
    }
    // The picture goes in and the words come out through the program's own pipes: nothing is written to disk.
    let mut child = run(engine)
        .args(["stdin", "stdout", "-l", &wanted.join("+"), "tsv"])
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|error| EngineError::Failed(error.to_string()))?;
    let mut input = child.stdin.take().ok_or_else(|| EngineError::Failed("the engine takes no picture".into()))?;
    let picture = picture.to_vec();
    // Written from a thread of its own: the engine may start answering before it has read everything.
    let writer = std::thread::spawn(move || input.write_all(&picture));
    let output = child.wait_with_output().map_err(|error| EngineError::Failed(error.to_string()))?;
    let _ = writer.join();
    if !output.status.success() {
        return Err(EngineError::Failed(String::from_utf8_lossy(&output.stderr).trim().to_owned()));
    }
    let mut words = words_of(&String::from_utf8_lossy(&output.stdout));
    if wanted.contains(&"ron") {
        for word in &mut words {
            word.text = romanian_letters(&word.text);
        }
    }
    Ok(words)
}

/// Romanian text with its own letters: the engine writes ș and ț the old way,
/// with a cedilla (ş, ţ), which a search typed on a Romanian keyboard does not
/// find. Done only when Romanian is read: in Turkish the cedilla is right.
fn romanian_letters(text: &str) -> String {
    text.chars()
        .map(|letter| match letter {
            'ş' => 'ș',
            'Ş' => 'Ș',
            'ţ' => 'ț',
            'Ţ' => 'Ț',
            other => other,
        })
        .collect()
}

/// The words of the engine's table (tab-separated: level, page, block,
/// paragraph, line, word, left, top, width, height, confidence, text).
fn words_of(table: &str) -> Vec<FoundWord> {
    table
        .lines()
        .filter_map(|row| {
            let cells: Vec<&str> = row.splitn(12, '\t').collect();
            let [level, _, _, _, _, _, left, top, width, height, confidence, text] = cells.as_slice() else {
                return None;
            };
            // Level 5 is a word; the others are the blocks, paragraphs and lines around it.
            if *level != "5" || text.trim().is_empty() || confidence.parse::<f32>().ok()? < LEAST_CONFIDENCE {
                return None;
            }
            let number = |cell: &str| cell.parse::<f32>().ok();
            let (width, height) = (number(width)?, number(height)?);
            (width > 0.0 && height > 0.0).then(|| FoundWord { text: text.trim().to_owned(), x: number(left).unwrap_or(0.0), y: number(top).unwrap_or(0.0), width, height })
        })
        .collect()
}

/// A box found on a page drawn turned by `turn` degrees (clockwise), as it
/// lies on the page unturned. `width` and `height` are of the unturned page;
/// boxes are `(x, y, width, height)` from the top-left corner.
pub fn unturned(found: (f32, f32, f32, f32), turn: i32, width: f32, height: f32) -> (f32, f32, f32, f32) {
    let (x, y, box_width, box_height) = found;
    match turn.rem_euclid(360) {
        90 => (y, height - x - box_width, box_height, box_width),
        180 => (width - x - box_width, height - y - box_height, box_width, box_height),
        270 => (width - y - box_height, x, box_height, box_width),
        _ => found,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_words_the_engine_is_sure_of() {
        let table = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n\
            1\t1\t0\t0\t0\t0\t0\t0\t800\t600\t-1\t\n\
            4\t1\t1\t1\t1\t0\t40\t50\t300\t30\t-1\t\n\
            5\t1\t1\t1\t1\t1\t40\t50\t120\t30\t96.5\tȘtampilă\n\
            5\t1\t1\t1\t1\t2\t170\t52\t90\t28\t91\tși semnătură\n\
            5\t1\t1\t1\t1\t3\t270\t52\t10\t28\t12\t|\n\
            5\t1\t1\t1\t1\t4\t290\t52\t10\t28\t95\t \n";
        let words = words_of(table);
        assert_eq!(words.len(), 2, "the speck and the blank are left out");
        assert_eq!(words[0], FoundWord { text: "Ștampilă".into(), x: 40.0, y: 50.0, width: 120.0, height: 30.0 });
        // A tab never ends a word, but text may hold spaces.
        assert_eq!(words[1].text, "și semnătură");
        assert!(words_of("nothing like a table").is_empty());
    }

    #[test]
    fn writes_romanian_with_its_own_letters() {
        assert_eq!(romanian_letters("Operaţiuni şi corespondenţă, Ştampilă Ţară"), "Operațiuni și corespondență, Ștampilă Țară");
        // Letters that are already right, and those of other languages, stay.
        assert_eq!(romanian_letters("și țară, ça va"), "și țară, ça va");
    }

    #[test]
    fn puts_a_box_back_on_the_unturned_page() {
        // A page 600 wide and 800 tall. Drawn a quarter turned it is 800 wide: its top-left corner shows at the top right.
        assert_eq!(unturned((10.0, 20.0, 100.0, 30.0), 0, 600.0, 800.0), (10.0, 20.0, 100.0, 30.0));
        assert_eq!(unturned((700.0, 10.0, 30.0, 100.0), 90, 600.0, 800.0), (10.0, 70.0, 100.0, 30.0));
        assert_eq!(unturned((490.0, 750.0, 100.0, 30.0), 180, 600.0, 800.0), (10.0, 20.0, 100.0, 30.0));
        assert_eq!(unturned((20.0, 490.0, 30.0, 100.0), 270, 600.0, 800.0), (10.0, 20.0, 100.0, 30.0));
    }
}
