//! A PDF of empty pages, written by hand: it needs nothing from the engine.

use std::fs;
use std::path::Path;

use super::EngineError;

/// The most pages one new document starts with.
pub const MAX_BLANK_PAGES: usize = 500;
/// The sizes a page may have, in points: from a stamp to a wall poster.
const SMALLEST_SIDE: f32 = 20.0;
const LARGEST_SIDE: f32 = 14_400.0;

/// Writes `destination`: `count` empty pages of `width` × `height` points.
pub fn blank_pdf(width: f32, height: f32, count: usize, destination: &Path) -> Result<(), EngineError> {
    let usable = |side: f32| side.is_finite() && (SMALLEST_SIDE..=LARGEST_SIDE).contains(&side);
    if !usable(width) || !usable(height) || count == 0 || count > MAX_BLANK_PAGES {
        return Err(EngineError::Failed("not a usable page size or number of pages".into()));
    }
    fs::write(destination, blank_pdf_bytes(width, height, count)).map_err(|error| EngineError::Failed(error.to_string()))
}

fn blank_pdf_bytes(width: f32, height: f32, count: usize) -> Vec<u8> {
    let kids = (0..count).map(|index| format!("{} 0 R", index + 3)).collect::<Vec<_>>().join(" ");
    let mut objects = vec!["<< /Type /Catalog /Pages 2 0 R >>".to_owned(), format!("<< /Type /Pages /Count {count} /Kids [{kids}] >>")];
    for _ in 0..count {
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] /Resources << >> >>"));
    }

    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
    }
    let table = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{table}\n%%EOF\n", objects.len() + 1).bytes());
    pdf
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_one_page_object_per_page() {
        let pdf = String::from_utf8(blank_pdf_bytes(595.0, 842.0, 3)).expect("plain text");
        assert_eq!(pdf.matches("/Type /Page ").count(), 3);
        assert!(pdf.contains("/Count 3"));
        assert!(pdf.contains("/MediaBox [0 0 595 842]"));
        assert!(pdf.ends_with("%%EOF\n"));
    }

    #[test]
    fn refuses_sizes_and_counts_that_make_no_document() {
        let nowhere = Path::new("unused.pdf");
        assert!(blank_pdf(0.0, 842.0, 1, nowhere).is_err());
        assert!(blank_pdf(595.0, f32::NAN, 1, nowhere).is_err());
        assert!(blank_pdf(595.0, 842.0, 0, nowhere).is_err());
        assert!(blank_pdf(595.0, 842.0, MAX_BLANK_PAGES + 1, nowhere).is_err());
    }
}
