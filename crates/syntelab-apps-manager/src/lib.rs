//! App management for the shell.
//!
//! For now: finding the apps that are present on disk. Catalog, download,
//! verification and install come later (PLAN.md, step 4).

pub mod discovery;

pub use discovery::{discover_apps, DiscoveredApp};
