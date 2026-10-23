//! PDF Organizer, Rust side.
//!
//! - [`engine`]: the PDF engine (the only module that touches MuPDF).
//! - [`render`]: pages and thumbnails, drawn on background threads.
//! - [`documents`]: the documents that are open.
//! - [`kept_files`]: drafts (PDFs not saved anywhere yet) and files handed over by the interface.
//! - this file: the app as the shell sees it ([`PdfOrganizer`]).
//!
//! Commands (JSON in, JSON out):
//! - `open_document { path }` → `{ documentId, fileName, pageSizes }`, where
//!   `pageSizes` is `[width0, height0, width1, height1, ...]` in PDF points.
//!   With `asPages: true`, other files are accepted too and come back as a
//!   document of the program's own (to combine or insert, not to edit and save
//!   over): a picture becomes one page; a text file or web page is laid out on
//!   A4 pages; an e-book (EPUB, FB2, MOBI), an XPS document or a comic book
//!   archive (CBZ) is converted by the engine; a Word, Excel or PowerPoint file is converted by the office suite
//!   on the computer (`needs-office` when there is none). A picture the engine
//!   cannot read itself is handed over already decoded: `{ picture: <PNG as
//!   base64>, name }` in place of `path`.
//! - `close_document { documentId }` → `null`.
//! - `document_facts { documentId }` → `{ path, fileSize, title, author, subject,
//!   keywords, creator, producer, created, modified, format, bookmarks }`: what
//!   the file says about itself (dates as the file writes them), and its table
//!   of contents as a tree of `{ title, page, children }` (`page` from 0, or null).
//! - `white_margins { documentId, page }` → `{ margins }`: how much blank paper the
//!   page has along each edge as it lies in its file, `[left, top, right, bottom]`
//!   in points (to cut the white edges off).
//! - `text_lines { documentId, page }` → `{ lines }`: the lines of text of a page,
//!   each `{ text, x, y, width, height, size, color, bold, italic, font }` (places
//!   in points from the top-left corner; `font` is the document's own font when
//!   the computer has it, else `sans`, `serif` or `mono`):
//!   what is needed to take a line out (a mark of kind `erase`: the text in
//!   its box is removed from the file, nothing is drawn) and write it anew.
//! - `list_fonts` → `{ families }`: the names of the fonts installed on the
//!   computer, sorted. A text mark may name one as its `font`; it is then put
//!   into the file that is written.
//! - `form_fields { documentId }` → `{ fields }`: the fields of the document's
//!   form that can be filled in, each `{ page, id, name, label, kind, value,
//!   area, readOnly, multiline, options, on, maxLength }` (`kind` is `text`,
//!   `checkbox`, `radio` or `choice`; `area` is `[x, y, width, height]` in points
//!   from the page's top-left corner; `on` is the value of a ticked checkbox or
//!   radio button, whose value is otherwise `Off`). The answers are written when
//!   pages are saved: a page of `save_pages` and the commands like it may carry
//!   `answers: [{ id, value }]`.
//! - `working_copy { pages, baseDocumentId }` → like `open_document`: the pages
//!   as they would be saved, as a document of the program's own (to print a
//!   form with its answers before saving it).
//! - `page_texts { documentId, fromPage, pageCount }` → `{ texts }`: the text of
//!   each page of that stretch, in order (to compare two documents).
//! - `search_text { documentId, query, fromPage, pageCount }` → `{ pages: [{ page,
//!   boxes }] }`: the pages in that stretch on which the text is written (upper
//!   and lower case alike), each with `boxes` as `[x0, y0, width0, height0, ...]`
//!   in PDF points from the page's top-left corner. The interface asks for one
//!   stretch after another, so a long document never blocks it.
//! - `reshape_pages { pages, crop | fit }` → like `open_document`: the pages
//!   given a new shape, as a document of their own that the interface shows in
//!   their place until the user saves. `crop` is `{ left, top, right, bottom }`
//!   (points cut off each edge of the page as shown); `fit` is `{ width, height,
//!   matchOrientation, keepSize, place }` (the sheet to put each page on, scaled to
//!   fit; with `keepSize` never made larger; `place` is `[across, down]`, each 0,
//!   0.5 or 1, where the page lies on the sheet, the middle when left out). Two more
//!   changes draw over the pages instead: `label` is `{ texts, place, size,
//!   margin }` (a short text for each page, in order: page numbers; `place` is
//!   `top-left` … `bottom-right`), `picture` is `{ data, width }` (a PNG or JPEG
//!   as base64, drawn over the middle of each page: a watermark; `width` is the
//!   share of the page it may take, 0 to 1; with `area` (`{ x, y, width, height }`
//!   in points from the page's top-left corner) the picture fills that area
//!   instead: an added image, a signature). `text` is `{ text, x, y, size,
//!   color }` (text written at that point; `color` is `[red, green, blue]` from 0
//!   to 1; fails with `letters-missing` when the built-in font cannot write it),
//!   `shape` is `{ kind, area, color, lineWidth, fill }` (`kind` is `rectangle`,
//!   `ellipse`, `line-down` or `line-up`). `redact` is `{ area }`: what is there
//!   is removed from the file for good and a black box is left (the text under
//!   it can no longer be found or copied). The file behind it is the program's
//!   own and goes away with `close_document`.
//! - `read_picture { path }` → `{ data, type, width, height }`: a picture file
//!   as base64 the interface can show, with its size in pixels. PNG and JPEG
//!   come as they are; other formats the engine reads (TIFF, BMP, GIF…) come as
//!   PNG. A format it does not read (WebP, SVG…) comes as it is, with `width` 0,
//!   for the interface to decode itself.
//! - `save_pages { destination, pages: [{ documentId, page, rotation }] }` →
//!   `{ fileSize }` (of the file written, in bytes). Writes a new PDF with those pages in that order (`rotation` is an
//!   extra turn in degrees). No open file is changed. `baseDocumentId` (optional)
//!   names the document whose bookmarks and form fields the new file keeps;
//!   without it, that is the first page's document. With `shrinkPictures:
//!   { longestSide, quality }` the photographs in the new file are made smaller
//!   ("Compress"): those longer than `longestSide` pixels are halved until they
//!   are under twice that, and saved as JPEG of that `quality` (1 to 100).
//!   With `keepExisting`, a file already at `destination` is left alone and the
//!   request fails with `destination-exists`. With `replace`, the result takes
//!   its place, even when it is one of the files read: it is written whole
//!   beside it first and swapped in only then; the documents of the request
//!   that read it are closed; when it cannot be replaced (another program has
//!   it open) it stays as it was and the request fails with `destination-busy`.
//!   `sign_document` and `export_document` take `keepExisting` and `replace` too.
//! - `existing_files { paths }` → `{ existing }`: those of the paths where a file or folder is.
//! - `new_draft { name, pages, baseDocumentId }` → `{ path }`. Writes the pages as
//!   a PDF called `name` in the program's own folder: a document that has no
//!   place of the user's choosing yet. It opens like any other PDF; the
//!   interface asks where to save it.
//! - `page_links { documentId, page }` → `{ links: [{ x, y, width, height, url, page }], signatures: [{ x, y, width,
//!   height, index }] }`. The links of one page: where each is (points from the top-left corner of
//!   the page as shown) and where it leads, an address (`url`) or a page of
//!   the file (`page`, from 0); the other is null. And the boxes of the signatures shown on it, each with the
//!   signature's place in what `signatures` lists.
//!   `save_pages` and `save_document` also take `changes`: `{ bookmarks: [{ path,
//!   title, remove }], detach: [name] }`, bookmarks of the base document to
//!   rename or remove (each found by its place at every level, from 0) and
//!   attached files to take out.
//! - `page_pictures { documentId, page }` → `{ pictures: [{ x, y, width, height }] }`.
//!   Where the pictures of a page are (points from the top-left corner of the
//!   page as shown), in the order the page draws them. `page_picture {
//!   documentId, page, picture }` → `{ data, type }`: one of them (by its place
//!   in that list) as a PNG in base64. A mark of kind `erasePicture` takes the
//!   pictures that lie in its box out of the file.
//! - `ocr_engine {}` → `{ found, languages }`. Whether the engine that reads
//!   scanned pages (Tesseract) is on the computer, and the languages it can
//!   read. `ocr_page { documentId, page, rotation, languages }` → `{ words: [{
//!   text, x, y, width, height }] }`: the words of one page (drawn turned by
//!   `rotation` to be read), each with its box on the page unturned, in
//!   points. Fails with `no-ocr-engine` or `ocr-failed`. A mark of kind
//!   `hiddenText` (with `words` and `turn`) writes them into the page unseen.
//! - `list_certificates {}` → `{ certificates: [{ id, subject, issuer, validFrom,
//!   validUntil }] }`. The certificates of the user that can sign (times in
//!   seconds since 1970). `certificate_of_file { path, password }` → the same
//!   facts for the certificate in a `.pfx`/`.p12` file; fails with
//!   `wrong-password` or `no-certificate`.
//! - `sign_document { destination, baseDocumentId, pages, changes, keepExisting, replace, shrinkPictures, certificate,
//!   place, reason, location }` → `{ fileSize, signer }`. Writes the pages like
//!   `save_pages` and signs the file with a certificate (PAdES baseline):
//!   `certificate` is `{ id }` (of the user's store) or `{ path, password }` (a
//!   file). `place` is `{ page, x, y, width, height }`, where the signature
//!   shows (what shows is drawn by the marks of `look`), or left out for a
//!   signature that shows nowhere; or `places`, the same signature on several
//!   pages, each `{ page, x, y, width, height, look }`. Without `pages`, the document's own file is
//!   signed by adding to its end (the signatures it has stay good); `look` are
//!   marks placed in the box of the signature, drawn as its picture; with
//!   `lock`, no one can sign after it (`document-locked` is what a later
//!   attempt fails with). Fails with `sign-cancelled` when the user
//!   turns the PIN window away, `wrong-password`, `no-certificate`, `sign-failed`.
//! - `signatures { documentId }` → `{ signatures: [{ field, signer, issuer, reason,
//!   location, time, intact, wholeFile, signedAfter, locks, trust }] }`. The signatures of the file:
//!   `intact` when the signed bytes are unchanged, `wholeFile` when nothing was
//!   added after signing, `trust` is `trusted`, `expired`, `untrusted` or
//!   `unknown`. Nothing is asked online; whether a certificate was revoked is not checked here.
//! - `show_certificate { documentId, index, timeStamp }` → `{}`. Shows the system's own window for the certificate of
//!   one signature (by its place in `signatures`), or of the authority of its time stamp; returns when it is closed.
//!   `check_revocation { documentId, index, timeStamp }` → `{ status }`: asks the issuers online, because the user
//!   asked, whether that certificate or one that issued it was revoked: `good`, `revoked` or `unknown`. Both fail
//!   with `certificates-unsupported` where the system has no such window or check, `no-certificate` when the
//!   signature carries none.
//! - `attached_files { documentId }` → `{ files: [{ name, size }] }`. The files kept
//!   inside the document. `save_attached_file { documentId, name, destination }`
//!   → `{ path }` writes one of them out.
//! - `new_blank_draft { name, width, height, pages }` → `{ path }`. A draft of that many
//!   empty pages of that size, in points.
//! - `receive_file { name, data }` → `{ path }`. Writes a file the interface
//!   holds only the content of (dropped on the window, pasted), `data` as
//!   base64, and tells where it is. A large file comes in pieces: the next
//!   ones carry `into: <that path>` and are added to it.
//!   A page may also carry `marks`: what the user drew and wrote on it, each
//!   `{ kind, x, y, width, height, rotation, stroke, fill, opacity, lineWidth }`
//!   in points from the top-left corner of the page as it lies in its file
//!   (before `rotation`, so marks turn with the page). `kind` is `rectangle`,
//!   `ellipse`, `line`, `arrow` (both from the corner to the opposite one;
//!   sizes may be negative), `check`, `cross`, `dot`, `highlight`, `text` (with
//!   `text`, `font`: `sans` | `serif` | `mono`, `bold`, `italic`, `size`) or
//!   `picture` (with `data` as base64; marks that share a picture send it once
//!   with a `dataId` and name only the id afterwards) or `redact` (what is in
//!   the box is removed from the file for good, a black box is left). Colors are `[red, green, blue]` from 0
//!   to 1, or null for none; `rotation` turns the mark about its middle.
//!   Some kinds are not drawn but become objects of the PDF: `link` (with
//!   `url`, or `toPage`: the place of a page of the new file, from 0),
//!   `textField` (with `name`, `multiline`), `checkBox` and `signatureField`
//!   (with `name`), `bookmark` (with `name`, its title; it leads to the top of
//!   the box) and `attachment` (with `path`, the file, `name` and `author`; its paper clip takes the `stroke` color and the `rotation`).
//! - `export_document { destination, format, pages, baseDocumentId, resolution, quality }`
//!   → `{ files }`. Writes the pages in another format: `png`, `jpg`, `svg` (one
//!   file per page: with several pages, files named `<name>_001.<ending>`…
//!   beside `destination`), `tiff` (every page in one file), `txt`, `html`,
//!   `xml`, `ps`, `docx`, `odt`. `resolution` (dots per inch) and `quality` (JPEG,
//!   1 to 100) are for the pictures.
//! - `draft_place { name }` → `{ path }`: where a draft called `name` may be
//!   written by the shell (a web page saved as a PDF).
//! - `split_document { folder, baseDocumentId, parts: [{ fileName, pages }] }` →
//!   `{ files }`. Writes one new PDF per part into the folder and returns their
//!   paths. Nothing is written when a file with one of the names is already
//!   there (`destination-exists`).
//! - `save_document { documentId, pages }` → `{ saved, documentId, fileName,
//!   pageSizes }`. Writes the pages over the document's own file and opens it
//!   again under a new id. `saved` is false when the file could not be
//!   replaced (another program has it open): the file is then unchanged.
//! - `list_folder { path, endings }` → `{ files: [{ path, under }], more }`. The
//!   files of a folder and of those under it with one of the endings; `under`
//!   is where each lies below the folder. `more` when there were too many.
//! - `make_folder { path }` → `{}`. Makes a folder (and those above it) for results.
//! - `write_report { destination, text }` → `{}`. Writes the report of a batch
//!   run as a text file; fails with `destination-exists` rather than write over one.
//!
//! Resources (PNG):
//! - `page/<documentId>/<pageIndex>?scale=<number>&rotate=<0|90|180|270>`
//!   (scale 1.0 = 72 pixels per inch; rotate turns the picture clockwise for
//!   viewing only)
//! - `thumbnail/<documentId>/<pageIndex>`

