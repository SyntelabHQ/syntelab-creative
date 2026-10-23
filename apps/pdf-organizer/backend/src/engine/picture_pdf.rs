//! Turning a picture into a one-page PDF, so that pictures can be combined
//! with documents like any other page (MuPDF binding).

use std::path::Path;

use mupdf::pdf::PdfDocument;
use mupdf::{Image, Size};

use super::page_change::{draw_over, put_resource};
use super::EngineError;

/// The longer side of the page a picture gets is never more than this: the
/// longer side of an A4 sheet, in points.
const LONGEST_SIDE: f32 = 842.0;
/// Dots per inch assumed for a picture that does not say.
const USUAL_RESOLUTION: f32 = 96.0;

/// Writes `destination`: a PDF with one page, filled by the picture in `picture`.
pub fn picture_to_pdf(picture: &Path, destination: &Path) -> Result<(), EngineError> {
    let name = |path: &Path| {
        path.to_str().map(str::to_owned).ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))
    };
    let image = Image::from_file(&name(picture)?).map_err(failed)?;
    let (resolution_x, resolution_y) = image.resolution();
    let (width, height) =
        page_size(image.width() as f32, image.height() as f32, resolution_x as f32, resolution_y as f32)
            .ok_or_else(|| EngineError::Failed("the picture has no size".into()))?;

    let mut document = PdfDocument::new();
    document.new_page(Size::new(width, height)).map_err(failed)?;
    let object = document.add_image(&image).map_err(failed)?;
    let mut page = document.find_page(0).map_err(failed)?;
    let picture_name = put_resource(&document, &mut page, "XObject", "Picture", &object, true)?;
    draw_over(&mut document, &mut page, &format!("q {width} 0 0 {height} 0 0 cm /{picture_name} Do Q\n"))?;
    document.save(&name(destination)?).map_err(failed)
}

/// The page a picture of `width` × `height` pixels gets, in points: its own
/// size on paper, made smaller when that would be larger than an A4 sheet.
fn page_size(width: f32, height: f32, resolution_x: f32, resolution_y: f32) -> Option<(f32, f32)> {
    if !(width > 0.0 && height > 0.0) {
        return None;
    }
    let resolution = |given: f32| if given.is_finite() && given >= 36.0 { given } else { USUAL_RESOLUTION };
    let own_width = width * 72.0 / resolution(resolution_x);
    let own_height = height * 72.0 / resolution(resolution_y);
    let shrink = (LONGEST_SIDE / own_width.max(own_height)).min(1.0);
    Some((own_width * shrink, own_height * shrink))
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::page_size;

    #[test]
    fn gives_a_small_picture_its_own_size_on_paper() {
        // 960 × 480 pixels at 96 dots per inch: 10 × 5 inches.
        assert_eq!(page_size(960.0, 480.0, 96.0, 96.0), Some((720.0, 360.0)));
        // No resolution given: the usual one.
        assert_eq!(page_size(960.0, 480.0, 0.0, 0.0), Some((720.0, 360.0)));
    }

    #[test]
    fn keeps_a_large_picture_within_a_sheet_and_in_shape() {
        let (width, height) = page_size(4000.0, 3000.0, 72.0, 72.0).expect("size");
        assert_eq!(width, 842.0);
        assert!((height - 631.5).abs() < 0.01);
        assert_eq!(page_size(0.0, 10.0, 96.0, 96.0), None);
    }
}
