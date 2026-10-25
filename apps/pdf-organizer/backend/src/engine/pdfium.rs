//! PDFium binding, for drawing pages on screen only.
//!
//! PDFium (the PDF engine of Chrome) draws text for screens: letters are smoothed on the red, green and blue
//! parts of each pixel (as ClearType does), so they look sharper than MuPDF draws them. Everything else (writing,
//! signing, text, forms) stays with MuPDF.
//!
//! PDFium is a library of its own (`pdfium.dll`), installed next to the program. Without it, or when it cannot
//! read a file, pages are drawn by MuPDF as before. PDFium may be used by one thread at a time: every call is made
//! holding [`LOCK`].

use std::ffi::{c_char, c_int, c_ulong, c_void};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use super::{EngineError, Rotation};

/// Draw annotations (and form fields with an appearance of their own), as MuPDF does.
const FPDF_ANNOT: c_int = 0x01;
/// Smooth letters on the parts of each pixel, for a screen.
const FPDF_LCD_TEXT: c_int = 0x02;
const WHITE: u32 = 0xFFFF_FFFF;

/// Names the library to use instead of the one next to the program (for tests).
pub const LIBRARY_VARIABLE: &str = "SYNTELAB_PDFIUM";

#[cfg(windows)]
const LIBRARY_NAME: &str = "pdfium.dll";
#[cfg(target_os = "macos")]
const LIBRARY_NAME: &str = "libpdfium.dylib";
#[cfg(all(unix, not(target_os = "macos")))]
const LIBRARY_NAME: &str = "libpdfium.so";

type Handle = *mut c_void;

#[repr(C)]
struct FileAccess {
    length: c_ulong,
    get_block: extern "C" fn(param: *mut c_void, position: c_ulong, buffer: *mut u8, size: c_ulong) -> c_int,
    param: *mut c_void,
}

/// What PDFium asks of a program that shows forms: only which version of the list this is; every function in it
/// stays empty (the fields are only drawn here, never typed into).
#[repr(C)]
struct FormFillInfo {
    version: c_int,
    functions: [*mut c_void; 64],
}

#[repr(C)]
struct Matrix {
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    e: f32,
    f: f32,
}

#[repr(C)]
struct RectF {
    left: f32,
    top: f32,
    right: f32,
    bottom: f32,
}

/// The few functions of PDFium used here.
struct Library {
    load_custom_document: unsafe extern "C" fn(*mut FileAccess, *const c_char) -> Handle,
    close_document: unsafe extern "C" fn(Handle),
    get_page_count: unsafe extern "C" fn(Handle) -> c_int,
    load_page: unsafe extern "C" fn(Handle, c_int) -> Handle,
    close_page: unsafe extern "C" fn(Handle),
    page_width: unsafe extern "C" fn(Handle) -> f32,
    page_height: unsafe extern "C" fn(Handle) -> f32,
    get_last_error: unsafe extern "C" fn() -> c_ulong,
    bitmap_create: unsafe extern "C" fn(c_int, c_int, c_int) -> Handle,
    bitmap_fill_rect: unsafe extern "C" fn(Handle, c_int, c_int, c_int, c_int, u32) -> c_int,
    bitmap_buffer: unsafe extern "C" fn(Handle) -> *mut u8,
    bitmap_stride: unsafe extern "C" fn(Handle) -> c_int,
    bitmap_destroy: unsafe extern "C" fn(Handle),
    render_with_matrix: unsafe extern "C" fn(Handle, Handle, *const Matrix, *const RectF, c_int),
    init_forms: unsafe extern "C" fn(Handle, *mut FormFillInfo) -> Handle,
    exit_forms: unsafe extern "C" fn(Handle),
    after_load_page: unsafe extern "C" fn(Handle, Handle),
    before_close_page: unsafe extern "C" fn(Handle, Handle),
    draw_forms: unsafe extern "C" fn(Handle, Handle, Handle, c_int, c_int, c_int, c_int, c_int, c_int),
}

