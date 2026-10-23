//! The interface's only ways to the network, both through `syntelab-net`:
//! reading one of the known files of syntelab.com, and a web page the user
//! asked for: saved as a PDF, or read as its source.

use std::path::PathBuf;

use serde_json::Value;
use syntelab_net::RemoteFile;

/// Downloads one of the known files (`update`, `changelog/<language>`) and returns its
/// content. The interface decides when; it never passes an address.
#[tauri::command]
pub async fn fetch_remote_file(file: String) -> Result<Value, String> {
    let file = RemoteFile::from_name(&file).ok_or_else(|| format!("unknown remote file: {file}"))?;
    let text = tauri::async_runtime::spawn_blocking(move || syntelab_net::fetch(file))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
    serde_json::from_str(&text).map_err(|error| format!("not a valid file: {error}"))
}

/// Reads the source (HTML) of the web page at an address the user typed. The
/// stable codes in the error (`not-an-address`, `no-browser`, `failed`) are
/// for the interface to translate.
#[tauri::command]
pub async fn read_web_page(address: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || syntelab_net::web_page_source(&address))
        .await
        .map_err(|_| "failed".to_owned())?
        .map_err(|error| {
            match error {
                syntelab_net::NetError::NotAllowed(_) => "not-an-address",
                syntelab_net::NetError::NoBrowser => "no-browser",
                _ => "failed",
            }
            .to_owned()
        })
}

/// Saves the web page at an address the user typed as a PDF at `destination`
/// (a place the app's Rust side gave, ending in `.pdf`). The stable codes in
/// the error (`not-an-address`, `no-browser`, `failed`) are for the interface
/// to translate.
#[tauri::command]
pub async fn save_web_page(address: String, destination: PathBuf) -> Result<(), String> {
    let is_pdf = destination.extension().is_some_and(|ending| ending.eq_ignore_ascii_case("pdf"));
    if !is_pdf || !destination.is_absolute() {
        return Err("failed".into());
    }
    tauri::async_runtime::spawn_blocking(move || syntelab_net::save_web_page_as_pdf(&address, &destination))
        .await
        .map_err(|_| "failed".to_owned())?
        .map_err(|error| {
            match error {
                syntelab_net::NetError::NotAllowed(_) => "not-an-address",
                syntelab_net::NetError::NoBrowser => "no-browser",
                _ => "failed",
            }
            .to_owned()
        })
}
