//! What differs between Windows, Linux and macOS, behind one interface.
//!
//! Callers use the modules here and never write `cfg(windows)` themselves.

pub mod certificates;
pub mod default_app;
pub mod explorer_menu;
pub mod fonts;
pub mod share;
