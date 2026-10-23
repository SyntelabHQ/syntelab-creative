//! What the user adds to a page that is not drawn into it: links, form
//! fields of their own, bookmarks and attached files (MuPDF binding). They are
//! carried by marks like everything else put on a page, and become objects of
//! the PDF itself when a file is made.

use std::fs;
use std::path::Path;

use mupdf::pdf::{EmbeddedFileOptions, PdfDocument, PdfObject};
use mupdf::Buffer;

use super::marks::{Mark, MarkKind};
use super::page_change::{ellipse_path, failed, own_box};
use super::EngineError;

/// Where a link leads.
#[derive(Debug, Clone, PartialEq)]
pub enum LinkTarget {
    /// An address: a web page, `mailto:`…
    Address(String),
    /// A page of the file that is being written, by its place there, from 0.
    Page(usize),
}

/// A form field the user adds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NewField {
    Text { multiline: bool },
    Checkbox,
    /// A place to sign with a certificate, left empty.
    Signature,
    /// A list that drops down, to choose one of these answers from.
    Choice { options: Vec<String> },
    /// One of the buttons of a group (the fields of one name): choosing one clears the others. `value` is the answer it stands for.
    Radio { value: String },
}

/// What is changed in a document beside its pages when it is written anew.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct DocumentChanges {
    pub bookmarks: Vec<BookmarkEdit>,
    /// Names of attached files to take out.
    pub detach: Vec<String>,
}

/// A bookmark the document has, found by its place at every level (from 0), and what happens to it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BookmarkEdit {
    pub path: Vec<usize>,
    /// A new title.
    pub title: Option<String>,
    /// It is taken out, with the bookmarks under it.
    pub remove: bool,
}

/// Makes the changes of `changes` in the document.
pub(super) fn change(document: &mut PdfDocument, changes: &DocumentChanges) -> Result<(), EngineError> {
    // Found before anything is taken out: the places are those of the document as it was.
    let mut found = Vec::new();
    for edit in &changes.bookmarks {
        if let Some(item) = bookmark_at(document, &edit.path)? {
            found.push((item, edit));
        }
    }
    for (item, edit) in &mut found {
        if let Some(title) = edit.title.as_deref().filter(|title| !title.trim().is_empty()) {
            let written = document.new_object_from_str(&text_string(title.trim())).map_err(failed)?;
            item.dict_put("Title", written).map_err(failed)?;
        }
    }
    for (item, edit) in &found {
        if edit.remove {
            remove_bookmark(document, item)?;
        }
    }

    for name in &changes.detach {
        document.delete_embedded_file(name).map_err(failed)?;
        // Its paper clip goes with it.
        for number in 0..document.page_count().map_err(failed)? {
            let page = document.find_page(number).map_err(failed)?;
            let Some(mut annotations) = page.get_dict("Annots").map_err(failed)?.filter(|list| list.is_array().unwrap_or(false)) else {
                continue;
            };
            let mut index = annotations.len().map_err(failed)? as i32;
            while index > 0 {
                index -= 1;
                let Some(annotation) = annotations.get_array(index).map_err(failed)? else {
                    continue;
                };
                let is_clip = annotation.get_dict("Subtype").map_err(failed)?.and_then(|kind| kind.as_name().ok()).is_some_and(|kind| kind == b"FileAttachment");
                let of_file = |key: &str| -> bool {
                    annotation
                        .get_dict("FS")
                        .ok()
                        .flatten()
                        .and_then(|file| file.get_dict(key).ok().flatten())
                        .and_then(|written| written.as_string().ok())
                        .is_some_and(|written| written == *name)
                };
                if is_clip && (of_file("UF") || of_file("F")) {
                    annotations.array_delete(index).map_err(failed)?;
                }
            }
        }
    }
    Ok(())
}

/// The bookmark at `path`: its place among the top ones, then among those under it, and so on.
fn bookmark_at(document: &PdfDocument, path: &[usize]) -> Result<Option<PdfObject>, EngineError> {
    let Some(mut parent) = document.catalog().map_err(failed)?.get_dict("Outlines").map_err(failed)? else {
        return Ok(None);
    };
    let mut found = None;
    for place in path {
        let Some(mut item) = parent.get_dict("First").map_err(failed)? else {
            return Ok(None);
        };
        for _ in 0..*place {
            match item.get_dict("Next").map_err(failed)? {
                Some(next) => item = next,
                None => return Ok(None),
            }
        }
        parent = item.try_clone().map_err(failed)?;
        found = Some(item);
    }
    Ok(found)
}

