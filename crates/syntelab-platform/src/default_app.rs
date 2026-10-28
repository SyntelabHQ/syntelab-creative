//! The program as an app that opens PDF files: it shows in "Open with" and in
//! the system's settings of default apps, where the user can choose it.
//!
//! Windows does not let a program make itself the default: it is registered
//! (for the user alone, `HKEY_CURRENT_USER`, no administrator rights), the
//! user chooses it in Settings, and the program reads whether they did. The
//! user's choice (`UserChoice`) is only read, never written.
//!
//! What is written, under `Software`:
//! - `Classes\SyntelabCreative.pdf`: the kind of file, its icon (PDF Organizer's) and how it opens (the program with
//!   the file);
//! - `Classes\.pdf\OpenWithProgids`, value `SyntelabCreative.pdf`: offered in "Open with";
//! - `SyntelabCreative\Capabilities`: the program's name, what it does, and that it opens `.pdf`;
//! - `RegisteredApplications`, value `SyntelabCreative`: where those capabilities are.
//!
//! Other systems: not yet.

use std::fmt;
use std::path::{Path, PathBuf};

/// The kind of file the program registers for PDF files.
pub const PROG_ID: &str = "SyntelabCreative.pdf";

/// The name the program is registered by among the apps that can be defaults
/// (`registeredAppUser=` of the settings page).
pub const REGISTERED_NAME: &str = "SyntelabCreative";

/// What the settings of default apps show.
#[cfg_attr(not(windows), allow(dead_code))]
const APP_NAME: &str = "Syntelab Creative";
#[cfg_attr(not(windows), allow(dead_code))]
const APP_DESCRIPTION: &str = "View, organize, edit and sign PDFs with PDF Organizer.";
/// What Explorer calls a PDF file when this program opens it.
#[cfg_attr(not(windows), allow(dead_code))]
const TYPE_NAME: &str = "PDF Document";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DefaultAppError {
    /// This system has no such registration this program can make yet.
    Unsupported,
    Failed(String),
}

impl fmt::Display for DefaultAppError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(formatter, "default apps are not supported on this system"),
            Self::Failed(reason) => write!(formatter, "{reason}"),
        }
    }
}

impl std::error::Error for DefaultAppError {}

/// Where the keys are kept: `Software` in the user's part of the registry.
/// Another place can be named, for tests that must not touch it. The user's
/// choice is always read from the real place.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppPlace(String);

impl Default for AppPlace {
    fn default() -> Self {
        Self("Software".to_owned())
    }
}

impl AppPlace {
    pub fn under(key: &str) -> Self {
        Self(key.trim_matches('\\').to_owned())
    }
}

#[cfg_attr(not(windows), allow(dead_code))]
impl AppPlace {
    /// The kind of file.
    fn prog_id(&self) -> String {
        format!(r"{}\Classes\{PROG_ID}", self.0)
    }

    /// The kinds of files offered in "Open with" for `.pdf`.
    fn open_with(&self) -> String {
        format!(r"{}\Classes\.pdf\OpenWithProgids", self.0)
    }

    /// The program's own key; its capabilities are under it.
    fn program(&self) -> String {
        format!(r"{}\{REGISTERED_NAME}", self.0)
    }

    fn capabilities(&self) -> String {
        format!(r"{}\Capabilities", self.program())
    }

    /// Names the program and where its capabilities are (without the hive).
    fn registered_applications(&self) -> String {
        format!(r"{}\RegisteredApplications", self.0)
    }
}

/// True on a system where the program can register as a default app.
pub fn is_supported() -> bool {
    cfg!(windows)
}

/// Where the user's choice for `.pdf` is read, newest way first: Windows 11 may keep it in `UserChoiceLatest`
/// (its `ProgId` key, or the key itself), else it is in `UserChoice`. Each is a key and the name of a value.
#[cfg_attr(not(windows), allow(dead_code))]
fn choice_places() -> [(String, &'static str); 3] {
    let base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf";
    [(format!(r"{base}\UserChoiceLatest\ProgId"), "ProgId"), (format!(r"{base}\UserChoiceLatest"), "ProgId"), (format!(r"{base}\UserChoice"), "ProgId")]
}

/// True when the kind of file the user chose is this program's.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_ours(chosen: &str) -> bool {
    chosen.trim().eq_ignore_ascii_case(PROG_ID)
}

