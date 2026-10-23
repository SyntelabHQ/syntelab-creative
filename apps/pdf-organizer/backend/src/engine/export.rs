//! Writing a PDF out in another format: pictures of its pages, its text, or
//! a document for a word processor (MuPDF binding).
//!
//! What a PDF holds is a picture of each page with text laid on it, not
//! paragraphs and tables: the pictures and the plain text are exact, the
//! word processor documents are a rebuilding that keeps the text and where
//! it stands, as well as the engine can tell.

use std::fs;
use std::path::{Path, PathBuf};

use jpeg_encoder::{ColorType, Encoder};
use mupdf::{Colorspace, Document, DocumentWriter, ImageFormat, Matrix, Pixmap, TextPageFlags};

use super::EngineError;

/// What a document can be written out as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    /// One picture per page.
    Png,
    Jpeg,
    /// One file holding a picture of every page.
    Tiff,
    /// One drawing per page that stays sharp at any size.
    Svg,
    /// The words, page after page.
    Text,
    /// The text with its fonts and places, to open in a browser.
    Html,
    /// The text with the place of every letter, for other programs to read.
    Xml,
    PostScript,
    /// A document for Word and the like.
    Docx,
    /// A document for LibreOffice and the like.
    Odt,
}

impl ExportFormat {
    /// The name the interface uses, which is also the ending of the file: `png`, `docx`…
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "png" => Self::Png,
            "jpg" => Self::Jpeg,
            "tiff" => Self::Tiff,
            "svg" => Self::Svg,
            "txt" => Self::Text,
            "html" => Self::Html,
            "xml" => Self::Xml,
            "ps" => Self::PostScript,
            "docx" => Self::Docx,
            "odt" => Self::Odt,
            _ => return None,
        })
    }

    /// True for the formats that give one file per page.
    fn one_file_per_page(self) -> bool {
        matches!(self, Self::Png | Self::Jpeg | Self::Svg)
    }
}

/// How pictures of pages are made.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PictureOptions {
    /// Dots per inch: 72 is the page at its real size on an old screen, 300 is print quality.
    pub resolution: f32,
    /// For JPEG, from 1 (small, rough) to 100 (large, fine).
    pub quality: u8,
}

impl Default for PictureOptions {
    fn default() -> Self {
        Self { resolution: 150.0, quality: 88 }
    }
}

/// The most pixels one picture of a page may have: a poster at print quality is drawn less fine.
const MAX_PICTURE_PIXELS: f32 = 60_000_000.0;

/// Writes the PDF at `source` in another format. Returns the files written:
/// `destination` itself, or, for a format that gives one file per page and a
/// document of several pages, files beside it named `<name>_001.<ending>`,
/// `_002`… Nothing is written when one of those already exists.
pub fn export(source: &Path, format: ExportFormat, destination: &Path, pictures: PictureOptions) -> Result<Vec<PathBuf>, EngineError> {
    let document = Document::open(text_of(source)?).map_err(failed)?;
    if document.needs_password().map_err(failed)? {
        return Err(EngineError::PasswordRequired);
    }
    let page_count = usize::try_from(document.page_count().map_err(failed)?).unwrap_or(0);
    if page_count == 0 {
        return Err(EngineError::Failed("the document has no pages".into()));
    }

    let files = if format.one_file_per_page() && page_count > 1 {
        let files: Vec<PathBuf> = (1..=page_count).map(|number| numbered(destination, number, page_count)).collect();
        if files.iter().any(|file| file.exists()) {
            return Err(EngineError::DestinationExists);
        }
        files
    } else {
        vec![destination.to_path_buf()]
    };

    let written = write(&document, page_count, format, &files, pictures);
    if written.is_err() {
        // Half of the pages is not an export.
        for file in &files {
            let _ = fs::remove_file(file);
        }
    }
    written.map(|()| files)
}