pub mod batch_files;
pub mod documents;
pub mod engine;
pub mod kept_files;
pub mod render;

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use syntelab_app_api::{AppContext, AppError, Resource, ResourceReply, ResourceRequest, SyntelabApp};

use documents::{Documents, OpenDocument};
use kept_files::KeptFiles;
use engine::FileKind;
use syntelab_office_bridge::BridgeError;
use syntelab_platform::{certificates, fonts};
use engine::time_stamp;
use engine::{
    assemble, assemble_changed, picture_from_base64, BookmarkEdit, DocumentChanges, HiddenWord, ShownSignature, SignatureRequest, Area, Bookmark, EngineError, LinkTarget, NewField, ExportFormat, FontFamily, PictureOptions, Mark, MarkKind, PageChange, PdfFile,
    PictureShrink, Place, PlannedPage, Rotation, ShapeKind,
};
use render::{RenderError, RenderReply};

pub const APP_ID: &str = "pdf-organizer";

/// The largest picture file that is read to be put on a page.
const MAX_PICTURE_BYTES: u64 = 40 * 1024 * 1024;

/// The most pages one `search_text` call looks through.
const MAX_SEARCH_STRETCH: usize = 200;

pub struct PdfOrganizer {
    documents: Documents,
    kept_files: KeptFiles,
}

impl PdfOrganizer {
    pub fn new(context: &AppContext) -> Self {
        Self { documents: Documents::new(&context.cache_dir), kept_files: KeptFiles::new(&context.cache_dir) }
    }