/// Held while PDFium is called: it may be used by one thread at a time.
static LOCK: Mutex<()> = Mutex::new(());

fn lock() -> MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// PDFium, loaded and started once; `None` when it is not installed or did not load.
fn library() -> Option<&'static Library> {
    static LIBRARY: OnceLock<Option<Library>> = OnceLock::new();
    LIBRARY.get_or_init(|| load(&library_path()?).inspect_err(|error| trace(error)).ok()).as_ref()
}

fn library_path() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(LIBRARY_VARIABLE) {
        return Some(PathBuf::from(path));
    }
    let next_to_program = std::env::current_exe().ok().and_then(|program| Some(program.parent()?.join(LIBRARY_NAME)));
    // While developing, also where `tools/fetch-pdfium.mjs` puts it.
    let fetched = cfg!(debug_assertions)
        .then(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../third-party/pdfium").join(LIBRARY_NAME));
    next_to_program.into_iter().chain(fetched).find(|path| path.is_file())
}

fn load(path: &Path) -> Result<Library, String> {
    // SAFETY: PDFium is a plain C library; loading it runs no code of ours.
    let loaded = unsafe { libloading::Library::new(path) }.map_err(|error| format!("{}: {error}", path.display()))?;
    // Never let go: the functions below point into it for as long as the program runs.
    let loaded: &'static libloading::Library = Box::leak(Box::new(loaded));
    macro_rules! function {
        ($name:literal) => {
            // SAFETY: the type is the one PDFium's headers (fpdfview.h) give the function.
            *unsafe { loaded.get(concat!($name, "\0").as_bytes()) }.map_err(|error| format!("{}: {error}", $name))?
        };
    }
    let init: unsafe extern "C" fn() = function!("FPDF_InitLibrary");
    let library = Library {
        load_custom_document: function!("FPDF_LoadCustomDocument"),
        close_document: function!("FPDF_CloseDocument"),
        get_page_count: function!("FPDF_GetPageCount"),
        load_page: function!("FPDF_LoadPage"),
        close_page: function!("FPDF_ClosePage"),
        page_width: function!("FPDF_GetPageWidthF"),
        page_height: function!("FPDF_GetPageHeightF"),
        get_last_error: function!("FPDF_GetLastError"),
        bitmap_create: function!("FPDFBitmap_Create"),
        bitmap_fill_rect: function!("FPDFBitmap_FillRect"),
        bitmap_buffer: function!("FPDFBitmap_GetBuffer"),
        bitmap_stride: function!("FPDFBitmap_GetStride"),
        bitmap_destroy: function!("FPDFBitmap_Destroy"),
        render_with_matrix: function!("FPDF_RenderPageBitmapWithMatrix"),
        init_forms: function!("FPDFDOC_InitFormFillEnvironment"),
        exit_forms: function!("FPDFDOC_ExitFormFillEnvironment"),
        after_load_page: function!("FORM_OnAfterLoadPage"),
        before_close_page: function!("FORM_OnBeforeClosePage"),
        draw_forms: function!("FPDF_FFLDraw"),
    };
    let _held = lock();
    // SAFETY: called once, before any other function of the library.
    unsafe { init() };
    trace(&format!("pages are drawn with {}", path.display()));
    Ok(library)
}

/// What went wrong with PDFium, said in the terminal while developing; the user sees the page drawn by MuPDF.
pub(super) fn trace(message: &str) {
    if cfg!(debug_assertions) {
        eprintln!("[pdfium] {message}");
    }
}

/// The file, read by PDFium a block at a time.
extern "C" fn read_block(param: *mut c_void, position: c_ulong, buffer: *mut u8, size: c_ulong) -> c_int {
    // SAFETY: `param` is the `File` of a `SharpFile`, which outlives its document; PDFium asks for one block at a
    // time and `buffer` holds `size` bytes.
    let (file, buffer) = unsafe { (&mut *param.cast::<File>(), std::slice::from_raw_parts_mut(buffer, size as usize)) };
    // `c_ulong` is 32 bits on Windows and 64 elsewhere.
    #[allow(clippy::useless_conversion)]
    let read = file.seek(SeekFrom::Start(u64::from(position))).and_then(|_| file.read_exact(buffer));
    c_int::from(read.is_ok())
}

