        // A picture in the four inks of print cannot be written as a PNG: it is refused, and stays where it is.
//! MuPDF binding.

use std::path::Path;

use mupdf::document::MetadataName;
use mupdf::{Colorspace, Document, ImageFormat, Matrix, Outline};

use super::{Bookmark, DocumentFacts, EngineError, PageSize, Rotation, TextBox, TextLine};

/// More places than this on one page are not reported: a page that full of
/// the same text is not being read hit by hit.
const MAX_HITS_PER_PAGE: u32 = 500;

/// The scale pages are drawn at to find their white margins.
const MARGIN_SCALE: f32 = 1.5;
/// Lighter than this counts as paper: faint specks of a scan do not.
const PAPER_WHITE: u8 = 236;

/// The blank border of a picture `width` × `height`, in pixels: `[left, top,
/// right, bottom]`. All 0 when nothing in it is inked.
fn ink_margins(width: usize, height: usize, inked: impl Fn(usize, usize) -> bool) -> [usize; 4] {
    let row_inked = |y: usize| (0..width).any(|x| inked(x, y));
    let Some(top) = (0..height).find(|y| row_inked(*y)) else {
        return [0; 4];
    };
    let bottom = (0..height).rev().find(|y| row_inked(*y)).unwrap_or(top);
    let column_inked = |x: usize| (top..=bottom).any(|y| inked(x, y));
    let left = (0..width).find(|x| column_inked(*x)).unwrap_or(0);
    let right = (0..width).rev().find(|x| column_inked(*x)).unwrap_or(left);
    [left, top, width - 1 - right, height - 1 - bottom]
}

/// Largest picture one render may produce, in pixels. Keeps memory bounded
/// whatever zoom is asked for: the scale is lowered to fit.
const MAX_RENDER_PIXELS: f32 = 40_000_000.0;

/// An open PDF. Lives on the thread that opened it.
pub struct PdfFile {
    document: Document,
    page_count: usize,
}

impl PdfFile {
    pub fn open(path: &Path) -> Result<Self, EngineError> {
        // MuPDF takes file names as UTF-8 on every platform.
        let name = path
            .to_str()
            .ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
        let document = Document::open(name).map_err(failed)?;
        if document.needs_password().map_err(failed)? {
            return Err(EngineError::PasswordRequired);
        }
        let page_count = usize::try_from(document.page_count().map_err(failed)?).unwrap_or(0);
        Ok(Self { document, page_count })
    }

    pub fn page_count(&self) -> usize {
        self.page_count
    }

    pub fn page_size(&self, index: usize) -> Result<PageSize, EngineError> {
        let bounds = self.load_page(index)?.bounds().map_err(failed)?;
        Ok(PageSize { width: bounds.x1 - bounds.x0, height: bounds.y1 - bounds.y0 })
    }

    /// Draws one page as a PNG. `scale` 1.0 means 72 pixels per inch.
    pub fn render_png(&self, index: usize, scale: f32, rotation: Rotation) -> Result<Vec<u8>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        let area = (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0);
        let scale = fit_scale(scale, area);

