//! Files that are not PDFs but can become pages: which they are, and how
//! text files are laid out as pages (MuPDF binding). Pictures are in
//! `picture_pdf`; office documents go through `syntelab-office-bridge`.

use std::fs;
use std::path::Path;

use mupdf::{Document, DocumentWriter, Matrix};

use super::EngineError;

/// What a file is, by its name, for the purpose of turning it into pages.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    Pdf,
    /// A picture MuPDF reads itself.
    Picture,
    /// A picture MuPDF does not read; the interface decodes it and hands the pixels over.
    PictureForInterface,
    /// Plain text, or a web page: laid out as pages.
    Text,
    /// A document in another format MuPDF reads: an e-book, XPS, a comic book archive.
    Document,
    /// Word, Excel, PowerPoint and the like: converted by an office suite.
    Office,
    Other,
}

const PICTURES: &[&str] =
    &["png", "jpg", "jpeg", "jpe", "jfif", "bmp", "dib", "gif", "tif", "tiff", "pnm", "pbm", "pgm", "ppm", "pam", "jp2", "jpx", "j2k", "jpf", "psd"];
const PICTURES_FOR_INTERFACE: &[&str] = &["webp", "avif", "svg", "ico", "cur", "apng"];
const PLAIN_TEXT: &[&str] = &["txt", "text", "log", "md", "markdown", "csv", "tsv", "ini", "json", "xml", "yaml", "yml"];
const WEB_PAGES: &[&str] = &["html", "htm", "xhtml"];
const DOCUMENTS: &[&str] = &["epub", "fb2", "mobi", "xps", "oxps", "cbz"];

pub fn file_kind(path: &Path) -> FileKind {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase) else {
        return FileKind::Other;
    };
    let is_in = |list: &[&str]| list.contains(&extension.as_str());
    if extension == "pdf" {
        FileKind::Pdf
    } else if is_in(PICTURES) {
        FileKind::Picture
    } else if is_in(PICTURES_FOR_INTERFACE) {
        FileKind::PictureForInterface
    } else if is_in(PLAIN_TEXT) || is_in(WEB_PAGES) {
        FileKind::Text
    } else if is_in(DOCUMENTS) {
        FileKind::Document
    } else if syntelab_office_bridge::office_kind(path).is_some() {
        FileKind::Office
    } else {
        FileKind::Other
    }
}

/// A4, upright, in points; and the letter size text is laid out in.
const SHEET_WIDTH: f32 = 595.0;
const SHEET_HEIGHT: f32 = 842.0;
const LETTER_SIZE: f32 = 11.0;
/// Text files larger than this are not laid out: nobody combines a book of raw text by accident.
const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;

/// Writes `destination`: the text file (or web page) `source` laid out on A4 pages.
pub fn text_to_pdf(source: &Path, destination: &Path) -> Result<(), EngineError> {
    let too_large = fs::metadata(source).map(|file| file.len() > MAX_TEXT_BYTES).unwrap_or(false);
    if too_large {
        return Err(EngineError::Failed("the text file is too large".into()));
    }
    let bytes = fs::read(source).map_err(|error| EngineError::Failed(error.to_string()))?;
    let is_web_page =
        source.extension().and_then(|extension| extension.to_str()).is_some_and(|extension| WEB_PAGES.iter().any(|known| extension.eq_ignore_ascii_case(known)));
    // MuPDF picks how to read the data by a file name; every plain text is read as ".txt".
    let mut document = Document::from_bytes(&as_utf8(&bytes), if is_web_page { "page.html" } else { "text.txt" }).map_err(failed)?;
    document.layout(SHEET_WIDTH, SHEET_HEIGHT, LETTER_SIZE).map_err(failed)?;
    let page_count = document.page_count().map_err(failed)?;
    if page_count < 1 {
        return Err(EngineError::Failed("the file has no text".into()));
    }
    write_pdf(&document, page_count, destination)
}

/// Documents larger than this are not converted in one go.
const MAX_DOCUMENT_BYTES: u64 = 300 * 1024 * 1024;

