//! Converts Word, Excel and PowerPoint files to PDF through an office suite
//! that is installed: LibreOffice, or Microsoft Office on Windows. See the
//! README of this crate.

mod error;
mod kind;
mod libre_office;
#[cfg(windows)]
mod ms_office;
mod run;

use std::path::Path;

pub use error::BridgeError;
pub use kind::{office_extensions, office_kind, OfficeKind};

/// Writes `destination`: the office document `source` as a PDF. The source is
/// not changed. Takes as long as the office suite does (seconds), up to a limit.
pub fn convert_to_pdf(source: &Path, destination: &Path) -> Result<(), BridgeError> {
    let kind = office_kind(source).ok_or(BridgeError::NotAnOfficeFile)?;
    if let Some(program) = libre_office::find() {
        return libre_office::convert(&program, source, destination);
    }
    #[cfg(windows)]
    {
        ms_office::convert(kind, source, destination)
    }
    #[cfg(not(windows))]
    {
        let _ = kind;
        Err(BridgeError::NoOfficeSuite)
    }
}
