//! One window for each app: its own button on the taskbar, its own name and icon, and it can be pinned. An app is
//! never open in two windows: asking for one that is open brings its window to the front.
//!
//! What the program is started with (`launch.rs`) goes to the window of the app it belongs to: an entry of the
//! file manager's menu and the shortcut of an app to that app, files to the app that takes their kind. A start
//! with nothing to do opens the app used last. Another window's interface can ask for an app too (the app
//! switcher, the search), with a tab to open in it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use syntelab_app_api::AppStatus;
use syntelab_apps_manager::{discover_apps, DiscoveredApp};
use syntelab_platform::window_identity::{self, WindowIdentity};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::launch::{self, LaunchRequest, Waiting};

/// The app the program opens in until another has been used.
const FIRST_APP: &str = "pdf-organizer";
/// Where the app used last is remembered, in the program's settings folder.
const LAST_APP_FILE: &str = "last-app";

/// The label of an app's window.
pub fn label_of(app: &str) -> String {
    format!("app-{app}")
}

/// The app a window belongs to, by its label.
pub fn app_of(label: &str) -> Option<&str> {
    label.strip_prefix("app-")
}

/// What waits for the window of an app: starts of the program, and tabs other windows asked for.
#[derive(Debug, Default, Clone, PartialEq, Serialize)]
pub struct WindowRequests {
    pub launches: Vec<LaunchRequest>,
    pub tabs: Vec<serde_json::Value>,
}

/// What waits for each app's window, by app id; and the window used last.
#[derive(Default)]
pub struct AppWindows {
    waiting: Mutex<HashMap<String, WindowRequests>>,
    last_focused: Mutex<Option<String>>,
}

/// The apps that can be opened.
fn usable_apps(app: &AppHandle) -> Vec<DiscoveredApp> {
    let Ok(folder) = crate::apps::apps_dir(app) else { return Vec::new() };
    discover_apps(&folder).unwrap_or_default().into_iter().filter(|known| known.manifest.status == AppStatus::Active).collect()
}

fn ending_of(path: &Path) -> String {
    path.extension().map(|ending| format!(".{}", ending.to_string_lossy().to_lowercase())).unwrap_or_default()
}

/// Which app each request goes to. An entry of the menu and the shortcut of an app go to their app; files alone
/// are shared out among the apps that take their kind (the first that does). What no app can be opened for is
/// passed over.
pub fn routed(requests: Vec<LaunchRequest>, apps: &[DiscoveredApp]) -> Vec<(String, LaunchRequest)> {
    let is_usable = |id: &str| apps.iter().any(|known| known.manifest.id == id);
    let mut routed: Vec<(String, LaunchRequest)> = Vec::new();
    for request in requests {
        if let Some(app) = request.app.clone() {
            if is_usable(&app) {
                routed.push((app, request));
            }
            continue;
        }
        for file in request.files {
            let ending = ending_of(&file);
            let Some(owner) = apps.iter().find(|known| known.manifest.file_types.iter().any(|kind| kind.to_lowercase() == ending)) else { continue };
            let id = owner.manifest.id.clone();
            match routed.iter_mut().find(|(app, known)| *app == id && known.app.is_none()) {
                Some((_, known)) => known.files.push(file),
                None => routed.push((id, LaunchRequest { app: None, action: None, files: vec![file] })),
            }
        }
    }
    routed
}

/// The app to open when the program is started with nothing to do: the one used last, while it can still be
/// opened; else the usual first app, else the first that can be opened. With no app found at all (a damaged
/// installation), the usual first app all the same: a window that says so beats a program that shows nothing.
pub fn starting_app(last: Option<&str>, apps: &[DiscoveredApp]) -> String {
    let usable = |id: &str| apps.iter().any(|known| known.manifest.id == id);
    last.filter(|id| usable(id))
        .map(str::to_owned)
        .or_else(|| (usable(FIRST_APP) || apps.is_empty()).then(|| FIRST_APP.to_owned()))
        .or_else(|| apps.first().map(|known| known.manifest.id.clone()))
        .unwrap_or_else(|| FIRST_APP.to_owned())
}

fn last_app_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|folder| folder.join(LAST_APP_FILE))
}