/// Writes `destination`: a document in another format MuPDF reads (an e-book,
/// XPS, a comic book archive) as a PDF. A document without pages of its own
/// (an e-book) is laid out on A4 pages.
pub fn document_to_pdf(source: &Path, destination: &Path) -> Result<(), EngineError> {
    let too_large = fs::metadata(source).map(|file| file.len() > MAX_DOCUMENT_BYTES).unwrap_or(false);
    if too_large {
        return Err(EngineError::Failed("the file is too large".into()));
    }
    let name = |path: &Path| {
        path.to_str().map(str::to_owned).ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))
    };
    let mut document = Document::open(&name(source)?).map_err(failed)?;
    if document.needs_password().map_err(failed)? {
        return Err(EngineError::PasswordRequired);
    }
    if document.is_reflowable().map_err(failed)? {
        document.layout(SHEET_WIDTH, SHEET_HEIGHT, LETTER_SIZE).map_err(failed)?;
    }
    let page_count = document.page_count().map_err(failed)?;
    if page_count < 1 {
        return Err(EngineError::Failed("the file has no pages".into()));
    }
    write_pdf(&document, page_count, destination)
}

/// Writes the pages of `document` to `destination` as a PDF, through MuPDF's
/// PDF writer. Not `Document::convert_to_pdf`: its C wrapper in mupdf-sys 0.8.0
/// reuses freed objects from the second page on (a use-after-free).
fn write_pdf(document: &Document, page_count: i32, destination: &Path) -> Result<(), EngineError> {
    let name = destination.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    let mut writer = DocumentWriter::new(name, "pdf", "").map_err(failed)?;
    for index in 0..page_count {
        let page = document.load_page(index).map_err(failed)?;
        let device = writer.begin_page(page.bounds().map_err(failed)?).map_err(failed)?;
        page.run(&device, &Matrix::IDENTITY).map_err(failed)?;
        writer.end_page(device).map_err(failed)?;
    }
    // Closing it writes the file.
    drop(writer);
    Ok(())
}

/// Text files come in several encodings; MuPDF wants UTF-8. A file that
/// starts with a UTF-16 mark is converted; one that is not valid UTF-8 is
/// read as Windows Latin, where every byte is a letter.
fn as_utf8(bytes: &[u8]) -> Vec<u8> {
    let utf16 = |pairs: &[u8], big_endian: bool| {
        let units: Vec<u16> = pairs
            .chunks_exact(2)
            .map(|pair| if big_endian { u16::from_be_bytes([pair[0], pair[1]]) } else { u16::from_le_bytes([pair[0], pair[1]]) })
            .collect();
        String::from_utf16_lossy(&units).into_bytes()
    };
    match bytes {
        [0xFF, 0xFE, rest @ ..] => utf16(rest, false),
        [0xFE, 0xFF, rest @ ..] => utf16(rest, true),
        [0xEF, 0xBB, 0xBF, rest @ ..] => rest.to_vec(),
        _ if std::str::from_utf8(bytes).is_ok() => bytes.to_vec(),
        _ => bytes.iter().map(|byte| char::from(*byte)).collect::<String>().into_bytes(),
    }
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tells_files_apart_by_their_names() {
        assert_eq!(file_kind(Path::new("a/Scan.PDF")), FileKind::Pdf);
        assert_eq!(file_kind(Path::new("photo.TIFF")), FileKind::Picture);
        assert_eq!(file_kind(Path::new("photo.webp")), FileKind::PictureForInterface);
        assert_eq!(file_kind(Path::new("notes.md")), FileKind::Text);
        assert_eq!(file_kind(Path::new("page.html")), FileKind::Text);
        assert_eq!(file_kind(Path::new("letter.docx")), FileKind::Office);
        assert_eq!(file_kind(Path::new("novel.EPUB")), FileKind::Document);
        assert_eq!(file_kind(Path::new("comic.cbz")), FileKind::Document);
        assert_eq!(file_kind(Path::new("program.exe")), FileKind::Other);
        assert_eq!(file_kind(Path::new("no-ending")), FileKind::Other);
    }

    #[test]
    fn reads_text_in_the_usual_encodings() {
        assert_eq!(as_utf8("ăîâ".as_bytes()), "ăîâ".as_bytes());
        assert_eq!(as_utf8(&[0xEF, 0xBB, 0xBF, b'a']), b"a");
        assert_eq!(as_utf8(&[0xFF, 0xFE, b'a', 0, 0x03, 0x01]), "aă".as_bytes());
        assert_eq!(as_utf8(&[0xFE, 0xFF, 0, b'a']), b"a");
        // Not UTF-8: each byte is taken as a letter, so nothing is lost or refused.
        assert_eq!(as_utf8(&[b'a', 0xE9]), "aé".as_bytes());
    }
}