    fn open_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            #[serde(default)]
            path: Option<PathBuf>,
            #[serde(default)]
            as_pages: bool,
            /// A picture already decoded by the interface: a PNG as base64, and the name to show.
            #[serde(default)]
            picture: Option<String>,
            #[serde(default)]
            name: Option<String>,
        }
        let Request { path, as_pages, picture, name } = parse(payload)?;
        let working_file = || self.documents.working_file().map_err(|error| failed("cannot-open", &error));

        let opened = if let Some(picture) = picture {
            let data = picture_from_base64(&picture).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
            let pages = working_file()?;
            // The pixels pass through a file of their own on the way to becoming a page.
            let pixels = pages.with_extension("png");
            fs::write(&pixels, data.as_slice()).map_err(|error| failed("cannot-open", &error))?;
            let made = engine::picture_to_pdf(&pixels, &pages);
            let _ = fs::remove_file(&pixels);
            made.map_err(|error| failed("cannot-open", &error))?;
            self.documents.open_temporary_named(&pages, name.unwrap_or_default())
        } else {
            let path = path.ok_or_else(|| AppError::InvalidRequest("a path or a picture".into()))?;
            let kind = engine::file_kind(&path);
            if kind == FileKind::Pdf {
                self.documents.open(&path)
            } else if !as_pages {
                // The engine could show some of these, but not save them: only a PDF is a document to edit.
                return Err(AppError::Failed { code: "cannot-open", detail: "not a PDF".into() });
            } else {
                let pages = working_file()?;
                match kind {
                    FileKind::Picture => engine::picture_to_pdf(&path, &pages).map_err(|error| failed("cannot-open", &error))?,
                    FileKind::Text => engine::text_to_pdf(&path, &pages).map_err(|error| failed("cannot-open", &error))?,
                    FileKind::Document => engine::document_to_pdf(&path, &pages).map_err(|error| match error {
                        EngineError::PasswordRequired => failed("password-required", &error),
                        _ => failed("cannot-open", &error),
                    })?,
                    FileKind::Office => {
                        syntelab_office_bridge::convert_to_pdf(&path, &pages).map_err(|error| match error {
                            BridgeError::NoOfficeSuite => failed("needs-office", &error),
                            BridgeError::TimedOut => failed("office-timed-out", &error),
                            _ => failed("cannot-open", &error),
                        })?;
                    }
                    FileKind::PictureForInterface => {
                        return Err(AppError::Failed { code: "decode-in-interface", detail: path.display().to_string() });
                    }
                    FileKind::Pdf | FileKind::Other => {
                        return Err(AppError::Failed { code: "cannot-open", detail: "not a file that can become pages".into() });
                    }
                }
                let shown = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
                self.documents.open_temporary_named(&pages, shown)
            }
        };
        let (id, document) = opened.map_err(|error| match error {
            EngineError::PasswordRequired => failed("password-required", &error),
            _ => failed("cannot-open", &error),
        })?;
        Ok(describe(id, &document))
    }

    fn close_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
        }
        let Request { document_id } = parse(payload)?;
        self.documents.close(document_id);
        Ok(Value::Null)
    }

    fn document_facts(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
        }
        let Request { document_id } = parse(payload)?;
        let document = self
            .documents
            .get(document_id)
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;

        // Asked once per document: the file is read on this thread, not on the ones that draw.
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let facts = file.facts();
        let bookmarks = file.bookmarks().unwrap_or_default();
        fn tree(bookmarks: &[Bookmark]) -> Value {
            bookmarks
                .iter()
                .map(|bookmark| json!({ "title": bookmark.title, "page": bookmark.page, "children": tree(&bookmark.children) }))
                .collect()
        }
        Ok(json!({
            "path": document.path,
            "fileSize": fs::metadata(&document.path).map(|file| file.len()).unwrap_or(0),
            "title": facts.title,
            "author": facts.author,
            "subject": facts.subject,
            "keywords": facts.keywords,
            "creator": facts.creator,
            "producer": facts.producer,
            "created": facts.created,
            "modified": facts.modified,
            "format": facts.format,
            "bookmarks": tree(&bookmarks),
        }))
    }

    fn text_lines(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
        }
        let Request { document_id, page } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let lines = file.text_lines(page).map_err(|error| match error {
            EngineError::NoSuchPage(page) => AppError::NotFound(format!("page {page}")),
            _ => failed("render-failed", &error),
        })?;
        let lines: Vec<Value> = lines
            .iter()
            .map(|line| {
                json!({
                    "text": line.text,
                    "x": line.area.x, "y": line.area.y, "width": line.area.width, "height": line.area.height,
                    "size": line.size, "color": line.color, "bold": line.bold, "italic": line.italic,
                    // The same font, when the computer has it; else the built-in one closest to it.
                    "font": fonts::font_file(installed_fonts(), &line.font_name, line.bold, line.italic).map_or(line.family, |font| font.family.as_str()),
                })
            })
            .collect();
        Ok(json!({ "lines": lines }))
    }

    fn list_fonts(&self) -> Result<Value, AppError> {
        let mut families: Vec<&str> = installed_fonts().iter().map(|font| font.family.as_str()).collect();
        families.dedup();
        Ok(json!({ "families": families }))
    }

    fn white_margins(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
        }
        let Request { document_id, page } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let margins = file.white_margins(page).map_err(|error| match error {
            EngineError::NoSuchPage(page) => AppError::NotFound(format!("page {page}")),
            _ => failed("render-failed", &error),
        })?;
        Ok(json!({ "margins": margins }))
    }

    fn page_pictures(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
        }
        let Request { document_id, page } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let pictures = file.pictures(page).map_err(|error| failed("render-failed", &error))?;
        let pictures: Vec<Value> = pictures.iter().map(|area| json!({ "x": area.x, "y": area.y, "width": area.width, "height": area.height })).collect();
        Ok(json!({ "pictures": pictures }))
    }

    fn page_picture(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
            /// Its place among the pictures of the page, as `page_pictures` lists them.
            picture: usize,
        }
        let Request { document_id, page, picture } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let png = file.picture(page, picture).map_err(|error| failed("render-failed", &error))?;
        Ok(json!({ "data": engine::to_base64(&png), "type": "image/png" }))
    }

    fn ocr_engine(&self) -> Result<Value, AppError> {
        let Some(engine) = engine::find_ocr_engine() else {
            return Ok(json!({ "found": false, "languages": [] }));
        };
        let languages = engine::ocr_languages(&engine).unwrap_or_default();
        Ok(json!({ "found": true, "languages": languages }))
    }

    fn ocr_page(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
            /// How far the page is turned for its text to stand upright: 0, 90, 180 or 270.
            #[serde(default)]
            rotation: i32,
            languages: Vec<String>,
        }
        /// Dots per inch the page is drawn at for reading: what the engine reads best.
        const RESOLUTION: f32 = 300.0;
        let Request { document_id, page, rotation, languages } = parse(payload)?;
        let engine = engine::find_ocr_engine().ok_or_else(|| failed("no-ocr-engine", &"the OCR engine is not on this computer"))?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let turn = Rotation::from_degrees(rotation);
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let size = file.page_size(page).map_err(|error| match error {
            EngineError::NoSuchPage(page) => AppError::NotFound(format!("page {page}")),
            _ => failed("render-failed", &error),
        })?;
        let picture = file.render_png(page, RESOLUTION / 72.0, turn).map_err(|error| failed("render-failed", &error))?;
        // A very large page is drawn smaller than asked: how many dots a point really got is read off the picture.
        let dots_wide = picture.get(16..20).map_or(0, |width| u32::from_be_bytes([width[0], width[1], width[2], width[3]])) as f32;
        let shown_width = if rotation.rem_euclid(180) == 90 { size.height } else { size.width };
        if dots_wide <= 0.0 || shown_width <= 0.0 {
            return Err(failed("render-failed", &"the page has no size"));
        }
        let points = shown_width / dots_wide;
        let found = engine::recognize(&engine, &picture, &languages).map_err(|error| failed("ocr-failed", &error))?;
        let words: Vec<Value> = found
            .iter()
            .map(|word| {
                // From dots of the picture to points of the page, and back onto the page as it lies unturned.
                let (x, y, width, height) = engine::unturned((word.x * points, word.y * points, word.width * points, word.height * points), rotation, size.width, size.height);
                json!({ "text": word.text, "x": x, "y": y, "width": width, "height": height })
            })
            .collect();
        Ok(json!({ "words": words }))
    }

    fn list_certificates(&self) -> Result<Value, AppError> {
        let certificates: Vec<Value> = certificates::signing_certificates().iter().map(certificate_facts).collect();
        Ok(json!({ "certificates": certificates }))
    }

    fn certificate_of_file(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            password: String,
        }
        let Request { path, password } = parse(payload)?;
        let data = fs::read(&path).map_err(|error| failed("no-certificate", &error))?;
        let certificate = certificates::certificate_of(certificates::Source::File { data: &data, password: &password }).map_err(certificate_error)?;
        Ok(certificate_facts(&certificate))
    }

    fn sign_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            destination: PathBuf,
            #[serde(default)]
            base_document_id: Option<u64>,
            /// The pages to write. Left out: the base document is signed as it is in its file, by adding
            /// to the end of that file, so that the signatures it already has stay good.
            #[serde(default)]
            pages: Option<Vec<RequestedPage>>,
            #[serde(default)]
            changes: RequestedChanges,
            /// What the signature shows in its box: marks placed from the top-left corner of the box.
            #[serde(default)]
            look: Vec<RequestedMark>,
            /// Nothing may be changed after this signature, and no one else can sign.
            #[serde(default)]
            lock: bool,
            /// A file that is already at the destination is left alone: the request fails instead.
            #[serde(default)]
            keep_existing: bool,
            /// The signed file takes the place of the file at the destination, even of the one signed (see `write_over`).
            #[serde(default)]
            replace: bool,
            /// With `pages`: the photographs of the document are made smaller before it is signed.
            #[serde(default)]
            shrink_pictures: Option<SignedShrink>,
            #[serde(default)]
            certificate: Option<RequestedCertificate>,
            #[serde(default)]
            place: Option<RequestedPlace>,
            /// Instead of `place` and `look`: the same signature shown on several pages, each with its own box and look.
            #[serde(default)]
            places: Vec<RequestedPlace>,
            #[serde(default)]
            reason: String,
            #[serde(default)]
            location: String,
            /// The address of a time-stamping authority: the signature gets a time stamp from it, kept inside it.
            #[serde(default)]
            time_stamp: Option<String>,
            /// Not a signature: a time stamp of the document itself, from the authority of `time_stamp`. No certificate is used.
            #[serde(default)]
            time_stamp_only: bool,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct SignedShrink {
            longest_side: u32,
            quality: u8,
        }
        #[derive(Deserialize)]
        struct RequestedCertificate {
            /// A certificate of the user's store…
            #[serde(default)]
            id: Option<String>,
            /// …or a file that holds one, with its password.
            #[serde(default)]
            path: Option<PathBuf>,
            #[serde(default)]
            password: String,
        }
        #[derive(Deserialize)]
        struct RequestedPlace {
            page: usize,
            x: f32,
            y: f32,
            width: f32,
            height: f32,
            /// In `places`: what shows in this box.
            #[serde(default)]
            look: Vec<RequestedMark>,
        }
        let Request { destination, base_document_id, pages, changes, look, lock, keep_existing, replace, shrink_pictures, certificate, place, places, reason, location, time_stamp, time_stamp_only } = parse(payload)?;
        if keep_existing && !replace && destination.exists() {
            return Err(save_error(EngineError::DestinationExists));
        }
        let time_stamp = time_stamp.map(|url| url.trim().to_owned()).filter(|url| !url.is_empty());
        if let Some(url) = &time_stamp {
            if !syntelab_net::is_time_stamp_address(url) {
                return Err(failed("time-stamp-address", url));
            }
        }
        if time_stamp_only && time_stamp.is_none() {
            return Err(AppError::InvalidRequest("the address of a time-stamping authority".into()));
        }

        let file = certificate.as_ref().and_then(|certificate| certificate.path.as_ref()).map(fs::read).transpose().map_err(|error| failed("no-certificate", &error))?;
        let source = match (certificate.as_ref().and_then(|certificate| certificate.id.as_deref()), &file) {
            _ if time_stamp_only => None,
            (_, Some(data)) => Some(certificates::Source::File { data, password: certificate.as_ref().map_or("", |certificate| certificate.password.as_str()) }),
            (Some(id), None) => Some(certificates::Source::Store { id }),
            (None, None) => return Err(AppError::InvalidRequest("a certificate: its id, or a file".into())),
        };
        // Asked before anything is written: a wrong password or a missing certificate stops here.
        let signer = source.map(certificates::certificate_of).transpose().map_err(certificate_error)?.map(|signer| signer.subject).unwrap_or_default();

        let mut pictures = Vec::new();
        let mut shown = Vec::new();
        // The places of `places`, each with its own look, or the one `place` with `look`.
        for (at, marks) in places.iter().map(|at| (at, &at.look)).chain(place.iter().map(|at| (at, &look))) {
            let marks = marks.iter().map(|mark| mark.to_mark(&mut pictures)).collect::<Result<Vec<_>, _>>()?;
            let added_rotation = pages.as_ref().and_then(|pages| pages.get(at.page)).map_or(0, |page| page.rotation);
            shown.push(ShownSignature { page: at.page, area: Area { x: at.x, y: at.y, width: at.width, height: at.height }, added_rotation, look: marks });
        }
        let shown = if time_stamp_only { Vec::new() } else { shown };
        // With a time stamp the signature is made to be checked for years: what the certificate's issuer says of it now
        // is kept inside it, when the issuer can be asked (long-term validation). Without its word the signature is
        // still made, as before.
        let revocation = match (source, &time_stamp) {
            (Some(source), Some(_)) => revocation_of(source),
            _ => None,
        };
        let extra_room = revocation.as_ref().map_or(0, |kept| kept.len() + 64);
        let request = SignatureRequest { shown, name: signer.clone(), reason, location, lock: lock && !time_stamp_only, added_to: pages.is_none(), time_stamp_only, extra_room };

        // Why signing failed is kept beside the engine's own word for it: the user is told which it was.
        let readers = if replace { readers_of(base_document_id, pages.as_deref().unwrap_or_default()) } else { Vec::new() };
        let sign_into = |unsigned: &Path, destination: &Path| {
            let refused = std::cell::RefCell::new(None);
            let refuse = |error: AppError| {
                let said = EngineError::Failed(error.to_string());
                *refused.borrow_mut() = Some(error);
                said
            };
            let signed = engine::sign_file(unsigned, destination, &request, &|parts| {
                let Some(source) = source else {
                    // A time stamp of the document: of every byte the signature covers.
                    let url = time_stamp.as_deref().unwrap_or_default();
                    return time_stamp_of(url, &fingerprint(parts)).map_err(refuse);
                };
                let attributes: Vec<(&str, &[u8])> = revocation.as_deref().map(|kept| (engine::revocation::ARCHIVAL_ATTRIBUTE, kept)).into_iter().collect();
                let signature = certificates::sign_detached_with(source, parts, &attributes).map_err(|error| refuse(certificate_error(error)))?;
                let Some(url) = time_stamp.as_deref() else {
                    return Ok(signature);
                };
                // The stamp is of the signature itself: it shows the signature was made by then.
                let value = time_stamp::signature_value(&signature)?;
                let token = time_stamp_of(url, &fingerprint(&[&value])).map_err(refuse)?;
                time_stamp::with_token(&signature, &token)
            });
            signed.map_err(|error| refused.take().unwrap_or_else(|| save_error(error)))
        };
        // Signed beside the file and put in its place once complete, or written straight to the destination.
        let sign_to_destination = |unsigned: &Path| {
            if replace {
                self.write_over(&destination, &readers, |staged| sign_into(unsigned, staged))
            } else {
                sign_into(unsigned, &destination)
            }
        };
        let Some(pages) = pages else {
            // Nothing of the document changes: its own file is signed, and the signature added to its end.
            let id = base_document_id.ok_or_else(|| AppError::InvalidRequest("the document to sign".into()))?;
            let document = self.documents.get(id).ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
            // A signature that closed the document is respected: another one would only break it.
            // A time stamp of the document is no change to it (PAdES): it may still be added.
            if !time_stamp_only && engine::signatures(&document.path).map_err(|error| failed("cannot-open", &error))?.iter().any(|signature| signature.locks) {
                return Err(failed("document-locked", &"the document was locked by a signature"));
            }
            let path = document.path.clone();
            // Let go of, so that the document can be closed when the signed file takes its place.
            drop(document);
            sign_to_destination(&path)?;
            if time_stamp_only {
                keep_time_stamp_validation(&destination);
            }
            return Ok(json!({ "fileSize": fs::metadata(&destination).map(|file| file.len()).unwrap_or(0), "signer": signer }));
        };
        let (sources, planned) = self.plan(base_document_id, &pages)?;

        // The document as it is now, written in full first; the signature then covers every byte of it.
        let unsigned = staged_path(&destination);
        let pictures = shrink_pictures.map(|shrink| PictureShrink { longest_side: shrink.longest_side, quality: shrink.quality });
        let written = assemble_changed(&sources, &planned, &unsigned, pictures, &changes.into()).map_err(save_error).and_then(|()| sign_to_destination(&unsigned));
        let _ = fs::remove_file(&unsigned);
        written?;
        if time_stamp_only {
            keep_time_stamp_validation(&destination);
        }
        Ok(json!({ "fileSize": fs::metadata(&destination).map(|file| file.len()).unwrap_or(0), "signer": signer }))
    }

    fn signatures(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
        }
        let Request { document_id } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let found = engine::signatures(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let file = if found.is_empty() { Vec::new() } else { fs::read(&document.path).map_err(|error| failed("cannot-open", &error))? };
        let signatures: Vec<Value> = found
            .iter()
            .map(|signature| {
                // What was added after it is known to be only signing when a later signature covers the file to its end.
                let end = signature.ranges[2] + signature.ranges[3];
                let signed_after = found.iter().any(|later| later.ranges[2] + later.ranges[3] > end && later.covers(file.len()));
                let covered = signature.covered(&file);
                // A document's own time stamp is the stamp itself; a signature may keep one inside it.
                let token = if signature.time_stamp_only { Some(signature.message.clone()) } else { time_stamp::token_in(&signature.message) };
                let stamp = token.as_ref().map(|token| {
                    let checked = if signature.time_stamp_only {
                        covered.and_then(|parts| certificates::verify_time_stamp(token, &parts).ok())
                    } else {
                        time_stamp::signature_value(&signature.message).ok().and_then(|value| certificates::verify_time_stamp(token, &[&value]).ok())
                    };
                    json!({
                        // When the authority says it was, as PDF writes moments.
                        "time": time_stamp::time_of(token).unwrap_or_default(),
                        "intact": checked.as_ref().is_some_and(|checked| checked.intact),
                        "authority": checked.as_ref().map_or("", |checked| checked.authority.as_str()),
                        "trust": trust_word(checked.as_ref().map(|checked| checked.trust)),
                    })
                });
                if signature.time_stamp_only {
                    let stamp = stamp.unwrap_or(Value::Null);
                    return json!({
                        "kind": "timeStamp",
                        "field": signature.field,
                        "signer": stamp["authority"],
                        "issuer": "",
                        "reason": "",
                        "location": "",
                        "time": stamp["time"],
                        "intact": stamp["intact"],
                        "wholeFile": signature.covers(file.len()),
                        "signedAfter": signed_after,
                        "locks": false,
                        "trust": stamp["trust"],
                        "timeStamp": stamp,
                    });
                }
                let verified = covered.and_then(|parts| certificates::verify_detached(&signature.message, &parts).ok());
                json!({
                    "kind": "signature",
                    "field": signature.field,
                    // Who the certificate says signed; what the signature says of itself where the certificate cannot be read.
                    "signer": verified.as_ref().map(|verified| verified.signer.clone()).filter(|signer| !signer.is_empty()).unwrap_or_else(|| signature.name.clone()),
                    "issuer": verified.as_ref().map_or("", |verified| verified.issuer.as_str()),
                    "reason": signature.reason,
                    "location": signature.location,
                    "time": signature.time,
                    // The signed bytes are as they were when it was made…
                    "intact": verified.as_ref().is_some_and(|verified| verified.intact),
                    // …and nothing was added to the file after it.
                    "wholeFile": signature.covers(file.len()),
                    // …except other signatures, which is how a document is signed by several people.
                    "signedAfter": signed_after,
                    // It closes the document: no one else can sign after it.
                    "locks": signature.locks,
                    "trust": trust_word(verified.as_ref().map(|verified| verified.trust)),
                    // The time stamp it keeps, if it has one: when an authority says the signature was made by.
                    "timeStamp": stamp,
                })
            })
            .collect();
        Ok(json!({ "signatures": signatures }))
    }

    /// The certificates of one signature of a document (by its place in `signatures`), the one it was made with first;
    /// with `timeStamp`, those of the authority of its time stamp.
    fn signature_chain(&self, payload: Value) -> Result<Vec<Vec<u8>>, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            index: usize,
            #[serde(default)]
            time_stamp: bool,
        }
        let Request { document_id, index, time_stamp } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let found = engine::signatures(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let signature = found.get(index).ok_or_else(|| AppError::NotFound(format!("signature {index}")))?;
        let message = if time_stamp && !signature.time_stamp_only { time_stamp::token_in(&signature.message) } else { Some(signature.message.clone()) };
        let carried = message.map(|message| time_stamp::certificates_in(&message)).unwrap_or_default();
        if carried.is_empty() {
            return Err(certificate_error(certificates::CertificateError::NotFound));
        }
        Ok(in_chain_order(carried))
    }

    fn show_certificate(&self, payload: Value) -> Result<Value, AppError> {
        let chain = self.signature_chain(payload)?;
        certificates::show_certificate(&chain).map_err(certificate_error)?;
        Ok(json!({}))
    }

    fn check_revocation(&self, payload: Value) -> Result<Value, AppError> {
        use certificates::Revocation;
        let chain = self.signature_chain(payload)?;
        let status = match certificates::check_revocation(&chain).map_err(certificate_error)? {
            Revocation::Good => "good",
            Revocation::Revoked => "revoked",
            Revocation::Unknown => "unknown",
        };
        Ok(json!({ "status": status }))
    }

    fn page_links(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            page: usize,
        }
        let Request { document_id, page } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let links = file.links(page).map_err(|error| match error {
            EngineError::NoSuchPage(page) => AppError::NotFound(format!("page {page}")),
            _ => failed("render-failed", &error),
        })?;
        let links: Vec<Value> = links
            .iter()
            .map(|link| json!({ "x": link.area.x, "y": link.area.y, "width": link.area.width, "height": link.area.height, "url": link.address, "page": link.page }))
            .collect();
        // The signatures shown on the page, each by its place in the list of the document's signatures.
        let boxes = file.signature_boxes(page).unwrap_or_default();
        let found = if boxes.is_empty() { Vec::new() } else { engine::signatures(&document.path).unwrap_or_default() };
        let signatures: Vec<Value> = boxes
            .iter()
            .filter_map(|(area, field)| {
                let index = found.iter().position(|signature| signature.object == *field)?;
                Some(json!({ "x": area.x, "y": area.y, "width": area.width, "height": area.height, "index": index }))
            })
            .collect();
        Ok(json!({ "links": links, "signatures": signatures }))
    }

    fn attached_files(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
        }
        let Request { document_id } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let files = engine::attached_files(&document.path).map_err(|error| failed("cannot-open", &error))?;
        Ok(json!({ "files": files.iter().map(|file| json!({ "name": file.name, "size": file.size })).collect::<Vec<_>>() }))
    }

    fn list_folder(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
            endings: Vec<String>,
        }
        let Request { path, endings } = parse(payload)?;
        let (found, more) = batch_files::list_folder(&path, &endings).map_err(|error| failed("cannot-open", &error))?;
        let files: Vec<Value> = found.iter().map(|file| json!({ "path": file.path, "under": file.under })).collect();
        Ok(json!({ "files": files, "more": more }))
    }

    fn make_folder(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
        }
        let Request { path } = parse(payload)?;
        fs::create_dir_all(&path).map_err(|error| failed("save-failed", &error))?;
        Ok(json!({}))
    }

    fn write_report(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            destination: PathBuf,
            text: String,
        }
        let Request { destination, text } = parse(payload)?;
        if destination.exists() {
            return Err(save_error(EngineError::DestinationExists));
        }
        batch_files::write_report(&destination, &text).map_err(|error| failed("save-failed", &error))?;
        Ok(json!({}))
    }

    fn save_attached_file(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            name: String,
            destination: PathBuf,
        }
        let Request { document_id, name, destination } = parse(payload)?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        engine::save_attached_file(&document.path, &name, &destination).map_err(|error| failed("save-failed", &error))?;
        Ok(json!({ "path": destination }))
    }

    fn form_fields(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
        }
        let Request { document_id } = parse(payload)?;
        let document = self
            .documents
            .get(document_id)
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let fields = engine::form_fields(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let fields: Vec<Value> = fields
            .into_iter()
            .map(|field| {
                json!({
                    "page": field.page,
                    "id": field.id,
                    "name": field.name,
                    "label": field.label,
                    "kind": field.kind.name(),
                    "value": field.value,
                    "area": [field.area.x, field.area.y, field.area.width, field.area.height],
                    "readOnly": field.read_only,
                    "multiline": field.multiline,
                    "options": field.options.iter().map(|(value, text)| json!({ "value": value, "text": text })).collect::<Vec<_>>(),
                    "on": field.on,
                    "maxLength": field.max_length,
                })
            })
            .collect();
        Ok(json!({ "fields": fields }))
    }

    fn working_copy(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            #[serde(default)]
            base_document_id: Option<u64>,
            pages: Vec<RequestedPage>,
        }
        let Request { base_document_id, pages } = parse(payload)?;
        let (sources, planned) = self.plan(base_document_id, &pages)?;
        let destination = self.documents.working_file().map_err(|error| failed("save-failed", &error))?;
        assemble(&sources, &planned, &destination).map_err(save_error)?;
        let (id, document) =
            self.documents.open_temporary(&destination).map_err(|error| failed("cannot-open", &error))?;
        Ok(describe(id, &document))
    }

    fn page_texts(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            #[serde(default)]
            from_page: usize,
            page_count: usize,
        }
        let Request { document_id, from_page, page_count } = parse(payload)?;
        let document = self
            .documents
            .get(document_id)
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        // Read on this thread, not on the ones that draw.
        let file = PdfFile::open(&document.path).map_err(|error| failed("cannot-open", &error))?;
        let end = from_page.saturating_add(page_count.min(MAX_SEARCH_STRETCH)).min(file.page_count());
        let texts: Vec<String> = (from_page..end)
            // A page whose text cannot be read counts as a page without text.
            .map(|page| file.page_text(page).unwrap_or_default())
            .collect();
        Ok(json!({ "texts": texts }))
    }

    fn search_text(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            query: String,
            #[serde(default)]
            from_page: usize,
            page_count: usize,
        }
        let Request { document_id, query, from_page, page_count } = parse(payload)?;
        if query.is_empty() {
            return Ok(json!({ "pages": [] }));
        }
        let document = self
            .documents
            .get(document_id)
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;

        let pages = from_page..from_page.saturating_add(page_count.min(MAX_SEARCH_STRETCH));
        let found = document.search(query, pages).map_err(|error| match error {
            RenderError::Superseded => AppError::Superseded,
            RenderError::Engine(error) => failed("search-failed", &error),
        })?;
        let pages: Vec<Value> = found
            .into_iter()
            .map(|hits| {
                let boxes: Vec<f32> = hits.boxes.iter().flat_map(|b| [b.x, b.y, b.width, b.height]).collect();
                json!({ "page": hits.page, "boxes": boxes })
            })
            .collect();
        Ok(json!({ "pages": pages }))
    }

    /// Turns the pages the interface sent into what the engine writes: the
    /// files that take part (the base first) and the pages in order.
    fn plan(&self, base: Option<u64>, pages: &[RequestedPage]) -> Result<(Vec<PathBuf>, Vec<PlannedPage>), AppError> {
        let mut ids: Vec<u64> = Vec::new();
        let mut sources: Vec<PathBuf> = Vec::new();
        let documents = &self.documents;
        let source_of = |ids: &mut Vec<u64>, sources: &mut Vec<PathBuf>, id: u64| -> Result<usize, AppError> {
            if let Some(index) = ids.iter().position(|known| *known == id) {
                return Ok(index);
            }
            let document = documents.get(id).ok_or_else(|| AppError::NotFound(format!("document {id}")))?;
            ids.push(id);
            sources.push(document.path.clone());
            Ok(ids.len() - 1)
        };

        if let Some(base) = base {
            source_of(&mut ids, &mut sources, base)?;
        }
        let mut planned = Vec::with_capacity(pages.len());
        let mut pictures = Vec::new();
        // A page of the first file can be placed once; a copy of it (a pasted page) is read
        // from the same file opened once more, as if it were another document.
        let mut placed: Vec<(usize, usize)> = Vec::new();
        let mut again: Option<usize> = None;
        for page in pages {
            let mut source = source_of(&mut ids, &mut sources, page.document_id)?;
            if source == 0 && placed.contains(&(0, page.page)) {
                source = match again {
                    Some(index) => index,
                    None => {
                        let first = sources[0].clone();
                        sources.push(first);
                        ids.push(u64::MAX);
                        *again.insert(sources.len() - 1)
                    }
                };
            }
            placed.push((source, page.page));
            planned.push(PlannedPage {
                source,
                page: page.page,
                rotation: Rotation::from_degrees(page.rotation),
                change: None,
                answers: page.answers.iter().map(|answer| (answer.id, answer.value.clone())).collect(),
                marks: page.marks.iter().map(|mark| mark.to_mark(&mut pictures)).collect::<Result<_, _>>()?,
            });
        }
        Ok((sources, planned))
    }

    fn reshape_pages(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Crop {
            left: f32,
            top: f32,
            right: f32,
            bottom: f32,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fit {
            width: f32,
            height: f32,
            #[serde(default)]
            match_orientation: bool,
            #[serde(default)]
            keep_size: bool,
            #[serde(default)]
            place: Option<[f32; 2]>,
        }
        #[derive(Deserialize)]
        struct Label {
            texts: Vec<String>,
            place: String,
            size: f32,
            margin: f32,
        }
        #[derive(Deserialize)]
        struct Picture {
            data: String,
            #[serde(default)]
            width: f32,
            #[serde(default)]
            area: Option<RequestedArea>,
        }
        #[derive(Deserialize)]
        struct Text {
            text: String,
            x: f32,
            y: f32,
            size: f32,
            #[serde(default)]
            color: [f32; 3],
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Shape {
            kind: String,
            area: RequestedArea,
            #[serde(default)]
            color: [f32; 3],
            line_width: f32,
            #[serde(default)]
            fill: Option<[f32; 3]>,
        }
        #[derive(Deserialize)]
        struct Request {
            pages: Vec<RequestedPage>,
            #[serde(default)]
            crop: Option<Crop>,
            #[serde(default)]
            fit: Option<Fit>,
            #[serde(default)]
            label: Option<Label>,
            #[serde(default)]
            picture: Option<Picture>,
            #[serde(default)]
            text: Option<Text>,
            #[serde(default)]
            shape: Option<Shape>,
            #[serde(default)]
            redact: Option<Redact>,
        }
        #[derive(Deserialize)]
        struct Redact {
            area: RequestedArea,
        }
        let Request { pages, crop, fit, label, picture, text, shape, redact } = parse(payload)?;
        if let Some(Redact { area }) = redact {
            if crop.is_some() || fit.is_some() || label.is_some() || picture.is_some() || text.is_some() || shape.is_some() {
                return Err(AppError::InvalidRequest("one change at a time".into()));
            }
            return self.reshaped(&pages, vec![PageChange::Redact { area: area.into() }; pages.len()]);
        }
        // One change for every page, or (labels) one for each.
        let changes: Vec<PageChange> = match (crop, fit, label, picture, text, shape) {
            (Some(Crop { left, top, right, bottom }), None, None, None, None, None) => {
                vec![PageChange::Crop { left, top, right, bottom }; pages.len()]
            }
            (None, Some(Fit { width, height, match_orientation, keep_size, place }), None, None, None, None) => {
                vec![PageChange::Fit { width, height, match_orientation, keep_size, place: place.unwrap_or([0.5, 0.5]) }; pages.len()]
            }
            (None, None, Some(Label { texts, place, size, margin }), None, None, None) => {
                let place = Place::from_name(&place).ok_or_else(|| AppError::InvalidRequest(format!("place {place}")))?;
                if texts.len() != pages.len() {
                    return Err(AppError::InvalidRequest("one text for each page".into()));
                }
                let size = size.clamp(4.0, 144.0);
                texts.into_iter().map(|text| PageChange::Label { text, place, size, margin: margin.max(0.0) }).collect()
            }
            (None, None, None, Some(Picture { data, width, area }), None, None) => {
                let data = picture_from_base64(&data).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
                vec![PageChange::Picture { data, width, area: area.map(Area::from) }; pages.len()]
            }
            (None, None, None, None, Some(Text { text, x, y, size, color }), None) => {
                vec![PageChange::Text { text, x, y, size: size.clamp(4.0, 400.0), color }; pages.len()]
            }
            (None, None, None, None, None, Some(Shape { kind, area, color, line_width, fill })) => {
                let kind = ShapeKind::from_name(&kind).ok_or_else(|| AppError::InvalidRequest(format!("shape {kind}")))?;
                vec![PageChange::Shape { kind, area: area.into(), color, line_width, fill }; pages.len()]
            }
            _ => return Err(AppError::InvalidRequest("one of crop, fit, label, picture, text, shape".into())),
        };

        self.reshaped(&pages, changes)
    }

    /// Writes the pages, each with its change, as a document of the program's own, and opens it.
    fn reshaped(&self, pages: &[RequestedPage], changes: Vec<PageChange>) -> Result<Value, AppError> {
        let (sources, mut planned) = self.plan(None, pages)?;
        for (page, change) in planned.iter_mut().zip(changes) {
            page.change = Some(change);
        }
        let destination = self.documents.working_file().map_err(|error| failed("save-failed", &error))?;
        assemble(&sources, &planned, &destination).map_err(save_error)?;
        let (id, document) =
            self.documents.open_temporary(&destination).map_err(|error| failed("cannot-open", &error))?;
        Ok(describe(id, &document))
    }

    fn read_picture(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            path: PathBuf,
        }
        let Request { path } = parse(payload)?;
        let too_large = fs::metadata(&path).map(|file| file.len() > MAX_PICTURE_BYTES).unwrap_or(false);
        if too_large {
            return Err(AppError::Failed { code: "picture-too-large", detail: path.display().to_string() });
        }
        let bytes = fs::read(&path).map_err(|error| failed("cannot-open", &error))?;
        let extension = path.extension().and_then(|extension| extension.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
        let web_type = match extension.as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" | "jpe" | "jfif" => Some("image/jpeg"),
            _ => None,
        };
        match (engine::picture_size(&bytes), web_type) {
            // What every web view shows goes over as it is.
            (Ok((width, height)), Some(web_type)) => {
                Ok(json!({ "data": engine::to_base64(&bytes), "type": web_type, "width": width, "height": height }))
            }
            // Read by the engine, but not by a web view (TIFF…): handed over as PNG.
            (Ok((width, height)), None) => {
                let png = engine::picture_as_png(&bytes).map_err(|error| failed("not-a-picture", &error))?;
                Ok(json!({ "data": engine::to_base64(&png), "type": "image/png", "width": width, "height": height }))
            }
            // Not read by the engine: perhaps the web view can (WebP, SVG…).
            (Err(_), _) if engine::file_kind(&path) == FileKind::PictureForInterface => {
                let web_type = match extension.as_str() {
                    "svg" => "image/svg+xml",
                    "webp" => "image/webp",
                    "avif" => "image/avif",
                    "apng" => "image/apng",
                    _ => "image/x-icon",
                };
                Ok(json!({ "data": engine::to_base64(&bytes), "type": web_type, "width": 0, "height": 0 }))
            }
            (Err(error), _) => Err(failed("not-a-picture", &error)),
        }
    }

    fn save_pages(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            destination: PathBuf,
            #[serde(default)]
            base_document_id: Option<u64>,
            pages: Vec<RequestedPage>,
            #[serde(default)]
            shrink_pictures: Option<RequestedShrink>,
            #[serde(default)]
            changes: RequestedChanges,
            /// A file that is already at the destination is left alone: the request fails instead.
            #[serde(default)]
            keep_existing: bool,
            /// The result takes the place of the file at the destination, even of one of the files read (see `write_over`).
            #[serde(default)]
            replace: bool,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct RequestedShrink {
            longest_side: u32,
            quality: u8,
        }
        let Request { destination, base_document_id, pages, shrink_pictures, changes, keep_existing, replace } = parse(payload)?;
        if keep_existing && !replace && destination.exists() {
            return Err(save_error(EngineError::DestinationExists));
        }

        let (sources, planned) = self.plan(base_document_id, &pages)?;
        let pictures = shrink_pictures.map(|shrink| PictureShrink { longest_side: shrink.longest_side, quality: shrink.quality });
        if replace {
            let readers = readers_of(base_document_id, &pages);
            self.write_over(&destination, &readers, |staged| assemble_changed(&sources, &planned, staged, pictures, &changes.into()).map_err(save_error))?;
        } else {
            assemble_changed(&sources, &planned, &destination, pictures, &changes.into()).map_err(save_error)?;
        }
        Ok(json!({ "fileSize": fs::metadata(&destination).map(|file| file.len()).unwrap_or(0) }))
    }

    fn new_draft(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            name: String,
            #[serde(default)]
            base_document_id: Option<u64>,
            pages: Vec<RequestedPage>,
        }
        let Request { name, base_document_id, pages } = parse(payload)?;
        if !is_plain_file_name(&name) {
            return Err(AppError::InvalidRequest("a plain file name".into()));
        }
        let (sources, planned) = self.plan(base_document_id, &pages)?;
        let destination = self.kept_files.draft(&name).map_err(|error| failed("save-failed", &error))?;
        assemble(&sources, &planned, &destination).map_err(save_error)?;
        Ok(json!({ "path": destination }))
    }

    fn new_blank_draft(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            name: String,
            width: f32,
            height: f32,
            pages: usize,
        }
        let Request { name, width, height, pages } = parse(payload)?;
        if !is_plain_file_name(&name) {
            return Err(AppError::InvalidRequest("a plain file name".into()));
        }
        let destination = self.kept_files.draft(&name).map_err(|error| failed("save-failed", &error))?;
        engine::blank_pdf(width, height, pages, &destination).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        Ok(json!({ "path": destination }))
    }

    fn receive_file(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            #[serde(default)]
            name: Option<String>,
            data: String,
            #[serde(default)]
            into: Option<PathBuf>,
        }
        let Request { name, data, into } = parse(payload)?;
        let bytes = picture_from_base64(&data).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
        let path = match into {
            // More of a file begun earlier: only ever one of the program's own.
            Some(path) if self.kept_files.is_received(&path) && path.is_file() => path,
            Some(_) => return Err(AppError::InvalidRequest("not a received file".into())),
            None => {
                let name = name.filter(|name| is_plain_file_name(name)).ok_or_else(|| AppError::InvalidRequest("a plain file name".into()))?;
                self.kept_files.received(&name).map_err(|error| failed("save-failed", &error))?
            }
        };
        let mut file = fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|error| failed("save-failed", &error))?;
        file.write_all(&bytes).map_err(|error| failed("save-failed", &error))?;
        Ok(json!({ "path": path }))
    }

    fn export_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            destination: PathBuf,
            format: String,
            #[serde(default)]
            base_document_id: Option<u64>,
            pages: Vec<RequestedPage>,
            #[serde(default)]
            resolution: Option<f32>,
            #[serde(default)]
            quality: Option<u8>,
            /// As for `save_pages`.
            #[serde(default)]
            keep_existing: bool,
            #[serde(default)]
            replace: bool,
        }
        let Request { destination, format, base_document_id, pages, resolution, quality, keep_existing, replace } = parse(payload)?;
        let format = ExportFormat::from_name(&format).ok_or_else(|| AppError::InvalidRequest(format!("no format {format}")))?;
        let defaults = PictureOptions::default();
        let pictures = PictureOptions { resolution: resolution.unwrap_or(defaults.resolution), quality: quality.unwrap_or(defaults.quality) };
        if keep_existing && !replace && destination.exists() {
            return Err(save_error(EngineError::DestinationExists));
        }

        // The document as it is now (pages arranged, drawn on, answered) is written as a PDF of the program's own first.
        let (sources, planned) = self.plan(base_document_id, &pages)?;
        let whole = self.documents.working_file().map_err(|error| failed("save-failed", &error))?;
        let written = assemble(&sources, &planned, &whole).map_err(save_error);
        let exported = if replace {
            written.and_then(|()| self.export_over(&whole, format, &destination, pictures, &readers_of(base_document_id, &pages)))
        } else {
            written.and_then(|()| engine::export(&whole, format, &destination, pictures).map_err(save_error))
        };
        let _ = fs::remove_file(&whole);
        Ok(json!({ "files": exported? }))
    }

    /// Writes `whole` out in `format` in a folder of its own beside `destination`, then puts each file it gave in its
    /// place, writing over what is there (see `write_over`).
    fn export_over(&self, whole: &Path, format: ExportFormat, destination: &Path, pictures: PictureOptions, readers: &[u64]) -> Result<Vec<PathBuf>, AppError> {
        let name = destination.file_name().ok_or_else(|| AppError::InvalidRequest("a file name".into()))?;
        let mut room = name.to_os_string();
        room.push(".replacing");
        let room = destination.with_file_name(room);
        fs::create_dir_all(&room).map_err(|error| failed("save-failed", &error))?;
        let moved = engine::export(whole, format, &room.join(name), pictures).map_err(save_error).and_then(|written| {
            let mut files = Vec::with_capacity(written.len());
            for file in written {
                let target = destination.with_file_name(file.file_name().unwrap_or_default());
                self.write_over(&target, readers, |staged| fs::rename(&file, staged).map_err(|error| failed("save-failed", &error)))?;
                files.push(target);
            }
            Ok(files)
        });
        let _ = fs::remove_dir_all(&room);
        moved
    }

    /// A place for a draft that something other than this app's engine will write (the shell saving a web page).
    fn draft_place(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            name: String,
        }
        let Request { name } = parse(payload)?;
        if !is_plain_file_name(&name) {
            return Err(AppError::InvalidRequest("a plain file name".into()));
        }
        let destination = self.kept_files.draft(&name).map_err(|error| failed("save-failed", &error))?;
        Ok(json!({ "path": destination }))
    }

    fn split_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Part {
            file_name: String,
            pages: Vec<RequestedPage>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            folder: PathBuf,
            #[serde(default)]
            base_document_id: Option<u64>,
            parts: Vec<Part>,
        }
        let Request { folder, base_document_id, parts } = parse(payload)?;

        // Everything is checked before the first file is written.
        let mut destinations = Vec::with_capacity(parts.len());
        for part in &parts {
            if !is_plain_file_name(&part.file_name) {
                return Err(AppError::InvalidRequest(format!("not a file name: {}", part.file_name)));
            }
            let destination = folder.join(&part.file_name);
            if destination.exists() || destinations.contains(&destination) {
                return Err(AppError::Failed {
                    code: "destination-exists",
                    detail: destination.display().to_string(),
                });
            }
            destinations.push(destination);
        }

        for (part, destination) in parts.iter().zip(&destinations) {
            let (sources, planned) = self.plan(base_document_id, &part.pages)?;
            assemble(&sources, &planned, destination).map_err(save_error)?;
        }
        Ok(json!({ "files": destinations }))
    }

    fn save_document(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Request {
            document_id: u64,
            pages: Vec<RequestedPage>,
            #[serde(default)]
            changes: RequestedChanges,
        }
        let Request { document_id, pages, changes } = parse(payload)?;

        let path = self
            .documents
            .get(document_id)
            .map(|document| document.path.clone())
            .ok_or_else(|| AppError::NotFound(format!("document {document_id}")))?;
        let (sources, planned) = self.plan(Some(document_id), &pages)?;

        // Written in full beside the file first; the file itself is touched only by the swap.
        let staged = staged_path(&path);
        assemble_changed(&sources, &planned, &staged, None, &changes.into()).map_err(save_error)?;

        // This program reads the file too: let go of it, swap, and open it again.
        let released = self.documents.close_and_release(document_id);
        let saved = released && fs::rename(&staged, &path).is_ok();
        if !saved {
            let _ = fs::remove_file(&staged);
        }
        let (id, reopened) = self.documents.open(&path).map_err(|error| failed("cannot-open", &error))?;

        let mut answer = describe(id, &reopened);
        answer["saved"] = Value::Bool(saved);
        Ok(answer)
    }

    /// Puts a result in the place of the file at `destination`, which may be one of the files it was made from:
    /// `write` writes it whole beside that file first, and only then does it take its place, in one step. The
    /// documents of `readers` that read that file are closed before: on Windows a file that is open cannot be
    /// replaced. When it still cannot be (another program has it open), the file is left as it was and the request
    /// fails with `destination-busy`.
    fn write_over(&self, destination: &Path, readers: &[u64], write: impl FnOnce(&Path) -> Result<(), AppError>) -> Result<(), AppError> {
        let mut staged = destination.file_name().unwrap_or_default().to_os_string();
        staged.push(".new");
        let staged = destination.with_file_name(staged);
        if let Err(error) = write(&staged) {
            let _ = fs::remove_file(&staged);
            return Err(error);
        }
        for &id in readers {
            if self.documents.get(id).is_some_and(|document| same_file(&document.path, destination)) {
                self.documents.close_and_release(id);
            }
        }
        fs::rename(&staged, destination).map_err(|error| {
            let _ = fs::remove_file(&staged);
            failed("destination-busy", &error)
        })
    }

    fn existing_files(&self, payload: Value) -> Result<Value, AppError> {
        #[derive(Deserialize)]
        struct Request {
            paths: Vec<PathBuf>,
        }
        let Request { paths } = parse(payload)?;
        let existing: Vec<&PathBuf> = paths.iter().filter(|path| path.exists()).collect();
        Ok(json!({ "existing": existing }))
    }

    /// Splits `<kind>/<documentId>/<pageIndex>` and finds the document.
    fn locate(&self, path: &str) -> Result<(String, Arc<OpenDocument>, usize), AppError> {
        let mut parts = path.split('/');
        let (Some(kind), Some(document), Some(page), None) = (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            return Err(AppError::NotFound(path.to_owned()));
        };
        let document_id: u64 = document.parse().map_err(|_| AppError::InvalidRequest("document id".into()))?;
        let page: usize = page.parse().map_err(|_| AppError::InvalidRequest("page index".into()))?;
        let document = self.documents.get(document_id).ok_or_else(|| AppError::NotFound(path.to_owned()))?;
        Ok((kind.to_owned(), document, page))
    }
}

