//! The fonts installed on the computer: their names and where their files
//! are, so text can be written in them and they need not ship with the suite.
//!
//! The names are read from the font files themselves, in the folders each
//! system keeps fonts in. No other program is asked.

use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// One installed font file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InstalledFont {
    /// The name people know it by: `Arial`, `Segoe UI Light`.
    pub family: String,
    pub bold: bool,
    pub italic: bool,
    pub file: PathBuf,
}

/// Folders are looked into this deep (Linux keeps fonts in folders within folders).
const MAX_DEPTH: usize = 4;
/// A name table larger than this is not a real one.
const MAX_NAME_TABLE: u32 = 512 * 1024;

/// The fonts of the computer, sorted by name. Empty where none can be read
/// (the caller then offers its built-in fonts only).
pub fn installed_fonts() -> Vec<InstalledFont> {
    let mut fonts = Vec::new();
    for folder in font_folders() {
        collect(&folder, MAX_DEPTH, &mut fonts);
    }
    fonts.sort_by(|a, b| a.family.to_lowercase().cmp(&b.family.to_lowercase()).then(a.bold.cmp(&b.bold)).then(a.italic.cmp(&b.italic)));
    fonts.dedup_by(|a, b| a.family == b.family && a.bold == b.bold && a.italic == b.italic);
    fonts
}

/// The file of the font of that name and style; a family without that style
/// gives its plain one.
pub fn font_file<'a>(fonts: &'a [InstalledFont], family: &str, bold: bool, italic: bool) -> Option<&'a InstalledFont> {
    let of_family = || fonts.iter().filter(|font| font.family.eq_ignore_ascii_case(family));
    of_family()
        .find(|font| font.bold == bold && font.italic == italic)
        .or_else(|| of_family().find(|font| !font.bold && !font.italic))
        .or_else(|| of_family().next())
}

fn font_folders() -> Vec<PathBuf> {
    let from = |variable: &str, rest: &str| std::env::var_os(variable).map(|root| PathBuf::from(root).join(rest));
    let folders: Vec<Option<PathBuf>> = if cfg!(target_os = "windows") {
        // Fonts for everyone, then the ones this user installed for themselves.
        vec![from("WINDIR", "Fonts").or_else(|| Some(PathBuf::from("C:\\Windows\\Fonts"))), from("LOCALAPPDATA", "Microsoft\\Windows\\Fonts")]
    } else if cfg!(target_os = "macos") {
        vec![Some("/System/Library/Fonts".into()), Some("/Library/Fonts".into()), from("HOME", "Library/Fonts")]
    } else {
        vec![Some("/usr/share/fonts".into()), Some("/usr/local/share/fonts".into()), from("HOME", ".fonts"), from("HOME", ".local/share/fonts")]
    };
    folders.into_iter().flatten().collect()
}

fn collect(folder: &Path, depth: usize, fonts: &mut Vec<InstalledFont>) {
    let Ok(entries) = fs::read_dir(folder) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if depth > 0 {
                collect(&path, depth - 1, fonts);
            }
            continue;
        }
        let single_font = path.extension().and_then(|ending| ending.to_str()).is_some_and(|ending| ending.eq_ignore_ascii_case("ttf") || ending.eq_ignore_ascii_case("otf"));
        if !single_font {
            continue;
        }
        if let Some((family, bold, italic)) = File::open(&path).ok().and_then(|mut file| read_names(&mut file)) {
            fonts.push(InstalledFont { family, bold, italic, file: path });
        }
    }
}

/// The family of a font file and whether it is the bold or the italic one,
/// read from the tables at the start of the file. `None` for a file that is
/// not a font, or names no family.
fn read_names(file: &mut (impl Read + Seek)) -> Option<(String, bool, bool)> {
    let mut start = [0u8; 12];
    file.read_exact(&mut start).ok()?;
    let table_count = usize::from(u16::from_be_bytes([start[4], start[5]]));
    let mut tables = vec![0u8; table_count.min(64) * 16];
    file.read_exact(&mut tables).ok()?;
    let table = |tag: &[u8; 4]| {
        tables.chunks_exact(16).find(|record| &record[..4] == tag).map(|record| {
            (u32::from_be_bytes([record[8], record[9], record[10], record[11]]), u32::from_be_bytes([record[12], record[13], record[14], record[15]]))
        })
    };

    // "head" says, in two bits, whether the font is bold and whether it is italic.
    let (head_at, _) = table(b"head")?;
    let mut style = [0u8; 2];
    file.seek(SeekFrom::Start(u64::from(head_at) + 44)).ok()?;
    file.read_exact(&mut style).ok()?;
    let (bold, italic) = (style[1] & 1 != 0, style[1] & 2 != 0);

    let (name_at, name_length) = table(b"name")?;
    if name_length > MAX_NAME_TABLE {
        return None;
    }
    let mut names = vec![0u8; name_length as usize];
    file.seek(SeekFrom::Start(u64::from(name_at))).ok()?;
    file.read_exact(&mut names).ok()?;
    family_name(&names).map(|family| (family, bold, italic))
}

