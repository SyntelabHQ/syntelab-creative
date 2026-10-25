//! Pages drawn for the screen: by PDFium when it is installed and reads the file (sharper text), otherwise by
//! MuPDF. Both draw the same pixels in the same places, so the interface cannot tell which one did.

use std::path::PathBuf;

use super::mupdf_file::rgb_png;
use super::pdfium::{trace, SharpFile};
use super::{EngineError, PdfFile, Rotation, Tile};

/// Draws the pages of one document; lives on the thread that draws them, beside its MuPDF [`PdfFile`].
pub struct ScreenPages {
    path: PathBuf,
    sharp: Option<SharpFile>,
    /// PDFium was tried for this file (and is in `sharp` if it read it).
    tried: bool,
}

impl ScreenPages {
    pub fn new(path: PathBuf) -> Self {
        Self { path, sharp: None, tried: false }
    }

    /// PDFium's copy of the document, opened the first time it is needed; `None` when it cannot be used.
    fn sharp(&mut self, file: &PdfFile) -> Option<&mut SharpFile> {
        if !self.tried {
            self.tried = true;
            match SharpFile::open(&self.path) {
                Some(Ok(sharp)) if sharp.page_count() == file.page_count() => self.sharp = Some(sharp),
                Some(Ok(_)) => trace("PDFium and MuPDF count the pages differently; MuPDF draws them"),
                Some(Err(error)) => trace(&error.to_string()),
                None => {}
            }
        }
        self.sharp.as_mut()
    }

    /// True when PDFium draws this document's pages.
    pub fn drawn_by_pdfium(&mut self, file: &PdfFile) -> bool {
        self.sharp(file).is_some()
    }

    /// A page as a PNG. `scale` 1.0 means 72 pixels per inch.
    pub fn page_png(&mut self, file: &PdfFile, index: usize, scale: f32, rotation: Rotation) -> Result<Vec<u8>, EngineError> {
        if let Some(sharp) = self.sharp(file) {
            let drawn = file.whole_picture(index, scale, rotation).and_then(|picture| {
                let rgb = sharp.draw(index, rotation, picture, [0, 0, picture[0], picture[1]])?;
                rgb_png(picture[0], picture[1], &rgb)
            });
            match drawn {
                Ok(png) => return Ok(png),
                Err(error) => trace(&error.to_string()),
            }
        }
        file.render_png(index, scale, rotation)
    }

    /// A piece of a page as a PNG, as [`PdfFile::render_tile_png`] cuts it.
    pub fn tile_png(&mut self, file: &PdfFile, index: usize, scale: f32, rotation: Rotation, tile: Tile) -> Result<Vec<u8>, EngineError> {
        if let Some(sharp) = self.sharp(file) {
            let drawn = file.tile_picture(index, scale, rotation, tile).and_then(|(picture, area)| {
                let rgb = sharp.draw(index, rotation, picture, area)?;
                rgb_png(area[2] - area[0], area[3] - area[1], &rgb)
            });
            match drawn {
                Ok(png) => return Ok(png),
                Err(error) => trace(&error.to_string()),
            }
        }
        file.render_tile_png(index, scale, rotation, tile)
    }
}
