//! Entries in the right-click menu of the system's file manager: "Convert to
//! PDF with PDF Organizer" on files in Windows Explorer.
//!
//! An entry stands in the menu by itself, or opens to the side from one that
//! gathers the entries of an app ("Syntelab Dev" > "Checksums"). Every key
//! written is named `SyntelabCreative` or starts with `SyntelabCreative.`:
//! whatever an earlier version wrote, and on whatever kind of file, is found
//! by that name and taken out before the entries are written again, and when
//! the menu is turned off.
//!
//! On Windows they are written for the user alone (`HKEY_CURRENT_USER`), so
//! no administrator rights are asked. They show in the classic menu: at once
//! on Windows 10, under "Show more options" on Windows 11 (the short menu of
//! Windows 11 takes entries only from packaged programs; that comes with the
//! Microsoft Store variant). Other systems: not yet.

use std::fmt;
use std::path::{Path, PathBuf};

/// One entry of the menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuEntry {
    /// Tells it apart from every other entry: `pdf-organizer.combine-to-pdf`.
    pub id: String,
    /// What the menu shows, in the user's language.
    pub label: String,
    /// What the program is started with, before the file that was clicked.
    pub arguments: Vec<String>,
    /// What it shows on: kinds of files, each as an ending with its dot (`.pdf`); `*` for files of every kind;
    /// `folder` for folders.
    pub file_types: Vec<String>,
    /// Shown beside it when it stands by itself: an `.ico` file, or a program and the number of an icon in it
    /// (`"C:\…\x.exe",0`).
    pub icon: Option<String>,
    /// The entry it opens from, to the side; none: it stands in the menu by itself.
    pub group: Option<MenuGroup>,
}

/// An entry that gathers others, which open to its side.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuGroup {
    /// Tells it apart from the other groups and entries: `dev`.
    pub id: String,
    pub label: String,
    /// As for an entry.
    pub icon: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MenuError {
    /// This system has no such menu this program can add to yet.
    Unsupported,
    Failed(String),
}

impl fmt::Display for MenuError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unsupported => write!(formatter, "the file manager's menu is not supported on this system"),
            Self::Failed(reason) => write!(formatter, "{reason}"),
        }
    }
}

impl std::error::Error for MenuError {}

/// Where the entries are kept: the user's own part of the registry on
/// Windows. Another place can be named, for tests that must not touch it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MenuPlace(String);

impl Default for MenuPlace {
    fn default() -> Self {
        Self(r"Software\Classes".to_owned())
    }
}

impl MenuPlace {
    /// A place of one's own under the user's part of the registry.
    pub fn under(key: &str) -> Self {
        Self(key.trim_matches('\\').to_owned())
    }
}

/// True on a system whose file manager's menu this program can add to.
pub fn is_supported() -> bool {
    cfg!(windows)
}

/// What the name of every key this program writes in a menu is or starts with (`SyntelabCreative.dev`). Version 1.0
/// gathered every entry under a key of this very name.
#[cfg_attr(not(windows), allow(dead_code))]
const OURS: &str = "SyntelabCreative";

/// True for the name of a key this program wrote in a menu, in this version or an earlier one.
#[cfg_attr(not(windows), allow(dead_code))]
fn is_ours(name: &str) -> bool {
    name == OURS || name.strip_prefix(OURS).is_some_and(|rest| rest.starts_with('.'))
}

/// Names are plain letters: nothing that could lead elsewhere in the registry.
fn plain(text: &str) -> bool {
    !text.is_empty() && text.chars().all(|letter| letter.is_ascii_alphanumeric() || matches!(letter, '-' | '_' | '.'))
}

/// Where the menu of one kind of thing is kept: files of an ending, files of every kind, folders.
fn kind_key(place: &MenuPlace, kind: &str) -> Option<String> {
    match kind {
        "*" => Some(format!(r"{}\*", place.0)),
        "folder" => Some(format!(r"{}\Directory", place.0)),
        _ => {
            // An ending is a dot and plain letters.
            let ending = kind.strip_prefix('.')?;
            (plain(ending) && !ending.contains('.')).then(|| format!(r"{}\SystemFileAssociations\.{}", place.0, ending.to_ascii_lowercase()))
        }
    }
}

