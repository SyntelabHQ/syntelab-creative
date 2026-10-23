//! What every app's Rust side implements, and what it gets from the shell.

use std::collections::BTreeMap;
use std::fmt;
use std::path::PathBuf;

use serde_json::Value;

/// Services the shell gives an app when it creates it.
#[derive(Debug, Clone)]
pub struct AppContext {
    /// A folder on disk that belongs to this app, for things that can be
    /// rebuilt (thumbnails...). The shell may empty it at any time.
    pub cache_dir: PathBuf,
}

/// A request for binary data (a page picture, a thumbnail), made by the app's
/// interface through a URL.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResourceRequest {
    /// Path after the app id, without a leading slash: `page/3/41`.
    pub path: String,
    /// Query values: `?scale=1.5` → `{ "scale": "1.5" }`.
    pub query: BTreeMap<String, String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resource {
    /// Media type, for example `image/png`.
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppError {
    /// The app has no such command or resource.
    NotFound(String),
    /// The request is malformed (missing or wrong values).
    InvalidRequest(String),
    /// The request was dropped because newer ones made it pointless.
    Superseded,
    /// The work itself failed. `code` is stable and can be mapped to a
    /// translated message by the app's interface; `detail` is for logs.
    Failed { code: &'static str, detail: String },
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AppError::NotFound(what) => write!(f, "not found: {what}"),
            AppError::InvalidRequest(why) => write!(f, "invalid request: {why}"),
            AppError::Superseded => f.write_str("superseded by a newer request"),
            AppError::Failed { code, detail } => write!(f, "{code}: {detail}"),
        }
    }
}

impl std::error::Error for AppError {}

/// Called exactly once with the answer to a [`ResourceRequest`], from any thread.
pub type ResourceReply = Box<dyn FnOnce(Result<Resource, AppError>) + Send>;

/// The Rust side of an app. The shell owns one instance per app and calls it
/// from several threads.
pub trait SyntelabApp: Send + Sync {
    /// The app id: the same as its folder name and the `id` in `app.json`.
    fn id(&self) -> &'static str;

    /// Runs a command sent by the app's interface and returns its result as
    /// JSON. Called on a worker thread; it may take a moment, but anything
    /// long belongs in a job.
    fn invoke(&self, command: &str, payload: Value) -> Result<Value, AppError>;

    /// Produces binary data for the app's interface. The method returns at
    /// once; `reply` is called when the data is ready, so an app can queue
    /// requests and drop the ones that are no longer needed.
    fn resource(&self, request: ResourceRequest, reply: ResourceReply);
}
