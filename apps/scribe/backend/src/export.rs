//! A text written as a document of another kind: Word (`.docx`), one
//! paragraph to each line, or PDF, laid out on A4 pages (MuPDF binding). The
//! text keeps its own file; what is written here is a copy for others.

use std::fs;
use std::io;
use std::path::Path;

use mupdf::{Document, DocumentWriter, Matrix};

use crate::files::partial_path;

/// The kinds of documents a text can be written as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    Word,
    Pdf,
}

impl DocumentKind {
    /// From the name the interface uses, which is also the ending of the file.
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "docx" => Some(Self::Word),
            "pdf" => Some(Self::Pdf),
            _ => None,
        }
    }
}

/// Writes `text` at `path` as a document of `kind`, never half a file.
pub fn write_document(path: &Path, text: &str, kind: DocumentKind) -> Result<(), String> {
    let partial = partial_path(path);
    let written = match kind {
        DocumentKind::Word => fs::write(&partial, word_document(text)).map_err(|error| error.to_string()),
        DocumentKind::Pdf => write_pdf(&partial, text),
    };
    let moved = written.and_then(|()| fs::rename(&partial, path).map_err(|error| error.to_string()));
    if moved.is_err() {
        let _ = fs::remove_file(&partial);
    }
    moved
}

/// What XML cannot hold is left out (the control characters but the tab), and its own signs are written out.
fn xml_escaped(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for letter in text.chars() {
        match letter {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\t' => escaped.push('\t'),
            letter if (letter as u32) < 0x20 || letter == '\u{FFFE}' || letter == '\u{FFFF}' => {}
            letter => escaped.push(letter),
        }
    }
    escaped
}

/// True when the first letter of a line that has a direction is written from right to left (Hebrew, Arabic and their kin).
fn right_to_left(line: &str) -> bool {
    line.chars()
        .find(|letter| letter.is_alphabetic())
        .is_some_and(|letter| matches!(letter as u32, 0x0590..=0x08FF | 0xFB1D..=0xFDFF | 0xFE70..=0xFEFF))
}

/// The parts of a Word document: one paragraph to each line, tabs kept as tabs.
fn word_parts(text: &str) -> Vec<(&'static str, Vec<u8>)> {
    let mut body = String::new();
    for line in text.split('\n') {
        body.push_str("<w:p>");
        if right_to_left(line) {
            body.push_str("<w:pPr><w:bidi/></w:pPr>");
        }
        for (index, piece) in line.split('\t').enumerate() {
            if index > 0 {
                body.push_str("<w:r><w:tab/></w:r>");
            }
            if !piece.is_empty() {
                body.push_str("<w:r><w:t xml:space=\"preserve\">");
                body.push_str(&xml_escaped(piece));
                body.push_str("</w:t></w:r>");
            }
        }
        body.push_str("</w:p>");
    }
    const HEAD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";
    let types = format!(
        "{HEAD}<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>"
    );
    let relations = format!(
        "{HEAD}<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>"
    );
    // A4, with margins of 2 cm (in twentieths of a point).
    let document = format!(
        "{HEAD}<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/><w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"567\" w:footer=\"567\" w:gutter=\"0\"/></w:sectPr></w:body></w:document>"
    );
    vec![("[Content_Types].xml", types.into_bytes()), ("_rels/.rels", relations.into_bytes()), ("word/document.xml", document.into_bytes())]
}

/// A Word document holding `text`.
pub fn word_document(text: &str) -> Vec<u8> {
    stored_zip(&word_parts(text))
}

/// A ZIP archive of files kept as they are (not packed smaller): what a Word document is made of.
fn stored_zip(files: &[(&str, Vec<u8>)]) -> Vec<u8> {
    let mut archive = Vec::new();
    let mut directory = Vec::new();
    for (name, data) in files {
        let offset = archive.len() as u32;
        let crc = crc32(data);
        let size = data.len() as u32;
        let name_length = name.len() as u16;
        // Version 2.0; names in UTF-8; stored; 1 January 1980.
        let common = |into: &mut Vec<u8>| {
            into.extend_from_slice(&20u16.to_le_bytes());
            into.extend_from_slice(&0x0800u16.to_le_bytes());
            into.extend_from_slice(&0u16.to_le_bytes());
            into.extend_from_slice(&0u16.to_le_bytes());
            into.extend_from_slice(&0x0021u16.to_le_bytes());
            into.extend_from_slice(&crc.to_le_bytes());
            into.extend_from_slice(&size.to_le_bytes());
            into.extend_from_slice(&size.to_le_bytes());
            into.extend_from_slice(&name_length.to_le_bytes());
            into.extend_from_slice(&0u16.to_le_bytes());
        };
        archive.extend_from_slice(&0x0403_4b50u32.to_le_bytes());
        common(&mut archive);
        archive.extend_from_slice(name.as_bytes());
        archive.extend_from_slice(data);

        directory.extend_from_slice(&0x0201_4b50u32.to_le_bytes());
        directory.extend_from_slice(&20u16.to_le_bytes());
        common(&mut directory);
        // No comment, disk 0, no attributes; where the file starts.
        directory.extend_from_slice(&[0; 8]);
        directory.extend_from_slice(&0u32.to_le_bytes()[..2]);
        directory.extend_from_slice(&offset.to_le_bytes());
        directory.extend_from_slice(name.as_bytes());
    }
    let directory_offset = archive.len() as u32;
    let directory_size = directory.len() as u32;
    archive.extend_from_slice(&directory);
    let count = files.len() as u16;
    archive.extend_from_slice(&0x0605_4b50u32.to_le_bytes());
    archive.extend_from_slice(&[0; 4]);
    archive.extend_from_slice(&count.to_le_bytes());
    archive.extend_from_slice(&count.to_le_bytes());
    archive.extend_from_slice(&directory_size.to_le_bytes());
    archive.extend_from_slice(&directory_offset.to_le_bytes());
    archive.extend_from_slice(&0u16.to_le_bytes());
    archive
}

