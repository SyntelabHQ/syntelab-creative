//! Full pages, drawn on request.

use std::path::PathBuf;

use crate::engine::{EngineError, PageSize, PdfFile, Rotation};

use super::queue::Job;
use super::worker::{Work, Worker};
use super::{RenderError, RenderReply};

/// More waiting pages than this means the user has scrolled on; the oldest
/// requests are given up.
const MAX_WAITING_PAGES: usize = 12;

struct PageJob {
    page: usize,
    scale: f32,
    rotation: Rotation,
    reply: RenderReply,
}

impl Job for PageJob {
    fn reject(self) {
        (self.reply)(Err(RenderError::Superseded));
    }
}

struct DrawPages;

impl Work for DrawPages {
    type Job = PageJob;

    fn run(&mut self, file: &PdfFile, job: PageJob) {
        (job.reply)(file.render_png(job.page, job.scale, job.rotation).map_err(RenderError::Engine));
    }
}

/// Draws the pages of one document on its own thread.
pub struct PageRenderer {
    worker: Worker<PageJob>,
}

impl PageRenderer {
    /// Opens the document and measures every page.
    pub fn open(path: PathBuf) -> Result<(Self, Vec<PageSize>), EngineError> {
        let (worker, sizes) = Worker::spawn("pdf-pages", path, MAX_WAITING_PAGES, DrawPages, |file| {
            (0..file.page_count()).map(|index| file.page_size(index)).collect()
        })?;
        Ok((Self { worker }, sizes))
    }

    /// `scale` 1.0 means 72 pixels per inch.
    pub fn render(&self, page: usize, scale: f32, rotation: Rotation, reply: RenderReply) {
        self.worker.submit(PageJob { page, scale, rotation, reply });
    }
}
