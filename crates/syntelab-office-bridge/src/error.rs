use std::fmt;

/// Why an office document could not be turned into a PDF.
#[derive(Debug)]
pub enum BridgeError {
    /// The file is not one an office suite opens.
    NotAnOfficeFile,
    /// Neither LibreOffice nor Microsoft Office could be used on this computer.
    NoOfficeSuite,
    /// The office suite took too long and was stopped.
    TimedOut,
    /// The office suite ran but gave no PDF (damaged file, password…).
    Failed(String),
}

impl fmt::Display for BridgeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAnOfficeFile => write!(formatter, "not an office document"),
            Self::NoOfficeSuite => write!(formatter, "no office suite is installed"),
            Self::TimedOut => write!(formatter, "the office suite took too long"),
            Self::Failed(detail) => write!(formatter, "the conversion failed: {detail}"),
        }
    }
}

impl std::error::Error for BridgeError {}
