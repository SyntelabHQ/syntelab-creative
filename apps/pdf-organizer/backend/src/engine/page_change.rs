//! Changing a page while a new PDF is written: cutting its edges off, putting
//! it on a sheet of another size, or drawing over it (a page number, a
//! watermark) (MuPDF binding).
//!
//! Sizes and edges are given for the page as it is shown, that is after the
//! page's own rotation; the arithmetic that turns them into the page's
//! unrotated boxes is in plain functions at the end, tested without MuPDF.

use std::io::Read;
use std::sync::Arc;

use mupdf::pdf::{PdfDocument, PdfObject, PdfRedactImageMethod, PdfRedactLineArtMethod, PdfRedactOptions, PdfRedactTextMethod};
use mupdf::{Buffer, Font, Image, Rect};

use super::EngineError;

/// What is done to a page, on top of placing and turning it.
#[derive(Debug, Clone, PartialEq)]
pub enum PageChange {
    /// Cuts this much off each edge of the page as shown, in PDF points.
    /// Nothing is removed from the file: the page only shows less.
    Crop { left: f32, top: f32, right: f32, bottom: f32 },
    /// Puts the page on a sheet of this size, in PDF points: scaled to fit.
    /// With `match_orientation`, the sheet is turned to lie the way the page
    /// does (a wide page gets a wide sheet). With `keep_size`, the page is not
    /// made larger than it is (it is still made smaller when it would not
    /// fit). `place` says where it lies in the room that is left, as the
    /// reader sees it: across (0 left, 0.5 middle, 1 right) and down (0 top,
    /// 0.5 middle, 1 bottom).
    Fit { width: f32, height: f32, match_orientation: bool, keep_size: bool, place: [f32; 2] },
    /// Writes a short text near an edge of the page as shown: a page number.
    /// `size` (of the letters) and `margin` (from the edges) are in points.
    Label { text: String, place: Place, size: f32, margin: f32 },
    /// Draws a picture (PNG or JPEG data; a PNG may be see-through) over the
    /// page as shown. With an `area` it fills that area (an added image, a
    /// signature); without, it lies over the middle of the page, taking up to
    /// `width` (0 to 1) of it in both directions (a watermark).
    Picture { data: Arc<Vec<u8>>, width: f32, area: Option<Area> },
    /// Writes text on the page as shown: its first line starts at `x`, with
    /// the top of its letters at `y` (both from the top-left corner, in
    /// points). Lines are split at line breaks. Fails with
    /// [`EngineError::LettersMissing`] when the built-in font cannot write it.
    Text { text: String, x: f32, y: f32, size: f32, color: [f32; 3] },
    /// Draws a shape in `area`, with a line of `line_width` points in
    /// `color`, filled with `fill` when given.
    Shape { kind: ShapeKind, area: Area, color: [f32; 3], line_width: f32, fill: Option<[f32; 3]> },
    /// Removes what is in `area` for good and leaves a black box there: the
    /// text under it is taken out of the file, pictures are blacked out where
    /// the box covers them. Not a box drawn over content that stays.
    Redact { area: Area },
}

/// A rectangle on the page as shown, in points, measured from the top-left corner.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Area {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShapeKind {
    Rectangle,
    Ellipse,
    /// From the top-left corner of the area to its bottom-right corner.
    LineDown,
    /// From the bottom-left corner of the area to its top-right corner.
    LineUp,
    /// A tick, as in a ticked box.
    Check,
    /// Two lines from corner to corner.
    Cross,
    /// A filled circle, in the line color.
    Dot,
}

impl ShapeKind {
    /// The name the interface uses: `rectangle`, `ellipse`, `line-down`, `line-up`, `check`, `cross`, `dot`.
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "rectangle" => Self::Rectangle,
            "ellipse" => Self::Ellipse,
            "line-down" => Self::LineDown,
            "line-up" => Self::LineUp,
            "check" => Self::Check,
            "cross" => Self::Cross,
            "dot" => Self::Dot,
            _ => return None,
        })
    }
}

/// Where on the page a label is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Place {
    TopLeft,
    TopCenter,
    TopRight,
    BottomLeft,
    BottomCenter,
    BottomRight,
}

impl Place {
    /// The name the interface uses: `top-left`, `bottom-center`…
    pub fn from_name(name: &str) -> Option<Self> {
        Some(match name {
            "top-left" => Self::TopLeft,
            "top-center" => Self::TopCenter,
            "top-right" => Self::TopRight,
            "bottom-left" => Self::BottomLeft,
            "bottom-center" => Self::BottomCenter,
            "bottom-right" => Self::BottomRight,
            _ => return None,
        })
    }

    fn at_top(self) -> bool {
        matches!(self, Self::TopLeft | Self::TopCenter | Self::TopRight)
    }
}

/// Decodes picture data sent as base64 text.
pub fn picture_from_base64(text: &str) -> Result<Arc<Vec<u8>>, EngineError> {
    let mut data = Vec::new();
    Buffer::from_base64(text).map_err(failed)?.read_to_end(&mut data).map_err(|error| EngineError::Failed(error.to_string()))?;
    Ok(Arc::new(data))
}

/// The size of a picture in pixels; fails when the data is not a picture MuPDF reads.
pub fn picture_size(data: &[u8]) -> Result<(u32, u32), EngineError> {
    let image = Image::from_bytes(data).map_err(failed)?;
    Ok((image.width(), image.height()))
}

