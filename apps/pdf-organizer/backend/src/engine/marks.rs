//! Marks: what the user draws and writes on a page (shapes, arrows, text, a
//! highlight, a picture), written into the page as real drawing instructions
//! when a file is made (MuPDF binding). In the interface they stay objects
//! that can be moved and changed until then.
//!
//! A mark is placed on the page as it lies in its file (after the page's own
//! rotation, before any turn the user added): it is drawn before that turn
//! is applied, so it turns with the page.

use std::path::PathBuf;
use std::sync::Arc;

use mupdf::pdf::{PdfDocument, PdfObject};
use mupdf::{Font, Image};

use super::additions::{LinkTarget, NewField};
use super::page_change::{draw_over, ellipse_path, failed, page_frame, put_resource};
use super::EngineError;

/// One thing drawn on a page. Places and sizes are in points, measured from
/// the top-left corner of the page.
#[derive(Debug, Clone, PartialEq)]
pub struct Mark {
    pub kind: MarkKind,
    /// The box of the mark. For a line or an arrow: from (`x`, `y`) to
    /// (`x + width`, `y + height`), so its sizes may be negative.
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    /// Turned this many degrees clockwise about the middle of its box.
    pub rotation: f32,
    /// Color of its line (of its letters, for text): `[red, green, blue]` from 0 to 1.
    pub stroke: Option<[f32; 3]>,
    pub fill: Option<[f32; 3]>,
    /// 1 hides what is under it, 0 cannot be seen.
    pub opacity: f32,
    pub line_width: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub enum MarkKind {
    Rectangle,
    Ellipse,
    Line,
    /// A line with a head at its end.
    Arrow,
    /// A tick, as in a ticked box.
    Check,
    /// Two lines from corner to corner.
    Cross,
    /// A filled circle, in the line color.
    Dot,
    /// A see-through band of color that leaves what is under it readable.
    Highlight,
    /// Lines of text; the first starts at the top-left corner of the box. With
    /// a `file`, it is written in that font of the computer (which is put into
    /// the PDF); without, or when the file cannot be read, in the built-in
    /// font of the `family`. `align` says where each line stands in the width of
    /// the box: 0 at its left, 0.5 in its middle, 1 at its right.
    Text { text: String, family: FontFamily, bold: bool, italic: bool, size: f32, file: Option<PathBuf>, align: f32 },
    /// A picture (PNG or JPEG data) filling the box.
    Picture { data: Arc<Vec<u8>> },
    /// Not drawn: what is in the box is removed from the file for good and a
    /// black box is left (see `page_change::redact`).
    Redact,
    /// Not drawn: the text in the box is taken out of the file and nothing is
    /// left in its place (a line of the document that is written anew).
    Erase,
    /// Text that is written into the page but not seen: the words read off a
    /// scanned page (OCR), each where it stands, so the page can be searched
    /// and its text copied. `turn` (0, 90, 180 or 270) is how far the page
    /// must be turned clockwise for the words to stand upright.
    HiddenText { words: Vec<HiddenWord>, turn: i32 },
    /// Not drawn: the pictures of the document that lie in the box are taken
    /// out of the file (a picture of the document that is moved or removed).
    ErasePicture,
    /// Not drawn: the box becomes a link (see `additions`).
    Link { target: LinkTarget },
    /// Not drawn: the box becomes a form field of this name.
    Field { field: NewField, name: String },
    /// Not drawn: a bookmark of this title that leads to the top of the box.
    Bookmark { title: String },
    /// Not drawn: the file is attached to the document, with a paper clip in
    /// the box (in the line color of the mark, turned as the mark is). `author`
    /// says who attached it, when they said.
    Attachment { file: PathBuf, name: String, author: String },
}

/// One word of hidden text: what it says, and its box on the page (in
/// points from the top-left corner, like the box of a mark).
#[derive(Debug, Clone, PartialEq)]
pub struct HiddenWord {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontFamily {
    Sans,
    Serif,
    Mono,
}

impl FontFamily {
    /// The name the interface uses: `sans`, `serif`, `mono`.
    pub fn from_name(name: &str) -> Self {
        match name {
            "serif" => Self::Serif,
            "mono" => Self::Mono,
            _ => Self::Sans,
        }
    }
}

/// From the top of a line of text to its baseline, in letter sizes. The
/// interface places its letters by the same numbers.
pub const TEXT_ASCENT: f32 = 0.8;
/// From one baseline to the next, in letter sizes.
pub const TEXT_LINE_HEIGHT: f32 = 1.25;

/// What the pages of one new file share: each font and picture is put into the file once.
#[derive(Default)]
pub(super) struct SharedMarks {
    fonts: Vec<SharedFont>,
    pictures: Vec<(Arc<Vec<u8>>, PdfObject)>,
}

struct SharedFont {
    /// For a font of the computer: its file. The other facts then say nothing.
    file: Option<PathBuf>,
    family: FontFamily,
    bold: bool,
    italic: bool,
    /// One of the computer's fonts (with letters of many languages), not a built-in one.
    wide: bool,
    font: Font,
    object: PdfObject,
}

impl Mark {
    /// The box of a mark that removes what is under it, with its corners in
    /// order, and what goes; `None` for any other mark.
    pub(super) fn removed_area(&self) -> Option<(super::Area, super::page_change::Removed)> {
        use super::page_change::Removed;
        let removed = match self.kind {
            MarkKind::Redact => Removed::Everything,
            MarkKind::Erase => Removed::Text,
            MarkKind::ErasePicture => Removed::Pictures,
            _ => return None,
        };
        let area = self.area_in_order();
        Some(match removed {
            // A picture goes when any of it is touched: only its middle is, so that a picture beside it stays.
            Removed::Pictures => (
                super::Area { x: area.x + area.width * 0.3, y: area.y + area.height * 0.3, width: area.width * 0.4, height: area.height * 0.4 },
                removed,
            ),
            _ => (area, removed),
        })
    }

