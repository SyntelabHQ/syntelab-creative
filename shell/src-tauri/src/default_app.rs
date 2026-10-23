//! The program as an app that opens PDF files (`syntelab-platform`):
//! registered at start, for this user alone, so it shows in "Open with" and in
//! the system's settings of default apps. The user makes it the default there;
//! PDF Organizer asks whether they did and opens that page.
//!
//! A development build (`npm run dev`) never registers: PDF files would start a
//! program that shows a page of the development server. Neither does a copy
//! started apart from the one in use (`SYNTELAB_SEPARATE_INSTANCE`).

use std::path::PathBuf;

use syntelab_platform::default_app::{self, AppPlace};
use tauri_plugin_opener::OpenerExt;

/// True for a development build, which does not register.
const DEVELOPMENT: bool = cfg!(debug_assertions);

/// Registers the program when it is not registered yet, or is registered from another place (a copy since moved).
/// Called once at start.
pub fn keep_registered() {
    if DEVELOPMENT || std::env::var_os("SYNTELAB_SEPARATE_INSTANCE").is_some() || !default_app::is_supported() {
        return;
    }
    let Ok(program) = std::env::current_exe() else {
        return;
    };
    let place = AppPlace::default();
    if default_app::registered_program(&place).as_deref() != Some(program.as_path()) {
        let _ = default_app::register(&place, &program);
    }
}

/// `supported`: the program is registered (by this copy or the one in use), so the user can choose it.
/// `isDefault`: the user chose it for PDF files.
#[tauri::command]
pub fn default_pdf_app_state() -> serde_json::Value {
    let registered: Option<PathBuf> = default_app::registered_program(&AppPlace::default());
    serde_json::json!({
        "supported": default_app::is_supported() && registered.is_some(),
        "isDefault": default_app::is_default(),
    })
}

/// Opens the system's settings where the user makes the program the default for PDF files. A page of the system,
/// opened on this computer: nothing goes online.
#[tauri::command]
pub fn open_default_app_settings(app: tauri::AppHandle) -> Result<(), String> {
    if !default_app::is_supported() {
        return Err("unsupported".to_owned());
    }
    app.opener().open_url(default_app::settings_uri(), None::<&str>).map_err(|error| error.to_string())
}
