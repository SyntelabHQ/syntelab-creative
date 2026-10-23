use std::path::Path;

use super::ShareError;

/// A file ready to be shared. Never made on this system.
pub struct Shareable(());

impl Shareable {
    /// Opens the share window over the program's window.
    pub fn show(self, _window_handle: isize) -> Result<(), ShareError> {
        Err(ShareError::Unsupported)
    }
}

pub(super) fn prepare(_path: &Path) -> Result<Shareable, ShareError> {
    Err(ShareError::Unsupported)
}
