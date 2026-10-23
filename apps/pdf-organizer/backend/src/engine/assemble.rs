//! Writing a new PDF made of chosen pages (MuPDF binding).

use std::fs;
use std::path::{Path, PathBuf};

use mupdf::pdf::{InsertPdfOptions, InsertPosition, PageSelection, PdfDocument, PdfWriteOptions};

use super::additions::{self, DocumentChanges};
use super::forms;
use super::marks::{self, Mark};
use super::page_change::{self, PageChange};
use super::shrink::{self, PictureShrink};
use super::{EngineError, Rotation};

/// One page of the file to write.
#[derive(Debug, Clone, PartialEq)]
pub struct PlannedPage {
    /// Which of the source files the page comes from (index into `sources`).
    pub source: usize,
    /// Page number in that file, from 0.
    pub page: usize,
    /// Extra turn, on top of the rotation the page already has.
    pub rotation: Rotation,
    /// A change made after the turn: cut the edges, another sheet size, or something drawn over the page.
    pub change: Option<PageChange>,
    /// Answers to write into the form fields of the page, each as `(field id,
    /// value)`; see [`super::FormField`]. Written before the page is changed.
    pub answers: Vec<(i32, String)>,
    /// What the user drew and wrote on the page. Drawn before the turn, so it turns with the page.
    pub marks: Vec<Mark>,
}

/// Writes `destination`: the pages in `pages`, in that order, taken from the
/// files in `sources`.
///
/// The first source is the base: its pages keep everything they share
/// (fonts, bookmarks, form fields), and may each be used once. Pages of the
/// other sources are copied in. The source files are not changed; the
/// destination must not be one of them. The file appears under its final name
/// only when it is complete.
pub fn assemble(sources: &[PathBuf], pages: &[PlannedPage], destination: &Path) -> Result<(), EngineError> {
    assemble_smaller(sources, pages, destination, None)
}

/// Like [`assemble`]; with `pictures`, the photographs of the new file are
/// made smaller on the way ("Compress").
pub fn assemble_smaller(
    sources: &[PathBuf],
    pages: &[PlannedPage],
    destination: &Path,
    pictures: Option<PictureShrink>,
) -> Result<(), EngineError> {
    assemble_changed(sources, pages, destination, pictures, &DocumentChanges::default())
}

