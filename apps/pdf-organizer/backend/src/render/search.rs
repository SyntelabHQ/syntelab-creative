//! Finding text, on a thread of its own so that a long search never holds up
//! the pages being drawn.

use std::ops::Range;
use std::path::PathBuf;
use std::sync::mpsc;

use crate::engine::{EngineError, PdfFile, TextBox};

use super::queue::Job;
use super::worker::{Work, Worker};
use super::RenderError;

/// The interface asks for a stretch of pages at a time and waits for it, so
/// few searches ever wait; an older one still waiting is no longer wanted.
const MAX_WAITING_SEARCHES: usize = 2;

/// The places on one page where the text was found.
#[derive(Debug, Clone, PartialEq)]
pub struct PageHits {
    pub page: usize,
    pub boxes: Vec<TextBox>,
}

struct SearchJob {
    needle: String,
    pages: Range<usize>,
    reply: mpsc::Sender<Result<Vec<PageHits>, EngineError>>,
}

impl Job for SearchJob {
    // Dropping the reply tells the one waiting that no answer will come.
    fn reject(self) {}
}

struct FindText;

impl Work for FindText {
    type Job = SearchJob;

    fn run(&mut self, file: &PdfFile, job: SearchJob) {
        let end = job.pages.end.min(file.page_count());
        let mut found = Vec::new();
        for page in job.pages.start..end {
            match file.search_page(page, &job.needle) {
                Ok(boxes) if boxes.is_empty() => {}
                Ok(boxes) => found.push(PageHits { page, boxes }),
                Err(error) => {
                    let _ = job.reply.send(Err(error));
                    return;
                }
            }
        }
        let _ = job.reply.send(Ok(found));
    }
}

/// Searches the text of one document on its own thread.
pub struct TextSearch {
    worker: Worker<SearchJob>,
}

impl TextSearch {
    pub fn open(path: PathBuf) -> Result<Self, EngineError> {
        let (worker, ()) = Worker::spawn("pdf-search", path, MAX_WAITING_SEARCHES, FindText, |_| Ok(()))?;
        Ok(Self { worker })
    }

    /// The pages of `pages` that contain `needle`, in order. Waits for the answer.
    pub fn search(&self, needle: String, pages: Range<usize>) -> Result<Vec<PageHits>, RenderError> {
        let (reply, answer) = mpsc::channel();
        self.worker.submit(SearchJob { needle, pages, reply });
        answer.recv().map_err(|_| RenderError::Superseded)?.map_err(RenderError::Engine)
    }
}
