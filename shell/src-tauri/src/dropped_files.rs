//! Where on disk the files dropped on the window are. The page gets only their content; on
//! Windows it hands them to WebView2 with `chrome.webview.postMessageWithAdditionalObjects`,
//! which gives this side each file's path. The paths go back to the page as an event.
//!
//! The window's own drop handling (`dragDropEnabled`) stays off: on Windows it would stop
//! the page's own drag and drop (pages, binder, apps) from working.

use tauri::WebviewWindow;

/// The message the page sends with the dropped files.
#[cfg_attr(not(windows), allow(dead_code))]
pub const MESSAGE: &str = "syntelab:dropped-files";
/// The event that carries their paths back (an empty list when none had one).
#[cfg_attr(not(windows), allow(dead_code))]
pub const EVENT: &str = "dropped-file-paths";

#[cfg(windows)]
pub fn listen(window: &WebviewWindow) {
    use tauri::Emitter;
    let emitter = window.clone();
    let _ = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
        use webview2_com::{take_pwstr, WebMessageReceivedEventHandler};
        use windows::core::{Interface, PWSTR};
        unsafe {
            let Ok(core) = webview.controller().CoreWebView2() else { return };
            let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut message = PWSTR::null();
                // Other messages (Tauri's own, other parts of the page) are not ours.
                if args.TryGetWebMessageAsString(&mut message).is_err() || take_pwstr(message) != MESSAGE {
                    return Ok(());
                }
                let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return Ok(()) };
                let objects = args.AdditionalObjects()?;
                let mut count = 0u32;
                objects.Count(&mut count)?;
                let mut paths = Vec::new();
                for index in 0..count {
                    let object = objects.GetValueAtIndex(index)?;
                    if let Ok(file) = object.cast::<ICoreWebView2File>() {
                        let mut path = PWSTR::null();
                        if file.Path(&mut path).is_ok() {
                            paths.push(take_pwstr(path));
                        }
                    }
                }
                let _ = emitter.emit(EVENT, paths);
                Ok(())
            }));
            let mut token = Default::default();
            let _ = core.add_WebMessageReceived(&handler, &mut token);
        }
    });
}

/// Elsewhere the page keeps opening dropped files by their content.
#[cfg(not(windows))]
pub fn listen(_window: &WebviewWindow) {}