/// Like [`assemble_smaller`]; `changes` says what else of the base document
/// is changed: bookmarks renamed or removed, attached files taken out.
pub fn assemble_changed(
    sources: &[PathBuf],
    pages: &[PlannedPage],
    destination: &Path,
    pictures: Option<PictureShrink>,
    changes: &DocumentChanges,
) -> Result<(), EngineError> {
    if pages.is_empty() {
        return Err(EngineError::Failed("a document needs at least one page".into()));
    }
    if sources.iter().any(|source| same_file(source, destination)) {
        return Err(EngineError::DestinationInUse);
    }

    let mut documents = sources.iter().map(|path| open(path)).collect::<Result<Vec<_>, _>>()?;
    let page_counts =
        documents.iter().map(|document| document.page_count().map_err(failed)).collect::<Result<Vec<_>, _>>()?;
    for planned in pages {
        let count = page_counts.get(planned.source).copied().unwrap_or(0);
        if i32::try_from(planned.page).map_or(true, |page| page >= count) {
            return Err(EngineError::NoSuchPage(planned.page));
        }
    }

    let (base, others) = documents.split_first_mut().ok_or_else(|| EngineError::Failed("no source file".into()))?;

    // What the document has beside its pages is changed first, while its pages are all still there.
    additions::change(base, changes)?;

    // Hold on to the base pages that stay, then empty the base and put pages
    // back in the planned order.
    let mut kept = Vec::with_capacity(pages.len());
    let mut used = vec![false; usize::try_from(page_counts[0]).unwrap_or(0)];
    for planned in pages {
        if planned.source != 0 {
            kept.push(None);
            continue;
        }
        if std::mem::replace(&mut used[planned.page], true) {
            return Err(EngineError::Failed(format!("page {} is used twice", planned.page)));
        }
        kept.push(Some(base.find_page(to_i32(planned.page)?).map_err(failed)?));
    }
    base.delete_pages(PageSelection::All).map_err(failed)?;

    let mut shared = page_change::Shared::default();
    let mut pending = additions::Pending::default();
    for (index, (planned, kept_page)) in pages.iter().zip(&kept).enumerate() {
        match kept_page {
            Some(page) => base.insert_page(to_i32(index)?, page).map_err(failed)?,
            None => {
                let options = InsertPdfOptions {
                    source_pages: PageSelection::Pages(vec![planned.page]),
                    target: InsertPosition::Before(index),
                    ..InsertPdfOptions::default()
                };
                base.insert_pdf(&others[planned.source - 1], options).map_err(failed)?;
            }
        }
        forms::fill(base, to_i32(index)?, &planned.answers)?;
        // What is to be removed goes first, so that nothing drawn afterwards is lost with it.
        for (area, removed) in planned.marks.iter().filter_map(Mark::removed_area) {
            page_change::redact(base, to_i32(index)?, area, removed)?;
        }
        if !planned.marks.is_empty() {
            let mut page = base.find_page(to_i32(index)?).map_err(failed)?;
            marks::apply(base, &mut page, &planned.marks, &mut shared.marks)?;
            // Links, fields, bookmarks and attached files: placed like the marks, before the turn.
            additions::add(base, index, &planned.marks, planned.rotation.degrees() as i32, &mut pending)?;
        }
        if planned.rotation != Rotation::None {
            let mut page = base.load_pdf_page(to_i32(index)?).map_err(failed)?;
            let turned = (page.rotation().map_err(failed)? + planned.rotation.degrees() as i32).rem_euclid(360);
            page.set_rotation(turned).map_err(failed)?;
        }
        if let Some(PageChange::Redact { area }) = &planned.change {
            // Works on the page as a whole, not on its parts like the other changes.
            page_change::redact(base, to_i32(index)?, *area, page_change::Removed::Everything)?;
        } else if let Some(change) = &planned.change {
            let mut page = base.find_page(to_i32(index)?).map_err(failed)?;
            page_change::apply(base, &mut page, change, &mut shared)?;
        }
    }

    additions::finish(base, pending)?;

    // A new file is written: the signatures of the old one would be broken in it, so they are left behind.
    super::sign::drop_signatures(base)?;

    if let Some(pictures) = pictures {
        shrink::shrink_pictures(base, pictures)?;
    }

    // Pages that were left out would otherwise stay in the file, unseen.
    let mut options = PdfWriteOptions::default();
    options.set_garbage_level(if pictures.is_some() { 4 } else { 3 }).set_compress(true);
    if pictures.is_some() {
        // Asked to be small: pack the fonts and pictures too.
        options.set_compress_fonts(true).set_compress_images(true);
    }

    let partial = partial_path(destination);
    let partial_name =
        partial.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    let written = base.save_with_options(partial_name, options).map_err(failed);
    let moved = written.and_then(|()| fs::rename(&partial, destination).map_err(|error| EngineError::Failed(error.to_string())));
    if moved.is_err() {
        let _ = fs::remove_file(&partial);
    }
    moved
}

fn open(path: &Path) -> Result<PdfDocument, EngineError> {
    let name = path.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    let document = PdfDocument::open(name).map_err(failed)?;
    if document.needs_password().map_err(failed)? {
        return Err(EngineError::PasswordRequired);
    }
    Ok(document)
}

/// The file is written here first, next to its final place.
fn partial_path(destination: &Path) -> PathBuf {
    let mut name = destination.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(".part");
    destination.with_file_name(name)
}

/// True when both paths lead to the same existing file.
fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn to_i32(value: usize) -> Result<i32, EngineError> {
    i32::try_from(value).map_err(|_| EngineError::NoSuchPage(value))
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}