/// What opens a PDF: the program with the file, as when a file is opened from the file manager (`launch.rs`).
#[cfg_attr(not(windows), allow(dead_code))]
fn open_command(program: &Path) -> String {
    format!("\"{}\" \"%1\"", program.to_string_lossy().replace('"', ""))
}

/// The icon: the program's own.
#[cfg_attr(not(windows), allow(dead_code))]
fn icon_of(program: &Path) -> String {
    format!("\"{}\",0", program.to_string_lossy().replace('"', ""))
}

/// The icon of PDF files, installed beside the program: a white page with PDF Organizer's icon on it
/// (`icons\apps\pdf-organizer-file.ico`), else PDF Organizer's own icon, else the program's.
#[cfg_attr(not(windows), allow(dead_code))]
fn file_icon_of(program: &Path) -> String {
    let installed = program.parent().and_then(|folder| [pdf_file_icon(folder), pdf_organizer_icon(folder)].into_iter().find(|icon| icon.is_file()));
    match installed {
        Some(icon) => format!("\"{}\",0", icon.to_string_lossy().replace('"', "")),
        None => icon_of(program),
    }
}

/// Where the icon of PDF files is installed, in the program's folder.
#[cfg_attr(not(windows), allow(dead_code))]
fn pdf_file_icon(folder: &Path) -> PathBuf {
    folder.join("icons").join("apps").join("pdf-organizer-file.ico")
}

/// Where PDF Organizer's icon is installed, in the program's folder.
#[cfg_attr(not(windows), allow(dead_code))]
fn pdf_organizer_icon(folder: &Path) -> PathBuf {
    folder.join("icons").join("apps").join("pdf-organizer.ico")
}

/// The program a command starts: what is between its first quotes.
#[cfg_attr(not(windows), allow(dead_code))]
fn program_of(line: &str) -> Option<PathBuf> {
    let rest = line.strip_prefix('"')?;
    rest.split_once('"').map(|(program, _)| PathBuf::from(program))
}

/// The page of Settings where the user makes the program a default: its own page on Windows 11 (build 22000 and
/// later), the list of default apps on Windows 10.
pub fn settings_uri_for(build: Option<u32>) -> String {
    match build {
        Some(build) if build >= 22000 => format!("ms-settings:defaultapps?registeredAppUser={REGISTERED_NAME}"),
        _ => "ms-settings:defaultapps".to_owned(),
    }
}

/// The page of Settings for this system (see `settings_uri_for`).
pub fn settings_uri() -> String {
    settings_uri_for(imp::windows_build())
}

/// Registers the program, at `program`, as an app that opens PDF files. Writes everything again.
pub fn register(place: &AppPlace, program: &Path) -> Result<(), DefaultAppError> {
    imp::register(place, program)
}

/// Takes out everything `register` wrote. The user's choice is left as it is.
pub fn unregister(place: &AppPlace) -> Result<(), DefaultAppError> {
    imp::unregister(place)
}

/// The program PDF files open with, as registered; none when it is not registered, or only in part.
pub fn registered_program(place: &AppPlace) -> Option<PathBuf> {
    imp::registered_program(place)
}

/// True when the program is registered from `program`, with what this version writes (the icon of PDF files too).
pub fn is_registered_as(place: &AppPlace, program: &Path) -> bool {
    imp::is_registered_as(place, program)
}

/// True when the user chose this program for PDF files.
pub fn is_default() -> bool {
    imp::is_default()
}

#[cfg(not(windows))]
mod imp {
    use super::{AppPlace, DefaultAppError};
    use std::path::{Path, PathBuf};

    pub fn register(_place: &AppPlace, _program: &Path) -> Result<(), DefaultAppError> {
        Err(DefaultAppError::Unsupported)
    }

    pub fn unregister(_place: &AppPlace) -> Result<(), DefaultAppError> {
        Err(DefaultAppError::Unsupported)
    }

    pub fn registered_program(_place: &AppPlace) -> Option<PathBuf> {
        None
    }

    pub fn is_registered_as(_place: &AppPlace, _program: &Path) -> bool {
        false
    }

    pub fn is_default() -> bool {
        false
    }

    pub fn windows_build() -> Option<u32> {
        None
    }
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteKeyValueW, RegDeleteTreeW, RegGetValueW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RRF_RT_REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    use super::{choice_places, file_icon_of, icon_of, is_ours, open_command, program_of, AppPlace, DefaultAppError, APP_DESCRIPTION, APP_NAME, PROG_ID, REGISTERED_NAME, TYPE_NAME};