/// A picture in any format MuPDF reads, as a PNG: what the interface can show.
pub fn picture_as_png(data: &[u8]) -> Result<Vec<u8>, EngineError> {
    let pixels = Image::from_bytes(data).and_then(|image| image.to_pixmap()).map_err(failed)?;
    let mut png = Vec::new();
    pixels.write_to(&mut png, mupdf::ImageFormat::PNG).map_err(failed)?;
    Ok(png)
}

/// Data as base64 text, to hand to the interface.
pub fn to_base64(data: &[u8]) -> String {
    const LETTERS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut text = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let bits = (u32::from(chunk[0]) << 16) | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8) | u32::from(*chunk.get(2).unwrap_or(&0));
        for place in 0..4 {
            if place <= chunk.len() {
                text.push(LETTERS[((bits >> (18 - place * 6)) & 63) as usize] as char);
            } else {
                text.push('=');
            }
        }
    }
    text
}

/// What the pages of one new file share when they are drawn over: the font
/// of the labels and the pictures, each put into the file once.
#[derive(Default)]
pub(super) struct Shared {
    label_font: Option<(Font, PdfObject)>,
    pictures: Vec<SharedPicture>,
    /// The fonts and pictures of what the user drew on pages.
    pub(super) marks: super::marks::SharedMarks,
}

struct SharedPicture {
    data: Arc<Vec<u8>>,
    object: PdfObject,
    width: f32,
    height: f32,
}

/// The name of the label font in a page's resources; unlikely to be taken.
const LABEL_FONT_NAME: &str = "SyntelabLabel";
/// How far above its baseline a capital letter of the label font reaches, in letter sizes.
const CAPITAL_HEIGHT: f32 = 0.72;
/// From one line of text to the next, in letter sizes.
const LINE_HEIGHT: f32 = 1.25;

/// The least a page may measure after a change, in points.
const SMALLEST_SIDE: f32 = 4.0;

/// `[x0, y0, x1, y1]` in the page's own, unrotated coordinates (y grows upward).
type PageBox = [f32; 4];

pub(super) fn apply(
    document: &mut PdfDocument,
    page: &mut PdfObject,
    change: &PageChange,
    shared: &mut Shared,
) -> Result<(), EngineError> {
    let visible = visible_box(page)?;
    let rotation = page
        .get_dict_inheritable("Rotate")
        .map_err(failed)?
        .map(|value| value.as_int())
        .transpose()
        .map_err(failed)?
        .unwrap_or(0);

    match *change {
        PageChange::Crop { left, top, right, bottom } => {
            let cropped = cropped_box(visible, rotation, [left, top, right, bottom])
                .ok_or_else(|| EngineError::Failed("nothing of the page would be left".into()))?;
            page.dict_put("CropBox", box_object(document, cropped)?).map_err(failed)
        }
        PageChange::Fit { width, height, match_orientation, keep_size, place } => {
            let placement = fit_on_sheet(visible, rotation, width, height, match_orientation, keep_size, place)
                .ok_or_else(|| EngineError::Failed("not a usable page size".into()))?;
            wrap_contents(document, page, visible, &placement)?;
            move_annotations(document, page, &placement)?;
            let sheet = [0.0, 0.0, placement.sheet_width, placement.sheet_height];
            page.dict_put("MediaBox", box_object(document, sheet)?).map_err(failed)?;
            // Set on the page itself, so a box inherited from above cannot apply.
            page.dict_put("CropBox", box_object(document, sheet)?).map_err(failed)?;
            for other in ["TrimBox", "ArtBox", "BleedBox"] {
                page.dict_delete(other).map_err(failed)?;
            }
            Ok(())
        }
        PageChange::Label { ref text, place, size, margin } => {
            shared.need_label_font(document)?;
            let (font, object) = shared.label_font.as_ref().expect("just set");
            // Letters the font does not have are left out.
            let (glyphs, width) = glyphs_of(font, text, size, false)?;
            if glyphs.is_empty() {
                return Ok(());
            }
            let frame = ShownFrame::of(visible, rotation);
            let (x, y) = label_position(place, frame.width, frame.height, width, size, margin);
            put_resource(document, page, "Font", LABEL_FONT_NAME, object, false)?;
            let drawing = format!(
                "q {} cm BT 0 g /{LABEL_FONT_NAME} {size} Tf {x} {y} Td <{glyphs}> Tj ET Q\n",
                frame.matrix()
            );
            draw_over(document, page, &drawing)
        }
        PageChange::Text { ref text, x, y, size, color } => {
            shared.need_label_font(document)?;
            let (font, object) = shared.label_font.as_ref().expect("just set");
            let frame = ShownFrame::of(visible, rotation);
            let [red, green, blue] = color.map(|part| part.clamp(0.0, 1.0));
            let mut lines = String::new();
            for (number, line) in text.lines().enumerate() {
                let (glyphs, _) = glyphs_of(font, line, size, true)?;
                // From the top of the page down: the first baseline sits a capital's height under `y`.
                let baseline = frame.height - y - size * CAPITAL_HEIGHT - number as f32 * size * LINE_HEIGHT;
                lines.push_str(&format!("1 0 0 1 {x} {baseline} Tm <{glyphs}> Tj "));
            }
            if lines.is_empty() {
                return Ok(());
            }
            put_resource(document, page, "Font", LABEL_FONT_NAME, object, false)?;
            let drawing = format!(
                "q {} cm BT {red} {green} {blue} rg /{LABEL_FONT_NAME} {size} Tf {lines}ET Q\n",
                frame.matrix()
            );
            draw_over(document, page, &drawing)
        }
        PageChange::Shape { kind, area, color, line_width, fill } => {
            let frame = ShownFrame::of(visible, rotation);
            let Some(path) = shape_path(kind, area, frame.height) else {
                return Ok(());
            };
            let [red, green, blue] = color.map(|part| part.clamp(0.0, 1.0));
            let line_width = if line_width.is_finite() { line_width.clamp(0.1, 100.0) } else { 1.0 };
            let closed = matches!(kind, ShapeKind::Rectangle | ShapeKind::Ellipse);
            let paint = match (kind, fill.filter(|_| closed)) {
                // A dot is all fill, in the color of the line.
                (ShapeKind::Dot, _) => format!("{red} {green} {blue} rg f"),
                (_, Some(fill)) => {
                    let [red, green, blue] = fill.map(|part| part.clamp(0.0, 1.0));
                    format!("{red} {green} {blue} rg B")
                }
                (_, None) => "S".to_owned(),
            };
            // Round ends and corners: a tick and a cross look drawn by hand.
            let drawing = format!(
                "q {} cm {red} {green} {blue} RG {line_width} w 1 J 1 j {path}{paint} Q\n",
                frame.matrix()
            );
            draw_over(document, page, &drawing)
        }
        // Done by `redact`, which needs the page as a whole.
        PageChange::Redact { .. } => Ok(()),
        PageChange::Picture { ref data, width, area } => {
            let index = match shared.pictures.iter().position(|known| Arc::ptr_eq(&known.data, data)) {
                Some(index) => index,
                None => {
                    let image = Image::from_bytes(data).map_err(failed)?;
                    let object = document.add_image(&image).map_err(failed)?;
                    shared.pictures.push(SharedPicture {
                        data: Arc::clone(data),
                        object,
                        width: image.width() as f32,
                        height: image.height() as f32,
                    });
                    shared.pictures.len() - 1
                }
            };
            let picture = &shared.pictures[index];
            let frame = ShownFrame::of(visible, rotation);
            let placed = match area {
                Some(area) if area.width > 0.0 && area.height > 0.0 => {
                    Some((area.x, frame.height - area.y - area.height, area.width, area.height))
                }
                Some(_) => None,
                None => centered(frame.width, frame.height, picture.width, picture.height, width),
            };
            let Some((x, y, drawn_width, drawn_height)) = placed else {
                return Ok(());
            };
            let name = put_resource(document, page, "XObject", "SyntelabMark", &picture.object, true)?;
            let drawing =
                format!("q {} cm {drawn_width} 0 0 {drawn_height} {x} {y} cm /{name} Do Q\n", frame.matrix());
            draw_over(document, page, &drawing)
        }
    }
}

