//! Hands a file to the system's "Share" window (`syntelab-platform`).

use std::path::PathBuf;
use std::sync::mpsc;

use syntelab_platform::share::{self, ShareError};
use tauri::WebviewWindow;

/// The system's handle of the program's window; only Windows needs one.
#[cfg(windows)]
fn window_handle(window: &WebviewWindow) -> Result<isize, ShareError> {
    window.hwnd().map(|handle| handle.0 as isize).map_err(|error| ShareError::Failed(error.to_string()))
}

#[cfg(not(windows))]
fn window_handle(_window: &WebviewWindow) -> Result<isize, ShareError> {
    Ok(0)
}

/// Opens the share window for one file. Answers `unsupported` on a system
/// without one; the interface then shows the file in its folder instead.
#[tauri::command]
pub async fn share_file(window: WebviewWindow, path: PathBuf) -> Result<(), String> {
    // Finding the file waits on the system: not on the window's thread.
    let shareable = tauri::async_runtime::spawn_blocking(move || share::prepare(&path))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;

    // Showing the window belongs to the thread that owns the program's window.
    let (answer, shown) = mpsc::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = answer.send(window_handle(&target).and_then(|handle| shareable.show(handle)));
        })
        .map_err(|error| error.to_string())?;
    tauri::async_runtime::spawn_blocking(move || shown.recv())
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}
