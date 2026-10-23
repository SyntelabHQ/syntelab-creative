use std::path::Path;

/// The kinds of office documents, by the program that opens them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeKind {
    /// Word, Writer: letters, reports.
    Text,
    /// Excel, Calc: tables.
    Sheet,
    /// PowerPoint, Impress: slides.
    Slides,
}

const TEXT: &[&str] = &["docx", "doc", "docm", "dotx", "dot", "rtf", "odt", "ott", "wps"];
const SHEET: &[&str] = &["xlsx", "xls", "xlsm", "xlsb", "xltx", "xlt", "ods", "ots"];
const SLIDES: &[&str] = &["pptx", "ppt", "pptm", "ppsx", "pps", "potx", "pot", "odp", "otp"];

/// The kind of office document a file is, by its name. `None` for anything else.
pub fn office_kind(path: &Path) -> Option<OfficeKind> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    let is_in = |list: &[&str]| list.contains(&extension.as_str());
    if is_in(TEXT) {
        Some(OfficeKind::Text)
    } else if is_in(SHEET) {
        Some(OfficeKind::Sheet)
    } else if is_in(SLIDES) {
        Some(OfficeKind::Slides)
    } else {
        None
    }
}

/// Every file name ending an office suite is asked to open.
pub fn office_extensions() -> impl Iterator<Item = &'static str> {
    TEXT.iter().chain(SHEET).chain(SLIDES).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_office_documents_by_their_names() {
        assert_eq!(office_kind(Path::new("C:/a/Report.DOCX")), Some(OfficeKind::Text));
        assert_eq!(office_kind(Path::new("budget.xlsx")), Some(OfficeKind::Sheet));
        assert_eq!(office_kind(Path::new("talk.odp")), Some(OfficeKind::Slides));
        assert_eq!(office_kind(Path::new("scan.pdf")), None);
        assert_eq!(office_kind(Path::new("docx")), None);
        assert!(office_extensions().any(|extension| extension == "rtf"));
    }
}
