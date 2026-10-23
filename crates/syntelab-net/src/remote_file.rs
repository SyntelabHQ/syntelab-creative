/// A static file on syntelab.com that the program may read (see `remote/`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RemoteFile {
    /// The newest version of the program and where to get it.
    Update,
    /// What is new, in one language: program changes and announcements.
    Changelog { language: String },
}

impl RemoteFile {
    /// The file a name stands for; callers outside Rust choose files by name:
    /// `update`, or `changelog/<language>` such as `changelog/pt-BR`.
    pub fn from_name(name: &str) -> Option<Self> {
        if name == "update" {
            return Some(Self::Update);
        }
        let language = name.strip_prefix("changelog/")?;
        is_language_code(language).then(|| Self::Changelog { language: language.to_owned() })
    }

    /// Where the file is published.
    pub fn url(&self) -> String {
        match self {
            Self::Update => "https://syntelab.com/creative/check/update.json".to_owned(),
            Self::Changelog { language } => format!("https://syntelab.com/creative/check/changelog/{language}.json"),
        }
    }
}

/// A language code as the program names its languages: `ro`, `fil`, `zh-TW`.
/// Nothing else can become part of an address.
fn is_language_code(code: &str) -> bool {
    let (base, region) = match code.split_once('-') {
        Some((base, region)) => (base, Some(region)),
        None => (code, None),
    };
    (2..=3).contains(&base.len())
        && base.bytes().all(|byte| byte.is_ascii_lowercase())
        && region.is_none_or(|region| region.len() == 2 && region.bytes().all(|byte| byte.is_ascii_uppercase()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::is_allowed;

    #[test]
    fn knows_its_files_by_name() {
        assert_eq!(RemoteFile::from_name("update"), Some(RemoteFile::Update));
        assert_eq!(
            RemoteFile::from_name("changelog/pt-BR").map(|file| file.url()),
            Some("https://syntelab.com/creative/check/changelog/pt-BR.json".to_owned())
        );
        for name in ["changelog", "changelog/", "changelog/../update", "changelog/EN", "changelog/en-us", "changelog/en/x", "https://example.com/"] {
            assert_eq!(RemoteFile::from_name(name), None, "{name}");
        }
    }

    #[test]
    fn every_file_is_at_an_allowed_address() {
        for file in [RemoteFile::Update, RemoteFile::Changelog { language: "en".to_owned() }] {
            assert!(is_allowed(&file.url()), "{} is not allowed", file.url());
        }
    }
}
