//! Pieces of pages, drawn on request: zoomed far in, only what is on screen is drawn, sharp.

use std::path::PathBuf;

use crate::engine::{EngineError, PdfFile, Rotation, ScreenPages, Tile};

use super::queue::Job;
use super::worker::{Work, Worker};
use super::{RenderError, RenderReply};

/// A screen holds a few dozen pieces; more waiting than this means the user has moved on.
const MAX_WAITING_TILES: usize = 96;

struct TileJob {
    page: usize,
    scale: f32,
    rotation: Rotation,
    tile: Tile,
    reply: RenderReply,
}

impl Job for TileJob {
    fn reject(self) {
        (self.reply)(Err(RenderError::Superseded));
    }
}

struct DrawTiles {
    screen: ScreenPages,
}

impl Work for DrawTiles {
    type Job = TileJob;

    fn run(&mut self, file: &PdfFile, job: TileJob) {
        (job.reply)(self.screen.tile_png(file, job.page, job.scale, job.rotation, job.tile).map_err(RenderError::Engine));
    }
}

/// Draws pieces of the pages of one document on its own thread, beside the one that draws whole pages.
pub struct TileRenderer {
    worker: Worker<TileJob>,
}

impl TileRenderer {
    pub fn open(path: PathBuf) -> Result<Self, EngineError> {
        let work = DrawTiles { screen: ScreenPages::new(path.clone()) };
        let (worker, ()) = Worker::spawn("pdf-tiles", path, MAX_WAITING_TILES, work, |_| Ok(()))?;
        Ok(Self { worker })
    }

    /// `scale` 1.0 means 72 pixels per inch.
    pub fn render(&self, page: usize, scale: f32, rotation: Rotation, tile: Tile, reply: RenderReply) {
        self.worker.submit(TileJob { page, scale, rotation, tile, reply });
    }
}
