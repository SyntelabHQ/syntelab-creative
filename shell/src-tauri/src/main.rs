// No console window next to the program on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_host;
mod app_windows;
mod apps;
mod default_app;
mod dropped_files;
mod explorer_menu;
mod launch;
mod net;
mod share;

use tauri::Manager;

fn main() {
    // Run by the installer once it has made the Start menu shortcuts: gives them the ids of the app windows, and
    // starts nothing else.
    if std::env::args().nth(1).as_deref() == Some(app_windows::TAG_SHORTCUTS) {
        app_windows::tag_shortcuts();
        return;
    }
    let context = tauri::generate_context!();
    // What this copy itself was started with waits for the interface to ask. The list is there before anything
    // else starts: a copy started at the same moment may hand its start over while this one is still opening
    // its window (the file manager starts one copy per file chosen).
    let waiting = launch::Waiting::default();
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    if let Some(request) = launch::request_of(&arguments, &std::env::current_dir().unwrap_or_default()) {
        waiting.add(request);
    }
    let mut builder = tauri::Builder::default().manage(waiting).manage(app_windows::AppWindows::default());
    // Only one copy runs: another one (a file opened from the file manager, an entry of its
    // right-click menu, the shortcut of an app) hands over what it was started with, which goes to the window of
    // its app; started with nothing to do, it brings back the window used last.
    // A copy started with SYNTELAB_SEPARATE_INSTANCE set stands apart: for trying a build beside the one in use.
    let separate = std::env::var_os("SYNTELAB_SEPARATE_INSTANCE").is_some();
    // Copies started at the same moment take turns until the first is ready to take the others' starts.
    let turn = if separate { None } else { launch::wait_for_turn(&context.config().identifier, launch::TURN_LIMIT) };
    if !separate {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, arguments, folder| {
            if let Some(request) = launch::request_of(arguments.get(1..).unwrap_or_default(), std::path::Path::new(&folder)) {
                app.state::<launch::Waiting>().add(request);
            }
            app_windows::deliver(app, false);
        }));
    }
    let app = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        // Updates: the interface asks for one only after the user chooses "Update";
        // what is downloaded must be signed with the key whose public half is in tauri.conf.json.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let cache_root = app.path().app_cache_dir()?;
            app.manage(app_host::AppHost::start(&cache_root));
            // The window of the app the program was started for; of the app used last when it was started with nothing to do.
            app_windows::deliver(app.handle(), true);
            app_windows::keep_shortcuts_tagged();
            // Offered in "Open with" and the settings of default apps for PDF files; written only when missing or moved.
            default_app::keep_registered();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                app_windows::note_focus(window.app_handle(), window.label());
            }
        })
        .register_asynchronous_uri_scheme_protocol(app_host::RESOURCE_SCHEME, app_host::serve_resource)
        .invoke_handler(tauri::generate_handler![
            apps::list_apps,
            app_host::app_invoke,
            net::fetch_remote_file,
            net::save_web_page,
            net::read_web_page,
            share::share_file,
            app_windows::take_window_requests,
            app_windows::open_app_window,
            explorer_menu::explorer_menu_state,
            explorer_menu::set_explorer_menu,
            default_app::default_pdf_app_state,
            default_app::open_default_app_settings
        ])
        .build(context)
        .expect("failed to start Syntelab Creative");
    // Built: this copy now takes the starts of the others (or has handed its own over and left).
    drop(turn);
    app.run(|_, _| {});
}
