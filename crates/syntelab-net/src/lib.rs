//! The only code of Syntelab Creative that goes online.
//!
//! It reads a fixed list of static files from syntelab.com and sends nothing
//! about the user. One more thing goes online, and only when the user types an
//! address and asks for it: saving a web page as a PDF, or reading its source
//! (`web_page`), done by the browser installed on the computer. And the currency converter of Units reads
//! rates of exchange from two services (`rates`), while it is used. And the network tools of Dev (`tools`) go
//! where the user points them: a request, a question to a name server, a try at a port, the certificate of a site,
//! each only when the user types the address and asks. And signing a PDF with a time stamp, or adding one to a document,
//! asks a time-stamping authority for it (`time_stamp`): only a fingerprint goes, never the document. Signing with a time
//! stamp also asks the issuer of the user's certificate whether it is still good (`revocation`), at the addresses the
//! certificate names, so its answer can be kept in the signature. See the README of this crate for the rules.

mod allow_list;
mod client;
mod error;
mod rates;
mod remote_file;
mod revocation;
mod time_stamp;
pub mod tools;
mod web_page;

pub use allow_list::is_allowed;
pub use error::NetError;
pub use rates::{fetch_coin_prices, fetch_fiat_rates};
pub use remote_file::RemoteFile;
pub use revocation::{ask_issuer, issuer_file};
pub use time_stamp::{is_time_stamp_address, time_stamp};
pub use web_page::{save_as_pdf as save_web_page_as_pdf, source as web_page_source, web_address};

/// Downloads one of the known files and returns its text.
///
/// Blocks until the answer arrives or the time limit passes; call it from a
/// worker thread.
pub fn fetch(file: RemoteFile) -> Result<String, NetError> {
    client::get_text(&file.url())
}