/// The family name in a font's table of names: the English one written for
/// Windows where there is one, else the first that can be read.
fn family_name(names: &[u8]) -> Option<String> {
    let number = |at: usize| names.get(at..at + 2).map(|bytes| usize::from(u16::from_be_bytes([bytes[0], bytes[1]])));
    let count = number(2)?;
    let strings_at = number(4)?;
    let mut fallback = None;
    for index in 0..count {
        let record = 6 + index * 12;
        let (platform, language, name_id) = (number(record)?, number(record + 4)?, number(record + 6)?);
        // 1 is the family as lists of fonts show it.
        if name_id != 1 {
            continue;
        }
        let start = strings_at + number(record + 10)?;
        let Some(bytes) = names.get(start..start + number(record + 8)?) else {
            continue;
        };
        let text = if platform == 3 || platform == 0 {
            // Two bytes a letter, the high one first.
            String::from_utf16_lossy(&bytes.chunks_exact(2).map(|pair| u16::from_be_bytes([pair[0], pair[1]])).collect::<Vec<_>>())
        } else {
            bytes.iter().map(|byte| char::from(*byte)).collect()
        };
        let text = text.trim().to_owned();
        if text.is_empty() {
            continue;
        }
        if platform == 3 && language == 0x409 {
            return Some(text);
        }
        fallback.get_or_insert(text);
    }
    fallback
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    /// A font file with just the two tables that are read.
    fn font_bytes(family: &str, style_bits: u8) -> Vec<u8> {
        let letters: Vec<u8> = family.encode_utf16().flat_map(u16::to_be_bytes).collect();
        // The table of names: one record, for Windows, in English, the family.
        let mut names = vec![0, 0, 0, 1, 0, 18];
        for number in [3u16, 1, 0x409, 1, letters.len() as u16, 0] {
            names.extend(number.to_be_bytes());
        }
        names.extend(&letters);
        let mut head = vec![0u8; 54];
        head[45] = style_bits;

        let mut file = vec![0, 1, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0];
        let (head_at, name_at) = (12 + 32, 12 + 32 + head.len());
        for (tag, at, length) in [(b"head", head_at, head.len()), (b"name", name_at, names.len())] {
            file.extend(tag);
            file.extend([0; 4]);
            file.extend((at as u32).to_be_bytes());
            file.extend((length as u32).to_be_bytes());
        }
        file.extend(head);
        file.extend(names);
        file
    }

    #[test]
    fn reads_the_family_and_style_from_a_font_file() {
        assert_eq!(read_names(&mut Cursor::new(font_bytes("Arial", 0))), Some(("Arial".into(), false, false)));
        assert_eq!(read_names(&mut Cursor::new(font_bytes("Segoe UI Light", 2))), Some(("Segoe UI Light".into(), false, true)));
        assert_eq!(read_names(&mut Cursor::new(font_bytes("Ștefan Sans", 3))), Some(("Ștefan Sans".into(), true, true)));
        // Not a font.
        assert_eq!(read_names(&mut Cursor::new(b"%PDF-1.7 not a font at all, just some bytes".to_vec())), None);
        assert_eq!(read_names(&mut Cursor::new(Vec::new())), None);
    }

    #[test]
    fn finds_the_file_of_a_style_or_the_plain_one() {
        let font = |family: &str, bold, italic, file: &str| InstalledFont { family: family.into(), bold, italic, file: file.into() };
        let fonts = [font("Arial", false, false, "arial.ttf"), font("Arial", true, false, "arialbd.ttf"), font("Impact", false, false, "impact.ttf")];
        assert_eq!(font_file(&fonts, "arial", true, false).map(|font| font.file.as_path()), Some(Path::new("arialbd.ttf")));
        assert_eq!(font_file(&fonts, "Impact", true, true).map(|font| font.file.as_path()), Some(Path::new("impact.ttf")));
        assert!(font_file(&fonts, "Nothing", false, false).is_none());
    }
}