impl Shared {
    fn need_label_font(&mut self, document: &mut PdfDocument) -> Result<(), EngineError> {
        if self.label_font.is_none() {
            let font = Font::new("Helvetica").map_err(failed)?;
            let object = document.add_font(&font).map_err(failed)?;
            self.label_font = Some((font, object));
        }
        Ok(())
    }
}

/// What is taken out of an area of a page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Removed {
    /// Text, pictures and drawings, and a black box is left: a redaction.
    Everything,
    /// The text only, and nothing is drawn: the place of a line that is being rewritten.
    Text,
    /// The pictures that reach into the area, whole, and nothing is drawn: a picture that is moved or removed.
    Pictures,
}

/// Removes for good what is in `area` of a page of `document`; see [`Removed`].
pub(super) fn redact(document: &mut PdfDocument, page_number: i32, area: Area, removed: Removed) -> Result<(), EngineError> {
    let all_finite = [area.x, area.y, area.width, area.height].iter().all(|number| number.is_finite());
    if !all_finite || area.width <= 0.0 || area.height <= 0.0 {
        return Ok(());
    }
    let mut page = document.load_pdf_page(page_number).map_err(failed)?;
    // The area is measured from the corner of what is shown; the page may start elsewhere.
    let bounds = page.bounds().map_err(failed)?;
    let (left, top) = (bounds.x0 + area.x, bounds.y0 + area.y);
    page.add_redact_annotation(Rect::new(left, top, left + area.width, top + area.height)).map_err(failed)?;
    page.redact_with_options(PdfRedactOptions {
        black_boxes: removed == Removed::Everything,
        image_method: match removed {
            Removed::Everything => PdfRedactImageMethod::Pixels,
            Removed::Text => PdfRedactImageMethod::None,
            Removed::Pictures => PdfRedactImageMethod::Remove,
        },
        line_art: if removed == Removed::Everything { PdfRedactLineArtMethod::RemoveIfCovered } else { PdfRedactLineArtMethod::None },
        text: if removed == Removed::Pictures { PdfRedactTextMethod::None } else { PdfRedactTextMethod::Remove },
    })
    .map_err(failed)?;
    Ok(())
}

/// The text as the font's own glyph numbers (four hex digits each), and how
/// wide it is at `size`. A letter the font does not have is left out, or,
/// with `strict`, makes the whole text fail.
fn glyphs_of(font: &Font, text: &str, size: f32, strict: bool) -> Result<(String, f32), EngineError> {
    let mut glyphs = String::new();
    let mut width = 0.0;
    for letter in text.chars() {
        let glyph = font.encode_character(letter as i32).map_err(failed)?;
        if glyph > 0 && glyph <= 0xFFFF {
            glyphs.push_str(&format!("{glyph:04X}"));
            width += font.advance_glyph(glyph).map_err(failed)? * size;
        } else if strict && !letter.is_control() {
            return Err(EngineError::LettersMissing);
        }
    }
    Ok((glyphs, width))
}

