//! Thumbnails: drawn in the background, kept on disk, reused on reopen.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::engine::{EngineError, PdfFile, Rotation};

use super::queue::Job;
use super::worker::{Work, Worker};
use super::{RenderError, RenderReply};

/// Width of a stored thumbnail, in pixels (shown at about half of this, so it
/// stays sharp on high-density screens).
pub const THUMBNAIL_WIDTH: f32 = 240.0;

/// Thumbnails near the visible ones are asked for together; keep a screenful.
const MAX_WAITING_THUMBNAILS: usize = 48;

/// The thumbnails of one version of one file, as PNG files in a folder.
#[derive(Debug, Clone)]
pub struct ThumbnailCache {
    dir: PathBuf,
}

impl ThumbnailCache {
    /// `root` is shared by all documents. The folder for this document is
    /// named after the file's path, size and modification time, so an edited
    /// file never shows old thumbnails.
    pub fn for_file(root: &Path, file: &Path) -> io::Result<Self> {
        let metadata = fs::metadata(file)?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_nanos());
        let identity = format!("{}|{}|{modified}", file.display(), metadata.len());
        let dir = root.join(format!("{:016x}", fnv1a(identity.as_bytes())));
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    /// The folder the document's small pictures are kept in.
    pub fn folder(&self) -> &Path {
        &self.dir
    }

    pub fn get(&self, page: usize) -> Option<Vec<u8>> {
        fs::read(self.path(page)).ok()
    }

    fn contains(&self, page: usize) -> bool {
        self.path(page).is_file()
    }

    /// Writes through a temporary file, so a reader never sees half a picture.
    fn put(&self, page: usize, png: &[u8]) -> io::Result<()> {
        let temporary = self.dir.join(format!("{page}.tmp"));
        fs::write(&temporary, png)?;
        fs::rename(temporary, self.path(page))
    }

    fn path(&self, page: usize) -> PathBuf {
        self.dir.join(format!("{page}.png"))
    }
}

/// FNV-1a, 64 bit: a small hash whose result never changes between versions.
fn fnv1a(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf2_9ce4_8422_2325, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x0100_0000_01b3))
}

struct ThumbnailJob {
    page: usize,
    reply: RenderReply,
}

impl Job for ThumbnailJob {
    fn reject(self) {
        (self.reply)(Err(RenderError::Superseded));
    }
}

struct DrawThumbnails {
    cache: ThumbnailCache,
    /// Next page the background pass looks at.
    next_background_page: usize,
}

impl DrawThumbnails {
    fn draw(&self, file: &PdfFile, page: usize) -> Result<Vec<u8>, EngineError> {
        let width = file.page_size(page)?.width.max(1.0);
        let png = file.render_png(page, THUMBNAIL_WIDTH / width, Rotation::None)?;
        // A thumbnail that cannot be stored is still shown; it is drawn again next time.
        let _ = self.cache.put(page, &png);
        Ok(png)
    }
}

impl Work for DrawThumbnails {
    type Job = ThumbnailJob;

    fn run(&mut self, file: &PdfFile, job: ThumbnailJob) {
        let result = match self.cache.get(job.page) {
            Some(png) => Ok(png),
            None => self.draw(file, job.page).map_err(RenderError::Engine),
        };
        (job.reply)(result);
    }

    /// Background pass: one page at a time, so a request never waits long.
    fn idle(&mut self, file: &PdfFile) -> bool {
        let page = self.next_background_page;
        if page >= file.page_count() {
            return false;
        }
        self.next_background_page += 1;
        if !self.cache.contains(page) {
            // A page that cannot be drawn is skipped; asking for it reports the error.
            let _ = self.draw(file, page);
        }
        true
    }
}

/// Thumbnails of one document: served from disk when present, drawn otherwise.
pub struct Thumbnails {
    cache: ThumbnailCache,
    worker: Worker<ThumbnailJob>,
}

impl Thumbnails {
    pub fn open(path: PathBuf, cache: ThumbnailCache) -> Result<Self, EngineError> {
        let work = DrawThumbnails { cache: cache.clone(), next_background_page: 0 };
        let (worker, ()) = Worker::spawn("pdf-thumbnails", path, MAX_WAITING_THUMBNAILS, work, |_| Ok(()))?;
        Ok(Self { cache, worker })
    }

    pub fn get(&self, page: usize, reply: RenderReply) {
        match self.cache.get(page) {
            Some(png) => reply(Ok(png)),
            None => self.worker.submit(ThumbnailJob { page, reply }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hash_is_stable() {
        // Reference values of FNV-1a 64.
        assert_eq!(fnv1a(b""), 0xcbf2_9ce4_8422_2325);
        assert_eq!(fnv1a(b"a"), 0xaf63_dc4c_8601_ec8c);
    }
}
