//! The documents that are open right now.

use std::collections::HashMap;
use std::fs;
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::engine::{EngineError, PageSize, Rotation};
use crate::render::pages::PageRenderer;
use crate::render::thumbnails::{ThumbnailCache, Thumbnails};
use crate::render::search::{PageHits, TextSearch};
use crate::render::{RenderError, RenderReply};

/// One open PDF. The file is held open by two threads: one draws the pages
/// the interface asks for, the other fills in thumbnails in the background.
/// A third one, for finding text, starts with the first search.
pub struct OpenDocument {
    pub path: PathBuf,
    /// The name to show: of the file itself or, for a picture turned into a
    /// page, of the picture.
    pub file_name: String,
    pub page_sizes: Vec<PageSize>,
    pages: PageRenderer,
    thumbnails: Thumbnails,
    search: Mutex<Option<TextSearch>>,
    /// Declared last, so it is let go of last: by then no thread reads the file.
    _temporary: Option<TemporaryFile>,
}

/// A file the program made for itself (pages given a new shape, not saved
/// yet). It is deleted when its document closes, with the small pictures
/// that were kept for it.
struct TemporaryFile {
    file: PathBuf,
    thumbnails: Option<PathBuf>,
}

impl Drop for TemporaryFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.file);
        if let Some(thumbnails) = &self.thumbnails {
            let _ = fs::remove_dir_all(thumbnails);
        }
    }
}

impl OpenDocument {
    fn open(path: &Path, thumbnails_root: &Path, temporary: bool, shown_name: Option<String>) -> Result<Self, EngineError> {
        // Made first: if opening fails, the file still goes away.
        let mut temporary = temporary.then(|| TemporaryFile { file: path.to_owned(), thumbnails: None });
        let (pages, page_sizes) = PageRenderer::open(path.to_owned())?;
        let cache = ThumbnailCache::for_file(thumbnails_root, path)
            .map_err(|error| EngineError::Failed(format!("thumbnail cache: {error}")))?;
        if let Some(temporary) = &mut temporary {
            temporary.thumbnails = Some(cache.folder().to_owned());
        }
        let thumbnails = Thumbnails::open(path.to_owned(), cache)?;
        let file_name = shown_name
            .unwrap_or_else(|| path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default());
        Ok(Self {
            path: path.to_owned(),
            file_name,
            page_sizes,
            pages,
            thumbnails,
            search: Mutex::new(None),
            _temporary: temporary,
        })
    }

    /// `scale` 1.0 means 72 pixels per inch.
    pub fn render_page(&self, page: usize, scale: f32, rotation: Rotation, reply: RenderReply) {
        self.pages.render(page, scale, rotation, reply);
    }

    pub fn thumbnail(&self, page: usize, reply: RenderReply) {
        self.thumbnails.get(page, reply);
    }

    /// The pages of `pages` on which `needle` is written. Waits for the answer.
    pub fn search(&self, needle: String, pages: Range<usize>) -> Result<Vec<PageHits>, RenderError> {
        let mut search = self.search.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if search.is_none() {
            *search = Some(TextSearch::open(self.path.clone()).map_err(RenderError::Engine)?);
        }
        search.as_ref().expect("just opened").search(needle, pages)
    }
}

/// Open documents by id. Ids are never reused while the program runs.
pub struct Documents {
    thumbnails_root: PathBuf,
    /// Where the program keeps files it makes for itself while documents are open.
    working_root: PathBuf,
    next_working_file: AtomicU64,
    next_id: AtomicU64,
    open: Mutex<HashMap<u64, Arc<OpenDocument>>>,
}

impl Documents {
    pub fn new(cache_dir: &Path) -> Self {
        let working_root = cache_dir.join("working");
        // What an earlier run left behind is of no use to anyone. Files another
        // running copy of the program still reads cannot be deleted, and stay.
        let _ = fs::remove_dir_all(&working_root);
        Self {
            thumbnails_root: cache_dir.join("thumbnails"),
            working_root,
            next_working_file: AtomicU64::new(1),
            next_id: AtomicU64::new(1),
            open: Mutex::new(HashMap::new()),
        }
    }

    pub fn open(&self, path: &Path) -> Result<(u64, Arc<OpenDocument>), EngineError> {
        self.open_as(path, false, None)
    }

    /// Opens a file made at [`Documents::working_file`]; it is deleted when the
    /// document closes.
    pub fn open_temporary(&self, path: &Path) -> Result<(u64, Arc<OpenDocument>), EngineError> {
        self.open_as(path, true, None)
    }

    /// Like [`Documents::open_temporary`], shown under another name than the file's own.
    pub fn open_temporary_named(&self, path: &Path, shown_name: String) -> Result<(u64, Arc<OpenDocument>), EngineError> {
        self.open_as(path, true, Some(shown_name))
    }

    /// A name for a new file of the program's own, in a folder that exists.
    pub fn working_file(&self) -> Result<PathBuf, EngineError> {
        fs::create_dir_all(&self.working_root).map_err(|error| EngineError::Failed(error.to_string()))?;
        let number = self.next_working_file.fetch_add(1, Ordering::Relaxed);
        Ok(self.working_root.join(format!("pages-{}-{number}.pdf", std::process::id())))
    }

    fn open_as(
        &self,
        path: &Path,
        temporary: bool,
        shown_name: Option<String>,
    ) -> Result<(u64, Arc<OpenDocument>), EngineError> {
        let document = Arc::new(OpenDocument::open(path, &self.thumbnails_root, temporary, shown_name)?);
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        self.lock().insert(id, Arc::clone(&document));
        Ok((id, document))
    }

    pub fn get(&self, id: u64) -> Option<Arc<OpenDocument>> {
        self.lock().get(&id).cloned()
    }

    /// Closes the document; its threads stop once pending work is answered.
    pub fn close(&self, id: u64) -> bool {
        self.lock().remove(&id).is_some()
    }

    /// Closes the document and returns once nothing in this program reads its
    /// file any more, so the file can be replaced. False when the document was
    /// not open, or is still in use after a few seconds.
    pub fn close_and_release(&self, id: u64) -> bool {
        let Some(mut document) = self.lock().remove(&id) else {
            return false;
        };
        // A request that is being answered right now still holds the document for a moment.
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match Arc::try_unwrap(document) {
                // Dropping it stops its threads and waits for them.
                Ok(_last_holder) => return true,
                Err(shared) if Instant::now() < deadline => {
                    document = shared;
                    thread::sleep(Duration::from_millis(10));
                }
                Err(_) => return false,
            }
        }
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<u64, Arc<OpenDocument>>> {
        self.open.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}
