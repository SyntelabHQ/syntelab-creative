use std::fmt;

/// Why a file could not be read from the network.
#[derive(Debug)]
pub enum NetError {
    /// The address is not one the program may contact.
    NotAllowed(String),
    /// The server sent the request on more times than is accepted.
    TooManyRedirects,
    /// No browser that can print a web page to a PDF is installed.
    NoBrowser,
    /// No connection, a server error, an answer that is too large…
    Request(String),
}

impl fmt::Display for NetError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotAllowed(url) => write!(formatter, "address not allowed: {url}"),
            Self::TooManyRedirects => write!(formatter, "too many redirects"),
            Self::NoBrowser => write!(formatter, "no browser to print the page with"),
            Self::Request(detail) => write!(formatter, "request failed: {detail}"),
        }
    }
}

impl std::error::Error for NetError {}
