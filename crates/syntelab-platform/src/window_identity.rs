//! Which app a window belongs to, for the taskbar: each app has a window of its own, with its own button, name and
//! icon, and pinning that window pins the app (its own shortcut), not the program as a whole.
//!
//! On Windows this is the window's AppUserModelID with the command, name and icon to start it again by. Elsewhere
//! the window's title and icon say it (set where the window is made), and there is nothing more to do.

use std::path::Path;

/// What the taskbar knows a window by.
pub struct WindowIdentity<'a> {
    /// Tells the apps apart; windows with the same id share a button.
    pub id: &'a str,
    /// The name a pinned window shows.
    pub name: &'a str,
    /// The command line that starts the program again in this app, for a pinned window.
    pub relaunch: &'a str,
    /// The icon a pinned window shows; the program's own when there is none.
    pub icon: Option<&'a Path>,
}

/// The id the taskbar knows the window of an app by.
pub fn app_window_id(app: &str) -> String {
    format!("SyntelabCreative.{app}")
}

/// Sets a text property, as Windows' own samples do: the text in memory of the system's own, freed once set.
#[cfg(windows)]
unsafe fn set(store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore, key: &windows::Win32::Foundation::PROPERTYKEY, text: &str) -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::SHStrDupW;
    unsafe {
        let copy = SHStrDupW(&HSTRING::from(text))?;
        let mut value = PROPVARIANT::default();
        (*value.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*value.Anonymous.Anonymous).Anonymous.pwszVal = copy;
        let done = store.SetValue(key, &value);
        let _ = PropVariantClear(&mut value);
        done
    }
}

/// A text property, when it is one.
#[cfg(windows)]
unsafe fn get(store: &windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore, key: &windows::Win32::Foundation::PROPERTYKEY) -> Option<String> {
    use windows::Win32::System::Com::StructuredStorage::PropVariantClear;
    use windows::Win32::System::Variant::VT_LPWSTR;
    unsafe {
        let mut value = store.GetValue(key).ok()?;
        let text = ((*value.Anonymous.Anonymous).vt == VT_LPWSTR).then(|| (*value.Anonymous.Anonymous).Anonymous.pwszVal.to_string().ok()).flatten();
        let _ = PropVariantClear(&mut value);
        text
    }
}

/// The app a shortcut opens the program in: `--app <id>` among its arguments.
pub fn app_of_arguments(arguments: &str) -> Option<String> {
    let mut words = arguments.split_whitespace();
    while let Some(word) = words.next() {
        if word == "--app" {
            return words.next().filter(|id| !id.is_empty() && id.chars().all(|letter| letter.is_ascii_lowercase() || letter.is_ascii_digit() || letter == '-')).map(str::to_owned);
        }
    }
    None
}

/// Gives each shortcut in `folder` that opens `program` in an app (`--app <id>`: the shortcuts of the Start
/// menu, and the copies Windows keeps of those pinned to the taskbar) the id of that app's window, so the
/// shortcut and the window are one button on the taskbar. Returns how many were changed; those that already have
/// it, and shortcuts of other programs, are left alone.
#[cfg(windows)]
pub fn tag_app_shortcuts(folder: &Path, program: &Path) -> usize {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READWRITE};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let Ok(entries) = std::fs::read_dir(folder) else { return 0 };
    let mut changed = 0;
    unsafe {
        let started = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.extension().is_some_and(|ending| ending.eq_ignore_ascii_case("lnk")) {
                continue;
            }
            let Ok(link) = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) else { continue };
            let Ok(file) = link.cast::<IPersistFile>() else { continue };
            if file.Load(&HSTRING::from(path.as_os_str()), STGM_READWRITE).is_err() {
                continue;
            }
            let mut arguments = [0u16; 1024];
            if link.GetArguments(&mut arguments).is_err() {
                continue;
            }
            let text = |letters: &[u16]| {
                let end = letters.iter().position(|&letter| letter == 0).unwrap_or(letters.len());
                String::from_utf16_lossy(&letters[..end])
            };
            let Some(app) = app_of_arguments(&text(&arguments)) else { continue };
            let mut target = [0u16; 1024];
            if link.GetPath(&mut target, std::ptr::null_mut(), 0).is_err() || !same_file(Path::new(&text(&target)), program) {
                continue;
            }
            let id = app_window_id(&app);
            let Ok(store) = link.cast::<IPropertyStore>() else { continue };
            if get(&store, &PKEY_AppUserModel_ID).as_deref() == Some(id.as_str()) {
                continue;
            }
            if set(&store, &PKEY_AppUserModel_ID, &id).is_ok() && store.Commit().is_ok() && file.Save(None, true).is_ok() {
                changed += 1;
            }
        }
        if started {
            CoUninitialize();
        }
    }
    changed
}

/// Elsewhere shortcuts carry no such id.
#[cfg(not(windows))]
pub fn tag_app_shortcuts(_folder: &Path, _program: &Path) -> usize {
    0
}

/// The same file, however the names are written (case, `..`).
#[cfg_attr(not(windows), allow(dead_code))]
fn same_file(a: &Path, b: &Path) -> bool {
    match (a.canonicalize(), b.canonicalize()) {
        (Ok(a), Ok(b)) => a == b,
        _ => a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()),
    }
}

/// Gives the window (`window` is its handle, an `HWND` on Windows) the identity; false when that could not be done.
#[cfg(windows)]
pub fn give(window: isize, identity: &WindowIdentity) -> bool {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::Storage::EnhancedStorage::{PKEY_AppUserModel_ID, PKEY_AppUserModel_RelaunchCommand, PKEY_AppUserModel_RelaunchDisplayNameResource, PKEY_AppUserModel_RelaunchIconResource};
    use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};

    let icon = identity.icon.map(|icon| format!("{},0", icon.display()));
    unsafe {
        let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(HWND(window as *mut _)) else { return false };
        // The command, name and icon count only for a window with an id of its own: they go first, the id last.
        let mut done = set(&store, &PKEY_AppUserModel_RelaunchCommand, identity.relaunch).is_ok()
            && set(&store, &PKEY_AppUserModel_RelaunchDisplayNameResource, identity.name).is_ok();
        if let Some(icon) = &icon {
            done &= set(&store, &PKEY_AppUserModel_RelaunchIconResource, icon).is_ok();
        }
        done && set(&store, &PKEY_AppUserModel_ID, identity.id).is_ok() && store.Commit().is_ok()
    }
}

/// Elsewhere the window's title and icon are all there is.
#[cfg(not(windows))]
pub fn give(_window: isize, _identity: &WindowIdentity) -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_app_has_an_id_of_its_own_on_the_taskbar() {
        assert_eq!(app_window_id("pdf-organizer"), "SyntelabCreative.pdf-organizer");
        assert_ne!(app_window_id("dev"), app_window_id("units"));
    }

    #[test]
    fn finds_the_app_a_shortcut_opens() {
        assert_eq!(app_of_arguments("--app pdf-organizer").as_deref(), Some("pdf-organizer"));
        assert_eq!(app_of_arguments("  --app   units  --x").as_deref(), Some("units"));
        assert_eq!(app_of_arguments("--app ../x"), None);
        assert_eq!(app_of_arguments("--app"), None);
        assert_eq!(app_of_arguments(""), None);
    }
}