fn write(document: &Document, page_count: usize, format: ExportFormat, files: &[PathBuf], pictures: PictureOptions) -> Result<(), EngineError> {
    let page = |index: usize| document.load_page(index as i32).map_err(failed);
    match format {
        ExportFormat::Png | ExportFormat::Jpeg => {
            for (index, file) in files.iter().enumerate() {
                let pixels = draw(&page(index)?, pictures.resolution)?;
                let mut data = Vec::new();
                if format == ExportFormat::Png {
                    pixels.write_to(&mut data, ImageFormat::PNG).map_err(failed)?;
                } else {
                    let (width, height) = (size_for_jpeg(pixels.width())?, size_for_jpeg(pixels.height())?);
                    Encoder::new(&mut data, pictures.quality.clamp(1, 100))
                        .encode(&rows_of(&pixels), width, height, ColorType::Rgb)
                        .map_err(|error| EngineError::Failed(error.to_string()))?;
                }
                fs::write(file, data).map_err(io_failed)?;
            }
            Ok(())
        }
        ExportFormat::Tiff => {
            let mut pages = Vec::with_capacity(page_count);
            for index in 0..page_count {
                let pixels = draw(&page(index)?, pictures.resolution)?;
                pages.push(TiffPage { width: pixels.width(), height: pixels.height(), resolution: pictures.resolution, rows: rows_of(&pixels) });
            }
            fs::write(&files[0], tiff_of(&pages)).map_err(io_failed)
        }
        ExportFormat::Svg => {
            for (index, file) in files.iter().enumerate() {
                fs::write(file, page(index)?.to_svg(&Matrix::IDENTITY).map_err(failed)?).map_err(io_failed)?;
            }
            Ok(())
        }
        ExportFormat::Text => {
            let mut text = String::new();
            for index in 0..page_count {
                if index > 0 {
                    // A form feed: where a printer, and many programs, start a new page.
                    text.push('\u{c}');
                }
                text.push_str(&page(index)?.to_text_page(TextPageFlags::empty()).and_then(|words| words.to_text()).map_err(failed)?);
            }
            fs::write(&files[0], text).map_err(io_failed)
        }
        ExportFormat::Html => {
            let mut html = String::from("<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<style>\nbody { background: #e8e8e8; }\ndiv[id^=\"page\"] { position: relative; margin: 16px auto; background: #ffffff; box-shadow: 0 1px 4px rgb(0 0 0 / 0.3); }\np { position: absolute; margin: 0; white-space: pre; }\n</style>\n</head>\n<body>\n");
            for index in 0..page_count {
                let words = page(index)?.to_text_page(TextPageFlags::PRESERVE_IMAGES).map_err(failed)?;
                html.push_str(&words.to_html(index as i32 + 1, false).map_err(failed)?);
            }
            html.push_str("</body>\n</html>\n");
            fs::write(&files[0], html).map_err(io_failed)
        }
        ExportFormat::Xml => {
            let mut xml = String::from("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<document>\n");
            for index in 0..page_count {
                xml.push_str(&page(index)?.to_text_page(TextPageFlags::empty()).and_then(|words| words.to_xml(index as i32 + 1)).map_err(failed)?);
            }
            xml.push_str("</document>\n");
            fs::write(&files[0], xml).map_err(io_failed)
        }
        ExportFormat::PostScript | ExportFormat::Docx | ExportFormat::Odt => {
            let kind = match format {
                ExportFormat::PostScript => "ps",
                ExportFormat::Docx => "docx",
                _ => "odt",
            };
            let mut writer = DocumentWriter::new(text_of(&files[0])?, kind, "").map_err(failed)?;
            for index in 0..page_count {
                let page = page(index)?;
                let device = writer.begin_page(page.bounds().map_err(failed)?).map_err(failed)?;
                page.run(&device, &Matrix::IDENTITY).map_err(failed)?;
                writer.end_page(device).map_err(failed)?;
            }
            // Closing it writes the end of the file.
            drop(writer);
            Ok(())
        }
    }
}

/// A page as pixels (red, green, blue) on white paper.
fn draw(page: &mupdf::Page, resolution: f32) -> Result<Pixmap, EngineError> {
    let bounds = page.bounds().map_err(failed)?;
    let area = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
    let wanted = if resolution.is_finite() { resolution.clamp(18.0, 1200.0) / 72.0 } else { 150.0 / 72.0 };
    let scale = if area > 0.0 { wanted.min((MAX_PICTURE_PIXELS / area).sqrt()) } else { wanted };
    page.to_pixmap(&Matrix::new_scale(scale, scale), &Colorspace::device_rgb(), false, true).map_err(failed)
}

