use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};

use crate::kind::OfficeKind;
use crate::run::run;
use crate::BridgeError;

// What each Office program is told, in PowerShell: open the file read-only
// and without a window, export a PDF, close, quit. The two file names come in
// through the environment, so nothing in them can be read as a command.

const WORD: &str = r"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Word.Application
try {
  $app.Visible = $false
  $app.DisplayAlerts = 0
  $document = $app.Documents.Open($env:SYNTELAB_SOURCE, $false, $true)
  $document.ExportAsFixedFormat($env:SYNTELAB_TARGET, 17)
  $document.Close($false)
} finally { $app.Quit() }
";

const EXCEL: &str = r"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Excel.Application
try {
  $app.Visible = $false
  $app.DisplayAlerts = $false
  $book = $app.Workbooks.Open($env:SYNTELAB_SOURCE, 0, $true)
  $book.ExportAsFixedFormat(0, $env:SYNTELAB_TARGET)
  $book.Close($false)
} finally { $app.Quit() }
";

const POWERPOINT: &str = r"
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  $slides = $app.Presentations.Open($env:SYNTELAB_SOURCE, $true, $false, $false)
  $slides.SaveAs($env:SYNTELAB_TARGET, 32)
  $slides.Close()
} finally { $app.Quit() }
";

/// Has the Office program for this kind of document write the PDF.
pub(crate) fn convert(kind: OfficeKind, source: &Path, destination: &Path) -> Result<(), BridgeError> {
    let (script, program) = match kind {
        OfficeKind::Text => (WORD, "WINWORD.EXE"),
        OfficeKind::Sheet => (EXCEL, "EXCEL.EXE"),
        OfficeKind::Slides => (POWERPOINT, "POWERPNT.EXE"),
    };
    // The copies the user has open themselves, to tell ours apart from them later.
    let open_before = running(program);
    // Office cannot write everywhere (an Office installed from the Store sees its own
    // version of the program data folders); the temporary folder always works.
    let written = temporary_pdf();

    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .env("SYNTELAB_SOURCE", source)
        .env("SYNTELAB_TARGET", &written);
    let ran = run(command);
    let ran = match ran {
        Ok(()) if written.is_file() => move_file(&written, destination),
        other => other,
    };
    let _ = fs::remove_file(&written);
    match ran {
        Ok(()) if destination.is_file() => Ok(()),
        Ok(()) => Err(BridgeError::Failed("no PDF was written".to_owned())),
        Err(BridgeError::TimedOut) => {
            // Ours is still there, hidden, waiting on a question nobody sees: stop it.
            // The user's own windows of the same program are left alone.
            for process in running(program).into_iter().filter(|process| !open_before.contains(process)) {
                stop(process);
            }
            Err(BridgeError::TimedOut)
        }
        // The program for this kind of file is not on this computer.
        Err(BridgeError::Failed(said)) if said.contains("80040154") || said.contains("New-Object") => {
            Err(BridgeError::NoOfficeSuite)
        }
        Err(error) => Err(error),
    }
}

/// A name for the PDF in the temporary folder, not used by anything else.
fn temporary_pdf() -> PathBuf {
    static NEXT: AtomicU32 = AtomicU32::new(1);
    let number = NEXT.fetch_add(1, Ordering::Relaxed);
    env::temp_dir().join(format!("syntelab-creative-office-{}-{number}.pdf", std::process::id()))
}

/// Moves a file, also across drives (where renaming is not possible).
fn move_file(from: &Path, to: &Path) -> Result<(), BridgeError> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    fs::copy(from, to).map(|_| ()).map_err(|error| BridgeError::Failed(error.to_string()))
}

/// The process numbers of every running copy of a program, by its file name.
fn running(program: &str) -> Vec<u32> {
    let listed = quiet("tasklist.exe")
        .args(["/FI", &format!("IMAGENAME eq {program}"), "/FO", "CSV", "/NH"])
        .stderr(Stdio::null())
        .output();
    let Ok(listed) = listed else {
        return Vec::new();
    };
    // Each line: "WINWORD.EXE","1234","Console",…
    String::from_utf8_lossy(&listed.stdout)
        .lines()
        .filter_map(|line| line.split(',').nth(1))
        .filter_map(|number| number.trim_matches('"').parse().ok())
        .collect()
}

fn stop(process: u32) {
    let _ = quiet("taskkill.exe")
        .args(["/F", "/PID", &process.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// A command that shows no console window.
fn quiet(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut command = Command::new(program);
    command.stdin(Stdio::null()).creation_flags(CREATE_NO_WINDOW);
    command
}