/// A PDF opened by PDFium, to draw its pages. Lives on the thread that opened it.
pub struct SharpFile {
    library: &'static Library,
    document: Handle,
    /// The document's form, so fields are drawn with what is typed in them (null when it has none to draw).
    forms: Handle,
    /// The page last drawn, kept open: pieces of the same page come one after another.
    page: Option<(usize, Handle)>,
    page_count: usize,
    // Boxed, so PDFium's pointers to them stay good while the document is open.
    _access: Box<FileAccess>,
    _form_info: Box<FormFillInfo>,
    _file: Box<File>,
}

// SAFETY: the handles are used only while holding `LOCK`, from whichever thread owns the `SharpFile`.
unsafe impl Send for SharpFile {}

impl SharpFile {
    /// Opens `path`. `None` when PDFium is not installed; an error when it cannot read the file.
    pub fn open(path: &Path) -> Option<Result<Self, EngineError>> {
        let library = library()?;
        Some(Self::open_with(library, path))
    }

    fn open_with(library: &'static Library, path: &Path) -> Result<Self, EngineError> {
        let failed = |reason: String| EngineError::Failed(format!("PDFium: {reason}"));
        let mut file = Box::new(File::open(path).map_err(|error| failed(error.to_string()))?);
        let length = file.metadata().map_err(|error| failed(error.to_string()))?.len();
        let length = c_ulong::try_from(length).map_err(|_| failed("the file is too large".into()))?;
        let mut access = Box::new(FileAccess {
            length,
            get_block: read_block,
            param: std::ptr::from_mut::<File>(&mut file).cast(),
        });
        let _held = lock();
        // SAFETY: `access` and the file it reads stay where they are until the document is closed (in `drop`).
        let document = unsafe { (library.load_custom_document)(&mut *access, std::ptr::null()) };
        if document.is_null() {
            // SAFETY: plain call.
            let code = unsafe { (library.get_last_error)() };
            return Err(failed(format!("the file could not be read (error {code})")));
        }
        // SAFETY: `document` is open.
        let page_count = usize::try_from(unsafe { (library.get_page_count)(document) }).unwrap_or(0);
        let mut form_info = Box::new(FormFillInfo { version: 1, functions: [std::ptr::null_mut(); 64] });
        // SAFETY: `form_info` stays where it is until the form is let go (in `drop`).
        let forms = unsafe { (library.init_forms)(document, &mut *form_info) };
        Ok(Self { library, document, forms, page: None, page_count, _access: access, _form_info: form_info, _file: file })
    }

    pub fn page_count(&self) -> usize {
        self.page_count
    }

    /// The page `index`, opened (or the one already open). Call holding `LOCK`.
    fn page(&mut self, index: usize) -> Result<Handle, EngineError> {
        if let Some((open, page)) = self.page {
            if open == index {
                return Ok(page);
            }
            self.page = None;
            // SAFETY: the page is open and is let go only here.
            unsafe { self.close_page(page) };
        }
        let number = c_int::try_from(index).map_err(|_| EngineError::NoSuchPage(index))?;
        if index >= self.page_count {
            return Err(EngineError::NoSuchPage(index));
        }
        // SAFETY: the document is open and the page is one of its pages.
        let page = unsafe { (self.library.load_page)(self.document, number) };
        if page.is_null() {
            return Err(EngineError::Failed(format!("PDFium could not read page {index}")));
        }
        if !self.forms.is_null() {
            // SAFETY: the page and the form are open.
            unsafe { (self.library.after_load_page)(page, self.forms) };
        }
        self.page = Some((index, page));
        Ok(page)
    }