/// The key of an entry that stands by itself, or of a group, on one kind of thing.
#[cfg_attr(not(windows), allow(dead_code))]
fn item_key(place: &MenuPlace, kind: &str, id: &str) -> Option<String> {
    kind_key(place, kind).filter(|_| plain(id)).map(|key| format!(r"{key}\shell\{OURS}.{id}"))
}

/// The key of an entry as it is kept: under its group, or by itself.
#[cfg_attr(not(windows), allow(dead_code))]
fn entry_key(place: &MenuPlace, kind: &str, entry: &MenuEntry) -> Option<String> {
    match &entry.group {
        Some(group) => item_key(place, kind, &group.id).filter(|_| plain(&entry.id)).map(|key| format!(r"{key}\shell\{}", entry.id)),
        None => item_key(place, kind, &entry.id),
    }
}

/// What the menu of one kind of thing holds: entries by themselves, and groups with the entries under them.
#[derive(Debug, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
enum Item<'a> {
    Alone(&'a MenuEntry),
    Group(&'a MenuGroup, Vec<&'a MenuEntry>),
}

/// What is shown on each kind of thing, in the order the kinds are first named. Explorer shows one entry of a
/// name: on a file whose ending has a menu of its own, that one is shown and the one of every file is not. So
/// the menu of an ending holds the entries of every file too.
#[cfg_attr(not(windows), allow(dead_code))]
fn laid_out(entries: &[MenuEntry]) -> Vec<(String, Vec<Item<'_>>)> {
    let mut kinds: Vec<String> = Vec::new();
    for kind in entries.iter().flat_map(|entry| &entry.file_types) {
        let kind = kind.to_ascii_lowercase();
        if !kinds.contains(&kind) {
            kinds.push(kind);
        }
    }
    kinds
        .into_iter()
        .map(|kind| {
            let of_files = kind.starts_with('.');
            let mut items: Vec<Item<'_>> = Vec::new();
            for entry in entries.iter().filter(|entry| entry.file_types.iter().any(|known| known.eq_ignore_ascii_case(&kind) || (of_files && known == "*"))) {
                match &entry.group {
                    None => items.push(Item::Alone(entry)),
                    Some(group) => match items.iter_mut().find_map(|item| match item {
                        Item::Group(known, under) if known.id == group.id => Some(under),
                        _ => None,
                    }) {
                        Some(under) => under.push(entry),
                        None => items.push(Item::Group(group, vec![entry])),
                    },
                }
            }
            (kind, items)
        })
        .collect()
}

/// What Explorer runs for an entry: the program, the entry's arguments, the file.
#[cfg_attr(not(windows), allow(dead_code))]
fn command_line(program: &Path, arguments: &[String]) -> String {
    let quoted = |text: &str| format!("\"{}\"", text.replace('"', ""));
    let mut line = quoted(&program.to_string_lossy());
    for argument in arguments {
        line.push(' ');
        line.push_str(&quoted(argument));
    }
    line.push_str(" \"%1\"");
    line
}

/// The program a command line starts: what is between its first quotes.
#[cfg_attr(not(windows), allow(dead_code))]
fn program_of(line: &str) -> Option<PathBuf> {
    let rest = line.strip_prefix('"')?;
    rest.split_once('"').map(|(program, _)| PathBuf::from(program))
}

/// Puts the entries in the menu, each on its kinds of files; `program` is what they start. Whatever this program
/// had put there before, in this version or an earlier one, is taken out first.
pub fn register(place: &MenuPlace, program: &Path, entries: &[MenuEntry]) -> Result<(), MenuError> {
    imp::register(place, program, entries)
}

/// Takes out of the menu everything this program put there, in this version or an earlier one.
pub fn unregister(place: &MenuPlace) -> Result<(), MenuError> {
    imp::unregister(place)
}

/// True when anything this program puts in the menu is there, in this version's way or an earlier one's.
pub fn is_registered(place: &MenuPlace) -> bool {
    imp::is_registered(place)
}

/// True when every entry is in the menu, as this version keeps it, on each of its kinds of files: false after an
/// app has gained an entry since they were put there, or when an earlier version put them there.
pub fn all_registered(place: &MenuPlace, entries: &[MenuEntry]) -> bool {
    imp::all_registered(place, entries)
}

/// The program the first of the entries starts, as this version keeps it; none when it is not there so.
pub fn registered_program(place: &MenuPlace, entries: &[MenuEntry]) -> Option<PathBuf> {
    imp::registered_program(place, entries)
}