/// The pixels row after row, three bytes each, without what the engine keeps between rows.
fn rows_of(pixels: &Pixmap) -> Vec<u8> {
    let (width, height) = (pixels.width() as usize, pixels.height() as usize);
    let (stride, parts) = (pixels.stride().unsigned_abs(), usize::from(pixels.n()));
    let samples = pixels.samples();
    let mut rows = Vec::with_capacity(width * height * 3);
    for y in 0..height {
        let row = &samples[y * stride..y * stride + width * parts];
        if parts == 3 {
            rows.extend_from_slice(row);
        } else {
            for pixel in row.chunks_exact(parts) {
                rows.extend_from_slice(&[pixel[0], pixel[parts.min(2).saturating_sub(1)], pixel[parts.min(3) - 1]]);
            }
        }
    }
    rows
}

fn size_for_jpeg(size: u32) -> Result<u16, EngineError> {
    u16::try_from(size).map_err(|_| EngineError::Failed("the page is too large for a JPEG picture".into()))
}

/// `report.png` → `report_007.png`, with as many digits as the last page needs (three at least).
fn numbered(destination: &Path, number: usize, of: usize) -> PathBuf {
    let digits = of.to_string().len().max(3);
    let stem = destination.file_stem().map(|stem| stem.to_string_lossy().into_owned()).unwrap_or_default();
    let ending = destination.extension().map(|ending| format!(".{}", ending.to_string_lossy())).unwrap_or_default();
    destination.with_file_name(format!("{stem}_{number:0digits$}{ending}"))
}

/// One page of a TIFF file.
struct TiffPage {
    width: u32,
    height: u32,
    resolution: f32,
    /// Red, green, blue for every pixel, row after row.
    rows: Vec<u8>,
}

/// A TIFF file with one picture per page, each packed row by row ("PackBits":
/// runs of the same byte, which white paper is full of, take two bytes).
fn tiff_of(pages: &[TiffPage]) -> Vec<u8> {
    // "II": numbers are written lowest byte first. 42 says it is a TIFF.
    let mut file = vec![b'I', b'I', 42, 0, 0, 0, 0, 0];
    let mut link_to_next = 4;
    for page in pages {
        let row_bytes = page.width as usize * 3;
        let mut packed = Vec::new();
        for row in page.rows.chunks(row_bytes.max(1)) {
            pack_bits(row, &mut packed);
        }
        let picture_at = file.len() as u32;
        file.extend_from_slice(&packed);
        if file.len() % 2 == 1 {
            file.push(0);
        }
        // Values too long for their place in the list stand before it.
        let depth_at = file.len() as u32;
        for _ in 0..3 {
            file.extend_from_slice(&8u16.to_le_bytes());
        }
        let resolution_at = file.len() as u32;
        file.extend_from_slice(&((page.resolution * 100.0).round() as u32).to_le_bytes());
        file.extend_from_slice(&100u32.to_le_bytes());

        let list_at = file.len() as u32;
        file[link_to_next..link_to_next + 4].copy_from_slice(&list_at.to_le_bytes());
        // Each entry: what it is, the kind of number (3 = two bytes, 4 = four, 5 = a fraction), how many, the value.
        let entries: [(u16, u16, u32, u32); 12] = [
            (256, 4, 1, page.width),
            (257, 4, 1, page.height),
            (258, 3, 3, depth_at),
            (259, 3, 1, 32773), // packed with PackBits
            (262, 3, 1, 2),     // red, green, blue
            (273, 4, 1, picture_at),
            (277, 3, 1, 3),
            (278, 4, 1, page.height),
            (279, 4, 1, packed.len() as u32),
            (282, 5, 1, resolution_at),
            (283, 5, 1, resolution_at),
            (296, 3, 1, 2), // the resolution is per inch
        ];
        file.extend_from_slice(&(entries.len() as u16).to_le_bytes());
        for (tag, kind, count, value) in entries {
            file.extend_from_slice(&tag.to_le_bytes());
            file.extend_from_slice(&kind.to_le_bytes());
            file.extend_from_slice(&count.to_le_bytes());
            file.extend_from_slice(&value.to_le_bytes());
        }
        link_to_next = file.len();
        file.extend_from_slice(&0u32.to_le_bytes());
    }
    file
}