/// Takes a bookmark out of the list it is in; the ones before and after it join hands.
fn remove_bookmark(document: &PdfDocument, item: &PdfObject) -> Result<(), EngineError> {
    let Some(mut parent) = item.get_dict("Parent").map_err(failed)? else {
        return Ok(());
    };
    let previous = item.get_dict("Prev").map_err(failed)?;
    let next = item.get_dict("Next").map_err(failed)?;
    match (&previous, &next) {
        (Some(previous), Some(next)) => {
            previous.try_clone().map_err(failed)?.dict_put("Next", next.try_clone().map_err(failed)?).map_err(failed)?;
            next.try_clone().map_err(failed)?.dict_put("Prev", previous.try_clone().map_err(failed)?).map_err(failed)?;
        }
        (Some(previous), None) => {
            previous.try_clone().map_err(failed)?.dict_delete("Next").map_err(failed)?;
            parent.dict_put("Last", previous.try_clone().map_err(failed)?).map_err(failed)?;
        }
        (None, Some(next)) => {
            next.try_clone().map_err(failed)?.dict_delete("Prev").map_err(failed)?;
            parent.dict_put("First", next.try_clone().map_err(failed)?).map_err(failed)?;
        }
        (None, None) => {
            parent.dict_delete("First").map_err(failed)?;
            parent.dict_delete("Last").map_err(failed)?;
        }
    }
    // How many entries show under the parent: one less, and those that showed under the one removed.
    let shown = |object: &PdfObject| -> Result<i32, EngineError> {
        Ok(object.get_dict("Count").map_err(failed)?.map(|count| count.as_int()).transpose().map_err(failed)?.unwrap_or(0))
    };
    let (count, gone) = (shown(&parent)?, 1 + shown(item)?.max(0));
    let left = if count >= 0 { (count - gone).max(0) } else { (count + gone).min(0) };
    if previous.is_none() && next.is_none() {
        parent.dict_delete("Count").map_err(failed)?;
    } else {
        parent.dict_put("Count", document.new_int(left).map_err(failed)?).map_err(failed)?;
    }
    Ok(())
}

/// A file kept inside a document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedFile {
    pub name: String,
    /// In bytes.
    pub size: usize,
}

/// The files the document at `path` has attached.
pub fn attached_files(path: &Path) -> Result<Vec<AttachedFile>, EngineError> {
    let document = open(path)?;
    let files = document.embedded_files().map_err(failed)?;
    Ok(files.into_iter().map(|file| AttachedFile { name: file.name, size: file.size }).collect())
}

/// Writes the file attached to the document at `path` under `name` to `destination`.
pub fn save_attached_file(path: &Path, name: &str, destination: &Path) -> Result<(), EngineError> {
    let document = open(path)?;
    let contents = document.load_embedded_file(name).map_err(failed)?.ok_or_else(|| EngineError::Failed(format!("no attached file named {name}")))?;
    fs::write(destination, contents).map_err(|error| EngineError::Failed(error.to_string()))
}

fn open(path: &Path) -> Result<PdfDocument, EngineError> {
    let name = path.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    PdfDocument::open(name).map_err(failed)
}

/// The largest file that is attached, in bytes.
const LARGEST_ATTACHMENT: u64 = 100 * 1024 * 1024;

/// What can only be finished once every page of the new file is in place.
#[derive(Default)]
pub(super) struct Pending {
    /// Links to a page: the link, and the place of the page it leads to.
    page_links: Vec<(PdfObject, usize)>,
    /// Bookmarks, in the order of the pages: the page's place, where on it (in its own coordinates), the title.
    bookmarks: Vec<(usize, (f32, f32), String)>,
    /// The names fields were given, so no two get the same.
    field_names: Vec<String>,
    /// The names attached files were given.
    attachment_names: Vec<String>,
    /// The groups of radio buttons made so far: the name of each, and the field its buttons belong to.
    radio_groups: Vec<(String, PdfObject)>,
}