    /// Lets go of a page. Call holding `LOCK`, once per page.
    unsafe fn close_page(&self, page: Handle) {
        // SAFETY: the caller's promise; the form is open while the document is.
        unsafe {
            if !self.forms.is_null() {
                (self.library.before_close_page)(page, self.forms);
            }
            (self.library.close_page)(page);
        }
    }

    /// Draws the part `area` (`[left, top, right, bottom]`, in pixels) of page `index` as it looks turned by
    /// `rotation` and stretched to `picture` pixels (`[width, height]`, after turning). Returns the pixels as
    /// red, green, blue, row after row.
    pub fn draw(&mut self, index: usize, rotation: Rotation, picture: [u32; 2], area: [u32; 4]) -> Result<Vec<u8>, EngineError> {
        let library = self.library;
        let [left, top, right, bottom] = area;
        let (width, height) = (right.saturating_sub(left), bottom.saturating_sub(top));
        if width == 0 || height == 0 || right > picture[0] || bottom > picture[1] {
            return Err(EngineError::Failed("the part to draw is outside the page".into()));
        }
        let side = |value: u32| c_int::try_from(value).map_err(|_| EngineError::Failed("the picture is too large".into()));
        let (bitmap_width, bitmap_height) = (side(width)?, side(height)?);

        let _held = lock();
        let page = self.page(index)?;
        // SAFETY: the page is open.
        let (page_width, page_height) = unsafe { ((library.page_width)(page), (library.page_height)(page)) };
        let matrix = page_matrix([page_width, page_height], rotation, picture, [left, top]);
        // SAFETY: plain call; the bitmap is let go below, whatever happens.
        let bitmap = unsafe { (library.bitmap_create)(bitmap_width, bitmap_height, 0) };
        if bitmap.is_null() {
            return Err(EngineError::Failed("PDFium had no room for the picture".into()));
        }
        let clip = RectF { left: 0.0, top: 0.0, right: width as f32, bottom: height as f32 };
        // SAFETY: the bitmap and the page are open; the matrix and the clip live through the call.
        let pixels = unsafe {
            (library.bitmap_fill_rect)(bitmap, 0, 0, bitmap_width, bitmap_height, WHITE);
            (library.render_with_matrix)(bitmap, page, &matrix, &clip, FPDF_ANNOT | FPDF_LCD_TEXT);
            if !self.forms.is_null() {
                // The fields as they are filled in, over the page: the whole picture placed so `area` is in the bitmap.
                let place = |value: u32| c_int::try_from(value).unwrap_or(c_int::MAX);
                let turns = match rotation {
                    Rotation::None => 0,
                    Rotation::Quarter => 1,
                    Rotation::Half => 2,
                    Rotation::ThreeQuarters => 3,
                };
                (library.draw_forms)(
                    self.forms,
                    bitmap,
                    page,
                    -place(left),
                    -place(top),
                    place(picture[0]),
                    place(picture[1]),
                    turns,
                    FPDF_ANNOT | FPDF_LCD_TEXT,
                );
            }
            let stride = usize::try_from((library.bitmap_stride)(bitmap)).unwrap_or(0);
            let buffer = (library.bitmap_buffer)(bitmap);
            let rows = if buffer.is_null() || stride < width as usize * 4 {
                None
            } else {
                Some(rgb_of_bgrx(std::slice::from_raw_parts(buffer, stride * height as usize), stride, width as usize))
            };
            (library.bitmap_destroy)(bitmap);
            rows
        };
        pixels.ok_or_else(|| EngineError::Failed("PDFium drew nothing".into()))
    }
}

impl Drop for SharpFile {
    fn drop(&mut self) {
        let _held = lock();
        // SAFETY: the page, the form and the document are open, and are let go only here, in that order.
        unsafe {
            if let Some((_, page)) = self.page.take() {
                self.close_page(page);
            }
            if !self.forms.is_null() {
                (self.library.exit_forms)(self.forms);
            }
            (self.library.close_document)(self.document);
        }
    }
}

