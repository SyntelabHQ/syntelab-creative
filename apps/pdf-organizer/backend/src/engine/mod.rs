//! The PDF engine. The only module that touches MuPDF (and PDFium, which draws
//! pages on screen): everything else in the backend goes through the types below, so the engine can be replaced without
//! changing its users.
//!
//! A [`PdfFile`] is tied to the thread that opened it (MuPDF documents cannot
//! move between threads). Code that needs a document on several threads opens
//! the file once per thread.

mod additions;
mod assemble;
mod blank_pdf;
mod export;
mod forms;
mod marks;
mod mupdf_file;
mod ocr;
mod other_files;
mod page_change;
mod pdfium;
mod picture_pdf;
mod screen;
pub mod revocation;
mod shrink;
mod sign;
pub mod time_stamp;

use std::fmt;

pub use additions::{attached_files, save_attached_file, AttachedFile, BookmarkEdit, DocumentChanges, LinkTarget, NewField};
pub use assemble::{assemble, assemble_changed, assemble_smaller, PlannedPage};
pub use blank_pdf::{blank_pdf, MAX_BLANK_PAGES};
pub use export::{export, ExportFormat, PictureOptions};
pub use forms::{form_fields, FieldKind, FormField};
pub use marks::{FontFamily, HiddenWord, Mark, MarkKind, TEXT_ASCENT, TEXT_LINE_HEIGHT};
pub use mupdf_file::PdfFile;
pub use ocr::{find_engine as find_ocr_engine, languages as ocr_languages, recognize, unturned, FoundWord};
pub use other_files::{document_to_pdf, file_kind, text_to_pdf, FileKind};
pub use picture_pdf::picture_to_pdf;
pub use screen::ScreenPages;
pub use shrink::PictureShrink;
pub use sign::{add_validation_data, sign_file, signatures, FoundSignature, ShownSignature, SignatureRequest};
pub use page_change::{
    picture_as_png, picture_from_base64, picture_size, to_base64, Area, PageChange, Place, ShapeKind,
};

/// Page size in PDF points (1/72 inch), after the page's own rotation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageSize {
    pub width: f32,
    pub height: f32,
}

/// What a PDF says about itself. A field the file leaves out is empty.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DocumentFacts {
    pub title: String,
    pub author: String,
    pub subject: String,
    pub keywords: String,
    /// The program the document was written in.
    pub creator: String,
    /// The program that made the PDF.
    pub producer: String,
    /// As written in the file: `D:20261009143000+02'00'`.
    pub created: String,
    pub modified: String,
    /// `PDF 1.7`.
    pub format: String,
}

/// One entry of a document's table of contents (its bookmarks).
#[derive(Debug, Clone, PartialEq)]
pub struct Bookmark {
    pub title: String,
    /// The page it leads to, from 0; `None` when it leads elsewhere (a web page) or nowhere.
    pub page: Option<usize>,
    pub children: Vec<Bookmark>,
}

/// A rectangle on a page, in PDF points, measured from the page's top-left
/// corner as the page is shown without any extra turn.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

/// A link of a page, as the document has it: where it is, and where it leads.
#[derive(Debug, Clone, PartialEq)]
pub struct PageLink {
    pub area: TextBox,
    /// An address outside the document, when it leads to one.
    pub address: Option<String>,
    /// A page of the document, from 0, when it leads to one.
    pub page: Option<usize>,
}

/// One line of text of a page, as the document has it: what it says, where,
/// and how it is written (to take it out and write it anew).
#[derive(Debug, Clone, PartialEq)]
pub struct TextLine {
    pub text: String,
    pub area: TextBox,
    /// Height of the letters, in points.
    pub size: f32,
    /// Red, green and blue of the letters, from 0 to 1.
    pub color: [f32; 3],
    pub bold: bool,
    pub italic: bool,
    /// `sans`, `serif` or `mono`: the built-in font closest to the document's own.
    pub family: &'static str,
    /// The name of the document's own font, without what a file adds to it
    /// (`ABCDEF+`, `-Bold`, `MT`): `Arial`, `Times New Roman`.
    pub font_name: String,
}

/// A rectangle of a page's picture, in pixels from its top-left corner: a piece drawn by itself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tile {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Tile {
    /// Reads `x,y,width,height`.
    pub fn parse(text: &str) -> Option<Self> {
        let mut numbers = text.split(',').map(|number| number.trim().parse::<u32>().ok());
        let tile = Self { x: numbers.next()??, y: numbers.next()??, width: numbers.next()??, height: numbers.next()?? };
        (numbers.next().is_none() && tile.width > 0 && tile.height > 0).then_some(tile)
    }
}

/// How far a page is turned for viewing, clockwise. The file is not changed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Rotation {
    #[default]
    None,
    Quarter,
    Half,
    ThreeQuarters,
}

impl Rotation {
    /// Accepts 0, 90, 180 and 270 (and the same plus full turns); anything
    /// else means no rotation.
    pub fn from_degrees(degrees: i32) -> Self {
        match degrees.rem_euclid(360) {
            90 => Rotation::Quarter,
            180 => Rotation::Half,
            270 => Rotation::ThreeQuarters,
            _ => Rotation::None,
        }
    }

    pub fn degrees(self) -> f32 {
        match self {
            Rotation::None => 0.0,
            Rotation::Quarter => 90.0,
            Rotation::Half => 180.0,
            Rotation::ThreeQuarters => 270.0,
        }
    }
}

#[derive(Debug)]
pub enum EngineError {
    /// The file needs a password; opening protected files is not supported yet.
    PasswordRequired,
    /// The file to write is one of the files being read.
    DestinationInUse,
    /// A file with the name to write is already there, and was not asked to be replaced.
    DestinationExists,
    /// The page number is outside the document.
    NoSuchPage(usize),
    /// The text has letters the built-in font cannot write (another script).
    LettersMissing,
    /// The file could not be read as a PDF, or a page could not be drawn.
    Failed(String),
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            EngineError::PasswordRequired => f.write_str("the document needs a password"),
            EngineError::DestinationInUse => f.write_str("the file to write is open as a source"),
            EngineError::DestinationExists => f.write_str("a file with that name is already there"),
            EngineError::NoSuchPage(index) => write!(f, "the document has no page {index}"),
            EngineError::LettersMissing => f.write_str("the font has no such letters"),
            EngineError::Failed(reason) => f.write_str(reason),
        }
    }
}

impl std::error::Error for EngineError {}

#[cfg(test)]
mod tile_tests {
    use super::Tile;

    #[test]
    fn reads_a_piece_of_a_page_from_its_numbers() {
        assert_eq!(Tile::parse("0,512,512,256"), Some(Tile { x: 0, y: 512, width: 512, height: 256 }));
        for wrong in ["", "1,2,3", "1,2,3,4,5", "1,2,0,4", "-1,2,3,4", "a,b,c,d"] {
            assert_eq!(Tile::parse(wrong), None, "{wrong}");
        }
    }
}