        let mut transform = Matrix::new_scale(scale, scale);
        transform.concat(Matrix::new_rotate(rotation.degrees()));
        let pixmap = page
            .to_pixmap(&transform, &Colorspace::device_rgb(), false, true)
            .map_err(failed)?;
        let mut png = Vec::new();
        pixmap.write_to(&mut png, ImageFormat::PNG).map_err(failed)?;
        Ok(png)
    }

    /// How much blank paper a page has along each edge, as shown: `[left, top,
    /// right, bottom]` in points. A page with nothing on it has no margins to
    /// speak of: all four are 0.
    pub fn white_margins(&self, index: usize) -> Result<[f32; 4], EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        // Drawn in grey at a modest size: enough to tell paper from what is on it.
        let scale = fit_scale(MARGIN_SCALE, (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0));
        let pixmap = page
            .to_pixmap(&Matrix::new_scale(scale, scale), &Colorspace::device_gray(), false, true)
            .map_err(failed)?;
        let (width, height) = (pixmap.width() as usize, pixmap.height() as usize);
        let (stride, parts) = (pixmap.stride().unsigned_abs(), usize::from(pixmap.n()));
        let samples = pixmap.samples();
        let inked = |x: usize, y: usize| samples.get(y * stride + x * parts).is_some_and(|grey| *grey < PAPER_WHITE);
        Ok(ink_margins(width, height, inked).map(|pixels| pixels as f32 / scale))
    }

    /// What the document says about itself.
    pub fn facts(&self) -> DocumentFacts {
        // A field that cannot be read is as good as one left out.
        let read = |name: MetadataName| self.document.metadata(name).unwrap_or_default();
        DocumentFacts {
            title: read(MetadataName::Title),
            author: read(MetadataName::Author),
            subject: read(MetadataName::Subject),
            keywords: read(MetadataName::Keywords),
            creator: read(MetadataName::Creator),
            producer: read(MetadataName::Producer),
            created: read(MetadataName::CreationDate),
            modified: read(MetadataName::ModDate),
            format: read(MetadataName::Format),
        }
    }

    /// The document's table of contents; empty when it has none.
    pub fn bookmarks(&self) -> Result<Vec<Bookmark>, EngineError> {
        fn convert(entries: Vec<Outline>, page_count: usize) -> Vec<Bookmark> {
            entries
                .into_iter()
                .map(|entry| Bookmark {
                    title: entry.title,
                    page: entry
                        .dest
                        .map(|destination| destination.loc.page_number as usize)
                        .filter(|page| *page < page_count),
                    children: convert(entry.down, page_count),
                })
                .collect()
        }
        Ok(convert(self.document.outlines().map_err(failed)?, self.page_count))
    }

    /// Where the pictures of one page are, in the order the page draws them:
    /// each as a box in points from the top-left corner of the page as shown.
    pub fn pictures(&self, index: usize) -> Result<Vec<TextBox>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        let parts = page.to_text_page(mupdf::TextPageFlags::PRESERVE_IMAGES).map_err(failed)?;
        Ok(parts
            .blocks()
            .filter(|block| block.r#type() == mupdf::text_page::TextBlockType::Image)
            .map(|block| {
                let area = block.bounds();
                TextBox { x: area.x0 - bounds.x0, y: area.y0 - bounds.y0, width: area.x1 - area.x0, height: area.y1 - area.y0 }
            })
            .collect())
    }

    /// The picture at `number` among the pictures of a page (see [`Self::pictures`]), as a PNG.
    pub fn picture(&self, index: usize, number: usize) -> Result<Vec<u8>, EngineError> {
        let page = self.load_page(index)?;
        let parts = page.to_text_page(mupdf::TextPageFlags::PRESERVE_IMAGES).map_err(failed)?;
        let image = parts
            .blocks()
            .filter(|block| block.r#type() == mupdf::text_page::TextBlockType::Image)
            .nth(number)
            .and_then(|block| block.image())
            .ok_or_else(|| EngineError::Failed(format!("the page has no picture {number}")))?;
        let pixels = image.to_pixmap().map_err(failed)?;
        // A picture in the four inks of print cannot be written as a PNG: it is refused, and stays where it is.
        // What is see-through in a picture is kept beside it in the file: the two are put together again.
        let pixels = match image.mask().map(|mask| mask.to_pixmap()).transpose().map_err(failed)? {
            Some(mask) => see_through(&pixels, &mask)?.unwrap_or(pixels),
            None => pixels,
        };
        let mut png = Vec::new();
        pixels.write_to(&mut png, mupdf::ImageFormat::PNG).map_err(failed)?;
        Ok(png)
    }

    /// The links of one page. A link that leads nowhere that can be told is left out.
    pub fn links(&self, index: usize) -> Result<Vec<super::PageLink>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        let mut links = Vec::new();
        for link in page.links().map_err(failed)? {
            let to_page = link.dest.map(|destination| destination.loc.page_number as usize).filter(|page| *page < self.page_count);
            let address = (to_page.is_none() && !link.uri.is_empty() && !link.uri.starts_with('#')).then(|| link.uri.clone());
            if to_page.is_none() && address.is_none() {
                continue;
            }
            let area = link.bounds;
            links.push(super::PageLink {
                area: TextBox { x: area.x0 - bounds.x0, y: area.y0 - bounds.y0, width: area.x1 - area.x0, height: area.y1 - area.y0 },
                address,
                page: to_page,
            });
        }
        Ok(links)
    }

    /// The boxes of the signatures shown on one page, each with the number of its field's object (as
    /// [`super::FoundSignature::object`] has it). Signatures that show nowhere have no box.
    pub fn signature_boxes(&self, index: usize) -> Result<Vec<(TextBox, i32)>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        // Only a PDF page has form fields.
        let Ok(page) = mupdf::pdf::PdfPage::try_from(page) else {
            return Ok(Vec::new());
        };
        let mut boxes = Vec::new();
        for widget in page.widgets() {
            if !matches!(widget.r#type(), Ok(mupdf::pdf::WidgetType::Signature)) {
                continue;
            }
            let annotation = widget.annotation();
            let area = annotation.bounds().map_err(failed)?;
            if area.x1 - area.x0 < 1.0 || area.y1 - area.y0 < 1.0 {
                continue;
            }
            // A box is its field, or one of the boxes of the field above it.
            let object = annotation.object();
            let field = match object.get_dict("T") {
                Ok(Some(_)) => object.as_indirect().ok(),
                _ => object.get_dict("Parent").ok().flatten().and_then(|parent| parent.as_indirect().ok()),
            };
            let Some(field) = field.filter(|number| *number > 0) else {
                continue;
            };
            boxes.push((TextBox { x: area.x0 - bounds.x0, y: area.y0 - bounds.y0, width: area.x1 - area.x0, height: area.y1 - area.y0 }, field));
        }
        Ok(boxes)
    }

    /// The text of one page, line by line, as a reader would copy it.
    pub fn page_text(&self, index: usize) -> Result<String, EngineError> {
        self.load_page(index)?.text(mupdf::TextExtractOptions::default()).map_err(failed)
    }

    /// The lines of text of one page, in reading order, each with where it
    /// stands and how it is written. Lines without anything to read are left out.
    pub fn text_lines(&self, index: usize) -> Result<Vec<TextLine>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        let words = page.to_text_page(mupdf::TextPageFlags::empty()).map_err(failed)?;
        let mut lines = Vec::new();
        for block in words.blocks() {
            for line in block.lines() {
                let text: String = line.chars().filter_map(|letter| letter.char()).collect();
                let Some(first) = line.chars().find(|letter| letter.char().is_some_and(|letter| !letter.is_whitespace())) else {
                    continue;
                };
                let font = first.font();
                let is = |ask: fn(&mupdf::Font) -> bool| font.as_ref().is_some_and(ask);
                let named = font.as_ref().map(|font| font_facts(font.name())).unwrap_or_default();
                let color = first.argb();
                let part = |shift: u32| ((color >> shift) & 0xFF) as f32 / 255.0;
                let area = line.bounds();
                lines.push(TextLine {
                    text: text.trim_end().to_owned(),
                    area: TextBox { x: area.x0 - bounds.x0, y: area.y0 - bounds.y0, width: area.x1 - area.x0, height: area.y1 - area.y0 },
                    size: first.size(),
                    color: [part(16), part(8), part(0)],
                    // What the font says of itself, or what its name gives away: files often leave the first out.
                    bold: is(mupdf::Font::is_bold) || named.bold,
                    italic: is(mupdf::Font::is_italic) || named.italic,
                    family: if is(mupdf::Font::is_monospaced) || named.mono { "mono" } else if named.serif { "serif" } else { "sans" },
                    font_name: named.family,
                });
            }
        }
        Ok(lines)
    }

    /// Where `needle` is written on one page, ignoring upper and lower case.
    /// A match that runs over two lines gives one box per line.
    pub fn search_page(&self, index: usize, needle: &str) -> Result<Vec<TextBox>, EngineError> {
        let page = self.load_page(index)?;
        let bounds = page.bounds().map_err(failed)?;
        let quads = page.search(needle, MAX_HITS_PER_PAGE).map_err(failed)?;
        Ok(quads
            .iter()
            .map(|quad| {
                let xs = [quad.ul.x, quad.ur.x, quad.ll.x, quad.lr.x];
                let ys = [quad.ul.y, quad.ur.y, quad.ll.y, quad.lr.y];
                let (left, right) = (xs.iter().copied().fold(f32::MAX, f32::min), xs.iter().copied().fold(f32::MIN, f32::max));
                let (top, bottom) = (ys.iter().copied().fold(f32::MAX, f32::min), ys.iter().copied().fold(f32::MIN, f32::max));
                TextBox { x: left - bounds.x0, y: top - bounds.y0, width: right - left, height: bottom - top }
            })
            .collect())
    }

    fn load_page(&self, index: usize) -> Result<mupdf::Page, EngineError> {
        if index >= self.page_count {
            return Err(EngineError::NoSuchPage(index));
        }
        let number = i32::try_from(index).map_err(|_| EngineError::NoSuchPage(index))?;
        self.document.load_page(number).map_err(failed)
    }
}

