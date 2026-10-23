//! The entries of the apps in the file manager's right-click menu
//! (`syntelab-platform`): added and taken out when the user says so in the
//! settings, for that user alone.
//!
//! A development build (`npm run dev`) never adds them: they would start a
//! program that shows a page of the development server, which is not there
//! when that is not running. It can take them out.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use syntelab_platform::explorer_menu::{self, MenuEntry, MenuGroup, MenuPlace};
use tauri::Manager;

/// True for a development build, which does not add the entries.
const DEVELOPMENT: bool = cfg!(debug_assertions);

/// An entry as the interface names it: which app declared it, its id there,
/// its label in the user's language, the kinds of files it shows on, and the
/// label of the entry it opens from when the app gathers its entries under one.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestedEntry {
    app_id: String,
    id: String,
    label: String,
    file_types: Vec<String>,
    group_label: Option<String>,
}

/// The icon of an app beside its entries: the one the installer puts next to the program, else the program's own.
fn icon_of(app: &tauri::AppHandle, program: &Path, app_id: &str) -> String {
    app.path()
        .resource_dir()
        .ok()
        .map(|folder| folder.join("icons").join("apps").join(format!("{app_id}.ico")))
        .filter(|icon| icon.is_file())
        .map(|icon| icon.to_string_lossy().into_owned())
        .unwrap_or_else(|| format!("\"{}\",0", program.to_string_lossy()))
}

fn entries(app: &tauri::AppHandle, program: &Path, requested: Vec<RequestedEntry>) -> Vec<MenuEntry> {
    requested
        .into_iter()
        .map(|entry| {
            let icon = icon_of(app, program, &entry.app_id);
            let (icon, group) = match entry.group_label {
                Some(label) => (None, Some(MenuGroup { id: entry.app_id.clone(), label, icon: Some(icon) })),
                None => (Some(icon), None),
            };
            MenuEntry {
                id: format!("{}.{}", entry.app_id, entry.id),
                label: entry.label,
                // What `launch.rs` reads back when the entry is chosen.
                arguments: vec!["--app".to_owned(), entry.app_id, "--action".to_owned(), entry.id],
                file_types: entry.file_types,
                icon,
                group,
            }
        })
        .collect()
}

/// The program that is running now, from where it is.
fn this_program() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|error| error.to_string())
}

/// `supported`: this system has such a menu. `registered`: entries of the program are in it. `complete`: every one
/// of them is, as this version keeps them (an app may have gained entries since they were put there).
/// `development`: this is a development build, which does not add them. `outdated`: they are there but start
/// another program (a development build, a copy since moved), or were written by an earlier version; the
/// interface then writes them again at once, unless this copy is a development build or one started apart from
/// the one in use (`SYNTELAB_SEPARATE_INSTANCE`, see `main.rs`).
#[tauri::command]
pub fn explorer_menu_state(app: tauri::AppHandle, entries_asked: Vec<RequestedEntry>) -> serde_json::Value {
    let program = this_program().unwrap_or_default();
    let entries = entries(&app, &program, entries_asked);
    let place = MenuPlace::default();
    let registered = explorer_menu::is_registered(&place);
    let apart = DEVELOPMENT || std::env::var_os("SYNTELAB_SEPARATE_INSTANCE").is_some();
    serde_json::json!({
        "supported": explorer_menu::is_supported(),
        "registered": registered,
        "complete": registered && explorer_menu::all_registered(&place, &entries),
        "development": DEVELOPMENT,
        "outdated": registered && !apart && explorer_menu::registered_program(&place, &entries).as_deref() != Some(program.as_path()),
    })
}

/// Puts the entries in the menu, or takes out everything of the program that is there.
#[tauri::command]
pub fn set_explorer_menu(app: tauri::AppHandle, enabled: bool, entries_asked: Vec<RequestedEntry>) -> Result<(), String> {
    let place = MenuPlace::default();
    if !enabled {
        return explorer_menu::unregister(&place).map_err(|error| error.to_string());
    }
    if DEVELOPMENT {
        return Err("a development build does not add entries to the menu".to_owned());
    }
    let program = this_program()?;
    let entries = entries(&app, &program, entries_asked);
    explorer_menu::register(&place, &program, &entries).map_err(|error| error.to_string())
}
