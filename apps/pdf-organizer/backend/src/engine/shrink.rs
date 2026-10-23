//! Making a PDF smaller by making its photographs smaller: fewer pixels,
//! saved again as JPEG (MuPDF binding).
//!
//! Only pictures already stored as JPEG are touched. They are photographs and
//! scans, where a little loss does not show; drawings and screenshots stored
//! without loss stay exactly as they are.

use std::collections::HashSet;

use jpeg_encoder::{ColorType, Encoder};
use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::{Buffer, Image};

use super::EngineError;

/// How far pictures are shrunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PictureShrink {
    /// Pictures longer than this on their longer side, in pixels, are made
    /// smaller: halved until they are under twice this.
    pub longest_side: u32,
    /// JPEG quality of the shrunk pictures, 1 to 100.
    pub quality: u8,
}

/// Shrinks the photographs of every page of `document`. A picture that would
/// not come out smaller is left alone, and so is one that cannot be read.
pub(super) fn shrink_pictures(document: &mut PdfDocument, shrink: PictureShrink) -> Result<(), EngineError> {
    let page_count = document.page_count().map_err(failed)?;
    let mut seen = HashSet::new();
    for page_number in 0..page_count {
        let page = document.load_pdf_page(page_number).map_err(failed)?;
        // A page whose pictures cannot be listed keeps them as they are.
        for picture in page.images().unwrap_or_default() {
            // The same picture is often on many pages (a logo): once is enough.
            // The filter is given as the file writes names: with a slash in front.
            let is_jpeg = picture.filter.as_deref().is_some_and(|filter| filter.trim_start_matches('/') == "DCTDecode");
            if !seen.insert(picture.xref) || !is_jpeg {
                continue;
            }
            let Some(level) = halvings(picture.width.max(picture.height), shrink.longest_side) else {
                continue;
            };
            let Ok(mut object) = document.new_indirect(picture.xref, 0) else {
                continue;
            };
            // What a failure leaves behind is the picture as it was.
            let _ = shrink_one(&mut object, level, shrink.quality);
        }
    }
    Ok(())
}

/// How many times a side of `length` pixels is halved to come under twice
/// `longest`. `None` when it is small enough already.
fn halvings(length: u32, longest: u32) -> Option<i32> {
    let longest = longest.max(16);
    let mut level = 0;
    let mut length = length;
    while length >= longest * 2 {
        length /= 2;
        level += 1;
    }
    (level > 0).then_some(level)
}

/// Replaces the data of one JPEG picture by a smaller JPEG. Returns whether it did.
fn shrink_one(picture: &mut PdfObject, level: i32, quality: u8) -> Result<bool, mupdf::Error> {
    // A picture with a mask of its own size would no longer fit its mask.
    if picture.get_dict("SMask")?.is_some() || picture.get_dict("Mask")?.is_some() {
        return Ok(false);
    }
    let original = picture.read_raw_stream()?;
    let mut pixels = Image::from_bytes(&original)?.to_pixmap()?;
    pixels.shrink(level)?;

    let color = match (pixels.n(), pixels.alpha()) {
        (1, false) => ColorType::Luma,
        (3, false) => ColorType::Rgb,
        // Four inks, or see-through: left as it is.
        _ => return Ok(false),
    };
    let (width, height) = (pixels.width() as usize, pixels.height() as usize);
    let (Ok(short_width), Ok(short_height)) = (u16::try_from(width), u16::try_from(height)) else {
        return Ok(false);
    };
    // Rows may be stored with padding after them: take just the pixels.
    let row_length = width * usize::from(pixels.n());
    let stride = pixels.stride().unsigned_abs();
    let samples = pixels.samples();
    let mut packed = Vec::with_capacity(row_length * height);
    for row in 0..height {
        let start = row * stride;
        let Some(pixels_of_row) = samples.get(start..start + row_length) else {
            return Ok(false);
        };
        packed.extend_from_slice(pixels_of_row);
    }

    let mut smaller = Vec::new();
    let encoder = Encoder::new(&mut smaller, quality.clamp(1, 100));
    if encoder.encode(&packed, short_width, short_height, color).is_err() || smaller.len() >= original.len() {
        return Ok(false);
    }

    picture.write_raw_stream_buffer(&Buffer::from_bytes(&smaller)?)?;
    picture.dict_put("Width", PdfObject::new_int(i32::from(short_width))?)?;
    picture.dict_put("Height", PdfObject::new_int(i32::from(short_height))?)?;
    picture.dict_put("BitsPerComponent", PdfObject::new_int(8)?)?;
    picture.dict_put("Filter", PdfObject::new_name("DCTDecode")?)?;
    picture.dict_put(
        "ColorSpace",
        PdfObject::new_name(if color == ColorType::Luma { "DeviceGray" } else { "DeviceRGB" })?,
    )?;
    // Described the old data: how it was packed, how its colors were stretched.
    picture.dict_delete("DecodeParms")?;
    picture.dict_delete("Decode")?;
    Ok(true)
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::halvings;

    #[test]
    fn halves_a_picture_until_it_is_under_twice_the_longest_side() {
        assert_eq!(halvings(1000, 1200), None);
        assert_eq!(halvings(2399, 1200), None);
        assert_eq!(halvings(2400, 1200), Some(1));
        assert_eq!(halvings(4000, 1200), Some(1));
        assert_eq!(halvings(6000, 1200), Some(2));
        assert_eq!(halvings(12000, 1200), Some(3));
        // A longest side that makes no sense counts as a very small one (16 pixels).
        assert_eq!(halvings(100, 0), Some(2));
        assert_eq!(halvings(20, 0), None);
    }
}