/// Adds what the marks of the page at `index` carry. Called before the user's
/// turn is put on the page (`added_rotation`, in degrees), like the drawing of marks.
pub(super) fn add(
    document: &mut PdfDocument,
    index: usize,
    marks: &[Mark],
    added_rotation: i32,
    pending: &mut Pending,
) -> Result<(), EngineError> {
    let carried = |mark: &&Mark| {
        matches!(mark.kind, MarkKind::Link { .. } | MarkKind::Field { .. } | MarkKind::Bookmark { .. } | MarkKind::Attachment { .. })
    };
    if !marks.iter().any(|mark| carried(&mark)) {
        return Ok(());
    }
    let page_number = i32::try_from(index).map_err(|_| EngineError::NoSuchPage(index))?;
    let mut page = document.find_page(page_number).map_err(failed)?;
    let own_rotation =
        page.get_dict_inheritable("Rotate").map_err(failed)?.map(|value| value.as_int()).transpose().map_err(failed)?.unwrap_or(0);
    // How the page will lie for the reader: what a field writes its text along.
    let shown_rotation = (own_rotation + added_rotation).rem_euclid(360);

    for mark in marks.iter().filter(carried) {
        if ![mark.x, mark.y, mark.width, mark.height].iter().all(|number| number.is_finite()) {
            continue;
        }
        let [x0, y0, x1, y1] = own_box(&page, mark.area_in_order())?;
        let rect = format!("[{x0} {y0} {x1} {y1}]");
        match &mark.kind {
            MarkKind::Link { target } => {
                let link = match target {
                    LinkTarget::Address(address) if !address.trim().is_empty() => {
                        let action = format!("<< /Type /Action /S /URI /URI {} >>", ascii_string(address.trim()));
                        add_object(document, &format!("<< /Type /Annot /Subtype /Link /Rect {rect} /Border [0 0 0] /F 4 /A {action} >>"))?
                    }
                    LinkTarget::Page(to) => {
                        let link = add_object(document, &format!("<< /Type /Annot /Subtype /Link /Rect {rect} /Border [0 0 0] /F 4 >>"))?;
                        pending.page_links.push((link.try_clone().map_err(failed)?, *to));
                        link
                    }
                    // A link that leads nowhere is not written.
                    LinkTarget::Address(_) => continue,
                };
                push_annotation(document, &mut page, link)?;
            }
            MarkKind::Field { field, name } => {
                if let NewField::Radio { value } = field {
                    // Buttons of one name are one field: its answer is the button that is chosen.
                    let group = if name.trim().is_empty() { "Group" } else { name.trim() };
                    let parent = match pending.radio_groups.iter().find(|(known, _)| known == group) {
                        Some((_, parent)) => parent.try_clone().map_err(failed)?,
                        None => {
                            // 49152: radio buttons, of which one always stays chosen.
                            let parent = add_object(document, &format!("<< /FT /Btn /Ff 49152 /T {} /V /Off /Kids [] >>", text_string(group)))?;
                            pending.radio_groups.push((group.to_owned(), parent.try_clone().map_err(failed)?));
                            add_to_form(document, parent.try_clone().map_err(failed)?, false, true)?;
                            parent
                        }
                    };
                    let mut kids = parent.get_dict("Kids").map_err(failed)?.ok_or_else(|| EngineError::Failed("a group without buttons".into()))?;
                    let (width, height) = (x1 - x0, y1 - y0);
                    let ring = format!("0.4 0.47 0.6 RG 1 w {}S\n", ellipse_path(0.5, 0.5, width - 1.0, height - 1.0));
                    let dot = format!("0 0 0 rg {}f\n", ellipse_path(width * 0.28, height * 0.28, width * 0.44, height * 0.44));
                    let on = form_stream(document, width, height, &format!("{ring}{dot}"))?;
                    let off = form_stream(document, width, height, &ring)?;
                    let mut states = document.new_dict().map_err(failed)?;
                    // The answer is a name in the file: plain letters and digits, told apart by its place in the group.
                    let plain: String = value.chars().filter(|letter| letter.is_ascii_alphanumeric()).collect();
                    let answer = format!("{}{}", if plain.is_empty() { "Choice" } else { &plain }, kids.len().map_err(failed)? + 1);
                    states.dict_put(answer.as_str(), on).map_err(failed)?;
                    states.dict_put("Off", off).map_err(failed)?;
                    let mut appearance = document.new_dict().map_err(failed)?;
                    appearance.dict_put("N", states).map_err(failed)?;
                    let mut button = add_object(
                        document,
                        &format!("<< /Type /Annot /Subtype /Widget /Rect {rect} /F 4 /AS /Off /MK << /R {shown_rotation} /CA (l) >> /TU {} >>", text_string(value)),
                    )?;
                    button.dict_put("AP", appearance).map_err(failed)?;
                    button.dict_put("Parent", parent.try_clone().map_err(failed)?).map_err(failed)?;
                    kids.array_push(button.try_clone().map_err(failed)?).map_err(failed)?;
                    push_annotation(document, &mut page, button)?;
                    continue;
                }
                let name = free_name(&mut pending.field_names, name, "Field");
                let common = format!("/Type /Annot /Subtype /Widget /Rect {rect} /F 4 /T {}", text_string(&name));
                let look = format!("/MK << /R {shown_rotation} /BC [0.4 0.47 0.6] >> /BS << /W 1 /S /S >>");
                let widget = match field {
                    NewField::Text { multiline } => {
                        let flags = if *multiline { 4096 } else { 0 };
                        add_object(document, &format!("<< {common} /FT /Tx /Ff {flags} /DA (/Helv 0 Tf 0 g) {look} >>"))?
                    }
                    NewField::Checkbox => {
                        let (width, height) = (x1 - x0, y1 - y0);
                        let frame = format!("0.4 0.47 0.6 RG 1 w 0.5 0.5 {} {} re S\n", width - 1.0, height - 1.0);
                        let tick = format!(
                            "q 0 0 0 RG {} w 1 J 1 j {} {} m {} {} l {} {} l S Q\n",
                            (width.min(height) * 0.12).max(1.0),
                            width * 0.2,
                            height * 0.5,
                            width * 0.42,
                            height * 0.24,
                            width * 0.8,
                            height * 0.8,
                        );
                        let on = form_stream(document, width, height, &format!("{frame}{tick}"))?;
                        let off = form_stream(document, width, height, &frame)?;
                        let mut states = document.new_dict().map_err(failed)?;
                        states.dict_put("Yes", on).map_err(failed)?;
                        states.dict_put("Off", off).map_err(failed)?;
                        let mut appearance = document.new_dict().map_err(failed)?;
                        appearance.dict_put("N", states).map_err(failed)?;
                        let mut widget =
                            add_object(document, &format!("<< {common} /FT /Btn /V /Off /AS /Off /MK << /R {shown_rotation} /CA (4) >> >>"))?;
                        widget.dict_put("AP", appearance).map_err(failed)?;
                        widget
                    }
                    NewField::Signature => add_object(document, &format!("<< {common} /FT /Sig {look} >>"))?,
                    NewField::Choice { options } => {
                        let answers: String = options.iter().map(|answer| answer.trim()).filter(|answer| !answer.is_empty()).map(text_string).collect::<Vec<_>>().join(" ");
                        // 131072: the list drops down from one line.
                        add_object(document, &format!("<< {common} /FT /Ch /Ff 131072 /Opt [{answers}] /DA (/Helv 0 Tf 0 g) {look} >>"))?
                    }
                    // Handled above.
                    NewField::Radio { .. } => continue,
                };
                push_annotation(document, &mut page, widget.try_clone().map_err(failed)?)?;
                add_to_form(document, widget, *field == NewField::Signature, true)?;
            }
            MarkKind::Bookmark { title } => {
                if !title.trim().is_empty() {
                    // The top-left corner of the mark, as the reader sees the page.
                    let top_left = match own_rotation.rem_euclid(360) {
                        90 => (x0, y0),
                        180 => (x1, y0),
                        270 => (x1, y1),
                        _ => (x0, y1),
                    };
                    pending.bookmarks.push((index, top_left, title.trim().to_owned()));
                }
            }
            MarkKind::Attachment { file, name, author } => {
                let size = fs::metadata(file).map(|facts| facts.len()).map_err(|error| EngineError::Failed(error.to_string()))?;
                if size > LARGEST_ATTACHMENT {
                    return Err(EngineError::Failed("the attached file is too large".into()));
                }
                let contents = fs::read(file).map_err(|error| EngineError::Failed(error.to_string()))?;
                let name = free_name(&mut pending.attachment_names, name, "file");
                // Among the files of the document, where every reader lists them…
                let attached = document.add_embedded_file(&name, &contents, EmbeddedFileOptions::new(&name)).map_err(failed)?;
                let file_spec = document.new_indirect(attached.xref, 0).map_err(failed)?;
                // …and as a paper clip on the page, where it was put, turned as it was turned.
                let (clip_width, clip_height) = (mark.width.abs(), mark.height.abs());
                let turn = if mark.rotation.is_finite() { mark.rotation.to_radians() } else { 0.0 };
                // The room the turned clip takes, around the same middle.
                let room_width = clip_width * turn.cos().abs() + clip_height * turn.sin().abs();
                let room_height = clip_width * turn.sin().abs() + clip_height * turn.cos().abs();
                let middle = (mark.x.min(mark.x + mark.width) + clip_width / 2.0, mark.y.min(mark.y + mark.height) + clip_height / 2.0);
                let room = super::Area { x: middle.0 - room_width / 2.0, y: middle.1 - room_height / 2.0, width: room_width, height: room_height };
                let [x0, y0, x1, y1] = own_box(&page, room)?;
                let rect = format!("[{x0} {y0} {x1} {y1}]");
                let (width, height) = (x1 - x0, y1 - y0);
                // Clockwise on the page as shown is the other way round in PDF, and the page's own turn is taken back out.
                let angle = (own_rotation as f32).to_radians() - turn;
                let color = mark.stroke.unwrap_or([0.0, 0.48, 1.0]).map(|part| part.clamp(0.0, 1.0));
                let drawing = format!(
                    "q 1 0 0 1 {} {} cm {} {} {} {} 0 0 cm 1 0 0 1 {} {} cm\n{}Q\n",
                    width / 2.0,
                    height / 2.0,
                    angle.cos(),
                    angle.sin(),
                    -angle.sin(),
                    angle.cos(),
                    -clip_width / 2.0,
                    -clip_height / 2.0,
                    paper_clip(clip_width, clip_height, color),
                );
                let clip = form_stream(document, width, height, &drawing)?;
                let mut appearance = document.new_dict().map_err(failed)?;
                appearance.dict_put("N", clip).map_err(failed)?;
                let who = if author.trim().is_empty() { String::new() } else { format!(" /T {}", text_string(author.trim())) };
                let mut note = add_object(
                    document,
                    &format!(
                        "<< /Type /Annot /Subtype /FileAttachment /Rect {rect} /F 4 /Name /Paperclip /C [{} {} {}] /Contents {}{who} >>",
                        color[0],
                        color[1],
                        color[2],
                        text_string(&name)
                    ),
                )?;
                note.dict_put("FS", file_spec).map_err(failed)?;
                note.dict_put("AP", appearance).map_err(failed)?;
                push_annotation(document, &mut page, note)?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// Finishes what needed every page in place: links that lead to a page, and bookmarks.
pub(super) fn finish(document: &mut PdfDocument, pending: Pending) -> Result<(), EngineError> {
    let page_count = usize::try_from(document.page_count().map_err(failed)?).unwrap_or(0);
    for (mut link, to) in pending.page_links {
        // A page that is gone leaves the link leading nowhere; it is harmless.
        if to >= page_count {
            continue;
        }
        let page = document.find_page(to as i32).map_err(failed)?;
        let mut destination = document.new_array().map_err(failed)?;
        destination.array_push(page).map_err(failed)?;
        destination.array_push(document.new_name("Fit").map_err(failed)?).map_err(failed)?;
        link.dict_put("Dest", destination).map_err(failed)?;
    }
    if pending.bookmarks.is_empty() {
        return Ok(());
    }

    let mut catalog = document.catalog().map_err(failed)?;
    let mut outlines = match catalog.get_dict("Outlines").map_err(failed)? {
        Some(outlines) if outlines.is_dict().map_err(failed)? => outlines,
        _ => {
            let outlines = add_object(document, "<< /Type /Outlines /Count 0 >>")?;
            catalog.dict_put("Outlines", outlines.try_clone().map_err(failed)?).map_err(failed)?;
            outlines
        }
    };
    for (index, (x, y), title) in pending.bookmarks {
        let page = document.find_page(index as i32).map_err(failed)?;
        let mut destination = document.new_array().map_err(failed)?;
        destination.array_push(page).map_err(failed)?;
        destination.array_push(document.new_name("XYZ").map_err(failed)?).map_err(failed)?;
        destination.array_push(document.new_real(x).map_err(failed)?).map_err(failed)?;
        destination.array_push(document.new_real(y).map_err(failed)?).map_err(failed)?;
        destination.array_push(document.new_null()).map_err(failed)?;

        let mut item = add_object(document, &format!("<< /Title {} >>", text_string(&title)))?;
        item.dict_put("Parent", outlines.try_clone().map_err(failed)?).map_err(failed)?;
        item.dict_put("Dest", destination).map_err(failed)?;
        // After the bookmarks the document already has, at the top level.
        match outlines.get_dict("Last").map_err(failed)? {
            Some(mut last) if last.is_dict().map_err(failed)? => {
                last.dict_put("Next", item.try_clone().map_err(failed)?).map_err(failed)?;
                item.dict_put("Prev", last).map_err(failed)?;
            }
            _ => outlines.dict_put("First", item.try_clone().map_err(failed)?).map_err(failed)?,
        }
        outlines.dict_put("Last", item).map_err(failed)?;
        // A list shown folded counts its entries below zero: it stays as it is.
        let count = outlines.get_dict("Count").map_err(failed)?.map(|count| count.as_int()).transpose().map_err(failed)?.unwrap_or(0);
        if count >= 0 {
            outlines.dict_put("Count", document.new_int(count + 1).map_err(failed)?).map_err(failed)?;
        }
    }
    Ok(())
}

/// A new object of the file, written as PDF writes objects; what comes back refers to it.
pub(super) fn add_object(document: &mut PdfDocument, source: &str) -> Result<PdfObject, EngineError> {
    let object = document.new_object_from_str(source).map_err(failed)?;
    document.add_object(&object).map_err(failed)
}

/// A small drawing of `width` × `height` that an annotation shows itself by.
pub(super) fn form_stream(document: &mut PdfDocument, width: f32, height: f32, drawing: &str) -> Result<PdfObject, EngineError> {
    let facts = document
        .new_object_from_str(&format!("<< /Type /XObject /Subtype /Form /BBox [0 0 {width} {height}] /Resources << >> >>"))
        .map_err(failed)?;
    let buffer = Buffer::from_bytes(drawing.as_bytes()).map_err(failed)?;
    document.add_stream(&buffer, Some(&facts), false).map_err(failed)
}

/// A paper clip of this color filling a box of `width` × `height`.
fn paper_clip(width: f32, height: f32, color: [f32; 3]) -> String {
    let at = |x: f32, y: f32| format!("{} {}", x * width, y * height);
    format!(
        "q {} {} {} RG {} w 1 J 1 j {} m {} l {} {} {} c {} l {} {} {} c {} l {} {} {} c {} l S Q\n",
        color[0],
        color[1],
        color[2],
        (width.min(height) * 0.09).max(0.8),
        at(0.62, 0.72),
        at(0.62, 0.3),
        at(0.62, 0.14),
        at(0.38, 0.14),
        at(0.38, 0.3),
        at(0.38, 0.8),
        at(0.38, 0.98),
        at(0.78, 0.98),
        at(0.78, 0.8),
        at(0.78, 0.22),
        at(0.78, 0.0),
        at(0.22, 0.0),
        at(0.22, 0.22),
        at(0.22, 0.72),
    )
}

pub(super) fn push_annotation(document: &PdfDocument, page: &mut PdfObject, annotation: PdfObject) -> Result<(), EngineError> {
    let mut annotations = match page.get_dict("Annots").map_err(failed)? {
        Some(annotations) if annotations.is_array().map_err(failed)? => annotations,
        _ => {
            page.dict_put("Annots", document.new_array().map_err(failed)?).map_err(failed)?;
            page.get_dict("Annots").map_err(failed)?.ok_or_else(|| EngineError::Failed("the page takes no annotations".into()))?
        }
    };
    annotations.array_push(annotation).map_err(failed)
}

/// Makes the field one of the document's form, which is started when the document has none.
///
/// `signature`: the field is for signing. `needs_drawing`: readers are asked
/// to draw the fields themselves (new fields have no picture of their own;
/// a document that is being signed must not ask for that: it would be changed
/// by whoever opens it).
pub(super) fn add_to_form(document: &mut PdfDocument, field: PdfObject, signature: bool, needs_drawing: bool) -> Result<(), EngineError> {
    const HELVETICA: &str = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
    let mut catalog = document.catalog().map_err(failed)?;
    let mut form = match catalog.get_dict("AcroForm").map_err(failed)? {
        Some(form) if form.is_dict().map_err(failed)? => form,
        _ => {
            let form = add_object(document, "<< /Fields [] /DA (/Helv 0 Tf 0 g) >>")?;
            catalog.dict_put("AcroForm", form.try_clone().map_err(failed)?).map_err(failed)?;
            form
        }
    };
    let mut fields = match form.get_dict("Fields").map_err(failed)? {
        Some(fields) if fields.is_array().map_err(failed)? => fields,
        _ => {
            form.dict_put("Fields", document.new_array().map_err(failed)?).map_err(failed)?;
            form.get_dict("Fields").map_err(failed)?.ok_or_else(|| EngineError::Failed("the form takes no fields".into()))?
        }
    };
    fields.array_push(field).map_err(failed)?;

    // The font the new fields write in must be known to the form.
    let mut resources = match form.get_dict("DR").map_err(failed)? {
        Some(resources) if resources.is_dict().map_err(failed)? => resources,
        _ => {
            form.dict_put("DR", document.new_dict().map_err(failed)?).map_err(failed)?;
            form.get_dict("DR").map_err(failed)?.ok_or_else(|| EngineError::Failed("the form takes no fonts".into()))?
        }
    };
    let mut fonts = match resources.get_dict("Font").map_err(failed)? {
        Some(fonts) if fonts.is_dict().map_err(failed)? => fonts,
        _ => {
            resources.dict_put("Font", document.new_dict().map_err(failed)?).map_err(failed)?;
            resources.get_dict("Font").map_err(failed)?.ok_or_else(|| EngineError::Failed("the form takes no fonts".into()))?
        }
    };
    if fonts.get_dict("Helv").map_err(failed)?.is_none() {
        let font = add_object(document, HELVETICA)?;
        fonts.dict_put("Helv", font).map_err(failed)?;
    }
    if needs_drawing {
        // Readers draw the fields themselves: nothing was typed into them yet.
        form.dict_put("NeedAppearances", document.new_bool(true)).map_err(failed)?;
    } else {
        form.dict_delete("NeedAppearances").map_err(failed)?;
    }
    if signature {
        let flags = form.get_dict("SigFlags").map_err(failed)?.map(|flags| flags.as_int()).transpose().map_err(failed)?.unwrap_or(0);
        // 1: the document has signature fields. 2 (with a signature made): it may only be added to, not rewritten.
        form.dict_put("SigFlags", document.new_int(flags | if needs_drawing { 1 } else { 3 }).map_err(failed)?).map_err(failed)?;
    }
    Ok(())
}

/// `wanted` (or `fallback` when it is empty), with a number after it when the name is taken.
fn free_name(taken: &mut Vec<String>, wanted: &str, fallback: &str) -> String {
    let base = if wanted.trim().is_empty() { fallback } else { wanted.trim() };
    let mut name = base.to_owned();
    let mut number = 2;
    while taken.contains(&name) {
        name = format!("{base} {number}");
        number += 1;
    }
    taken.push(name.clone());
    name
}

/// Text as PDF keeps it when it may hold any letter: two bytes per letter, written in hexadecimal.
pub(super) fn text_string(text: &str) -> String {
    let mut hex = String::from("<FEFF");
    for unit in text.encode_utf16() {
        hex.push_str(&format!("{unit:04X}"));
    }
    hex.push('>');
    hex
}

/// An address as PDF keeps it: plain letters only, anything else written as `%XX`.
fn ascii_string(address: &str) -> String {
    let mut written = String::from("(");
    for byte in address.bytes() {
        match byte {
            b'(' | b')' | b'\\' => {
                written.push('\\');
                written.push(byte as char);
            }
            0x21..=0x7e => written.push(byte as char),
            _ => written.push_str(&format!("%{byte:02X}")),
        }
    }
    written.push(')');
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_any_letter_as_text() {
        assert_eq!(text_string("Aș"), "<FEFF00410219>");
    }

    #[test]
    fn keeps_addresses_plain() {
        assert_eq!(ascii_string("https://a.ro/x (1)ă"), "(https://a.ro/x%20\\(1\\)%C4%83)");
    }

    #[test]
    fn numbers_a_name_that_is_taken() {
        let mut taken = Vec::new();
        assert_eq!(free_name(&mut taken, "Name", "Field"), "Name");
        assert_eq!(free_name(&mut taken, "Name", "Field"), "Name 2");
        assert_eq!(free_name(&mut taken, " ", "Field"), "Field");
    }
}