/// Where each point of a page goes in the picture: PDFium starts from the page as shown, in points, from its
/// top-left corner; it is turned by `rotation`, stretched to `picture` pixels, and moved so `origin` is at the
/// corner of the bitmap. Matches how MuPDF's pages are drawn, pixel for pixel.
fn page_matrix(page: [f32; 2], rotation: Rotation, picture: [u32; 2], origin: [u32; 2]) -> Matrix {
    let [width, height] = page;
    // Turned clockwise (y grows downward), then moved back to start at 0, 0.
    let (a, b, c, d, e, f) = match rotation {
        Rotation::None => (1.0, 0.0, 0.0, 1.0, 0.0, 0.0),
        Rotation::Quarter => (0.0, 1.0, -1.0, 0.0, height, 0.0),
        Rotation::Half => (-1.0, 0.0, 0.0, -1.0, width, height),
        Rotation::ThreeQuarters => (0.0, -1.0, 1.0, 0.0, 0.0, width),
    };
    let (turned_width, turned_height) = match rotation {
        Rotation::None | Rotation::Half => (width, height),
        Rotation::Quarter | Rotation::ThreeQuarters => (height, width),
    };
    let sx = if turned_width > 0.0 { picture[0] as f32 / turned_width } else { 1.0 };
    let sy = if turned_height > 0.0 { picture[1] as f32 / turned_height } else { 1.0 };
    Matrix {
        a: a * sx,
        b: b * sy,
        c: c * sx,
        d: d * sy,
        e: e * sx - origin[0] as f32,
        f: f * sy - origin[1] as f32,
    }
}

/// Pixels as PDFium writes them (blue, green, red, unused) as red, green, blue, without the gaps between rows.
fn rgb_of_bgrx(buffer: &[u8], stride: usize, width: usize) -> Vec<u8> {
    let mut rgb = Vec::with_capacity(buffer.len() / stride.max(1) * width * 3);
    for row in buffer.chunks(stride) {
        for pixel in row[..width * 4].chunks_exact(4) {
            rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
        }
    }
    rgb
}

#[cfg(test)]
mod tests {
    use super::*;

    fn apply(m: &Matrix, x: f32, y: f32) -> (f32, f32) {
        (m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f)
    }

    #[test]
    fn turns_the_page_into_the_picture() {
        // A page 100 × 200 points drawn at 2 pixels a point.
        let straight = page_matrix([100.0, 200.0], Rotation::None, [200, 400], [0, 0]);
        assert_eq!(apply(&straight, 100.0, 200.0), (200.0, 400.0));
        // A quarter turn clockwise: the top-left corner goes to the top right.
        let quarter = page_matrix([100.0, 200.0], Rotation::Quarter, [400, 200], [0, 0]);
        assert_eq!(apply(&quarter, 0.0, 0.0), (400.0, 0.0));
        assert_eq!(apply(&quarter, 100.0, 200.0), (0.0, 200.0));
        let half = page_matrix([100.0, 200.0], Rotation::Half, [200, 400], [0, 0]);
        assert_eq!(apply(&half, 0.0, 0.0), (200.0, 400.0));
        let three = page_matrix([100.0, 200.0], Rotation::ThreeQuarters, [400, 200], [0, 0]);
        assert_eq!(apply(&three, 0.0, 0.0), (0.0, 200.0));
        // A piece starting at 50, 60 puts that point at the corner of its bitmap.
        let piece = page_matrix([100.0, 200.0], Rotation::None, [200, 400], [50, 60]);
        assert_eq!(apply(&piece, 25.0, 30.0), (0.0, 0.0));
    }

    #[test]
    fn keeps_red_green_and_blue_in_order() {
        // Two pixels a row, with two bytes of padding after each row.
        let buffer = [3, 2, 1, 0, 6, 5, 4, 0, 9, 9, 30, 20, 10, 0, 60, 50, 40, 0, 9, 9];
        assert_eq!(rgb_of_bgrx(&buffer, 10, 2), vec![1, 2, 3, 4, 5, 6, 10, 20, 30, 40, 50, 60]);
    }
}