/// The outline of a shape as PDF path instructions, on a page `page_height`
/// tall as shown (where y grows upward). `None` for an area with no size.
fn shape_path(kind: ShapeKind, area: Area, page_height: f32) -> Option<String> {
    let Area { x, y, width, height } = area;
    let all_finite = [x, y, width, height].iter().all(|number| number.is_finite());
    if !all_finite || width < 0.0 || height < 0.0 || (width == 0.0 && height == 0.0) {
        return None;
    }
    let (left, right) = (x, x + width);
    let (top, bottom) = (page_height - y, page_height - y - height);
    Some(match kind {
        ShapeKind::Rectangle => format!("{left} {bottom} {width} {height} re "),
        ShapeKind::LineDown => format!("{left} {top} m {right} {bottom} l "),
        ShapeKind::LineUp => format!("{left} {bottom} m {right} {top} l "),
        ShapeKind::Cross => format!("{left} {top} m {right} {bottom} l {left} {bottom} m {right} {top} l "),
        // Down to a point a third of the way along, then up to the far corner.
        ShapeKind::Check => format!(
            "{} {} m {} {} l {} {} l ",
            left,
            bottom + height * 0.45,
            left + width * 0.36,
            bottom,
            right,
            top,
        ),
        ShapeKind::Ellipse | ShapeKind::Dot => ellipse_path(left, bottom, width, height),
    })
}

/// An ellipse that fills the box with its lower left corner at (`left`, `bottom`), as PDF path instructions.
pub(super) fn ellipse_path(left: f32, bottom: f32, width: f32, height: f32) -> String {
    // Four curves; this much of the radius puts their handles on a circle.
    const HANDLE: f32 = 0.552_284_8;
    let (right, top) = (left + width, bottom + height);
    let (center_x, center_y) = (left + width / 2.0, bottom + height / 2.0);
    let (handle_x, handle_y) = (width / 2.0 * HANDLE, height / 2.0 * HANDLE);
    format!(
        "{} {} m {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c {} {} {} {} {} {} c h ",
        right, center_y,
        right, center_y + handle_y, center_x + handle_x, top, center_x, top,
        center_x - handle_x, top, left, center_y + handle_y, left, center_y,
        left, center_y - handle_y, center_x - handle_x, bottom, center_x, bottom,
        center_x + handle_x, bottom, right, center_y - handle_y, right, center_y,
    )
}

/// The page as it is shown right now: how tall it is, and the matrix that
/// takes a point of that picture (from its lower left corner, y upward) to
/// the page's own coordinates.
pub(super) fn page_frame(page: &PdfObject) -> Result<(f32, String), EngineError> {
    let visible = visible_box(page)?;
    let rotation = page
        .get_dict_inheritable("Rotate")
        .map_err(failed)?
        .map(|value| value.as_int())
        .transpose()
        .map_err(failed)?
        .unwrap_or(0);
    let frame = ShownFrame::of(visible, rotation);
    Ok((frame.height, frame.matrix()))
}

/// A box on the page as it is shown (from its top-left corner, in points) as
/// `[x0 y0 x1 y1]` in the page's own coordinates: what a link or a field is
/// placed by.
pub(super) fn own_box(page: &PdfObject, area: super::Area) -> Result<[f32; 4], EngineError> {
    let rotation = page
        .get_dict_inheritable("Rotate")
        .map_err(failed)?
        .map(|value| value.as_int())
        .transpose()
        .map_err(failed)?
        .unwrap_or(0);
    own_box_turned(page, area, rotation)
}

/// Like [`own_box`], for the page as it is shown when turned by `rotation`
/// degrees instead of by its own rotation.
pub(super) fn own_box_turned(page: &PdfObject, area: super::Area, rotation: i32) -> Result<[f32; 4], EngineError> {
    let visible = visible_box(page)?;
    let frame = ShownFrame::of(visible, rotation);
    let [a, b, c, d, e, f] = frame.to_own;
    let own = |x: f32, y: f32| (a * x + c * y + e, b * x + d * y + f);
    // The shown picture is measured from its lower left corner, y upward.
    let (ax, ay) = own(area.x, frame.height - area.y);
    let (bx, by) = own(area.x + area.width, frame.height - area.y - area.height);
    Ok([ax.min(bx), ay.min(by), ax.max(bx), ay.max(by)])
}

/// Makes `object` known to the page, among its fonts or its pictures, and
/// returns the name it got. With `fresh`, the name is `name` followed by the
/// first number not taken yet: a page drawn over before already has such
/// names, and what was drawn then must keep finding its own picture. Without,
/// `name` itself is used and replaces what had it (the label font, always the
/// same one).
pub(super) fn put_resource(
    document: &PdfDocument,
    page: &mut PdfObject,
    kind: &str,
    name: &str,
    object: &PdfObject,
    fresh: bool,
) -> Result<String, EngineError> {
    let mut resources = match page.get_dict_inheritable("Resources").map_err(failed)? {
        Some(resources) => resources,
        None => {
            page.dict_put("Resources", document.new_dict().map_err(failed)?).map_err(failed)?;
            page.get_dict("Resources").map_err(failed)?.ok_or_else(|| EngineError::Failed("no resources".into()))?
        }
    };
    let mut of_kind = match resources.get_dict(kind).map_err(failed)? {
        Some(of_kind) => of_kind,
        None => {
            resources.dict_put(kind, document.new_dict().map_err(failed)?).map_err(failed)?;
            resources.get_dict(kind).map_err(failed)?.ok_or_else(|| EngineError::Failed("no resources".into()))?
        }
    };
    let mut chosen = name.to_owned();
    if fresh {
        let mut number = 0;
        loop {
            chosen = format!("{name}{number}");
            if of_kind.get_dict(chosen.as_str()).map_err(failed)?.is_none() {
                break;
            }
            number += 1;
        }
    }
    of_kind.dict_put(chosen.as_str(), object.try_clone().map_err(failed)?).map_err(failed)?;
    Ok(chosen)
}