fn last_app(app: &AppHandle) -> Option<String> {
    let text = std::fs::read_to_string(last_app_file(app)?).ok()?;
    Some(text.trim().to_owned()).filter(|id| !id.is_empty())
}

/// Remembers the window the user is in, to open its app at the next start and to bring it back when another copy
/// of the program is started with nothing to do.
pub fn note_focus(app: &AppHandle, label: &str) {
    let Some(id) = app_of(label) else { return };
    if let Ok(mut last) = app.state::<AppWindows>().last_focused.lock() {
        *last = Some(label.to_owned());
    }
    if let Some(file) = last_app_file(app) {
        if let Some(folder) = file.parent() {
            let _ = std::fs::create_dir_all(folder);
        }
        let _ = std::fs::write(file, id);
    }
}

/// The program's own icon for an app's window: `icons/apps/<id>.ico`, next to the program once installed.
fn icon_file(app: &AppHandle, id: &str) -> Option<PathBuf> {
    let folder = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")) } else { app.path().resource_dir().ok()? };
    Some(folder.join("icons").join("apps").join(format!("{id}.ico"))).filter(|file| file.is_file())
}

/// The largest picture in an `.ico` file that is kept as PNG (the 256 pixel one), as RGBA.
pub fn picture_of_icon(bytes: &[u8]) -> Option<(Vec<u8>, u32, u32)> {
    let word = |at: usize| bytes.get(at..at + 2).map(|two| u16::from_le_bytes([two[0], two[1]]));
    let long = |at: usize| bytes.get(at..at + 4).map(|four| u32::from_le_bytes([four[0], four[1], four[2], four[3]]) as usize);
    let count = word(4)? as usize;
    let mut best: Option<(u32, &[u8])> = None;
    for index in 0..count {
        let entry = 6 + 16 * index;
        let side = match *bytes.get(entry)? {
            0 => 256,
            side => u32::from(side),
        };
        let (size, start) = (long(entry + 8)?, long(entry + 12)?);
        let Some(data) = bytes.get(start..start.checked_add(size)?) else { continue };
        if data.starts_with(b"\x89PNG") && best.is_none_or(|(known, _)| side > known) {
            best = Some((side, data));
        }
    }
    let mut decoder = png::Decoder::new(best?.1);
    decoder.set_transformations(png::Transformations::normalize_to_color8() | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().ok()?;
    let mut buffer = vec![0; reader.output_buffer_size()];
    let frame = reader.next_frame(&mut buffer).ok()?;
    buffer.truncate(frame.buffer_size());
    (frame.color_type == png::ColorType::Rgba).then_some((buffer, frame.width, frame.height))
}

/// Opens the window of the app, or brings it to the front when it is open.
pub fn show(app: &AppHandle, id: &str) -> Result<WebviewWindow, String> {
    let label = label_of(id);
    if let Some(window) = app.get_webview_window(&label) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(window);
    }
    if !id.chars().all(|letter| letter.is_ascii_lowercase() || letter.is_ascii_digit() || letter == '-') {
        return Err(format!("no app {id} to open"));
    }
    let apps = usable_apps(app);
    let known = apps.iter().find(|known| known.manifest.id == id);
    // Only an app that can be used, unless none was found at all (see `starting_app`).
    if known.is_none() && !apps.is_empty() {
        return Err(format!("no app {id} to open"));
    }
    let name = known.and_then(|known| known.manifest.name.get("en").cloned()).unwrap_or_else(|| id.to_owned());
    let icon = icon_file(app, id);
    let picture = icon.as_ref().and_then(|file| std::fs::read(file).ok()).and_then(|bytes| picture_of_icon(&bytes));
    // The interface reads which app it is for before anything else runs.
    let script = format!("window.__SYNTELAB_WINDOW_APP__ = {};", serde_json::to_string(id).map_err(|error| error.to_string())?);
    let mut builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::default())
        .title(&name)
        .inner_size(1280.0, 800.0)
        .min_inner_size(240.0, 200.0)
        // The program draws its own title bar: the tabs, the search and the window's buttons in one row (window-bar.tsx).
        .decorations(false)
        // Dropped files are handled by the page (dropped_files.rs).
        .disable_drag_drop_handler()
        // Shown once it has its place on the taskbar, so its button is never the program's for a moment.
        .visible(false)
        .initialization_script(script);
    if let Some((rgba, width, height)) = picture {
        builder = builder.icon(tauri::image::Image::new_owned(rgba, width, height)).map_err(|error| error.to_string())?;
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    give_identity(&window, id, &name, icon.as_deref());
    crate::dropped_files::listen(&window);
    let _ = window.show();
    let _ = window.set_focus();
    Ok(window)
}

