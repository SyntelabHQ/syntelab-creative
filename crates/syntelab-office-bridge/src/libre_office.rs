use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use crate::run::run;
use crate::BridgeError;

/// Where the LibreOffice program is, when it is installed.
pub(crate) fn find() -> Option<PathBuf> {
    let name = if cfg!(windows) { "soffice.exe" } else { "soffice" };
    let mut places: Vec<PathBuf> = Vec::new();
    if cfg!(windows) {
        for folder in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(programs) = env::var_os(folder) {
                places.push(PathBuf::from(programs).join("LibreOffice").join("program"));
            }
        }
    } else {
        places.extend(["/usr/bin", "/usr/local/bin", "/opt/libreoffice/program", "/snap/bin"].map(PathBuf::from));
        places.push(PathBuf::from("/Applications/LibreOffice.app/Contents/MacOS"));
    }
    // Wherever the user put it, if it can be started by name.
    if let Some(path) = env::var_os("PATH") {
        places.extend(env::split_paths(&path));
    }
    places.into_iter().map(|folder| folder.join(name)).find(|program| program.is_file())
}

/// Has LibreOffice write the PDF: without a window, into a folder of its own
/// next to the destination, from where it is moved into place.
pub(crate) fn convert(program: &Path, source: &Path, destination: &Path) -> Result<(), BridgeError> {
    let folder = destination.with_extension("office");
    fs::create_dir_all(&folder).map_err(|error| BridgeError::Failed(error.to_string()))?;

    let mut command = Command::new(program);
    command.args(["--headless", "--norestore", "--convert-to", "pdf", "--outdir"]).arg(&folder).arg(source);
    let ran = run(command);

    // LibreOffice names the PDF after the source file.
    let written = source.file_stem().map(|stem| folder.join(stem).with_extension("pdf"));
    let moved = ran.and_then(|()| match written {
        Some(written) if written.is_file() => {
            fs::rename(&written, destination).map_err(|error| BridgeError::Failed(error.to_string()))
        }
        _ => Err(BridgeError::Failed("no PDF was written".to_owned())),
    });
    let _ = fs::remove_dir_all(&folder);
    moved
}