/// Adds drawing instructions after the page's own. Those are closed off
/// first, so whatever they left set (colors, a turned grid) does not apply.
pub(super) fn draw_over(document: &mut PdfDocument, page: &mut PdfObject, drawing: &str) -> Result<(), EngineError> {
    let mut all = document.new_array().map_err(failed)?;
    if let Some(contents) = page.get_dict("Contents").map_err(failed)? {
        all.array_push(stream(document, "q\n")?).map_err(failed)?;
        push_parts(&mut all, contents)?;
        all.array_push(stream(document, "\nQ\n")?).map_err(failed)?;
    }
    all.array_push(stream(document, drawing)?).map_err(failed)?;
    page.dict_put("Contents", all).map_err(failed)
}

/// A page's drawing instructions are one stream or a list of them.
fn push_parts(all: &mut PdfObject, contents: PdfObject) -> Result<(), EngineError> {
    if contents.is_array().map_err(failed)? {
        for index in 0..contents.len().map_err(failed)? {
            if let Some(part) = contents.get_array(index as i32).map_err(failed)? {
                all.array_push(part).map_err(failed)?;
            }
        }
        Ok(())
    } else {
        all.array_push(contents).map_err(failed)
    }
}

/// The part of the page that is shown: its crop box, inside its media box.
fn visible_box(page: &PdfObject) -> Result<PageBox, EngineError> {
    let media = read_box(page, "MediaBox")?.ok_or_else(|| EngineError::Failed("the page has no size".into()))?;
    Ok(match read_box(page, "CropBox")? {
        Some(crop) => [crop[0].max(media[0]), crop[1].max(media[1]), crop[2].min(media[2]), crop[3].min(media[3])],
        None => media,
    })
}

fn read_box(page: &PdfObject, key: &str) -> Result<Option<PageBox>, EngineError> {
    let Some(array) = page.get_dict_inheritable(key).map_err(failed)? else {
        return Ok(None);
    };
    let mut numbers = [0.0_f32; 4];
    for (index, number) in numbers.iter_mut().enumerate() {
        let Some(value) = array.get_array(index as i32).map_err(failed)? else {
            return Ok(None);
        };
        *number = value.as_float().map_err(failed)?;
    }
    // Corners may be given in any order.
    Ok(Some([
        numbers[0].min(numbers[2]),
        numbers[1].min(numbers[3]),
        numbers[0].max(numbers[2]),
        numbers[1].max(numbers[3]),
    ]))
}

fn box_object(document: &PdfDocument, numbers: PageBox) -> Result<PdfObject, EngineError> {
    let mut array = document.new_array().map_err(failed)?;
    for number in numbers {
        array.array_push(document.new_real(number).map_err(failed)?).map_err(failed)?;
    }
    Ok(array)
}

/// Puts the page's drawing instructions between "scale and move" and "undo":
/// the page's content is left as it is, and drawn smaller or larger elsewhere.
fn wrap_contents(
    document: &mut PdfDocument,
    page: &mut PdfObject,
    visible: PageBox,
    placement: &Placement,
) -> Result<(), EngineError> {
    let Some(contents) = page.get_dict("Contents").map_err(failed)? else {
        return Ok(());
    };
    let Placement { scale, move_x, move_y, .. } = *placement;
    // Only what was visible is drawn: the rest must not show up in the new margins.
    let before = format!(
        "q {} {} {} {} re W n {scale} 0 0 {scale} {move_x} {move_y} cm\n",
        visible[0] * scale + move_x,
        visible[1] * scale + move_y,
        (visible[2] - visible[0]) * scale,
        (visible[3] - visible[1]) * scale,
    );
    let mut wrapped = document.new_array().map_err(failed)?;
    wrapped.array_push(stream(document, &before)?).map_err(failed)?;
    push_parts(&mut wrapped, contents)?;
    wrapped.array_push(stream(document, "\nQ\n")?).map_err(failed)?;
    page.dict_put("Contents", wrapped).map_err(failed)
}

fn stream(document: &mut PdfDocument, instructions: &str) -> Result<PdfObject, EngineError> {
    let buffer = Buffer::from_bytes(instructions.as_bytes()).map_err(failed)?;
    document.add_stream(&buffer, None, false).map_err(failed)
}

/// Links, notes and form fields sit on the page by a rectangle of their own;
/// it moves with the content.
fn move_annotations(document: &PdfDocument, page: &PdfObject, placement: &Placement) -> Result<(), EngineError> {
    let Some(annotations) = page.get_dict("Annots").map_err(failed)? else {
        return Ok(());
    };
    if !annotations.is_array().map_err(failed)? {
        return Ok(());
    }
    for index in 0..annotations.len().map_err(failed)? {
        let Some(mut annotation) = annotations.get_array(index as i32).map_err(failed)? else {
            continue;
        };
        let Some(rect) = read_box(&annotation, "Rect")? else {
            continue;
        };
        let moved = [
            rect[0] * placement.scale + placement.move_x,
            rect[1] * placement.scale + placement.move_y,
            rect[2] * placement.scale + placement.move_x,
            rect[3] * placement.scale + placement.move_y,
        ];
        annotation.dict_put("Rect", box_object(document, moved)?).map_err(failed)?;
    }
    Ok(())
}

