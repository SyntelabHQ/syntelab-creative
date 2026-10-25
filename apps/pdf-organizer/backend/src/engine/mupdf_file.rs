        // A picture in the four inks of print cannot be written as a PNG: it is refused, and stays where it is.
//! MuPDF binding.

use std::cell::RefCell;
use std::path::Path;

use mupdf::document::MetadataName;
use mupdf::{Colorspace, Device, DisplayList, Document, IRect, Matrix, Outline, Pixmap, Rect};

use super::{Bookmark, DocumentFacts, EngineError, PageSize, Rotation, TextBox, TextLine, Tile};

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

/// The longest side of one piece of a page, in pixels: the interface asks for small ones.
pub const MAX_TILE_SIDE: u32 = 2048;
/// Pieces of a page are drawn up to this sharp (1 = 72 pixels per inch): enough for the largest zoom on any screen.
const MAX_TILE_SCALE: f32 = 128.0;

/// A page made ready to draw, again and again, in pieces.
struct ReadyPage {
    index: usize,
    bounds: Rect,
    list: DisplayList,
}

/// An open PDF. Lives on the thread that opened it.
pub struct PdfFile {
    document: Document,
    page_count: usize,
    /// The page last drawn in pieces: read once, then each piece only draws.
    ready: RefCell<Option<ReadyPage>>,
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
        Ok(Self { document, page_count, ready: RefCell::new(None) })
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

