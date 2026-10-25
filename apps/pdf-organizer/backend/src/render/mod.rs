//! Drawing pages and thumbnails off the interface thread.
//!
//! - [`pages`]: full pages, drawn only when asked (the interface asks only for
//!   what is on screen).
//! - [`tiles`]: pieces of pages, for a page zoomed far in.
//! - [`thumbnails`]: small pages, drawn in the background and kept on disk.
//! - [`search`]: finding text, without holding up the drawing.
//! - [`worker`] and [`queue`]: the thread and waiting line both are built on.

pub mod pages;
pub mod queue;
pub mod search;
pub mod thumbnails;
pub mod tiles;
pub mod worker;

use std::fmt;

use crate::engine::EngineError;

/// Called exactly once with the PNG, from the worker thread.
pub type RenderReply = Box<dyn FnOnce(Result<Vec<u8>, RenderError>) + Send>;

#[derive(Debug)]
pub enum RenderError {
    /// Newer requests pushed this one out, or the document was closed.
    Superseded,
    Engine(EngineError),
}

impl fmt::Display for RenderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            RenderError::Superseded => f.write_str("superseded by a newer request"),
            RenderError::Engine(error) => error.fmt(f),
        }
    }
}

impl std::error::Error for RenderError {}