pub(super) fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}

/// The page's box after `edges` (`[left, top, right, bottom]` of the page as
/// shown) are cut off. `None` when too little would be left.
fn cropped_box(visible: PageBox, rotation: i32, edges: [f32; 4]) -> Option<PageBox> {
    let [left, top, right, bottom] = edges.map(|edge| if edge.is_finite() { edge.max(0.0) } else { 0.0 });
    // A page turned for showing has other edges on the left and on top.
    let (own_left, own_top, own_right, own_bottom) = match rotation.rem_euclid(360) {
        90 => (top, right, bottom, left),
        180 => (right, bottom, left, top),
        270 => (bottom, left, top, right),
        _ => (left, top, right, bottom),
    };
    let cropped = [visible[0] + own_left, visible[1] + own_bottom, visible[2] - own_right, visible[3] - own_top];
    let large_enough = cropped[2] - cropped[0] >= SMALLEST_SIDE && cropped[3] - cropped[1] >= SMALLEST_SIDE;
    large_enough.then_some(cropped)
}

/// The page as the reader sees it: its size after its own rotation, and how
/// a point of that picture (measured from its lower left corner, y upward)
/// is found in the page's own coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
struct ShownFrame {
    width: f32,
    height: f32,
    /// `own = [a b c d e f]` applied to a shown point, as PDF writes matrices.
    to_own: [f32; 6],
}

impl ShownFrame {
    fn of(visible: PageBox, rotation: i32) -> Self {
        let [x0, y0, x1, y1] = visible;
        let (own_width, own_height) = (x1 - x0, y1 - y0);
        match rotation.rem_euclid(360) {
            // Turned a quarter clockwise: the lower left corner shown is the page's own lower right.
            90 => Self { width: own_height, height: own_width, to_own: [0.0, 1.0, -1.0, 0.0, x1, y0] },
            180 => Self { width: own_width, height: own_height, to_own: [-1.0, 0.0, 0.0, -1.0, x1, y1] },
            270 => Self { width: own_height, height: own_width, to_own: [0.0, -1.0, 1.0, 0.0, x0, y1] },
            _ => Self { width: own_width, height: own_height, to_own: [1.0, 0.0, 0.0, 1.0, x0, y0] },
        }
    }

    fn matrix(&self) -> String {
        self.to_own.map(|number| number.to_string()).join(" ")
    }

    #[cfg(test)]
    fn own_point(&self, x: f32, y: f32) -> (f32, f32) {
        let [a, b, c, d, e, f] = self.to_own;
        (a * x + c * y + e, b * x + d * y + f)
    }
}

/// Where a label of `text_width` starts (its baseline, at the left), on a
/// page of `width` × `height` as shown.
fn label_position(place: Place, width: f32, height: f32, text_width: f32, size: f32, margin: f32) -> (f32, f32) {
    let x = match place {
        Place::TopLeft | Place::BottomLeft => margin,
        Place::TopCenter | Place::BottomCenter => (width - text_width) / 2.0,
        Place::TopRight | Place::BottomRight => width - margin - text_width,
    };
    let y = if place.at_top() { height - margin - size * CAPITAL_HEIGHT } else { margin };
    (x, y)
}

/// A picture of `picture_width` × `picture_height` put in the middle of a
/// page, as large as `share` (0 to 1) of the page allows in both directions.
/// Returns `(x, y, width, height)`; `None` when there is nothing to draw.
fn centered(width: f32, height: f32, picture_width: f32, picture_height: f32, share: f32) -> Option<(f32, f32, f32, f32)> {
    let share = if share.is_finite() { share.clamp(0.0, 1.0) } else { 0.0 };
    if share <= 0.0 || picture_width <= 0.0 || picture_height <= 0.0 {
        return None;
    }
    let scale = (width * share / picture_width).min(height * share / picture_height);
    let (drawn_width, drawn_height) = (picture_width * scale, picture_height * scale);
    Some(((width - drawn_width) / 2.0, (height - drawn_height) / 2.0, drawn_width, drawn_height))
}

/// How a page is put on a sheet: `new = old × scale + move`, in the page's
/// own coordinates, and the size of the sheet in those coordinates.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Placement {
    scale: f32,
    move_x: f32,
    move_y: f32,
    sheet_width: f32,
    sheet_height: f32,
}