/// The window's own button on the taskbar, which starts this app again once pinned.
#[cfg(windows)]
fn give_identity(window: &WebviewWindow, id: &str, name: &str, icon: Option<&Path>) {
    let Ok(handle) = window.hwnd() else { return };
    let program = std::env::current_exe().unwrap_or_default();
    let relaunch = format!("\"{}\" --app {id}", program.display());
    let id = window_identity::app_window_id(id);
    window_identity::give(handle.0 as isize, &WindowIdentity { id: &id, name, relaunch: &relaunch, icon });
}

#[cfg(not(windows))]
fn give_identity(_window: &WebviewWindow, id: &str, name: &str, icon: Option<&Path>) {
    let id = window_identity::app_window_id(id);
    window_identity::give(0, &WindowIdentity { id: &id, name, relaunch: "", icon });
}

/// Hands each app's window what waits for it, opening the window when it is not open. With nothing waiting, the
/// first start opens the app used last, and a later one (another copy started with nothing to do) brings back
/// the window used last.
pub fn deliver(app: &AppHandle, first_start: bool) {
    let requests = launch::take_all(&app.state::<Waiting>());
    let apps = usable_apps(app);
    let routed = routed(requests, &apps);
    if routed.is_empty() {
        let last_window = app.state::<AppWindows>().last_focused.lock().ok().and_then(|last| last.clone());
        let target = match last_window.filter(|_| !first_start).and_then(|label| app_of(&label).map(str::to_owned)) {
            Some(id) => id,
            None => starting_app(last_app(app).as_deref(), &apps),
        };
        let _ = show(app, &target);
        return;
    }
    let mut targets: Vec<String> = Vec::new();
    if let Ok(mut waiting) = app.state::<AppWindows>().waiting.lock() {
        for (id, request) in routed {
            waiting.entry(id.clone()).or_default().launches.push(request);
            if !targets.contains(&id) {
                targets.push(id);
            }
        }
    }
    for id in targets {
        if show(app, &id).is_ok() {
            let _ = app.emit_to(label_of(&id).as_str(), launch::EVENT, ());
        }
    }
}

/// The shortcuts of the apps in the Start menu get the id of their app's window, so a shortcut pinned to the taskbar
/// and the window it opens are one button. Done once at start, beside the window; only the installed program.
pub fn keep_shortcuts_tagged() {
    if cfg!(debug_assertions) || std::env::var_os("SYNTELAB_SEPARATE_INSTANCE").is_some() {
        return;
    }
    std::thread::spawn(tag_shortcuts);
}

/// What the installer starts the program with to have the shortcuts tagged, and nothing else.
pub const TAG_SHORTCUTS: &str = "--tag-shortcuts";

/// Tags the shortcuts now (see [`keep_shortcuts_tagged`]); the installer runs the program with
/// `--tag-shortcuts` for this, right after making them, so they are tagged before anyone pins one.
pub fn tag_shortcuts() {
    let Ok(program) = std::env::current_exe() else { return };
    // The user's own Start menu (the usual installation), everyone's (an installation for all users), and the
    // shortcuts pinned to the taskbar: pinning copies the shortcut there, as it was then.
    let folders = [
        ("APPDATA", "Microsoft\\Windows\\Start Menu\\Programs\\Syntelab Creative"),
        ("ProgramData", "Microsoft\\Windows\\Start Menu\\Programs\\Syntelab Creative"),
        ("APPDATA", "Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"),
    ];
    for (variable, below) in folders {
        if let Some(root) = std::env::var_os(variable) {
            window_identity::tag_app_shortcuts(&PathBuf::from(root).join(below), &program);
        }
    }
}