        let pixmap = page
            .to_pixmap(&whole_pixels(bounds, scale, rotation), &Colorspace::device_rgb(), false, true)
            .map_err(failed)?;
        quick_png(&pixmap)
    }

    /// The size in pixels (`[width, height]`, turned) of the picture [`Self::render_png`] draws.
    pub fn whole_picture(&self, index: usize, scale: f32, rotation: Rotation) -> Result<[u32; 2], EngineError> {
        let bounds = self.load_page(index)?.bounds().map_err(failed)?;
        let scale = fit_scale(scale, (bounds.x1 - bounds.x0) * (bounds.y1 - bounds.y0));
        Ok(picture_pixels(bounds, scale, rotation))
    }

    /// The size in pixels of the picture [`Self::render_tile_png`] cuts `tile` from, and the part of it the piece
    /// is (`[left, top, right, bottom]`).
    pub fn tile_picture(&self, index: usize, scale: f32, rotation: Rotation, tile: Tile) -> Result<([u32; 2], [u32; 4]), EngineError> {
        let scale = if scale.is_finite() { scale.clamp(0.05, MAX_TILE_SCALE) } else { 1.0 };
        let bounds = self.load_page(index)?.bounds().map_err(failed)?;
        let picture = picture_pixels(bounds, scale, rotation);
        let side = |value: u32| i32::try_from(value).unwrap_or(i32::MAX);
        let area = tile_area(tile, side(picture[0]), side(picture[1]))
            .ok_or_else(|| EngineError::Failed("the piece is outside the page".into()))?;
        let corner = |value: i32| u32::try_from(value).unwrap_or(0);
        Ok((picture, [corner(area.x0), corner(area.y0), corner(area.x1), corner(area.y1)]))
    }

    /// Draws a piece of a page as a PNG: the rectangle `tile` of the picture [`Self::render_png`] would draw at
    /// `scale`, in pixels from its top-left corner (as shown, turned). A piece reaching past the page is cut at its
    /// edge. Zoomed far in, the interface asks only for the pieces on screen.
    pub fn render_tile_png(&self, index: usize, scale: f32, rotation: Rotation, tile: Tile) -> Result<Vec<u8>, EngineError> {
        let scale = if scale.is_finite() { scale.clamp(0.05, MAX_TILE_SCALE) } else { 1.0 };
        let mut ready = self.ready.borrow_mut();
        if ready.as_ref().is_none_or(|page| page.index != index) {
            let page = self.load_page(index)?;
            let bounds = page.bounds().map_err(failed)?;
            let list = page.to_display_list(true).map_err(failed)?;
            *ready = Some(ReadyPage { index, bounds, list });
        }
        let page = ready.as_ref().ok_or_else(|| EngineError::Failed("the page could not be read".into()))?;
        let matrix = whole_pixels(page.bounds, scale, rotation);
        let whole = page.bounds.transform(&matrix);
        let area = tile_area(tile, whole.x1.round() as i32, whole.y1.round() as i32)
            .ok_or_else(|| EngineError::Failed("the piece is outside the page".into()))?;
        let mut pixmap = Pixmap::new_with_rect(&Colorspace::device_rgb(), area, false).map_err(failed)?;
        pixmap.clear_with(255).map_err(failed)?;
        {
            // Done drawing once the device is let go.
            let device = Device::from_pixmap(&pixmap).map_err(failed)?;
            let clip = Rect { x0: area.x0 as f32, y0: area.y0 as f32, x1: area.x1 as f32, y1: area.y1 as f32 };
            page.list.run(&device, &matrix, clip).map_err(failed)?;
        }
        quick_png(&pixmap)
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

/// Draws the page, turned, onto a whole number of pixels: its width and height times `scale`, rounded. The page fills
/// the picture edge to edge, so the viewer shows it pixel for pixel instead of stretching it by a pixel or two (which
/// softens every letter). Turning alone would leave the page starting part of a pixel in, with a row of half-drawn
/// pixels on each side.
fn whole_pixels(bounds: mupdf::Rect, scale: f32, rotation: Rotation) -> Matrix {
    let turn = Matrix::new_rotate(rotation.degrees());
    let turned = bounds.transform(&turn);
    let (width, height) = (turned.x1 - turned.x0, turned.y1 - turned.y0);
    let mut transform = turn;
    transform.concat(Matrix::new_translate(-turned.x0, -turned.y0));
    if width > 0.0 && height > 0.0 {
        let pixels_wide = (width * scale).round().max(1.0);
        let pixels_high = (height * scale).round().max(1.0);
        transform.concat(Matrix::new_scale(pixels_wide / width, pixels_high / height));
    }
    transform
}

/// The pixels of `tile` within a picture `width` × `height`, at most [`MAX_TILE_SIDE`] along each side; `None`
/// when nothing of it is on the picture.
fn tile_area(tile: Tile, width: i32, height: i32) -> Option<IRect> {
    let side = |value: u32| i32::try_from(value.min(MAX_TILE_SIDE)).unwrap_or(0);
    let (x0, y0) = (i32::try_from(tile.x).ok()?, i32::try_from(tile.y).ok()?);
    let (x1, y1) = ((x0.saturating_add(side(tile.width))).min(width), (y0.saturating_add(side(tile.height))).min(height));
    (x0 < x1 && y0 < y1).then_some(IRect { x0, y0, x1, y1 })
}

/// The size in pixels of a page with these bounds drawn at `scale` and turned, as [`whole_pixels`] makes it.
fn picture_pixels(bounds: Rect, scale: f32, rotation: Rotation) -> [u32; 2] {
    let (width, height) = (bounds.x1 - bounds.x0, bounds.y1 - bounds.y0);
    let (width, height) = match rotation {
        Rotation::None | Rotation::Half => (width, height),
        Rotation::Quarter | Rotation::ThreeQuarters => (height, width),
    };
    let pixels = |points: f32| (points * scale).round().max(1.0) as u32;
    [pixels(width), pixels(height)]
}

/// A PNG of `pixmap` (red, green, blue), written for speed: the pictures go to the viewer on this computer, never
/// over a network, so a quicker page counts for more than a smaller file.
fn quick_png(pixmap: &mupdf::Pixmap) -> Result<Vec<u8>, EngineError> {
    let (width, height) = (pixmap.width(), pixmap.height());
    let channels = usize::from(pixmap.n());
    if channels != 3 {
        return Err(EngineError::Failed(format!("a picture with {channels} channels was drawn where 3 were asked for")));
    }
    let row = width as usize * channels;
    let stride = usize::try_from(pixmap.stride()).unwrap_or(row);
    let samples = pixmap.samples();
    if stride == row {
        rgb_png(width, height, samples.get(..row * height as usize).unwrap_or(samples))
    } else {
        let rows: Vec<u8> = samples.chunks(stride).take(height as usize).flat_map(|line| &line[..row.min(line.len())]).copied().collect();
        rgb_png(width, height, &rows)
    }
}

/// A PNG of `rgb` (red, green, blue, row after row, `width` × `height`), written for speed.
pub(super) fn rgb_png(width: u32, height: u32, rgb: &[u8]) -> Result<Vec<u8>, EngineError> {
    let mut png = Vec::new();
    let mut encoder = png::Encoder::new(&mut png, width, height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Fast);
    encoder.set_filter(png::FilterType::Sub);
    let encoding = |error: png::EncodingError| EngineError::Failed(error.to_string());
    let mut writer = encoder.write_header().map_err(encoding)?;
    writer.write_image_data(rgb).map_err(encoding)?;
    writer.finish().map_err(encoding)?;
    Ok(png)
}

/// Keeps the scale sane and the picture under [`MAX_RENDER_PIXELS`].
fn fit_scale(scale: f32, page_area_points: f32) -> f32 {
    let scale = if scale.is_finite() { scale.clamp(0.05, MAX_TILE_SCALE) } else { 1.0 };
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
    fn draws_a_page_onto_whole_pixels_edge_to_edge_however_it_is_turned() {
        // A page that does not start at 0, at a scale that does not give whole pixels by itself.
        let bounds = mupdf::Rect { x0: 10.3, y0: 5.0, x1: 605.58, y1: 846.89 };
        let scale: f32 = 1.6667;
        let (wide, high) = (((605.58_f32 - 10.3) * scale).round(), ((846.89_f32 - 5.0) * scale).round());
        for (rotation, expected) in [
            (Rotation::None, (wide, high)),
            (Rotation::Quarter, (high, wide)),
            (Rotation::Half, (wide, high)),
            (Rotation::ThreeQuarters, (high, wide)),
        ] {
            let drawn = bounds.transform(&whole_pixels(bounds, scale, rotation));
            for (got, want) in [(drawn.x0, 0.0), (drawn.y0, 0.0), (drawn.x1, expected.0), (drawn.y1, expected.1)] {
                assert!((got - want).abs() < 0.01, "{rotation:?}: {got} where {want} was expected");
            }
        }
    }

    #[test]
    fn writes_a_png_the_viewer_can_read() {
        let mut pixmap = mupdf::Pixmap::new_with_w_h(&Colorspace::device_rgb(), 3, 2, false).unwrap();
        pixmap.samples_mut().copy_from_slice(&[255, 0, 0, 0, 255, 0, 0, 0, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        let png = quick_png(&pixmap).unwrap();
        let mut reader = png::Decoder::new(png.as_slice()).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((frame.width, frame.height), (3, 2));
        assert_eq!(&pixels[..frame.buffer_size()], &[255, 0, 0, 0, 255, 0, 0, 0, 255, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    #[test]
    fn cuts_a_piece_at_the_edge_of_the_page() {
        let tile = |x, y, width, height| Tile { x, y, width, height };
        assert_eq!(tile_area(tile(10, 20, 100, 50), 1000, 800), Some(IRect { x0: 10, y0: 20, x1: 110, y1: 70 }));
        assert_eq!(tile_area(tile(950, 780, 100, 50), 1000, 800), Some(IRect { x0: 950, y0: 780, x1: 1000, y1: 800 }));
        assert_eq!(tile_area(tile(0, 0, 9999, 9999), 5000, 5000), Some(IRect { x0: 0, y0: 0, x1: 2048, y1: 2048 }));
        assert_eq!(tile_area(tile(1000, 0, 10, 10), 1000, 800), None);
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
