//! What some bytes are, told from how they start: a picture the web view can show, a PDF, text, or something else.
//!
//! Most kinds of files start with a few bytes of their own (the "magic"): that
//! is all that is looked at, so the kind of a file of any size is told at once.
//! What starts like none of them is text when it is UTF-8 with no zero byte in it.

/// How the interface can show bytes of a kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum View {
    /// A picture the web view draws (`<img>`).
    Picture,
    Pdf,
    Text,
    /// Nothing better than what kind it is, how large, and its first bytes.
    Other,
}

impl View {
    pub fn name(self) -> &'static str {
        match self {
            View::Picture => "picture",
            View::Pdf => "pdf",
            View::Text => "text",
            View::Other => "other",
        }
    }
}

/// What some bytes are.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Kind {
    pub view: View,
    /// Their media type, as the web view is told it.
    pub mime: &'static str,
    /// The name of their format, as it is known everywhere (`PNG`, `ZIP`); none for text, and for what is not known.
    pub format: Option<&'static str>,
}

/// How many bytes of the start are looked at.
pub const START: usize = 4096;

/// Kinds told by the bytes they start with: where those bytes are, the bytes, and the kind.
const MAGIC: &[(usize, &[u8], View, &str, &str)] = &[
    (0, b"\x89PNG\r\n\x1a\n", View::Picture, "image/png", "PNG"),
    (0, b"\xFF\xD8\xFF", View::Picture, "image/jpeg", "JPEG"),
    (0, b"GIF87a", View::Picture, "image/gif", "GIF"),
    (0, b"GIF89a", View::Picture, "image/gif", "GIF"),
    (0, b"\x00\x00\x01\x00", View::Picture, "image/x-icon", "ICO"),
    (0, b"%PDF-", View::Pdf, "application/pdf", "PDF"),
    (0, b"PK\x03\x04", View::Other, "application/zip", "ZIP"),
    (0, b"\x1F\x8B", View::Other, "application/gzip", "gzip"),
    (0, b"BZh", View::Other, "application/x-bzip2", "bzip2"),
    (0, b"\xFD7zXZ\x00", View::Other, "application/x-xz", "XZ"),
    (0, b"\x28\xB5\x2F\xFD", View::Other, "application/zstd", "Zstandard"),
    (0, b"7z\xBC\xAF\x27\x1C", View::Other, "application/x-7z-compressed", "7z"),
    (0, b"Rar!\x1A\x07", View::Other, "application/vnd.rar", "RAR"),
    (0, b"\x7FELF", View::Other, "application/octet-stream", "ELF"),
    (0, b"\x00asm", View::Other, "application/wasm", "WebAssembly"),
    (0, b"SQLite format 3\x00", View::Other, "application/octet-stream", "SQLite"),
    (0, b"II*\x00", View::Other, "image/tiff", "TIFF"),
    (0, b"MM\x00*", View::Other, "image/tiff", "TIFF"),
    (0, b"8BPS", View::Other, "image/vnd.adobe.photoshop", "PSD"),
    (0, b"OggS", View::Other, "audio/ogg", "Ogg"),
    (0, b"fLaC", View::Other, "audio/flac", "FLAC"),
    (0, b"ID3", View::Other, "audio/mpeg", "MP3"),
    (0, b"\x1A\x45\xDF\xA3", View::Other, "video/webm", "Matroska"),
    (0, b"wOFF", View::Other, "font/woff", "WOFF"),
    (0, b"wOF2", View::Other, "font/woff2", "WOFF2"),
    (0, b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", View::Other, "application/octet-stream", "OLE"),
    (4, b"ftypavif", View::Picture, "image/avif", "AVIF"),
    (4, b"ftypheic", View::Other, "image/heic", "HEIC"),
    (4, b"ftyp", View::Other, "video/mp4", "MP4"),
];

/// What bytes are, from their start (at least [`START`] of them when there are as many).
pub fn of(start: &[u8]) -> Kind {
    let at = |from: usize, sought: &[u8]| start.get(from..from + sought.len()) == Some(sought);
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return Kind { view: View::Picture, mime: "image/webp", format: Some("WebP") };
    }
    if at(0, b"RIFF") && at(8, b"WAVE") {
        return Kind { view: View::Other, mime: "audio/wav", format: Some("WAV") };
    }
    // Two letters are little to go by: a picture of Windows also has zeros where the format keeps room.
    if at(0, b"BM") && at(6, b"\x00\x00\x00\x00") {
        return Kind { view: View::Picture, mime: "image/bmp", format: Some("BMP") };
    }
    if let Some(&(_, _, view, mime, format)) = MAGIC.iter().find(|(from, sought, ..)| at(*from, sought)) {
        return Kind { view, mime, format: Some(format) };
    }
    match text_of(start) {
        Some(text) if is_svg(text) => Kind { view: View::Picture, mime: "image/svg+xml", format: Some("SVG") },
        Some(_) => Kind { view: View::Text, mime: "text/plain", format: None },
        // Two letters are little to go by: a text that starts so is still text.
        None if at(0, b"MZ") => Kind { view: View::Other, mime: "application/octet-stream", format: Some("EXE") },
        None => Kind { view: View::Other, mime: "application/octet-stream", format: None },
    }
}