/// Packs one row: a run of the same byte becomes "how many, the byte"; bytes
/// that differ are copied behind a count.
fn pack_bits(row: &[u8], packed: &mut Vec<u8>) {
    let mut at = 0;
    while at < row.len() {
        let mut run = 1;
        while at + run < row.len() && run < 128 && row[at + run] == row[at] {
            run += 1;
        }
        if run >= 2 {
            packed.push((257 - run) as u8);
            packed.push(row[at]);
            at += run;
            continue;
        }
        // Up to where the next run of three starts (a run of two is not worth breaking off for).
        let start = at;
        at += 1;
        while at < row.len() && at - start < 128 {
            if at + 2 < row.len() && row[at] == row[at + 1] && row[at] == row[at + 2] {
                break;
            }
            at += 1;
        }
        packed.push((at - start - 1) as u8);
        packed.extend_from_slice(&row[start..at]);
    }
}

fn text_of(path: &Path) -> Result<&str, EngineError> {
    path.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))
}

fn io_failed(error: std::io::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Unpacks what `pack_bits` made.
    fn unpack(packed: &[u8]) -> Vec<u8> {
        let mut row = Vec::new();
        let mut at = 0;
        while at < packed.len() {
            let count = packed[at] as i8;
            at += 1;
            if count >= 0 {
                let length = count as usize + 1;
                row.extend_from_slice(&packed[at..at + length]);
                at += length;
            } else {
                row.extend(std::iter::repeat_n(packed[at], (1 - count as isize) as usize));
                at += 1;
            }
        }
        row
    }

    #[test]
    fn packs_rows_so_that_they_unpack_to_themselves() {
        let rows: [&[u8]; 5] = [&[], &[7], &[1, 2, 3, 4], &[9; 300], &[1, 1, 2, 3, 3, 3, 3, 4, 5, 5, 6, 6, 6]];
        for row in rows {
            let mut packed = Vec::new();
            pack_bits(row, &mut packed);
            assert_eq!(unpack(&packed), row);
        }
        // White paper packs well.
        let mut packed = Vec::new();
        pack_bits(&[255; 3000], &mut packed);
        assert!(packed.len() < 60);
    }

    #[test]
    fn numbers_the_files_of_a_document_with_several_pages() {
        assert_eq!(numbered(Path::new("out/report.png"), 7, 12), Path::new("out/report_007.png"));
        assert_eq!(numbered(Path::new("report.jpg"), 1500, 2000), Path::new("report_1500.jpg"));
    }

    #[test]
    fn writes_a_tiff_with_a_picture_per_page() {
        let page = |shade: u8| TiffPage { width: 2, height: 2, resolution: 150.0, rows: vec![shade; 12] };
        let file = tiff_of(&[page(255), page(0)]);
        assert_eq!(&file[..4], b"II\x2a\x00");
        // The first list is where the header says; it has twelve entries and leads to a second one.
        let first = u32::from_le_bytes([file[4], file[5], file[6], file[7]]) as usize;
        assert_eq!(u16::from_le_bytes([file[first], file[first + 1]]), 12);
        let link = first + 2 + 12 * 12;
        let second = u32::from_le_bytes([file[link], file[link + 1], file[link + 2], file[link + 3]]) as usize;
        assert!(second > first && second < file.len());
        assert_eq!(&file[file.len() - 4..], &[0, 0, 0, 0]);
    }

    #[test]
    fn knows_the_formats_by_their_endings() {
        assert_eq!(ExportFormat::from_name("docx"), Some(ExportFormat::Docx));
        assert_eq!(ExportFormat::from_name("jpg"), Some(ExportFormat::Jpeg));
        assert_eq!(ExportFormat::from_name("exe"), None);
    }
}