#[cfg(not(windows))]
mod imp {
    use super::{MenuEntry, MenuError, MenuPlace};
    use std::path::{Path, PathBuf};

    pub fn register(_place: &MenuPlace, _program: &Path, _entries: &[MenuEntry]) -> Result<(), MenuError> {
        Err(MenuError::Unsupported)
    }

    pub fn unregister(_place: &MenuPlace) -> Result<(), MenuError> {
        Err(MenuError::Unsupported)
    }

    pub fn is_registered(_place: &MenuPlace) -> bool {
        false
    }

    pub fn all_registered(_place: &MenuPlace, _entries: &[MenuEntry]) -> bool {
        false
    }

    pub fn registered_program(_place: &MenuPlace, _entries: &[MenuEntry]) -> Option<PathBuf> {
        None
    }
}

#[cfg(windows)]
mod imp {
    use std::path::{Path, PathBuf};

    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ,
        RRF_RT_REG_SZ,
    };
    use windows::Win32::UI::Shell::{SHChangeNotify, SHCNE_ASSOCCHANGED, SHCNF_IDLIST};

    use super::{command_line, entry_key, is_ours, item_key, laid_out, program_of, Item, MenuEntry, MenuError, MenuPlace};

    fn failed(error: windows::core::Error) -> MenuError {
        MenuError::Failed(error.message())
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
        fn made(path: &str) -> Result<Self, MenuError> {
            let mut key = HKEY::default();
            // SAFETY: the path is a valid wide string; the key is closed by `Drop`.
            unsafe { RegCreateKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), None, PCWSTR::null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, None, &mut key, None) }.ok().map_err(failed)?;
            Ok(Self(key))
        }

        /// The key at `path`, to read; none when it is not there.
        fn opened(path: &str) -> Option<Self> {
            let mut key = HKEY::default();
            // SAFETY: the path is a valid wide string; the key is closed by `Drop`.
            unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), None, KEY_READ, &mut key) }.ok().ok()?;
            Some(Self(key))
        }

        /// Writes a text under `name`; the key's own text when `name` is empty.
        fn set(&self, name: &str, text: &str) -> Result<(), MenuError> {
            // Text is kept as wide letters with a zero after them, counted in bytes.
            let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
            let bytes: Vec<u8> = wide.iter().flat_map(|unit| unit.to_le_bytes()).collect();
            // SAFETY: name and data are valid for the call.
            unsafe { RegSetValueExW(self.0, &HSTRING::from(name), None, REG_SZ, Some(&bytes)) }.ok().map_err(failed)
        }

        /// The names of the keys right under this one.
        fn names(&self) -> Vec<String> {
            let mut names = Vec::new();
            // Names of keys are at most 255 letters.
            let mut buffer = [0u16; 256];
            for index in 0.. {
                let mut length = buffer.len() as u32;
                // SAFETY: the buffer and its length are valid for the call.
                let found = unsafe { RegEnumKeyExW(self.0, index, Some(PWSTR(buffer.as_mut_ptr())), &mut length, None, None, None, None) };
                if found.is_err() {
                    break;
                }
                names.push(String::from_utf16_lossy(&buffer[..length as usize]));
            }
            names
        }
    }

    /// Explorer is told that what it shows for files has changed.
    fn tell_explorer() {
        // SAFETY: a notification with no items.
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }

    /// Takes a key out, with all under it. One that is not there is as gone as one that was taken out.
    fn remove(path: &str) -> Result<(), MenuError> {
        // SAFETY: the path is a valid wide string.
        let deleted = unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(path)) };
        if deleted == ERROR_FILE_NOT_FOUND {
            return Ok(());
        }
        deleted.ok().map_err(failed)
    }

    /// Every key this program wrote in a menu, in this version or an earlier one, on whatever kind of thing.
    fn ours(place: &MenuPlace) -> Vec<String> {
        let endings = Key::opened(&format!(r"{}\SystemFileAssociations", place.0)).map(|key| key.names()).unwrap_or_default();
        let kinds = [format!(r"{}\*", place.0), format!(r"{}\Directory", place.0)].into_iter().chain(endings.into_iter().map(|ending| format!(r"{}\SystemFileAssociations\{ending}", place.0)));
        kinds
            .flat_map(|kind| {
                let shell = format!(r"{kind}\shell");
                let names = Key::opened(&shell).map(|key| key.names()).unwrap_or_default();
                names.into_iter().filter(|name| is_ours(name)).map(move |name| format!(r"{shell}\{name}"))
            })
            .collect()
    }

    fn remove_ours(place: &MenuPlace) -> Result<(), MenuError> {
        ours(place).iter().try_for_each(|path| remove(path))
    }

    /// Writes an entry's label, icon and command at `path`.
    fn write_entry(path: &str, program: &Path, entry: &MenuEntry, icon: Option<&str>) -> Result<(), MenuError> {
        let key = Key::made(path)?;
        key.set("MUIVerb", &entry.label)?;
        if let Some(icon) = icon {
            key.set("Icon", icon)?;
        }
        // Several files chosen at once are handed over one by one; the program that is running gathers them.
        key.set("MultiSelectModel", "Player")?;
        Key::made(&format!(r"{path}\command"))?.set("", &command_line(program, &entry.arguments))
    }

    pub fn register(place: &MenuPlace, program: &Path, entries: &[MenuEntry]) -> Result<(), MenuError> {
        // Written anew: nothing an app no longer has, or an earlier version wrote, stays.
        remove_ours(place)?;
        for (kind, items) in laid_out(entries) {
            for item in items {
                match item {
                    Item::Alone(entry) => {
                        if let Some(path) = item_key(place, &kind, &entry.id) {
                            write_entry(&path, program, entry, entry.icon.as_deref())?;
                        }
                    }
                    Item::Group(group, under) => {
                        let Some(path) = item_key(place, &kind, &group.id) else {
                            continue;
                        };
                        let key = Key::made(&path)?;
                        key.set("MUIVerb", &group.label)?;
                        if let Some(icon) = &group.icon {
                            key.set("Icon", icon)?;
                        }
                        // Empty: the entries under it are the keys under its `shell`.
                        key.set("SubCommands", "")?;
                        for entry in under {
                            if let Some(path) = entry_key(place, &kind, entry) {
                                write_entry(&path, program, entry, None)?;
                            }
                        }
                    }
                }
            }
        }
        tell_explorer();
        Ok(())
    }

    pub fn unregister(place: &MenuPlace) -> Result<(), MenuError> {
        remove_ours(place)?;
        tell_explorer();
        Ok(())
    }

    pub fn is_registered(place: &MenuPlace) -> bool {
        !ours(place).is_empty()
    }

    pub fn all_registered(place: &MenuPlace, entries: &[MenuEntry]) -> bool {
        laid_out(entries).iter().all(|(kind, items)| {
            items.iter().flat_map(|item| match item {
                Item::Alone(entry) => vec![*entry],
                Item::Group(_, under) => under.clone(),
            })
            .all(|entry| entry_key(place, kind, entry).is_some_and(|path| Key::opened(&path).is_some()))
        })
    }

    pub fn registered_program(place: &MenuPlace, entries: &[MenuEntry]) -> Option<PathBuf> {
        let entry = entries.first()?;
        let path = entry_key(place, entry.file_types.first()?, entry)?;
        let key = Key::opened(&format!(r"{path}\command"))?;
        let mut buffer = [0u16; 2048];
        let mut size = (buffer.len() * 2) as u32;
        // SAFETY: the buffer and its size in bytes are valid for the call.
        unsafe { RegGetValueW(key.0, PCWSTR::null(), PCWSTR::null(), RRF_RT_REG_SZ, None, Some(buffer.as_mut_ptr().cast()), Some(&mut size)) }.ok().ok()?;
        let length = (size as usize / 2).saturating_sub(1);
        program_of(&String::from_utf16_lossy(&buffer[..length]))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, kinds: &[&str]) -> MenuEntry {
        MenuEntry { id: id.into(), label: id.into(), arguments: Vec::new(), file_types: kinds.iter().map(|kind| (*kind).to_owned()).collect(), icon: None, group: None }
    }

    fn grouped(id: &str, kinds: &[&str]) -> MenuEntry {
        MenuEntry { group: Some(MenuGroup { id: "dev".into(), label: "Syntelab Dev".into(), icon: None }), ..entry(id, kinds) }
    }

    #[test]
    fn keeps_each_entry_by_itself_or_under_its_group() {
        let place = MenuPlace::default();
        assert_eq!(
            entry_key(&place, ".PDF", &entry("pdf-organizer.combine-to-pdf", &[])).as_deref(),
            Some(r"Software\Classes\SystemFileAssociations\.pdf\shell\SyntelabCreative.pdf-organizer.combine-to-pdf")
        );
        // Files of every kind, and folders; under a group.
        assert_eq!(entry_key(&place, "*", &grouped("dev.checksum", &[])).as_deref(), Some(r"Software\Classes\*\shell\SyntelabCreative.dev\shell\dev.checksum"));
        assert_eq!(entry_key(&place, "folder", &grouped("dev.checksum", &[])).as_deref(), Some(r"Software\Classes\Directory\shell\SyntelabCreative.dev\shell\dev.checksum"));
        // Nothing that could lead elsewhere in the registry is taken.
        assert_eq!(entry_key(&place, "pdf", &entry("x", &[])), None);
        assert_eq!(entry_key(&place, r".pdf\shell", &entry("x", &[])), None);
        assert_eq!(entry_key(&place, ".pdf", &entry(r"x\y", &[])), None);
        assert_eq!(entry_key(&place, ".tar.gz", &entry("x", &[])), None);
        assert_eq!(entry_key(&place, "*.pdf", &entry("x", &[])), None);
        assert_eq!(entry_key(&place, "*", &grouped(r"x\y", &[])), None);
    }

    #[test]
    fn knows_the_keys_it_wrote_in_every_version() {
        // 1.0 gathered every entry under one key; earlier, each stood by itself.
        assert!(is_ours("SyntelabCreative"));
        assert!(is_ours("SyntelabCreative.dev"));
        assert!(is_ours("SyntelabCreative.pdf-organizer.combine-to-pdf"));
        assert!(!is_ours("SyntelabCreativeX"));
        assert!(!is_ours("Open"));
    }

    #[test]
    fn shows_on_an_ending_the_entries_of_every_file_too() {
        let entries = [entry("dev.open", &[".json", ".PDF"]), entry("dev.checksum", &["*", "folder"]), entry("pdf.combine", &[".pdf"])];
        fn ids<'a>(items: &[Item<'a>]) -> Vec<&'a str> {
            items
                .iter()
                .map(|item| match item {
                    Item::Alone(entry) => entry.id.as_str(),
                    Item::Group(group, _) => group.id.as_str(),
                })
                .collect()
        }
        let laid = laid_out(&entries);
        assert_eq!(laid.iter().map(|(kind, _)| kind.as_str()).collect::<Vec<_>>(), [".json", ".pdf", "*", "folder"]);
        assert_eq!(ids(&laid[0].1), ["dev.open", "dev.checksum"]);
        assert_eq!(ids(&laid[1].1), ["dev.open", "dev.checksum", "pdf.combine"]);
        assert_eq!(ids(&laid[2].1), ["dev.checksum"]);
        // What is of every file is not of folders unless it says so; what is of folders is not of files.
        assert_eq!(ids(&laid[3].1), ["dev.checksum"]);
        assert_eq!(ids(&laid_out(&[entry("a", &["*"]), entry("b", &["folder"])])[1].1), ["b"]);
    }

    #[test]
    fn gathers_the_entries_of_a_group_where_it_first_shows() {
        let entries = [entry("pdf.convert", &[".txt"]), grouped("dev.checksum", &["*"]), entry("pdf.combine", &[".txt"]), grouped("dev.hex", &["*"])];
        let laid = laid_out(&entries);
        let (kind, items) = &laid[0];
        assert_eq!(kind, ".txt");
        assert_eq!(items.len(), 3);
        assert_eq!(items[0], Item::Alone(&entries[0]));
        assert_eq!(items[1], Item::Group(entries[1].group.as_ref().unwrap(), vec![&entries[1], &entries[3]]));
        assert_eq!(items[2], Item::Alone(&entries[2]));
    }

    #[test]
    fn starts_the_program_with_the_entry_and_the_file() {
        let program = Path::new(r"C:\Program Files\Syntelab Creative\syntelab-creative.exe");
        let line = command_line(program, &["--app".into(), "pdf-organizer".into(), "--action".into(), "combine-to-pdf".into()]);
        assert_eq!(line, r#""C:\Program Files\Syntelab Creative\syntelab-creative.exe" "--app" "pdf-organizer" "--action" "combine-to-pdf" "%1""#);
        // And reads the program back from it.
        assert_eq!(program_of(&line).as_deref(), Some(program));
        assert_eq!(program_of("syntelab.exe %1"), None);
    }
}