impl SyntelabApp for PdfOrganizer {
    fn id(&self) -> &'static str {
        APP_ID
    }

    fn invoke(&self, command: &str, payload: Value) -> Result<Value, AppError> {
        match command {
            "open_document" => self.open_document(payload),
            "close_document" => self.close_document(payload),
            "document_facts" => self.document_facts(payload),
            "form_fields" => self.form_fields(payload),
            "attached_files" => self.attached_files(payload),
            "page_links" => self.page_links(payload),
            "page_pictures" => self.page_pictures(payload),
            "page_picture" => self.page_picture(payload),
            "ocr_engine" => self.ocr_engine(),
            "ocr_page" => self.ocr_page(payload),
            "list_certificates" => self.list_certificates(),
            "certificate_of_file" => self.certificate_of_file(payload),
            "sign_document" => self.sign_document(payload),
            "signatures" => self.signatures(payload),
            "show_certificate" => self.show_certificate(payload),
            "check_revocation" => self.check_revocation(payload),
            "save_attached_file" => self.save_attached_file(payload),
            "list_folder" => self.list_folder(payload),
            "make_folder" => self.make_folder(payload),
            "write_report" => self.write_report(payload),
            "existing_files" => self.existing_files(payload),
            "white_margins" => self.white_margins(payload),
            "list_fonts" => self.list_fonts(),
            "text_lines" => self.text_lines(payload),
            "working_copy" => self.working_copy(payload),
            "page_texts" => self.page_texts(payload),
            "search_text" => self.search_text(payload),
            "reshape_pages" => self.reshape_pages(payload),
            "read_picture" => self.read_picture(payload),
            "save_pages" => self.save_pages(payload),
            "new_draft" => self.new_draft(payload),
            "new_blank_draft" => self.new_blank_draft(payload),
            "receive_file" => self.receive_file(payload),
            "export_document" => self.export_document(payload),
            "draft_place" => self.draft_place(payload),
            "split_document" => self.split_document(payload),
            "save_document" => self.save_document(payload),
            _ => Err(AppError::NotFound(command.to_owned())),
        }
    }

    fn resource(&self, request: ResourceRequest, reply: ResourceReply) {
        let (kind, document, page) = match self.locate(&request.path) {
            Ok(found) => found,
            Err(error) => return reply(Err(error)),
        };
        match kind.as_str() {
            "page" => {
                let scale = request.query.get("scale").and_then(|value| value.parse().ok()).unwrap_or(1.0);
                let degrees = request.query.get("rotate").and_then(|value| value.parse().ok()).unwrap_or(0);
                document.render_page(page, scale, Rotation::from_degrees(degrees), png_reply(reply));
            }
            "thumbnail" => document.thumbnail(page, png_reply(reply)),
            _ => reply(Err(AppError::NotFound(request.path))),
        }
    }
}