/// What the name of a font in a PDF tells: `ABCDEF+TimesNewRomanPS-BoldItalicMT`
/// is Times New Roman, bold, italic, with serifs.
#[derive(Debug, Default, PartialEq)]
struct FontFacts {
    family: String,
    bold: bool,
    italic: bool,
    serif: bool,
    mono: bool,
}

fn font_facts(name: &str) -> FontFacts {
    // A font cut down to the letters used gets six letters and a plus before its name.
    let name = name.split_once('+').map_or(name, |(_, rest)| rest);
    let lower = name.to_ascii_lowercase();
    let has = |words: &[&str]| words.iter().any(|word| lower.contains(word));
    let (base, _style) = name.split_once(['-', ',']).unwrap_or((name, ""));
    let mut family = base.to_owned();
    for ending in ["PSMT", "MT", "PS", "Bold", "Italic", "Oblique", "Regular"] {
        if let Some(shorter) = family.strip_suffix(ending) {
            family = shorter.to_owned();
        }
    }
    // `TimesNewRoman` is written `Times New Roman` where fonts are listed.
    let mut spaced = String::new();
    let mut before: Option<char> = None;
    for letter in family.chars() {
        let after_small = before.is_some_and(char::is_lowercase);
        if letter.is_uppercase() && after_small {
            spaced.push(' ');
        }
        spaced.push(letter);
        before = Some(letter);
    }
    FontFacts {
        family: spaced.trim().to_owned(),
        bold: has(&["bold", "black", "heavy", "semibold", "demi"]),
        italic: has(&["italic", "oblique"]),
        serif: has(&["times", "serif", "georgia", "garamond", "roman", "cambria", "palatino", "book", "minion", "century"]) && !has(&["sans"]),
        mono: has(&["courier", "mono", "consol", "typewriter"]),
    }
}