/// Fits the visible part of a page on a sheet of `width` × `height` (as
/// shown); see [`PageChange::Fit`]. `None` for sizes that make no sheet.
fn fit_on_sheet(
    visible: PageBox,
    rotation: i32,
    width: f32,
    height: f32,
    match_orientation: bool,
    keep_size: bool,
    place: [f32; 2],
) -> Option<Placement> {
    let usable = |side: f32| side.is_finite() && side >= SMALLEST_SIDE;
    let (own_width, own_height) = (visible[2] - visible[0], visible[3] - visible[1]);
    if !(usable(width) && usable(height) && usable(own_width) && usable(own_height)) {
        return None;
    }
    let sideways = rotation.rem_euclid(180) == 90;
    let (shown_width, shown_height) = if sideways { (own_height, own_width) } else { (own_width, own_height) };
    let (width, height) =
        if match_orientation && (shown_width > shown_height) != (width > height) { (height, width) } else { (width, height) };
    // The sheet in the page's own coordinates, where a turned page lies on its side.
    let (sheet_width, sheet_height) = if sideways { (height, width) } else { (width, height) };

    let fitted = (sheet_width / own_width).min(sheet_height / own_height);
    let scale = if keep_size { fitted.min(1.0) } else { fitted };
    // Where the page lies as the reader sees it, said in the page's own coordinates
    // (from its left, from its bottom): a turned page has its own left elsewhere.
    let share = |part: f32| if part.is_finite() { part.clamp(0.0, 1.0) } else { 0.5 };
    let (across, down) = (share(place[0]), share(place[1]));
    let (from_left, from_bottom) = match rotation.rem_euclid(360) {
        90 => (down, across),
        180 => (1.0 - across, down),
        270 => (1.0 - down, 1.0 - across),
        _ => (across, 1.0 - down),
    };
    Some(Placement {
        scale,
        move_x: (sheet_width - own_width * scale) * from_left - visible[0] * scale,
        move_y: (sheet_height - own_height * scale) * from_bottom - visible[1] * scale,
        sheet_width,
        sheet_height,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const A4: PageBox = [0.0, 0.0, 595.0, 842.0];

    #[test]
    fn keeps_a_page_its_size_and_puts_it_where_asked() {
        let small: PageBox = [0.0, 0.0, 200.0, 100.0];
        // At the top left of the sheet: its own bottom is 742 up.
        let placed = fit_on_sheet(small, 0, 595.0, 842.0, false, true, [0.0, 0.0]).expect("placement");
        assert_eq!((placed.scale, placed.move_x, placed.move_y), (1.0, 0.0, 742.0));
        // At the bottom right.
        let placed = fit_on_sheet(small, 0, 595.0, 842.0, false, true, [1.0, 1.0]).expect("placement");
        assert_eq!((placed.move_x, placed.move_y), (395.0, 0.0));
        // Too large to keep its size: made to fit after all.
        let large: PageBox = [0.0, 0.0, 1190.0, 1684.0];
        assert_eq!(fit_on_sheet(large, 0, 595.0, 842.0, false, true, [0.5, 0.5]).expect("placement").scale, 0.5);
        // A page shown a quarter turned: the reader's top left is its own bottom left.
        let placed = fit_on_sheet(small, 90, 595.0, 842.0, false, true, [0.0, 0.0]).expect("placement");
        assert_eq!((placed.move_x, placed.move_y), (0.0, 0.0));
    }

    #[test]
    fn cuts_the_edges_of_the_page_as_it_is_shown() {
        assert_eq!(cropped_box(A4, 0, [10.0, 20.0, 30.0, 40.0]), Some([10.0, 40.0, 565.0, 822.0]));
        // Turned a quarter clockwise, the page's own left edge is on top.
        assert_eq!(cropped_box(A4, 90, [10.0, 20.0, 30.0, 40.0]), Some([20.0, 10.0, 555.0, 812.0]));
        assert_eq!(cropped_box(A4, 180, [10.0, 20.0, 30.0, 40.0]), Some([30.0, 20.0, 585.0, 802.0]));
        assert_eq!(cropped_box(A4, 270, [10.0, 20.0, 30.0, 40.0]), Some([40.0, 30.0, 575.0, 832.0]));
    }

    #[test]
    fn refuses_to_cut_everything_away_and_ignores_bad_numbers() {
        assert_eq!(cropped_box(A4, 0, [300.0, 0.0, 300.0, 0.0]), None);
        assert_eq!(cropped_box(A4, 0, [-5.0, f32::NAN, 0.0, 0.0]), Some(A4));
    }

    #[test]
    fn fits_a_page_on_a_larger_sheet_centered() {
        // A5 on A4: scaled by about √2, as far as the tighter side allows.
        let a5 = [0.0, 0.0, 420.0, 595.0];
        let placed = fit_on_sheet(a5, 0, 595.0, 842.0, true, false, [0.5, 0.5]).expect("placement");
        assert!((placed.scale - 842.0 / 595.0).abs() < 0.001);
        assert!((placed.move_x - (595.0 - 420.0 * placed.scale) / 2.0).abs() < 0.01);
        assert!(placed.move_y.abs() < 0.01);
        assert_eq!((placed.sheet_width, placed.sheet_height), (595.0, 842.0));
    }

    #[test]
    fn keeps_a_wide_page_wide_unless_told_otherwise() {
        let wide = [0.0, 0.0, 800.0, 400.0];
        let matched = fit_on_sheet(wide, 0, 595.0, 842.0, true, false, [0.5, 0.5]).expect("placement");
        assert_eq!((matched.sheet_width, matched.sheet_height), (842.0, 595.0));
        let upright = fit_on_sheet(wide, 0, 595.0, 842.0, false, false, [0.5, 0.5]).expect("placement");
        assert_eq!((upright.sheet_width, upright.sheet_height), (595.0, 842.0));
        // Scaled to the width, centered on the height.
        assert!((upright.scale - 595.0 / 800.0).abs() < 0.001);
        assert!((upright.move_y - (842.0 - 400.0 * upright.scale) / 2.0).abs() < 0.01);
    }

    #[test]
    fn measures_a_turned_page_the_way_it_is_shown() {
        // Upright in the file but shown on its side: a wide page for the reader.
        let placed = fit_on_sheet(A4, 90, 595.0, 842.0, true, false, [0.5, 0.5]).expect("placement");
        // The sheet is wide as shown, so upright in the page's own coordinates.
        assert_eq!((placed.sheet_width, placed.sheet_height), (595.0, 842.0));
        assert!((placed.scale - 1.0).abs() < 0.001);
    }

    #[test]
    fn finds_the_corners_of_a_turned_page() {
        let page = [10.0, 20.0, 110.0, 220.0];
        let upright = ShownFrame::of(page, 0);
        assert_eq!((upright.width, upright.height), (100.0, 200.0));
        assert_eq!(upright.own_point(0.0, 0.0), (10.0, 20.0));

        // Turned a quarter clockwise: shown wide, its lower left is the page's own lower right.
        let quarter = ShownFrame::of(page, 90);
        assert_eq!((quarter.width, quarter.height), (200.0, 100.0));
        assert_eq!(quarter.own_point(0.0, 0.0), (110.0, 20.0));
        assert_eq!(quarter.own_point(200.0, 0.0), (110.0, 220.0));
        assert_eq!(quarter.own_point(0.0, 100.0), (10.0, 20.0));

        assert_eq!(ShownFrame::of(page, 180).own_point(0.0, 0.0), (110.0, 220.0));
        let three_quarters = ShownFrame::of(page, 270);
        assert_eq!(three_quarters.own_point(0.0, 0.0), (10.0, 220.0));
        assert_eq!(three_quarters.own_point(200.0, 100.0), (110.0, 20.0));
    }

    #[test]
    fn places_labels_by_the_edges() {
        assert_eq!(label_position(Place::BottomLeft, 600.0, 800.0, 40.0, 10.0, 30.0), (30.0, 30.0));
        assert_eq!(label_position(Place::BottomCenter, 600.0, 800.0, 40.0, 10.0, 30.0), (280.0, 30.0));
        assert_eq!(label_position(Place::BottomRight, 600.0, 800.0, 40.0, 10.0, 30.0), (530.0, 30.0));
        // At the top, the letters end at the margin.
        let (_, y) = label_position(Place::TopCenter, 600.0, 800.0, 40.0, 10.0, 30.0);
        assert!((y - (800.0 - 30.0 - 7.2)).abs() < 0.001);
        assert_eq!(Place::from_name("top-right"), Some(Place::TopRight));
        assert_eq!(Place::from_name("middle"), None);
    }

    #[test]
    fn writes_base64() {
        assert_eq!(to_base64(b""), "");
        assert_eq!(to_base64(b"f"), "Zg==");
        assert_eq!(to_base64(b"fo"), "Zm8=");
        assert_eq!(to_base64(b"foo"), "Zm9v");
        assert_eq!(to_base64(b"hello"), "aGVsbG8=");
    }

    #[test]
    fn outlines_shapes_from_the_top_left_corner() {
        let area = Area { x: 10.0, y: 20.0, width: 100.0, height: 50.0 };
        // On a page 800 tall, 20 from the top is 780 from the bottom.
        assert_eq!(shape_path(ShapeKind::Rectangle, area, 800.0).as_deref(), Some("10 730 100 50 re "));
        assert_eq!(shape_path(ShapeKind::LineDown, area, 800.0).as_deref(), Some("10 780 m 110 730 l "));
        assert_eq!(shape_path(ShapeKind::LineUp, area, 800.0).as_deref(), Some("10 730 m 110 780 l "));
        let ellipse = shape_path(ShapeKind::Ellipse, area, 800.0).expect("ellipse");
        assert!(ellipse.starts_with("110 755 m ") && ellipse.ends_with("c h "), "{ellipse}");
        // A flat area still makes a line; an area with no size at all makes nothing.
        let flat = Area { height: 0.0, ..area };
        assert_eq!(shape_path(ShapeKind::LineDown, flat, 800.0).as_deref(), Some("10 780 m 110 780 l "));
        assert_eq!(shape_path(ShapeKind::Rectangle, Area { width: 0.0, height: 0.0, ..area }, 800.0), None);
        assert_eq!(shape_path(ShapeKind::Cross, area, 800.0).as_deref(), Some("10 780 m 110 730 l 10 730 m 110 780 l "));
        assert_eq!(shape_path(ShapeKind::Check, area, 800.0).as_deref(), Some("10 752.5 m 46 730 l 110 780 l "));
        assert_eq!(shape_path(ShapeKind::Dot, area, 800.0), shape_path(ShapeKind::Ellipse, area, 800.0));
        assert_eq!(ShapeKind::from_name("line-up"), Some(ShapeKind::LineUp));
        assert_eq!(ShapeKind::from_name("check"), Some(ShapeKind::Check));
        assert_eq!(ShapeKind::from_name("star"), None);
    }

    #[test]
    fn centers_a_picture_within_its_share_of_the_page() {
        // A wide picture on an upright page: as wide as its share allows.
        assert_eq!(centered(600.0, 800.0, 300.0, 100.0, 0.5), Some((150.0, 350.0, 300.0, 100.0)));
        // A tall one is held back by the height.
        assert_eq!(centered(600.0, 800.0, 100.0, 400.0, 0.5), Some((250.0, 200.0, 100.0, 400.0)));
        assert_eq!(centered(600.0, 800.0, 100.0, 400.0, 0.0), None);
        assert_eq!(centered(600.0, 800.0, 0.0, 400.0, 0.5), None);
    }

    #[test]
    fn takes_the_origin_of_the_visible_part_into_account() {
        let offset = [100.0, 50.0, 400.0, 450.0];
        let placed = fit_on_sheet(offset, 0, 600.0, 800.0, false, false, [0.5, 0.5]).expect("placement");
        assert!((placed.scale - 2.0).abs() < 0.001);
        // The lower left corner of the visible part lands on the sheet's corner.
        assert!((offset[0] * placed.scale + placed.move_x).abs() < 0.01);
        assert!((offset[1] * placed.scale + placed.move_y).abs() < 0.01);
        assert_eq!(fit_on_sheet(offset, 0, 0.0, 800.0, false, false, [0.5, 0.5]), None);
    }
}