/// The check sum of ZIP archives (CRC-32, as in PNG and Ethernet).
fn crc32(data: &[u8]) -> u32 {
    let mut crc = !0u32;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
        }
    }
    !crc
}

/// A4, upright, in points; and the letter size the text is laid out in.
const SHEET_WIDTH: f32 = 595.0;
const SHEET_HEIGHT: f32 = 842.0;
const LETTER_SIZE: f32 = 11.0;

/// The text as a web page MuPDF lays out: each line a paragraph, its spaces kept, in the direction of its own letters.
fn as_web_page(text: &str) -> String {
    let mut page = String::from(
        "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>@page { margin: 2cm } body { margin: 0; font-family: sans-serif; font-size: 11pt } p { margin: 0; white-space: pre-wrap; overflow-wrap: break-word }</style></head><body>",
    );
    for line in text.split('\n') {
        page.push_str(if right_to_left(line) { "<p dir=\"rtl\">" } else { "<p>" });
        // An empty line keeps its height.
        page.push_str(if line.is_empty() { "&#160;" } else { "" });
        page.push_str(&xml_escaped(line));
        page.push_str("</p>");
    }
    page.push_str("</body></html>");
    page
}

fn write_pdf(path: &Path, text: &str) -> Result<(), String> {
    let failed = |error: mupdf::Error| error.to_string();
    let mut document = Document::from_bytes(as_web_page(text).as_bytes(), "page.html").map_err(failed)?;
    document.layout(SHEET_WIDTH, SHEET_HEIGHT, LETTER_SIZE).map_err(failed)?;
    let page_count = document.page_count().map_err(failed)?;
    if page_count < 1 {
        return Err("the text gives no pages".into());
    }
    // Not `Document::convert_to_pdf`: its C wrapper in mupdf-sys 0.8.0 reuses
    // freed objects from the second page on (a use-after-free).
    let name = path.to_str().ok_or_else(|| io::Error::other("the file name is not valid Unicode").to_string())?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_bytes_as_zip_does() {
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }

    #[test]
    fn writes_a_paragraph_to_each_line() {
        let parts = word_parts("Unu\tdoi\n\n<trei> & \u{7}patru\nשלום");
        let document = String::from_utf8(parts[2].1.clone()).expect("UTF-8");
        assert_eq!(document.matches("<w:p>").count(), 4);
        assert!(document.contains("<w:t xml:space=\"preserve\">Unu</w:t></w:r><w:r><w:tab/></w:r>"));
        assert!(document.contains("&lt;trei&gt; &amp; patru"), "{document}");
        assert!(document.contains("<w:bidi/>"), "a line of Hebrew goes from right to left");
    }

    #[test]
    fn makes_a_zip_with_its_directory() {
        let archive = word_document("Salut");
        assert_eq!(&archive[..4], &[0x50, 0x4b, 0x03, 0x04]);
        let end = archive.len() - 22;
        assert_eq!(&archive[end..end + 4], &[0x50, 0x4b, 0x05, 0x06]);
        assert_eq!(u16::from_le_bytes([archive[end + 10], archive[end + 11]]), 3);
    }

    #[test]
    fn writes_a_pdf_of_the_text() {
        let dir = std::env::temp_dir().join(format!("scribe-export-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("folder");
        let path = dir.join("text.pdf");
        write_document(&path, "Șase țări\n\nA doua linie", DocumentKind::Pdf).expect("written");
        let bytes = fs::read(&path).expect("read");
        assert!(bytes.starts_with(b"%PDF"));
        // A text of several pages (MuPDF's own conversion broke from the second page on).
        write_document(&path, &"A line of text\n".repeat(200), DocumentKind::Pdf).expect("written");
        assert!(Document::open(path.to_str().expect("name")).and_then(|pdf| pdf.page_count()).expect("pages") > 1);
        let _ = fs::remove_dir_all(&dir);
    }
}