    pub(super) fn area_in_order(&self) -> super::Area {
        super::Area {
            x: self.x.min(self.x + self.width),
            y: self.y.min(self.y + self.height),
            width: self.width.abs(),
            height: self.height.abs(),
        }
    }
}

/// Draws the marks over the page.
pub(super) fn apply(
    document: &mut PdfDocument,
    page: &mut PdfObject,
    marks: &[Mark],
    shared: &mut SharedMarks,
) -> Result<(), EngineError> {
    if marks.is_empty() {
        return Ok(());
    }
    let (page_height, matrix) = page_frame(page)?;
    let mut drawing = format!("q {matrix} cm 1 J 1 j\n");
    for mark in marks {
        if let Some(part) = draw(document, page, mark, page_height, shared)? {
            drawing.push_str(&part);
        }
    }
    drawing.push_str("Q\n");
    draw_over(document, page, &drawing)
}

/// Marks drawn as a picture of their own instead of into a page: what a
/// signature shows of itself. The marks are placed in a box of `width` ×
/// `height` (from its top-left corner, like marks on a page); `turn` is the
/// linear part of the matrix that stands the box upright on its page.
pub(super) fn appearance(document: &mut PdfDocument, marks: &[Mark], width: f32, height: f32, turn: [f32; 4]) -> Result<PdfObject, EngineError> {
    // Fonts and pictures are gathered on a dictionary that stands in for a page.
    let mut holder = document.new_dict().map_err(failed)?;
    let mut shared = SharedMarks::default();
    let mut drawing = String::from("q 1 J 1 j\n");
    for mark in marks {
        if let Some(part) = draw(document, &mut holder, mark, height, &mut shared)? {
            drawing.push_str(&part);
        }
    }
    drawing.push_str("Q\n");
    let [a, b, c, d] = turn;
    let mut facts = document
        .new_object_from_str(&format!("<< /Type /XObject /Subtype /Form /BBox [0 0 {width} {height}] /Matrix [{a} {b} {c} {d} 0 0] >>"))
        .map_err(failed)?;
    let resources = match holder.get_dict("Resources").map_err(failed)? {
        Some(resources) => resources,
        None => document.new_dict().map_err(failed)?,
    };
    facts.dict_put("Resources", resources).map_err(failed)?;
    let buffer = mupdf::Buffer::from_bytes(drawing.as_bytes()).map_err(failed)?;
    document.add_stream(&buffer, Some(&facts), false).map_err(failed)
}

/// The drawing instructions of one mark, between "remember" and "restore";
/// `None` for a mark with nothing to show.
fn draw(
    document: &mut PdfDocument,
    page: &mut PdfObject,
    mark: &Mark,
    page_height: f32,
    shared: &mut SharedMarks,
) -> Result<Option<String>, EngineError> {
    let Mark { x, y, width, height, .. } = *mark;
    if ![x, y, width, height, mark.rotation].iter().all(|number| number.is_finite()) {
        return Ok(None);
    }
    let rgb = |color: [f32; 3]| color.map(|part| part.clamp(0.0, 1.0).to_string()).join(" ");
    let line_width = if mark.line_width.is_finite() { mark.line_width.clamp(0.1, 100.0) } else { 1.0 };
    let stroke = mark.stroke.unwrap_or([0.0, 0.0, 0.0]);
    // The box with its corners in order, and upside down: PDF counts y from the bottom.
    let (left, right) = (x.min(x + width), x.max(x + width));
    let (top, bottom) = (page_height - y.min(y + height), page_height - y.max(y + height));
    let (box_width, box_height) = (right - left, top - bottom);

    let body = match &mark.kind {
        MarkKind::Rectangle | MarkKind::Ellipse => {
            if box_width <= 0.0 || box_height <= 0.0 {
                return Ok(None);
            }
            let path = if mark.kind == MarkKind::Rectangle {
                format!("{left} {bottom} {box_width} {box_height} re ")
            } else {
                ellipse_path(left, bottom, box_width, box_height)
            };
            match (mark.stroke, mark.fill) {
                (Some(line), Some(fill)) => format!("{} RG {} rg {line_width} w {path}B", rgb(line), rgb(fill)),
                (Some(line), None) => format!("{} RG {line_width} w {path}S", rgb(line)),
                (None, Some(fill)) => format!("{} rg {path}f", rgb(fill)),
                (None, None) => return Ok(None),
            }
        }
        MarkKind::Highlight => {
            if box_width <= 0.0 || box_height <= 0.0 {
                return Ok(None);
            }
            format!("{} rg {left} {bottom} {box_width} {box_height} re f", rgb(mark.fill.unwrap_or([1.0, 0.92, 0.0])))
        }
        MarkKind::Dot => {
            if box_width <= 0.0 || box_height <= 0.0 {
                return Ok(None);
            }
            format!("{} rg {}f", rgb(stroke), ellipse_path(left, bottom, box_width, box_height))
        }
        MarkKind::Check => format!(
            "{} RG {line_width} w {} {} m {} {} l {} {} l S",
            rgb(stroke),
            left,
            bottom + box_height * 0.45,
            left + box_width * 0.36,
            bottom,
            right,
            top,
        ),
        MarkKind::Cross => format!(
            "{} RG {line_width} w {left} {top} m {right} {bottom} l {left} {bottom} m {right} {top} l S",
            rgb(stroke)
        ),
        MarkKind::Line | MarkKind::Arrow => {
            let (from_x, from_y) = (x, page_height - y);
            let (to_x, to_y) = (x + width, page_height - y - height);
            let length = (to_x - from_x).hypot(to_y - from_y);
            if length <= 0.0 {
                return Ok(None);
            }
            if mark.kind == MarkKind::Line {
                format!("{} RG {line_width} w {from_x} {from_y} m {to_x} {to_y} l S", rgb(stroke))
            } else {
                let head = arrow_head(line_width, length);
                let (along_x, along_y) = ((to_x - from_x) / length, (to_y - from_y) / length);
                // The line stops where the head begins, so its round end does not stick out of the point.
                let (neck_x, neck_y) = (to_x - along_x * head.length, to_y - along_y * head.length);
                let (side_x, side_y) = (-along_y * head.half_width, along_x * head.half_width);
                format!(
                    "{color} RG {color} rg {line_width} w {from_x} {from_y} m {neck_x} {neck_y} l S {to_x} {to_y} m {} {} l {} {} l h f",
                    neck_x + side_x,
                    neck_y + side_y,
                    neck_x - side_x,
                    neck_y - side_y,
                    color = rgb(stroke),
                )
            }
        }
        MarkKind::Text { text, family, bold, italic, size, file, align } => {
            let size = if size.is_finite() { size.clamp(1.0, 2000.0) } else { 12.0 };
            let named = file.as_deref().and_then(|file| shared.font_from_file(document, file));
            let index = match named {
                Some(index) => index,
                None => shared.font_for(document, *family, *bold, *italic, text)?,
            };
            let SharedFont { font, object, .. } = &shared.fonts[index];
            let mut lines = String::new();
            for (number, line) in text.lines().enumerate() {
                let (glyphs, line_width) = glyphs_of(font, line, size)?;
                if glyphs.is_empty() {
                    continue;
                }
                let align = if align.is_finite() { align.clamp(0.0, 1.0) } else { 0.0 };
                let left = left + (box_width - line_width).max(0.0) * align;
                let baseline = top - size * TEXT_ASCENT - number as f32 * size * TEXT_LINE_HEIGHT;
                lines.push_str(&format!("1 0 0 1 {left} {baseline} Tm <{glyphs}> Tj "));
            }
            if lines.is_empty() {
                return Ok(None);
            }
            let name = put_resource(document, page, "Font", "SyntelabFont", object, true)?;
            format!("BT {} rg /{name} {size} Tf {lines}ET", rgb(stroke))
        }
        MarkKind::HiddenText { words, turn } => {
            // One font for the whole page: the built-in one when it has every letter, else one of the computer's.
            let all: String = words.iter().map(|word| word.text.as_str()).collect::<Vec<_>>().join(" ");
            let index = shared.font_for(document, FontFamily::Sans, false, false, &all)?;
            let SharedFont { font, object, .. } = &shared.fonts[index];
            let mut written = String::new();
            for word in words {
                if ![word.x, word.y, word.width, word.height].iter().all(|number| number.is_finite()) || word.width <= 0.0 || word.height <= 0.0 {
                    continue;
                }
                // The box upside down, as PDF counts; then along which way the word runs and how thick its line is.
                let (left, right) = (word.x, word.x + word.width);
                let (top, bottom) = (page_height - word.y, page_height - word.y - word.height);
                let sideways = turn.rem_euclid(180) == 90;
                let (length, thickness) = if sideways { (word.height, word.width) } else { (word.width, word.height) };
                let size = (thickness * 0.9).clamp(1.0, 2000.0);
                let (glyphs, natural) = glyphs_of(font, &word.text, size)?;
                if glyphs.is_empty() || natural <= 0.0 {
                    continue;
                }
                // Stretched to the length it has on the page, so that what is selected lies over what is seen.
                let stretch = (length / natural * 100.0).clamp(10.0, 1000.0);
                let lift = thickness * 0.2;
                let matrix = match turn.rem_euclid(360) {
                    90 => format!("0 1 -1 0 {} {bottom}", right - lift),
                    180 => format!("-1 0 0 -1 {right} {}", top - lift),
                    270 => format!("0 -1 1 0 {} {top}", left + lift),
                    _ => format!("1 0 0 1 {left} {}", bottom + lift),
                };
                written.push_str(&format!("/{{font}} {size} Tf {stretch} Tz {matrix} Tm <{glyphs}> Tj "));
            }
            if written.is_empty() {
                return Ok(None);
            }
            let name = put_resource(document, page, "Font", "SyntelabFont", object, true)?;
            // "3 Tr": neither filled nor outlined. The text is there for readers, not for the eye.
            format!("BT 3 Tr {}100 Tz ET", written.replace("{font}", &name))
        }
        // Done before anything is drawn, on the page as a whole.
        MarkKind::Redact | MarkKind::Erase | MarkKind::ErasePicture => return Ok(None),
        MarkKind::Link { .. } | MarkKind::Field { .. } | MarkKind::Bookmark { .. } | MarkKind::Attachment { .. } => return Ok(None),
        MarkKind::Picture { data } => {
            if box_width <= 0.0 || box_height <= 0.0 {
                return Ok(None);
            }
            let index = match shared.pictures.iter().position(|(known, _)| Arc::ptr_eq(known, data)) {
                Some(index) => index,
                None => {
                    let image = Image::from_bytes(data).map_err(failed)?;
                    shared.pictures.push((Arc::clone(data), document.add_image(&image).map_err(failed)?));
                    shared.pictures.len() - 1
                }
            };
            let name = put_resource(document, page, "XObject", "SyntelabMark", &shared.pictures[index].1, true)?;
            format!("{box_width} 0 0 {box_height} {left} {bottom} cm /{name} Do")
        }
    };

    let mut part = String::from("q ");
    let opacity = if mark.opacity.is_finite() { mark.opacity.clamp(0.0, 1.0) } else { 1.0 };
    let blended = mark.kind == MarkKind::Highlight;
    if opacity < 1.0 || blended {
        let mut state = document.new_dict().map_err(failed)?;
        state.dict_put("Type", document.new_name("ExtGState").map_err(failed)?).map_err(failed)?;
        state.dict_put("ca", document.new_real(opacity).map_err(failed)?).map_err(failed)?;
        state.dict_put("CA", document.new_real(opacity).map_err(failed)?).map_err(failed)?;
        if blended {
            // What is under a highlight stays as dark as it was.
            state.dict_put("BM", document.new_name("Multiply").map_err(failed)?).map_err(failed)?;
        }
        let name = put_resource(document, page, "ExtGState", "SyntelabState", &state, true)?;
        part.push_str(&format!("/{name} gs "));
    }
    if mark.rotation.rem_euclid(360.0) != 0.0 {
        let (center_x, center_y) = (x + width / 2.0, page_height - y - height / 2.0);
        let [a, b, c, d] = turn_matrix(mark.rotation);
        part.push_str(&format!("1 0 0 1 {center_x} {center_y} cm {a} {b} {c} {d} 0 0 cm 1 0 0 1 {} {} cm ", -center_x, -center_y));
    }
    part.push_str(&body);
    part.push_str(" Q\n");
    Ok(Some(part))
}

impl SharedMarks {
    /// The place in `fonts` of a font of the computer; `None` when its file cannot be read as a font.
    fn font_from_file(&mut self, document: &mut PdfDocument, file: &std::path::Path) -> Option<usize> {
        if let Some(index) = self.fonts.iter().position(|font| font.file.as_deref() == Some(file)) {
            return Some(index);
        }
        let data = std::fs::read(file).ok()?;
        let font = Font::from_bytes("SyntelabText", &data).ok()?;
        let object = document.add_font(&font).ok()?;
        self.fonts.push(SharedFont { file: Some(file.to_path_buf()), family: FontFamily::Sans, bold: false, italic: false, wide: true, font, object });
        Some(self.fonts.len() - 1)
    }