/// The start as text: UTF-8 (cut anywhere, even within a letter at its end) with no zero byte.
fn text_of(start: &[u8]) -> Option<&str> {
    let start = start.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(start);
    let text = match std::str::from_utf8(start) {
        Ok(text) => text,
        // The start was cut within its last letter: what comes before is looked at.
        Err(error) if error.error_len().is_none() => std::str::from_utf8(&start[..error.valid_up_to()]).ok()?,
        Err(_) => return None,
    };
    (!text.contains('\0')).then_some(text)
}

/// SVG is XML whose first element is `svg`: after the declaration, comments and a doctype, if any.
fn is_svg(text: &str) -> bool {
    let mut rest = text.trim_start();
    loop {
        if let Some(after) = rest.strip_prefix("<?").or_else(|| rest.strip_prefix("<!--")).or_else(|| rest.strip_prefix("<!")) {
            let end = if rest.starts_with("<?") { "?>" } else if rest.starts_with("<!--") { "-->" } else { ">" };
            match after.find(end) {
                Some(at) => rest = after[at + end.len()..].trim_start(),
                None => return false,
            }
        } else {
            return rest.starts_with("<svg") && rest[4..].starts_with(|letter: char| letter.is_whitespace() || letter == '>' || letter == '/');
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn told(bytes: &[u8]) -> (View, Option<&'static str>) {
        let kind = of(bytes);
        (kind.view, kind.format)
    }

    #[test]
    fn pictures_and_documents_are_told_by_their_start() {
        assert_eq!(told(b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"), (View::Picture, Some("PNG")));
        assert_eq!(told(b"\xFF\xD8\xFF\xE0\x00\x10JFIF"), (View::Picture, Some("JPEG")));
        assert_eq!(told(b"GIF89a\x01\x00"), (View::Picture, Some("GIF")));
        assert_eq!(told(b"RIFF\x24\x00\x00\x00WEBPVP8 "), (View::Picture, Some("WebP")));
        assert_eq!(told(b"BM\x36\x00\x0c\x00\x00\x00\x00\x00\x36\x00"), (View::Picture, Some("BMP")));
        assert_eq!(told(b"\x00\x00\x01\x00\x01\x00\x10\x10"), (View::Picture, Some("ICO")));
        assert_eq!(told(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3"), (View::Pdf, Some("PDF")));
        assert_eq!(of(b"%PDF-1.4").mime, "application/pdf");
        assert_eq!(told(b"PK\x03\x04\x14\x00"), (View::Other, Some("ZIP")));
        assert_eq!(told(b"\x1F\x8B\x08\x00"), (View::Other, Some("gzip")));
        assert_eq!(told(b"\x00\x00\x00\x18ftypmp42"), (View::Other, Some("MP4")));
        assert_eq!(told(b"MZ\x90\x00\x03\x00"), (View::Other, Some("EXE")));
        assert_eq!(told(b"MZ is a text"), (View::Text, None));
    }

    #[test]
    fn text_and_svg_are_told_apart() {
        assert_eq!(told(b"<?xml version=\"1.0\"?>\n<!-- drawn -->\n<!DOCTYPE svg>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), (View::Picture, Some("SVG")));
        assert_eq!(told(b"\xEF\xBB\xBF  <svg>"), (View::Picture, Some("SVG")));
        assert_eq!(told(b"<svgx>"), (View::Text, None));
        assert_eq!(told(b"<html><svg></svg></html>"), (View::Text, None));
        assert_eq!(told("{\"a\": \"é\"}".as_bytes()), (View::Text, None));
        // A start cut within a letter is still text.
        assert_eq!(told(&"aé".as_bytes()[..2]), (View::Text, None));
        assert_eq!(told(b"text\x00with a zero"), (View::Other, None));
        assert_eq!(told(b"\xC3\x28 not UTF-8"), (View::Other, None));
        assert_eq!(of(b"\xC3\x28").mime, "application/octet-stream");
        assert_eq!(told(b""), (View::Text, None));
    }
}
