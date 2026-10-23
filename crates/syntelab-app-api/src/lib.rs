//! The contract between the shell and apps, version 1.
//!
//! - [`manifest`]: the app manifest (`app.json`).
//! - [`app`]: the [`SyntelabApp`] trait an app's Rust side implements, and the
//!   types that travel between the shell and the app.

pub mod app;
pub mod manifest;

pub use app::{AppContext, AppError, Resource, ResourceReply, ResourceRequest, SyntelabApp};
pub use manifest::{AppBrand, AppManifest, AppStatus, LocalizedText};

/// Contract version this shell understands. Apps declare theirs as
/// `apiVersion` in `app.json`; the shell refuses any other value.
/// Mirrored by `API_VERSION` in `packages/shell-api`.
pub const API_VERSION: u32 = 1;