    /// The place in `fonts` of the font to write `text` in: the built-in one
    /// when it has every letter, else the computer's own font of that kind
    /// (when there is one), which knows many more languages.
    fn font_for(
        &mut self,
        document: &mut PdfDocument,
        family: FontFamily,
        bold: bool,
        italic: bool,
        text: &str,
    ) -> Result<usize, EngineError> {
        let built_in = self.font(document, family, bold, italic, false)?.expect("built-in fonts always load");
        if has_all_letters(&self.fonts[built_in].font, text) {
            return Ok(built_in);
        }
        Ok(self.font(document, family, bold, italic, true)?.unwrap_or(built_in))
    }

    fn font(
        &mut self,
        document: &mut PdfDocument,
        family: FontFamily,
        bold: bool,
        italic: bool,
        wide: bool,
    ) -> Result<Option<usize>, EngineError> {
        let known = |font: &SharedFont| font.file.is_none() && font.family == family && font.bold == bold && font.italic == italic && font.wide == wide;
        if let Some(index) = self.fonts.iter().position(known) {
            return Ok(Some(index));
        }
        let font = if wide {
            let Some(data) = system_font_files(family, bold, italic).into_iter().find_map(|path| std::fs::read(path).ok()) else {
                return Ok(None);
            };
            match Font::from_bytes("SyntelabText", &data) {
                Ok(font) => font,
                Err(_) => return Ok(None),
            }
        } else {
            Font::new(built_in_font_name(family, bold, italic)).map_err(failed)?
        };
        let object = document.add_font(&font).map_err(failed)?;
        self.fonts.push(SharedFont { file: None, family, bold, italic, wide, font, object });
        Ok(Some(self.fonts.len() - 1))
    }
}

fn has_all_letters(font: &Font, text: &str) -> bool {
    text.chars().filter(|letter| !letter.is_control()).all(|letter| font.encode_character(letter as i32).is_ok_and(|glyph| glyph > 0))
}

/// The text as the font's own glyph numbers (four hex digits each), and how
/// wide it is at `size`. A letter the font does not have is left out.
fn glyphs_of(font: &Font, text: &str, size: f32) -> Result<(String, f32), EngineError> {
    let mut glyphs = String::new();
    let mut width = 0.0;
    for letter in text.chars() {
        let glyph = font.encode_character(letter as i32).map_err(failed)?;
        if glyph > 0 && glyph <= 0xFFFF {
            glyphs.push_str(&format!("{glyph:04X}"));
            width += font.advance_glyph(glyph).map_err(failed)? * size;
        }
    }
    Ok((glyphs, width))
}

/// The fonts every PDF reader has.
fn built_in_font_name(family: FontFamily, bold: bool, italic: bool) -> &'static str {
    match (family, bold, italic) {
        (FontFamily::Sans, false, false) => "Helvetica",
        (FontFamily::Sans, true, false) => "Helvetica-Bold",
        (FontFamily::Sans, false, true) => "Helvetica-Oblique",
        (FontFamily::Sans, true, true) => "Helvetica-BoldOblique",
        (FontFamily::Serif, false, false) => "Times-Roman",
        (FontFamily::Serif, true, false) => "Times-Bold",
        (FontFamily::Serif, false, true) => "Times-Italic",
        (FontFamily::Serif, true, true) => "Times-BoldItalic",
        (FontFamily::Mono, false, false) => "Courier",
        (FontFamily::Mono, true, false) => "Courier-Bold",
        (FontFamily::Mono, false, true) => "Courier-Oblique",
        (FontFamily::Mono, true, true) => "Courier-BoldOblique",
    }
}

/// Where the computer keeps a font that looks like the built-in one and has
/// the letters of many more languages; the first that can be read is used.
fn system_font_files(family: FontFamily, bold: bool, italic: bool) -> Vec<PathBuf> {
    let style = usize::from(bold) + 2 * usize::from(italic);
    let mut files = Vec::new();
    if cfg!(target_os = "windows") {
        let name = match family {
            FontFamily::Sans => ["arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"],
            FontFamily::Serif => ["times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"],
            FontFamily::Mono => ["cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"],
        }[style];
        let windows = std::env::var_os("WINDIR").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("C:\\Windows"));
        files.push(windows.join("Fonts").join(name));
    } else if cfg!(target_os = "macos") {
        let name = match family {
            FontFamily::Sans => ["Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf", "Arial Bold Italic.ttf"],
            FontFamily::Serif => {
                ["Times New Roman.ttf", "Times New Roman Bold.ttf", "Times New Roman Italic.ttf", "Times New Roman Bold Italic.ttf"]
            }
            FontFamily::Mono => ["Courier New.ttf", "Courier New Bold.ttf", "Courier New Italic.ttf", "Courier New Bold Italic.ttf"],
        }[style];
        files.push(PathBuf::from("/System/Library/Fonts/Supplemental").join(name));
        files.push(PathBuf::from("/Library/Fonts").join(name));
    } else {
        let name = match family {
            FontFamily::Sans => ["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf"],
            FontFamily::Serif => ["DejaVuSerif.ttf", "DejaVuSerif-Bold.ttf", "DejaVuSerif-Italic.ttf", "DejaVuSerif-BoldItalic.ttf"],
            FontFamily::Mono => {
                ["DejaVuSansMono.ttf", "DejaVuSansMono-Bold.ttf", "DejaVuSansMono-Oblique.ttf", "DejaVuSansMono-BoldOblique.ttf"]
            }
        }[style];
        files.push(PathBuf::from("/usr/share/fonts/truetype/dejavu").join(name));
        files.push(PathBuf::from("/usr/share/fonts/dejavu").join(name));
    }
    files
}