/// A rectangle on a page as the interface names it: points from the top-left corner.
#[derive(Deserialize)]
struct RequestedArea {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

impl From<RequestedArea> for Area {
    fn from(area: RequestedArea) -> Self {
        Self { x: area.x, y: area.y, width: area.width, height: area.height }
    }
}

/// One page of a file to write, as the interface names it.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestedPage {
    document_id: u64,
    page: usize,
    /// Extra turn in degrees: 0, 90, 180 or 270.
    #[serde(default)]
    rotation: i32,
    /// Answers for the form fields on the page.
    #[serde(default)]
    answers: Vec<RequestedAnswer>,
    /// What the user drew and wrote on the page.
    #[serde(default)]
    marks: Vec<RequestedMark>,
}

/// One word of hidden text; see [`engine::HiddenWord`].
#[derive(Deserialize)]
struct RequestedWord {
    text: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

/// Changes to what the base document has beside its pages; see [`engine::DocumentChanges`].
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct RequestedChanges {
    /// Bookmarks to rename or remove, each found by its `path`: its place at every level, from 0.
    #[serde(default)]
    bookmarks: Vec<RequestedBookmarkEdit>,
    /// Names of attached files to take out of the document.
    #[serde(default)]
    detach: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestedBookmarkEdit {
    path: Vec<usize>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    remove: bool,
}

impl From<RequestedChanges> for DocumentChanges {
    fn from(changes: RequestedChanges) -> Self {
        Self {
            bookmarks: changes.bookmarks.into_iter().map(|edit| BookmarkEdit { path: edit.path, title: edit.title, remove: edit.remove }).collect(),
            detach: changes.detach,
        }
    }
}

/// One thing drawn on a page, as the interface names it; see [`engine::Mark`].
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestedMark {
    kind: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    #[serde(default)]
    rotation: f32,
    #[serde(default)]
    stroke: Option<[f32; 3]>,
    #[serde(default)]
    fill: Option<[f32; 3]>,
    #[serde(default = "opaque")]
    opacity: f32,
    #[serde(default = "opaque")]
    line_width: f32,
    #[serde(default)]
    text: String,
    #[serde(default)]
    font: String,
    #[serde(default)]
    bold: bool,
    #[serde(default)]
    italic: bool,
    #[serde(default)]
    size: f32,
    /// For text: `left` (when left out), `center` or `right`, in the width of the box.
    #[serde(default)]
    align: String,
    /// A picture as base64 (PNG or JPEG), for a mark of kind `picture`. A picture used
    /// by several marks of one request is sent once, with a `dataId`; the others name the id only.
    #[serde(default)]
    data: String,
    #[serde(default)]
    data_id: Option<u32>,
    /// For a link: the address it leads to…
    #[serde(default)]
    url: String,
    /// …or the page of the new file it leads to, by its place there, from 0.
    #[serde(default)]
    to_page: Option<usize>,
    /// The name of a field, the title of a bookmark, the name an attached file gets.
    #[serde(default)]
    name: String,
    /// For an attachment: where the file is.
    #[serde(default)]
    path: String,
    /// For a text field: it takes several lines.
    #[serde(default)]
    multiline: bool,
    /// For an attachment: who attached it.
    #[serde(default)]
    author: String,
    /// For hidden text: the words, each with its box, and how far the page is turned for them to stand upright.
    #[serde(default)]
    words: Vec<RequestedWord>,
    #[serde(default)]
    turn: i32,
    /// For a list to choose from: its answers.
    #[serde(default)]
    options: Vec<String>,
    /// For a radio button: the answer it stands for, among the buttons of its `name`.
    #[serde(default)]
    value: String,
}

/// The fonts of the computer, listed once: asking the system takes a moment.
fn installed_fonts() -> &'static [fonts::InstalledFont] {
    static FONTS: OnceLock<Vec<fonts::InstalledFont>> = OnceLock::new();
    FONTS.get_or_init(fonts::installed_fonts)
}

fn opaque() -> f32 {
    1.0
}

impl RequestedMark {
    /// `pictures` holds the pictures already decoded for this request, so the same one is put into the file once.
    fn to_mark(&self, pictures: &mut Vec<(u32, Arc<Vec<u8>>)>) -> Result<Mark, AppError> {
        let kind = match self.kind.as_str() {
            "rectangle" => MarkKind::Rectangle,
            "ellipse" => MarkKind::Ellipse,
            "line" => MarkKind::Line,
            "arrow" => MarkKind::Arrow,
            "check" => MarkKind::Check,
            "cross" => MarkKind::Cross,
            "dot" => MarkKind::Dot,
            "highlight" => MarkKind::Highlight,
            "redact" => MarkKind::Redact,
            "erase" => MarkKind::Erase,
            "erasePicture" => MarkKind::ErasePicture,
            "hiddenText" => MarkKind::HiddenText {
                words: self.words.iter().map(|word| HiddenWord { text: word.text.clone(), x: word.x, y: word.y, width: word.width, height: word.height }).collect(),
                turn: self.turn,
            },
            "link" => MarkKind::Link {
                target: match self.to_page {
                    Some(page) => LinkTarget::Page(page),
                    None => LinkTarget::Address(self.url.clone()),
                },
            },
            "textField" => MarkKind::Field { field: NewField::Text { multiline: self.multiline }, name: self.name.clone() },
            "checkBox" => MarkKind::Field { field: NewField::Checkbox, name: self.name.clone() },
            "signatureField" => MarkKind::Field { field: NewField::Signature, name: self.name.clone() },
            "choiceField" => MarkKind::Field { field: NewField::Choice { options: self.options.clone() }, name: self.name.clone() },
            "radioButton" => MarkKind::Field { field: NewField::Radio { value: self.value.clone() }, name: self.name.clone() },
            "bookmark" => MarkKind::Bookmark { title: self.name.clone() },
            "attachment" => MarkKind::Attachment { file: PathBuf::from(&self.path), name: self.name.clone(), author: self.author.clone() },
            "text" => MarkKind::Text {
                text: self.text.clone(),
                family: FontFamily::from_name(&self.font),
                bold: self.bold,
                italic: self.italic,
                size: self.size,
                align: match self.align.as_str() {
                    "center" => 0.5,
                    "right" => 1.0,
                    _ => 0.0,
                },
                // Any other name is a font of the computer.
                file: (!matches!(self.font.as_str(), "" | "sans" | "serif" | "mono"))
                    .then(|| fonts::font_file(installed_fonts(), &self.font, self.bold, self.italic).map(|font| font.file.clone()))
                    .flatten(),
            },
            "picture" => {
                let known = self.data_id.and_then(|id| pictures.iter().find(|(known, _)| *known == id));
                let data = match known {
                    Some((_, data)) if self.data.is_empty() => Arc::clone(data),
                    _ if self.data.is_empty() => return Err(AppError::InvalidRequest("a picture mark without its picture".into())),
                    _ => {
                        let data = picture_from_base64(&self.data).map_err(|error| AppError::InvalidRequest(error.to_string()))?;
                        if let Some(id) = self.data_id {
                            pictures.push((id, Arc::clone(&data)));
                        }
                        data
                    }
                };
                MarkKind::Picture { data }
            }
            other => return Err(AppError::InvalidRequest(format!("no mark of kind {other}"))),
        };
        Ok(Mark {
            kind,
            x: self.x,
            y: self.y,
            width: self.width,
            height: self.height,
            rotation: self.rotation,
            stroke: self.stroke,
            fill: self.fill,
            opacity: self.opacity,
            line_width: self.line_width,
        })
    }
}

#[derive(Deserialize)]
struct RequestedAnswer {
    id: i32,
    value: String,
}

/// What the interface needs to know about an open document.
fn describe(id: u64, document: &OpenDocument) -> Value {
    let page_sizes: Vec<f32> = document.page_sizes.iter().flat_map(|size| [size.width, size.height]).collect();
    json!({ "documentId": id, "fileName": document.file_name, "pageSizes": page_sizes })
}

/// True for a name that stays inside the folder it is joined to.
fn is_plain_file_name(name: &str) -> bool {
    let path = Path::new(name);
    !name.is_empty() && path.file_name().is_some_and(|file_name| file_name == path.as_os_str())
}

/// Where a file is written in full before it replaces the original.
/// The documents a request reads: its base and those its pages come from.
fn readers_of(base: Option<u64>, pages: &[RequestedPage]) -> Vec<u64> {
    base.into_iter().chain(pages.iter().map(|page| page.document_id)).collect()
}

/// True when both paths lead to the same existing file.
fn same_file(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn staged_path(path: &Path) -> PathBuf {
    let mut name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(".saving");
    path.with_file_name(name)
}

fn certificate_facts(certificate: &certificates::Certificate) -> Value {
    json!({
        "id": certificate.id,
        "subject": certificate.subject,
        "issuer": certificate.issuer,
        "validFrom": certificate.valid_from,
        "validUntil": certificate.valid_until,
    })
}

fn trust_word(trust: Option<certificates::Trust>) -> &'static str {
    match trust {
        Some(certificates::Trust::Trusted) => "trusted",
        Some(certificates::Trust::Expired) => "expired",
        Some(certificates::Trust::Untrusted) => "untrusted",
        None => "unknown",
    }
}

/// The SHA-256 of `parts`, taken as one run of bytes.
fn fingerprint(parts: &[&[u8]]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

/// Asks the time-stamping authority at `url` for a time stamp of `digest`, and checks that what came back is that.
fn time_stamp_of(url: &str, digest: &[u8; 32]) -> Result<Vec<u8>, AppError> {
    use std::hash::{BuildHasher, Hasher};
    // A number of this request only: what the authority answers must repeat it.
    let mut first = std::collections::hash_map::RandomState::new().build_hasher();
    first.write_u128(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |since| since.as_nanos()));
    let mut second = std::collections::hash_map::RandomState::new().build_hasher();
    second.write_u64(first.finish());
    let nonce = time_stamp::nonce((u128::from(first.finish()) << 64) | u128::from(second.finish()));
    let reply = syntelab_net::time_stamp(url, &time_stamp::query(digest, &nonce)).map_err(|error| failed("time-stamp-failed", &error))?;
    time_stamp::token_of(&reply, digest, &nonce).map_err(|error| failed("time-stamp-failed", &error))
}

/// What the issuers of the certificate of `source` (and of the authorities above it) say of it now, ready to be kept in
/// a signature (`RevocationInfoArchival`); `None` when no issuer could be asked or none said it is good.
fn revocation_of(source: certificates::Source<'_>) -> Option<Vec<u8>> {
    let word = issuers_word(certificates::chain_of(source).ok()?);
    (!word.answers.is_empty() || !word.lists.is_empty()).then(|| engine::revocation::archival(&word.lists, &word.answers))
}

/// What the issuers along a chain of certificates said of them.
struct IssuersWord {
    /// OCSP answers saying a certificate is good, and lists of revoked certificates.
    answers: Vec<Vec<u8>>,
    lists: Vec<Vec<u8>>,
    /// The chain, with the issuers' certificates that had to be fetched.
    chain: Vec<Vec<u8>>,
}

/// Asks the issuer of each certificate of `chain` (the first one's first, each followed by its issuer) whether it is
/// still good: by OCSP first; one that does not answer, or has no responder, gives its list of revoked certificates
/// instead. An authority at the top of the chain is asked nothing. An issuer's certificate the chain lacks is fetched
/// from where the certificate says it is kept.
fn issuers_word(mut chain: Vec<Vec<u8>>) -> IssuersWord {
    use engine::revocation::{self, Status};
    let mut answers = Vec::new();
    let mut lists = Vec::new();
    let mut index = 0;
    while index < chain.len() && index < 8 {
        let certificate = chain[index].clone();
        let Ok(facts) = revocation::facts(&certificate) else {
            break;
        };
        if facts.self_issued() {
            break;
        }
        if chain.len() == index + 1 {
            let fetched = facts.issuer_certificates.iter().find_map(|url| {
                let bytes = syntelab_net::issuer_file(url, false).ok()?;
                let found = revocation::facts(&bytes).ok()?;
                (found.subject == facts.issuer).then(|| bytes.clone())
            });
            match fetched {
                Some(issuer) => chain.push(issuer),
                None => break,
            }
        }
        let issuer = chain[index + 1].clone();
        let asked = revocation::ocsp_request(&certificate, &issuer).ok();
        let answered = asked.and_then(|asked| {
            facts.ocsp.iter().find_map(|url| {
                let answer = syntelab_net::ask_issuer(url, &asked).ok()?;
                (revocation::ocsp_status(&answer, facts.serial).ok()? == Status::Good).then_some(answer)
            })
        });
        match answered {
            Some(answer) => answers.push(answer),
            None => {
                if let Some(list) = facts.crls.iter().find_map(|url| syntelab_net::issuer_file(url, true).ok().filter(|list| revocation::is_der_sequence(list))) {
                    lists.push(list);
                }
            }
        }
        index += 1;
    }
    IssuersWord { answers, lists, chain }
}

/// The certificates of `carried` put in order from the one that signed to the top: the one no other was issued by
/// comes first, then the one that issued it, and so on.
fn in_chain_order(carried: Vec<Vec<u8>>) -> Vec<Vec<u8>> {
    use engine::revocation::facts;
    let names: Vec<(Vec<u8>, Vec<u8>)> = carried.iter().map(|certificate| facts(certificate).map(|read| (read.subject.to_vec(), read.issuer.to_vec())).unwrap_or_default()).collect();
    let Some(first) = (0..carried.len()).find(|index| !names.iter().enumerate().any(|(other, (_, issuer))| other != *index && *issuer == names[*index].0 && !names[other].0.is_empty())) else {
        return carried;
    };
    let mut ordered = vec![first];
    while ordered.len() < carried.len() {
        let issuer = &names[*ordered.last().unwrap_or(&first)].1;
        match (0..carried.len()).find(|index| !ordered.contains(index) && names[*index].0 == *issuer) {
            Some(next) => ordered.push(next),
            None => break,
        }
    }
    ordered.into_iter().map(|index| carried[index].clone()).collect()
}

/// Keeps in the file at `path` what a reader needs to check its newest time stamp of the document later without asking
/// anyone: the authority's certificates and what their issuers say of them now (`/DSS`). Done when it can be: a
/// stamp is good without it, only less easily checked.
fn keep_time_stamp_validation(path: &Path) {
    let Ok(found) = engine::signatures(path) else {
        return;
    };
    let Some(stamp) = found.iter().rev().find(|signature| signature.time_stamp_only) else {
        return;
    };
    let carried = time_stamp::certificates_in(&stamp.message);
    if carried.is_empty() {
        return;
    }
    let word = issuers_word(in_chain_order(carried));
    if word.answers.is_empty() && word.lists.is_empty() {
        return;
    }
    let _ = engine::add_validation_data(path, &word.chain, &word.answers, &word.lists);
}

fn certificate_error(error: certificates::CertificateError) -> AppError {
    use certificates::CertificateError;
    match error {
        CertificateError::WrongPassword => failed("wrong-password", &error),
        CertificateError::Cancelled => failed("sign-cancelled", &error),
        CertificateError::NotFound => failed("no-certificate", &error),
        CertificateError::Unsupported => failed("certificates-unsupported", &error),
        CertificateError::Failed(_) => failed("sign-failed", &error),
    }
}

fn save_error(error: EngineError) -> AppError {
    match error {
        EngineError::LettersMissing => failed("letters-missing", &error),
        EngineError::DestinationInUse => failed("destination-in-use", &error),
        EngineError::DestinationExists => failed("destination-exists", &error),
        EngineError::NoSuchPage(page) => AppError::InvalidRequest(format!("no page {page}")),
        _ => failed("save-failed", &error),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(payload: Value) -> Result<T, AppError> {
    serde_json::from_value(payload).map_err(|error| AppError::InvalidRequest(error.to_string()))
}

fn failed(code: &'static str, error: &dyn std::fmt::Display) -> AppError {
    AppError::Failed { code, detail: error.to_string() }
}

/// Turns the shell's reply into the one the render threads call.
fn png_reply(reply: ResourceReply) -> RenderReply {
    Box::new(move |result| {
        reply(match result {
            Ok(bytes) => Ok(Resource { mime: "image/png", bytes }),
            Err(RenderError::Superseded) => Err(AppError::Superseded),
            Err(RenderError::Engine(EngineError::NoSuchPage(page))) => Err(AppError::NotFound(format!("page {page}"))),
            Err(RenderError::Engine(error)) => Err(failed("render-failed", &error)),
        })
    })
}