/// Everything that waits for the window that asks, once.
#[tauri::command]
pub fn take_window_requests(window: WebviewWindow, windows: tauri::State<'_, AppWindows>) -> WindowRequests {
    let Some(id) = app_of(window.label()) else { return WindowRequests::default() };
    windows.waiting.lock().ok().and_then(|mut waiting| waiting.remove(id)).unwrap_or_default()
}

/// Opens the window of an app (or brings it to the front), with a tab to open in it when `tab` is given.
/// Asynchronous: on Windows a window made by a command that is not would wait on itself.
#[tauri::command]
pub async fn open_app_window(app: AppHandle, id: String, tab: Option<serde_json::Value>) -> Result<(), String> {
    if let Some(tab) = tab {
        if let Ok(mut waiting) = app.state::<AppWindows>().waiting.lock() {
            waiting.entry(id.clone()).or_default().tabs.push(tab);
        }
    }
    show(&app, &id)?;
    let _ = app.emit_to(label_of(&id).as_str(), launch::EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use syntelab_app_api::AppManifest;

    fn app(id: &str, file_types: &[&str]) -> DiscoveredApp {
        let manifest: AppManifest = serde_json::from_value(serde_json::json!({
            "id": id, "version": "0", "apiVersion": 1, "status": "active",
            "name": { "en": id }, "description": { "en": id },
            "brand": { "color": "#000000", "icon": "icon.svg" },
            "fileTypes": file_types,
        }))
        .expect("a manifest");
        DiscoveredApp { manifest, icon_svg: None }
    }

    fn request(app: Option<&str>, action: Option<&str>, files: &[&str]) -> LaunchRequest {
        LaunchRequest { app: app.map(str::to_owned), action: action.map(str::to_owned), files: files.iter().map(PathBuf::from).collect() }
    }

    #[test]
    fn windows_are_known_by_their_app() {
        assert_eq!(label_of("pdf-organizer"), "app-pdf-organizer");
        assert_eq!(app_of("app-pdf-organizer"), Some("pdf-organizer"));
        assert_eq!(app_of("main"), None);
    }

    #[test]
    fn sends_each_start_to_the_window_of_its_app() {
        let apps = [app("pdf-organizer", &[".pdf"]), app("scribe", &[".txt", ".md"])];
        let routed = routed(
            vec![
                request(None, None, &["a.PDF", "notes.txt", "b.pdf", "photo.png"]),
                request(Some("pdf-organizer"), Some("combine-to-pdf"), &["c.pdf"]),
                request(Some("units"), None, &[]),
                request(Some("scribe"), None, &[]),
            ],
            &apps,
        );
        assert_eq!(
            routed,
            vec![
                ("pdf-organizer".to_owned(), request(None, None, &["a.PDF", "b.pdf"])),
                ("scribe".to_owned(), request(None, None, &["notes.txt"])),
                ("pdf-organizer".to_owned(), request(Some("pdf-organizer"), Some("combine-to-pdf"), &["c.pdf"])),
                ("scribe".to_owned(), request(Some("scribe"), None, &[])),
            ]
        );
    }

    #[test]
    fn starts_in_the_app_used_last() {
        let apps = [app("dev", &[]), app("pdf-organizer", &[".pdf"])];
        assert_eq!(starting_app(Some("dev"), &apps), "dev");
        // An app that is gone, or none used yet: the usual first app, else the first there is.
        assert_eq!(starting_app(Some("gone"), &apps), "pdf-organizer");
        assert_eq!(starting_app(None, &apps), "pdf-organizer");
        assert_eq!(starting_app(None, &[app("units", &[])]), "units");
        assert_eq!(starting_app(None, &[]), "pdf-organizer");
    }

    #[test]
    fn reads_the_window_icon_of_each_app() {
        let folder = Path::new(env!("CARGO_MANIFEST_DIR")).join("icons/apps");
        for id in ["dev", "pdf-organizer", "scribe", "units"] {
            let bytes = std::fs::read(folder.join(format!("{id}.ico"))).expect("an icon");
            let (rgba, width, height) = picture_of_icon(&bytes).expect("a picture");
            assert_eq!((width, height), (256, 256), "{id}");
            assert_eq!(rgba.len(), 256 * 256 * 4);
        }
        assert!(picture_of_icon(b"not an icon").is_none());
    }
}