/// The head of an arrow: how long it is and half of how wide.
struct ArrowHead {
    length: f32,
    half_width: f32,
}

/// A head that suits the line: larger for a thick line, never longer than the arrow itself.
fn arrow_head(line_width: f32, arrow_length: f32) -> ArrowHead {
    let length = (line_width * 4.0).max(8.0).min(arrow_length);
    ArrowHead { length, half_width: length * 0.38 }
}

/// The first four numbers of the PDF matrix that turns `degrees` clockwise as
/// the reader sees it (PDF counts y upward, so it is the other way round there).
fn turn_matrix(degrees: f32) -> [f32; 4] {
    let (sin, cos) = degrees.to_radians().sin_cos();
    [cos, -sin, sin, cos]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn turns_clockwise_as_the_reader_sees_it() {
        let [a, b, c, d] = turn_matrix(90.0);
        // A point to the right of the middle ends up under it: lower y in PDF.
        let (x, y) = (a * 1.0 + c * 0.0, b * 1.0 + d * 0.0);
        assert!(x.abs() < 1e-6 && (y + 1.0).abs() < 1e-6);
    }

    #[test]
    fn arrow_heads_suit_their_lines() {
        assert_eq!(arrow_head(1.0, 100.0).length, 8.0);
        assert_eq!(arrow_head(5.0, 100.0).length, 20.0);
        // A very short arrow is all head.
        assert_eq!(arrow_head(5.0, 6.0).length, 6.0);
    }

    #[test]
    fn knows_the_fonts_every_reader_has() {
        assert_eq!(built_in_font_name(FontFamily::Sans, false, false), "Helvetica");
        assert_eq!(built_in_font_name(FontFamily::Serif, true, true), "Times-BoldItalic");
        assert_eq!(built_in_font_name(FontFamily::Mono, false, true), "Courier-Oblique");
        assert_eq!(FontFamily::from_name("serif"), FontFamily::Serif);
        assert_eq!(FontFamily::from_name("anything"), FontFamily::Sans);
    }
}