    fn failed(error: windows::core::Error) -> DefaultAppError {
        DefaultAppError::Failed(error.message())
    }

    /// A key of the registry, closed when it is let go.
    struct Key(HKEY);

    impl Drop for Key {
        fn drop(&mut self) {
            // SAFETY: the handle came from a function that opens a key and is closed once.
            let _ = unsafe { RegCloseKey(self.0) };
        }
    }

    impl Key {
        /// The key at `path` under the user's part of the registry, made when it is not there.
        fn made(path: &str) -> Result<Self, DefaultAppError> {
            let mut key = HKEY::default();
            // SAFETY: the path is a valid wide string; the key is closed by `Drop`.
            unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None) }.ok().map_err(failed)?;
            Ok(Self(key))
        }

        /// Writes a text under `name`; the key's own text when `name` is empty.
        fn set(&self, name: &str, text: &str) -> Result<(), DefaultAppError> {
            // Text is kept as wide letters with a zero after them, counted in bytes.
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
            // SAFETY: name and data are valid for the call.
            unsafe { RegSetValueExW(self.0, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) }.ok().map_err(failed)
        }
    }

    /// The text of a value; the key's own text when `name` is empty. None when it is not there.
    fn text(root: HKEY, path: &str, name: &str) -> Option<String> {
        let mut buffer = [0u16; 2048];
        let mut size = (buffer.len() * 2) as u32;
        // SAFETY: the buffer and its size in bytes are valid for the call.
        unsafe { RegGetValueW(root, &HSTRING::from(path), &HSTRING::from(name), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)) }.ok().ok()?;
        let length = (size as usize / 2).saturating_sub(1);
        Some(String::from_utf16_lossy(&buffer[..length]))
    }

    /// Explorer is told that what it shows for files has changed.
    fn tell_explorer() {
        // SAFETY: a notification with no items.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

    /// Takes a key out, with all under it. One that is not there is as gone as one that was taken out.
    fn remove(path: &str) -> Result<(), DefaultAppError> {
        // SAFETY: the path is a valid wide string.
        let deleted = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(path)) };
        if deleted == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        deleted.ok().map_err(failed)
    }

    /// Takes one value out of a key; the key and its other values stay.
    fn remove_value(path: &str, name: &str) -> Result<(), DefaultAppError> {
        // SAFETY: path and name are valid wide strings.
        let deleted = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, &HSTRING::from(path), &HSTRING::from(name)) };
        if deleted == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        deleted.ok().map_err(failed)
    }

    pub fn register(place: &AppPlace, program: &Path) -> Result<(), DefaultAppError> {
        let prog_id = place.prog_id();
        let kind = Key::made(&prog_id)?;
        kind.set("", TYPE_NAME)?;
        Key::made(&format!(r"{prog_id}\DefaultIcon"))?.set("", &file_icon_of(program))?;
        Key::made(&format!(r"{prog_id}\shell\open\command"))?.set("", &open_command(program))?;
        Key::made(&place.open_with())?.set(PROG_ID, "")?;

        let capabilities = place.capabilities();
        let about = Key::made(&capabilities)?;
        about.set("ApplicationName", APP_NAME)?;
        about.set("ApplicationDescription", APP_DESCRIPTION)?;
        about.set("ApplicationIcon", &icon_of(program))?;
        Key::made(&format!(r"{capabilities}\FileAssociations"))?.set(".pdf", PROG_ID)?;
        Key::made(&place.registered_applications())?.set(REGISTERED_NAME, &capabilities)?;
        tell_explorer();
        Ok(())
    }

    pub fn unregister(place: &AppPlace) -> Result<(), DefaultAppError> {
        remove_value(&place.registered_applications(), REGISTERED_NAME)?;
        remove(&place.program())?;
        remove_value(&place.open_with(), PROG_ID)?;
        remove(&place.prog_id())?;
        tell_explorer();
        Ok(())
    }

    pub fn registered_program(place: &AppPlace) -> Option<PathBuf> {
        // Registered in full: the program is named among the apps too.
        text(HKEY_CURRENT_USER, &place.registered_applications(), REGISTERED_NAME)?;
        text(HKEY_CURRENT_USER, &format!(r"{}\FileAssociations", place.capabilities()), ".pdf")?;
        program_of(&text(HKEY_CURRENT_USER, &format!(r"{}\shell\open\command", place.prog_id()), "")?)
    }

    pub fn is_registered_as(place: &AppPlace, program: &Path) -> bool {
        registered_program(place).as_deref() == Some(program)
            && text(HKEY_CURRENT_USER, &format!(r"{}\DefaultIcon", place.prog_id()), "").as_deref() == Some(file_icon_of(program).as_str())
    }

    pub fn is_default() -> bool {
        choice_places().iter().find_map(|(path, name)| text(HKEY_CURRENT_USER, path, name)).is_some_and(|chosen| is_ours(&chosen))
    }

    pub fn windows_build() -> Option<u32> {
        text(HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows NT\CurrentVersion", "CurrentBuildNumber")?.trim().parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_its_keys_in_the_users_software() {
        let place = AppPlace::default();
        assert_eq!(place.prog_id(), r"Software\Classes\SyntelabCreative.pdf");
        assert_eq!(place.open_with(), r"Software\Classes\.pdf\OpenWithProgids");
        assert_eq!(place.program(), r"Software\SyntelabCreative");
        assert_eq!(place.capabilities(), r"Software\SyntelabCreative\Capabilities");
        assert_eq!(place.registered_applications(), r"Software\RegisteredApplications");
        // A place for tests.
        assert_eq!(AppPlace::under(r"\Software\Tests\1\").prog_id(), r"Software\Tests\1\Classes\SyntelabCreative.pdf");
    }

    #[test]
    fn reads_the_users_choice_newest_way_first() {
        let places = choice_places();
        let base = r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf";
        assert_eq!(places[0], (format!(r"{base}\UserChoiceLatest\ProgId"), "ProgId"));
        assert_eq!(places[1], (format!(r"{base}\UserChoiceLatest"), "ProgId"));
        assert_eq!(places[2], (format!(r"{base}\UserChoice"), "ProgId"));
        assert!(is_ours("SyntelabCreative.pdf"));
        assert!(is_ours("syntelabcreative.PDF "));
        assert!(!is_ours("Acrobat.Document.DC"));
        assert!(!is_ours("SyntelabCreative.pdf.x"));
    }

    #[test]
    fn opens_the_file_with_the_program_alone() {
        let program = Path::new(r"C:\Users\Ana\AppData\Local\Syntelab Creative\syntelab-creative.exe");
        let line = open_command(program);
        assert_eq!(line, r#""C:\Users\Ana\AppData\Local\Syntelab Creative\syntelab-creative.exe" "%1""#);
        assert_eq!(program_of(&line).as_deref(), Some(program));
        assert_eq!(icon_of(program), r#""C:\Users\Ana\AppData\Local\Syntelab Creative\syntelab-creative.exe",0"#);
    }

    #[test]
    fn gives_pdf_files_the_icon_of_pdf_organizer_when_it_is_installed() {
        let folder = std::env::temp_dir().join(format!("syntelab-file-icon-{}", std::process::id()));
        let program = folder.join("syntelab-creative.exe");
        // Not installed beside the program: the program's own icon.
        assert_eq!(file_icon_of(&program), icon_of(&program));
        let icon = pdf_organizer_icon(&folder);
        std::fs::create_dir_all(icon.parent().unwrap()).unwrap();
        std::fs::write(&icon, b"icon").unwrap();
        assert_eq!(file_icon_of(&program), format!("\"{}\",0", icon.to_string_lossy()));
        // The icon made for PDF files comes first: a white page, not the app's coloured square.
        let page = pdf_file_icon(&folder);
        std::fs::write(&page, b"icon").unwrap();
        assert_eq!(file_icon_of(&program), format!("\"{}\",0", page.to_string_lossy()));
        std::fs::remove_dir_all(&folder).unwrap();
    }

    #[test]
    fn opens_the_programs_own_page_of_settings_on_windows_11() {
        assert_eq!(settings_uri_for(Some(22631)), "ms-settings:defaultapps?registeredAppUser=SyntelabCreative");
        assert_eq!(settings_uri_for(Some(22000)), "ms-settings:defaultapps?registeredAppUser=SyntelabCreative");
        assert_eq!(settings_uri_for(Some(19045)), "ms-settings:defaultapps");
        assert_eq!(settings_uri_for(None), "ms-settings:defaultapps");
    }
}