/// Keeps the scale sane and the picture under [`MAX_RENDER_PIXELS`].
fn fit_scale(scale: f32, page_area_points: f32) -> f32 {
    let scale = if scale.is_finite() { scale.clamp(0.05, 16.0) } else { 1.0 };
    if page_area_points <= 0.0 {
        return scale;
    }
    let largest = (MAX_RENDER_PIXELS / page_area_points).sqrt();
    scale.min(largest)
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

/// The colors of `pixels` with `mask` saying how much of each shows (white:
/// all of it), as one picture with see-through parts. `None` for pictures
/// this cannot be done for (colors other than gray or red-green-blue): the
/// picture is then used without its see-through parts.
fn see_through(pixels: &mupdf::Pixmap, mask: &mupdf::Pixmap) -> Result<Option<mupdf::Pixmap>, EngineError> {
    let (width, height, colors) = (pixels.width() as usize, pixels.height() as usize, usize::from(pixels.n()));
    let (mask_width, mask_height, mask_parts) = (mask.width() as usize, mask.height() as usize, usize::from(mask.n()));
    if pixels.alpha() || !(colors == 1 || colors == 3) || width == 0 || height == 0 || mask_width == 0 || mask_height == 0 || mask_parts == 0 {
        return Ok(None);
    }
    let (Ok(width_i32), Ok(height_i32)) = (i32::try_from(width), i32::try_from(height)) else {
        return Ok(None);
    };
    let mut together = mupdf::Pixmap::new_with_w_h(&mupdf::Colorspace::device_rgb(), width_i32, height_i32, true).map_err(failed)?;
    let (stride, mask_stride, out_stride) = (pixels.stride() as usize, mask.stride() as usize, together.stride() as usize);
    let (from, shows) = (pixels.samples(), mask.samples());
    let out = together.samples_mut();
    for y in 0..height {
        // The mask may be coarser or finer than the picture: the nearest of its dots is asked.
        let mask_row = (y * mask_height / height) * mask_stride;
        for x in 0..width {
            let alpha = u32::from(shows.get(mask_row + (x * mask_width / width) * mask_parts).copied().unwrap_or(255));
            let at = y * stride + x * colors;
            let color = |part: usize| u32::from(from.get(at + if colors == 3 { part } else { 0 }).copied().unwrap_or(0));
            let to = y * out_stride + x * 4;
            if let Some(dot) = out.get_mut(to..to + 4) {
                // Colors are kept already dimmed by how much of them shows, as the library keeps them.
                for (part, value) in dot.iter_mut().enumerate().take(3) {
                    *value = (color(part) * alpha / 255) as u8;
                }
                dot[3] = alpha as u8;
            }
        }
    }
    Ok(Some(together))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_a_font_name_tells() {
        let times = font_facts("ABCDEF+TimesNewRomanPS-BoldItalicMT");
        assert_eq!((times.family.as_str(), times.bold, times.italic, times.serif), ("Times New Roman", true, true, true));
        let arial = font_facts("ArialMT");
        assert_eq!((arial.family.as_str(), arial.bold, arial.serif, arial.mono), ("Arial", false, false, false));
        assert!(font_facts("Arial,Bold").bold);
        // Letters outside ASCII take more than one byte each.
        assert_eq!(font_facts("ÉtéÜber").family, "Été Über");
        assert!(font_facts("CourierNewPSMT").mono);
        assert!(!font_facts("OpenSans-Regular").serif);
    }

    #[test]
    fn finds_the_blank_border_of_a_picture() {
        // Ink from (3, 2) to (6, 4) on a sheet 10 wide and 8 tall.
        let inked = |x: usize, y: usize| (3..=6).contains(&x) && (2..=4).contains(&y);
        assert_eq!(ink_margins(10, 8, inked), [3, 2, 3, 3]);
        assert_eq!(ink_margins(10, 8, |_, _| false), [0; 4]);
        assert_eq!(ink_margins(10, 8, |_, _| true), [0; 4]);
    }

    #[test]
    fn keeps_normal_scales_and_limits_huge_ones() {
        let a4 = 595.0 * 842.0;
        assert_eq!(fit_scale(2.0, a4), 2.0);
        assert_eq!(fit_scale(f32::NAN, a4), 1.0);
        assert_eq!(fit_scale(0.0, a4), 0.05);

        let limited = fit_scale(16.0, a4);
        assert!(limited < 16.0);
        assert!(a4 * limited * limited <= MAX_RENDER_PIXELS * 1.001);
    }
}
