//! Opens real PDFs through the app, the way the shell does.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use pdf_organizer_backend::PdfOrganizer;
use serde_json::{json, Value};
use syntelab_app_api::{AppContext, AppError, Resource, ResourceRequest, SyntelabApp};

/// A PDF with one empty page per (width, height) pair.
fn make_pdf(pages: &[(u32, u32)]) -> Vec<u8> {
    let mut objects = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".to_owned(),
        format!(
            "<< /Type /Pages /Count {} /Kids [{}] >>",
            pages.len(),
            (0..pages.len()).map(|index| format!("{} 0 R", index + 3)).collect::<Vec<_>>().join(" ")
        ),
    ];
    for (width, height) in pages {
        objects.push(format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {width} {height}] >>"));
    }

    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
    pdf
}

/// A fresh folder for one test, with a PDF and a cache folder in it.
struct Fixture {
    dir: PathBuf,
    pdf: PathBuf,
    app: PdfOrganizer,
}

impl Fixture {
    fn new(name: &str, pages: &[(u32, u32)]) -> Self {
        let dir = std::env::temp_dir().join(format!("pdf-organizer-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("test folder");
        let pdf = dir.join("document.pdf");
        fs::write(&pdf, make_pdf(pages)).expect("test pdf");
        let app = PdfOrganizer::new(&AppContext { cache_dir: dir.join("cache") });
        Self { dir, pdf, app }
    }

    fn open(&self) -> Value {
        self.app.invoke("open_document", json!({ "path": self.pdf })).expect("the document opens")
    }

    fn resource(&self, path: &str, query: &[(&str, &str)]) -> Result<Resource, AppError> {
        let (sender, receiver) = mpsc::channel();
        let query: BTreeMap<String, String> =
            query.iter().map(|(key, value)| ((*key).to_owned(), (*value).to_owned())).collect();
        self.app.resource(
            ResourceRequest { path: path.to_owned(), query },
            Box::new(move |result| sender.send(result).expect("the test is waiting")),
        );
        receiver.recv_timeout(Duration::from_secs(30)).expect("an answer arrives")
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Width and height stored in a PNG's header.
fn png_size(png: &[u8]) -> (u32, u32) {
    assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n", "PNG signature");
    let number = |at: usize| u32::from_be_bytes(png[at..at + 4].try_into().unwrap());
    (number(16), number(20))
}

fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let start = Instant::now();
    while !done() {
        assert!(start.elapsed() < Duration::from_secs(30), "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn thumbnail_files(cache: &Path) -> usize {
    let Ok(documents) = fs::read_dir(cache.join("thumbnails")) else { return 0 };
    documents
        .flatten()
        .flat_map(|document| fs::read_dir(document.path()).into_iter().flatten().flatten())
        .filter(|file| file.path().extension().is_some_and(|extension| extension == "png"))
        .count()
}

#[test]
fn opens_a_document_and_reports_its_pages() {
    let fixture = Fixture::new("open", &[(595, 842), (842, 595), (300, 200)]);
    let opened = fixture.open();

    assert_eq!(opened["fileName"], "document.pdf");
    assert_eq!(opened["pageSizes"], json!([595.0, 842.0, 842.0, 595.0, 300.0, 200.0]));
    assert!(opened["documentId"].is_u64());
}

#[test]
fn draws_a_page_at_the_requested_scale() {
    let fixture = Fixture::new("page", &[(600, 800), (300, 200)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();

    let page = fixture.resource(&format!("page/{id}/0"), &[("scale", "0.5")]).expect("page 0 draws");
    assert_eq!(page.mime, "image/png");
    assert_eq!(png_size(&page.bytes), (300, 400));

    let page = fixture.resource(&format!("page/{id}/1"), &[("scale", "2")]).expect("page 1 draws");
    assert_eq!(png_size(&page.bytes), (600, 400));

    // Turned a quarter, width and height trade places; half a turn keeps them.
    let turned = fixture.resource(&format!("page/{id}/0"), &[("scale", "0.5"), ("rotate", "90")]).expect("draws");
    assert_eq!(png_size(&turned.bytes), (400, 300));
    let upside_down = fixture.resource(&format!("page/{id}/0"), &[("scale", "0.5"), ("rotate", "180")]).expect("draws");
    assert_eq!(png_size(&upside_down.bytes), (300, 400));
}

#[test]
fn makes_thumbnails_in_the_background_and_keeps_them_on_disk() {
    let fixture = Fixture::new("thumbnails", &[(600, 800); 12]);
    let id = fixture.open()["documentId"].as_u64().unwrap();

    let thumbnail = fixture.resource(&format!("thumbnail/{id}/11"), &[]).expect("a thumbnail draws");
    assert_eq!(png_size(&thumbnail.bytes), (240, 320));

    // Nobody asks for the other pages; the background pass draws them anyway.
    let cache = fixture.dir.join("cache");
    wait_for("all thumbnails on disk", || thumbnail_files(&cache) == 12);

    // Reopening the same file finds them again.
    fixture.app.invoke("close_document", json!({ "documentId": id })).expect("closes");
    let reopened = fixture.open()["documentId"].as_u64().unwrap();
    assert_ne!(reopened, id);
    let again = fixture.resource(&format!("thumbnail/{reopened}/11"), &[]).expect("served from disk");
    assert_eq!(again.bytes, thumbnail.bytes);
    assert_eq!(thumbnail_files(&cache), 12);
}

#[test]
fn writes_a_new_file_with_pages_reordered_rotated_and_inserted() {
    let fixture = Fixture::new("save", &[(600, 800), (300, 200), (500, 500)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();

    // A second document to take a page from.
    let other_path = fixture.dir.join("other.pdf");
    fs::write(&other_path, make_pdf(&[(100, 150), (400, 100)])).expect("second pdf");
    let other = fixture.app.invoke("open_document", json!({ "path": other_path })).expect("opens");
    let other_id = other["documentId"].as_u64().unwrap();

    // Last page first and turned, a page of the other file, then the first page; the middle one is left out.
    let destination = fixture.dir.join("result.pdf");
    fixture
        .app
        .invoke(
            "save_pages",
            json!({
                "destination": destination,
                "pages": [
                    { "documentId": id, "page": 2 },
                    { "documentId": id, "page": 0, "rotation": 90 },
                    { "documentId": other_id, "page": 1 },
                ],
            }),
        )
        .expect("saves");

    let result = fixture.app.invoke("open_document", json!({ "path": destination })).expect("the new file opens");
    assert_eq!(result["pageSizes"], json!([500.0, 500.0, 800.0, 600.0, 400.0, 100.0]));
    assert!(!fixture.dir.join("result.pdf.part").exists());

    // Asked to keep what is there, nothing is written over the file just made.
    let kept = fixture.app.invoke("save_pages", json!({ "destination": destination, "keepExisting": true, "pages": [{ "documentId": id, "page": 0 }] }));
    assert!(matches!(kept, Err(AppError::Failed { code: "destination-exists", .. })), "{kept:?}");
    assert_eq!(fixture.app.invoke("open_document", json!({ "path": destination })).expect("still opens")["pageSizes"].as_array().map(Vec::len), Some(6));

    // The originals are untouched.
    assert_eq!(fixture.open()["pageSizes"], json!([600.0, 800.0, 300.0, 200.0, 500.0, 500.0]));
}

#[test]
fn saves_over_the_open_file_and_opens_it_again() {
    let fixture = Fixture::new("save-over", &[(600, 800), (300, 200), (500, 500)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    // Thumbnails keep the file open on a second thread; saving has to wait for both.
    fixture.resource(&format!("thumbnail/{id}/0"), &[]).expect("a thumbnail draws");

    let saved = fixture
        .app
        .invoke(
            "save_document",
            json!({ "documentId": id, "pages": [{ "documentId": id, "page": 2 }, { "documentId": id, "page": 0, "rotation": 90 }] }),
        )
        .expect("saves");

    assert_eq!(saved["saved"], true);
    assert_eq!(saved["pageSizes"], json!([500.0, 500.0, 800.0, 600.0]));
    let new_id = saved["documentId"].as_u64().unwrap();
    assert_ne!(new_id, id);
    assert!(!fixture.dir.join("document.pdf.saving").exists());

    // The old id is gone, the new one draws the new first page.
    assert!(matches!(fixture.resource(&format!("page/{id}/0"), &[]), Err(AppError::NotFound(_))));
    let page = fixture.resource(&format!("page/{new_id}/0"), &[("scale", "1")]).expect("draws");
    assert_eq!(png_size(&page.bytes), (500, 500));

    // The file on disk really is the new one.
    assert_eq!(fixture.open()["pageSizes"], json!([500.0, 500.0, 800.0, 600.0]));
}

/// A two-page PDF with a title, an author and bookmarks: "First" (page 1)
/// with "Inside" (page 2) under it, then "Second" (page 2).
fn make_pdf_with_bookmarks() -> Vec<u8> {
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R /Outlines 5 0 R >>".to_owned(),
        "<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>".to_owned(),
        "<< /Type /Outlines /First 6 0 R /Last 8 0 R /Count 3 >>".to_owned(),
        "<< /Title (First) /Parent 5 0 R /Next 8 0 R /First 7 0 R /Last 7 0 R /Count 1 /Dest [3 0 R /Fit] >>".to_owned(),
        "<< /Title (Inside) /Parent 6 0 R /Dest [4 0 R /Fit] >>".to_owned(),
        "<< /Title (Second) /Parent 5 0 R /Prev 6 0 R /Dest [4 0 R /Fit] >>".to_owned(),
        "<< /Title (Yearly report) /Author (Ana Pop) /CreationDate (D:20261009143000+02'00') >>".to_owned(),
    ];
    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R /Info 9 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
    pdf
}

#[test]
fn tells_what_a_document_says_about_itself() {
    let fixture = Fixture::new("facts", &[(100, 100)]);
    let path = fixture.dir.join("with-bookmarks.pdf");
    fs::write(&path, make_pdf_with_bookmarks()).expect("test pdf");
    let id = fixture.app.invoke("open_document", json!({ "path": path })).expect("open")["documentId"].clone();

    let facts = fixture.app.invoke("document_facts", json!({ "documentId": id })).expect("facts");
    assert_eq!(facts["title"], "Yearly report");
    assert_eq!(facts["author"], "Ana Pop");
    assert_eq!(facts["subject"], "");
    assert_eq!(facts["created"], "D:20261009143000+02'00'");
    assert_eq!(facts["format"], "PDF 1.7");
    assert!(facts["fileSize"].as_u64().expect("size") > 500);
    assert_eq!(
        facts["bookmarks"],
        json!([
            { "title": "First", "page": 0, "children": [{ "title": "Inside", "page": 1, "children": [] }] },
            { "title": "Second", "page": 1, "children": [] },
        ])
    );

    // A document without any: empty, not an error.
    let plain = fixture.open()["documentId"].clone();
    let facts = fixture.app.invoke("document_facts", json!({ "documentId": plain })).expect("facts");
    assert_eq!(facts["title"], "");
    assert_eq!(facts["bookmarks"], json!([]));
}

/// A one-page PDF with a form: a text field "name", a checkbox "agree"
/// (ticked is `Yes`), and a choice "color" (red, green, blue).
fn make_pdf_with_form() -> Vec<u8> {
    // The pictures of the checkbox: a filled square when ticked, nothing when not.
    let ticked = "0 0 14 14 re f";
    let objects = [
        "<< /Type /Catalog /Pages 2 0 R /AcroForm << /Fields [5 0 R 6 0 R 10 0 R] /DA (/Helv 12 Tf 0 g) /DR << /Font << /Helv 7 0 R >> >> >> >>".to_owned(),
        "<< /Type /Pages /Count 1 /Kids [3 0 R] >>".to_owned(),
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] /Annots [5 0 R 6 0 R 10 0 R] >>".to_owned(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        "<< /Type /Annot /Subtype /Widget /FT /Tx /T (name) /TU (Your name) /Rect [20 240 180 260] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) /MaxLen 40 >>".to_owned(),
        "<< /Type /Annot /Subtype /Widget /FT /Btn /T (agree) /Rect [20 200 34 214] /P 3 0 R /F 4 /V /Off /AS /Off /AP << /N << /Yes 8 0 R /Off 9 0 R >> >> >>".to_owned(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_owned(),
        format!("<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length {} >>\nstream\n{ticked}\nendstream", ticked.len()),
        "<< /Type /XObject /Subtype /Form /BBox [0 0 14 14] /Length 0 >>\nstream\n\nendstream".to_owned(),
        "<< /Type /Annot /Subtype /Widget /FT /Ch /Ff 131072 /T (color) /Rect [20 160 120 180] /P 3 0 R /F 4 /DA (/Helv 12 Tf 0 g) /Opt [(red) [(g) (green)] (blue)] >>".to_owned(),
    ];
    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n{object}\nendobj\n", index + 1).bytes());
    }
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).bytes());
    for offset in offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", objects.len() + 1).bytes());
    pdf
}

#[test]
fn reads_a_form_and_saves_its_answers() {
    let fixture = Fixture::new("form", &[(100, 100)]);
    let path = fixture.dir.join("form.pdf");
    fs::write(&path, make_pdf_with_form()).expect("test pdf");
    let id = fixture.app.invoke("open_document", json!({ "path": path })).expect("open")["documentId"].as_u64().expect("id");

    let fields = fixture.app.invoke("form_fields", json!({ "documentId": id })).expect("fields")["fields"].clone();
    let fields = fields.as_array().expect("a list");
    let by_name = |name: &str| fields.iter().find(|field| field["name"] == name).unwrap_or_else(|| panic!("no field {name}: {fields:?}"));
    let name = by_name("name");
    assert_eq!(name["kind"], "text");
    assert_eq!(name["label"], "Your name");
    assert_eq!(name["value"], "");
    assert_eq!(name["maxLength"], 40);
    // 240 to 260 from the bottom of a page 300 tall: 40 from its top.
    assert_eq!(name["area"], json!([20.0, 40.0, 160.0, 20.0]));
    let agree = by_name("agree");
    assert_eq!(agree["kind"], "checkbox");
    assert_eq!(agree["on"], "Yes");
    assert_eq!(agree["value"], "Off");
    let color = by_name("color");
    assert_eq!(color["kind"], "choice");
    assert_eq!(color["options"], json!([{ "value": "red", "text": "red" }, { "value": "g", "text": "green" }, { "value": "blue", "text": "blue" }]));

    // A document without a form has no fields.
    let plain = fixture.open()["documentId"].clone();
    assert_eq!(fixture.app.invoke("form_fields", json!({ "documentId": plain })).expect("fields")["fields"], json!([]));

    // Saving writes the answers into the new file, and draws them.
    let answers = json!([
        { "id": name["id"], "value": "Ana Pop" },
        { "id": agree["id"], "value": "Yes" },
        { "id": color["id"], "value": "g" },
    ]);
    let pages = json!([{ "documentId": id, "page": 0, "answers": answers }]);
    let destination = fixture.dir.join("filled.pdf");
    fixture.app.invoke("save_pages", json!({ "destination": destination, "baseDocumentId": id, "pages": pages })).expect("save");

    let filled = fixture.app.invoke("open_document", json!({ "path": destination })).expect("open filled")["documentId"].as_u64().expect("id");
    let saved = fixture.app.invoke("form_fields", json!({ "documentId": filled })).expect("fields")["fields"].clone();
    let saved = saved.as_array().expect("a list");
    let value_of = |name: &str| saved.iter().find(|field| field["name"] == name).expect("field")["value"].clone();
    assert_eq!(value_of("name"), "Ana Pop");
    assert_eq!(value_of("agree"), "Yes");
    assert_eq!(value_of("color"), "g");

    let before = Drawn::page(&fixture, id, 0);
    let after = Drawn::page(&fixture, filled, 0);
    let dark = |drawn: &Drawn, xs: std::ops::Range<usize>, ys: std::ops::Range<usize>| {
        xs.flat_map(|x| ys.clone().map(move |y| (x, y))).filter(|(x, y)| drawn.at(*x, *y)[0] < 100).count()
    };
    assert_eq!(dark(&before, 20..180, 40..60), 0, "the name is empty before");
    assert!(dark(&after, 20..180, 40..60) > 20, "the name is written");
    assert_eq!(dark(&before, 20..34, 86..100), 0, "the box is empty before");
    let ticked = dark(&after, 20..34, 86..100);
    assert!(ticked > 10, "the box is ticked ({ticked} dark pixels)");

    // The same pages as a working copy, to print before saving.
    let copy = fixture.app.invoke("working_copy", json!({ "baseDocumentId": id, "pages": pages })).expect("working copy");
    let copy_id = copy["documentId"].as_u64().expect("id");
    assert!(dark(&Drawn::page(&fixture, copy_id, 0), 20..180, 40..60) > 20, "the copy has the answer");
    // The open document itself is untouched.
    assert_eq!(dark(&Drawn::page(&fixture, id, 0), 20..180, 40..60), 0);
}

/// A one-page PDF filled by one large photograph-like JPEG (2400 × 1600 pixels of noise-free gradient).
fn make_pdf_with_photo(dir: &Path) -> PathBuf {
    let (width, height) = (2400u16, 1600u16);
    let mut pixels = Vec::with_capacity(usize::from(width) * usize::from(height) * 3);
    for y in 0..height {
        for x in 0..width {
            // Soft diagonal bands with some texture, so the JPEG has something to say.
            let band = ((u32::from(x) + u32::from(y)) / 7 % 256) as u8;
            pixels.extend_from_slice(&[band, (u32::from(x) * 255 / u32::from(width)) as u8, ((x ^ y) & 0xff) as u8]);
        }
    }
    let mut jpeg = Vec::new();
    jpeg_encoder::Encoder::new(&mut jpeg, 92).encode(&pixels, width, height, jpeg_encoder::ColorType::Rgb).expect("jpeg");

    let content = "q 300 0 0 200 0 0 cm /Im0 Do Q";
    let mut pdf = b"%PDF-1.7\n".to_vec();
    let mut offsets = Vec::new();
    let mut add = |pdf: &mut Vec<u8>, body: &[u8]| {
        offsets.push(pdf.len());
        pdf.extend(format!("{} 0 obj\n", offsets.len()).bytes());
        pdf.extend_from_slice(body);
        pdf.extend(b"\nendobj\n");
    };
    add(&mut pdf, b"<< /Type /Catalog /Pages 2 0 R >>");
    add(&mut pdf, b"<< /Type /Pages /Count 1 /Kids [3 0 R] >>");
    add(&mut pdf, b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>");
    add(&mut pdf, format!("<< /Length {} >>\nstream\n{content}\nendstream", content.len()).as_bytes());
    let mut picture = format!(
        "<< /Type /XObject /Subtype /Image /Width {width} /Height {height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length {} >>\nstream\n",
        jpeg.len()
    )
    .into_bytes();
    picture.extend_from_slice(&jpeg);
    picture.extend(b"\nendstream");
    add(&mut pdf, &picture);
    let xref = pdf.len();
    pdf.extend(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).bytes());
    for offset in &offsets {
        pdf.extend(format!("{offset:010} 00000 n \n").bytes());
    }
    pdf.extend(format!("trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n", offsets.len() + 1).bytes());
    let path = dir.join("photo.pdf");
    fs::write(&path, pdf).expect("test pdf");
    path
}

#[test]
fn makes_a_file_smaller_by_shrinking_its_photographs() {
    let fixture = Fixture::new("shrink", &[(100, 100)]);
    let path = make_pdf_with_photo(&fixture.dir);
    let original_size = fs::metadata(&path).expect("file").len();
    let id = fixture.app.invoke("open_document", json!({ "path": path })).expect("open")["documentId"].as_u64().expect("id");
    let pages = json!([{ "documentId": id, "page": 0 }]);
    let save = |name: &str, shrink: Option<Value>| {
        let destination = fixture.dir.join(name);
        let mut request = json!({ "destination": destination, "baseDocumentId": id, "pages": pages });
        if let Some(shrink) = shrink {
            request["shrinkPictures"] = shrink;
        }
        let size = fixture.app.invoke("save_pages", request).expect("save")["fileSize"].as_u64().expect("size");
        assert_eq!(size, fs::metadata(&destination).expect("file").len());
        (destination, size)
    };

    // Saved as it is, the photograph is kept whole.
    let (_, plain_size) = save("plain.pdf", None);
    assert!(plain_size > original_size * 9 / 10, "{plain_size} of {original_size}");

    // Compressed: the photograph has a quarter of its pixels and the file is much smaller.
    let (smaller, smaller_size) = save("smaller.pdf", Some(json!({ "longestSide": 1200, "quality": 70 })));
    assert!(smaller_size < original_size / 2, "{smaller_size} of {original_size}");

    // The page is the same size and still shows the picture, with the same colors where it is plain.
    let opened = fixture.app.invoke("open_document", json!({ "path": smaller })).expect("open smaller");
    assert_eq!(opened["pageSizes"], json!([300.0, 200.0]));
    let before = Drawn::page(&fixture, id, 0);
    let after = Drawn::page(&fixture, opened["documentId"].as_u64().expect("id"), 0);
    for (x, y) in [(20, 20), (150, 100), (280, 180)] {
        let (was, is) = (before.at(x, y), after.at(x, y));
        // Green rises smoothly from left to right: a good place to compare.
        assert!((i32::from(was[1]) - i32::from(is[1])).abs() < 24, "at {x},{y}: {was:?} became {is:?}");
    }

    // A side already small enough: nothing to shrink, and the file is not made worse.
    let (_, kept_size) = save("kept.pdf", Some(json!({ "longestSide": 4000, "quality": 70 })));
    assert!(kept_size > original_size / 2);
}

#[test]
fn removes_for_good_what_is_redacted() {
    let fixture = Fixture::new("redact", &[(100, 100)]);
    // The sample with text: "Page N, line M: the quick brown fox…".
    let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/generated/small.pdf");
    let id = fixture.app.invoke("open_document", json!({ "path": sample })).expect("open")["documentId"].as_u64().expect("id");
    let find = |document: u64, query: &str| {
        let found = fixture.app.invoke("search_text", json!({ "documentId": document, "query": query, "fromPage": 0, "pageCount": 1 })).expect("search");
        found["pages"].as_array().expect("pages").first().map(|page| page["boxes"].as_array().expect("boxes").clone()).unwrap_or_default()
    };
    let line = find(id, "line 7:");
    assert_eq!(line.len(), 4, "the line is there once: {line:?}");
    let number = |index: usize| line[index].as_f64().expect("number");

    // Redact the whole width of the page at that line.
    let area = json!({ "x": 0, "y": number(1) - 1.0, "width": 600, "height": number(3) + 2.0 });
    let redacted = reshape_one(&fixture, id, json!({ "redact": { "area": area } }));

    // The words are gone from the file, not just covered; the lines around are still there.
    assert!(find(redacted, "line 7:").is_empty(), "the redacted line can still be found");
    assert_eq!(find(redacted, "line 6:").len(), 4);
    assert_eq!(find(redacted, "line 8:").len(), 4);
    // And a black box marks the place.
    let drawn = Drawn::page(&fixture, redacted, 0);
    let middle = ((number(0) + 40.0) as usize, (number(1) + number(3) / 2.0) as usize);
    assert_eq!(drawn.at(middle.0, middle.1), [0, 0, 0]);

    // Nothing else can be asked for along with it.
    let both = json!({ "pages": [{ "documentId": id, "page": 0 }], "redact": { "area": area }, "crop": { "left": 1, "top": 1, "right": 1, "bottom": 1 } });
    assert!(matches!(fixture.app.invoke("reshape_pages", both), Err(AppError::InvalidRequest(_))));
}

#[test]
fn finds_text_and_says_where_it_is() {
    let fixture = Fixture::new("search", &[(100, 100)]);
    // A generated sample with text: "Page N, line M: the quick brown fox…" on five pages.
    let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/generated/small.pdf");
    let opened = fixture.app.invoke("open_document", json!({ "path": sample })).expect("open sample");
    let id = opened["documentId"].as_u64().expect("document id");
    let search = |query: &str, from: u64, count: u64| {
        fixture
            .app
            .invoke("search_text", json!({ "documentId": id, "query": query, "fromPage": from, "pageCount": count }))
            .expect("search")
    };

    // Upper and lower case are the same; every page of the sample has the words.
    let found = search("QUICK BROWN", 0, 100);
    let pages = found["pages"].as_array().expect("pages");
    assert!(pages.len() >= 4, "{found}");
    assert_eq!(pages[0]["page"], 0);
    let boxes = pages[0]["boxes"].as_array().expect("boxes");
    assert!(!boxes.is_empty() && boxes.len() % 4 == 0);
    // The first box lies inside the page.
    let number = |index: usize| boxes[index].as_f64().expect("number");
    let page_width = opened["pageSizes"][0].as_f64().expect("width");
    let page_height = opened["pageSizes"][1].as_f64().expect("height");
    assert!(number(0) >= 0.0 && number(0) + number(2) <= page_width, "{boxes:?}");
    assert!(number(1) >= 0.0 && number(1) + number(3) <= page_height, "{boxes:?}");
    assert!(number(2) > 0.0 && number(3) > 0.0);

    // Only the stretch asked for is searched.
    let second_only = search("quick brown", 1, 1);
    let second_pages = second_only["pages"].as_array().expect("pages");
    assert_eq!(second_pages.len(), 1);
    assert_eq!(second_pages[0]["page"], 1);

    // The text of pages, a stretch at a time, to compare documents with.
    let texts = fixture.app.invoke("page_texts", json!({ "documentId": id, "fromPage": 1, "pageCount": 2 })).expect("texts");
    let texts = texts["texts"].as_array().expect("texts");
    assert_eq!(texts.len(), 2);
    assert!(texts[0].as_str().expect("text").contains("Page 2, line 1: the quick brown fox"), "{}", texts[0]);
    assert!(texts[1].as_str().expect("text").contains("Page 3, line 1:"));
    let beyond = fixture.app.invoke("page_texts", json!({ "documentId": id, "fromPage": 100, "pageCount": 2 })).expect("texts");
    assert_eq!(beyond["texts"], json!([]));

    // Nothing found, and nothing to look for.
    assert_eq!(search("zebra crossing", 0, 100)["pages"], json!([]));
    assert_eq!(search("", 0, 100)["pages"], json!([]));
}

#[test]
fn gives_pages_a_new_shape_in_a_file_of_its_own() {
    let fixture = Fixture::new("reshape", &[(100, 200), (400, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    let pages = json!([{ "documentId": id, "page": 0 }, { "documentId": id, "page": 1, "rotation": 90 }]);
    let sizes = |answer: &Value| -> Vec<i64> {
        answer["pageSizes"].as_array().expect("sizes").iter().map(|size| size.as_f64().expect("number").round() as i64).collect()
    };

    // Edges are cut off the page as it is shown: the second page is shown turned.
    let crop = json!({ "left": 10, "top": 20, "right": 30, "bottom": 40 });
    let cropped = fixture.app.invoke("reshape_pages", json!({ "pages": pages, "crop": crop })).expect("crop");
    assert_eq!(sizes(&cropped), [60, 140, 160, 340]);

    // Each page on an A4 sheet, lying the way the page does.
    let fit = json!({ "width": 595, "height": 842, "matchOrientation": true });
    let fitted = fixture.app.invoke("reshape_pages", json!({ "pages": pages, "fit": fit })).expect("fit");
    assert_eq!(sizes(&fitted), [595, 842, 595, 842]);
    let upright = json!([{ "documentId": id, "page": 1 }]);
    let wide = fixture.app.invoke("reshape_pages", json!({ "pages": upright, "fit": fit })).expect("fit a wide page");
    assert_eq!(sizes(&wide), [842, 595]);

    // The new shape can be saved, together with pages left as they were.
    let cropped_id = cropped["documentId"].as_u64().expect("document id");
    let destination = fixture.dir.join("reshaped.pdf");
    let saved_pages = json!([{ "documentId": cropped_id, "page": 0 }, { "documentId": id, "page": 1 }]);
    fixture
        .app
        .invoke("save_pages", json!({ "destination": destination, "baseDocumentId": id, "pages": saved_pages }))
        .expect("save");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("open saved");
    assert_eq!(sizes(&saved), [60, 140, 400, 200]);

    // The file behind the new shape is the program's own and goes away with its document.
    let working = fixture.dir.join("cache").join("working");
    let files = || fs::read_dir(&working).map(|entries| entries.count()).unwrap_or(0);
    assert_eq!(files(), 3);
    for answer in [&cropped, &fitted, &wide] {
        fixture.app.invoke("close_document", json!({ "documentId": answer["documentId"] })).expect("close");
    }
    wait_for("the working files to go", || files() == 0);

    // Nothing left of the page, or neither change asked for.
    let all = json!({ "left": 60, "top": 0, "right": 60, "bottom": 0 });
    let nothing = fixture.app.invoke("reshape_pages", json!({ "pages": pages, "crop": all }));
    assert!(matches!(nothing, Err(AppError::Failed { .. })), "{nothing:?}");
    assert!(matches!(fixture.app.invoke("reshape_pages", json!({ "pages": pages })), Err(AppError::InvalidRequest(_))));
    wait_for("no file left behind by a failed change", || files() == 0);
}

/// A page drawn at 72 pixels per inch, to look at its colors.
struct Drawn {
    pixels: Vec<u8>,
    width: usize,
    channels: usize,
}

impl Drawn {
    fn page(fixture: &Fixture, document: u64, page: usize) -> Self {
        let png = fixture.resource(&format!("page/{document}/{page}"), &[("scale", "1")]).expect("the page is drawn").bytes;
        let mut reader = png::Decoder::new(png.as_slice()).read_info().expect("png header");
        let mut pixels = vec![0; reader.output_buffer_size()];
        let info = reader.next_frame(&mut pixels).expect("png data");
        Self { pixels, width: info.width as usize, channels: info.color_type.samples() }
    }

    /// Red, green and blue at one place.
    fn at(&self, x: usize, y: usize) -> [u8; 3] {
        let at = (y * self.width + x) * self.channels;
        [self.pixels[at], self.pixels[at + 1], self.pixels[at + 2]]
    }
}

/// The half see-through red square of the tests, as base64.
fn marked_picture() -> &'static str {
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DQAMIMMAYAOOgF/REzMMkAAAAASUVORK5CYII="
}

/// A zip archive with its files stored as they are (no compression).
fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
    // The check sum zip archives use.
    fn crc32(data: &[u8]) -> u32 {
        let mut crc = u32::MAX;
        for byte in data {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 };
            }
        }
        !crc
    }
    let mut archive = Vec::new();
    let mut directory = Vec::new();
    for (name, data) in files {
        let offset = archive.len() as u32;
        let (crc, size, name_length) = (crc32(data), data.len() as u32, name.len() as u16);
        archive.extend(0x0403_4b50u32.to_le_bytes());
        archive.extend(20u16.to_le_bytes());
        archive.extend([0u8; 8]); // flags, method (stored), time, date
        archive.extend(crc.to_le_bytes());
        archive.extend(size.to_le_bytes());
        archive.extend(size.to_le_bytes());
        archive.extend(name_length.to_le_bytes());
        archive.extend(0u16.to_le_bytes());
        archive.extend(name.bytes());
        archive.extend(*data);

        directory.extend(0x0201_4b50u32.to_le_bytes());
        directory.extend(20u16.to_le_bytes());
        directory.extend(20u16.to_le_bytes());
        directory.extend([0u8; 8]);
        directory.extend(crc.to_le_bytes());
        directory.extend(size.to_le_bytes());
        directory.extend(size.to_le_bytes());
        directory.extend(name_length.to_le_bytes());
        directory.extend([0u8; 12]); // extra, comment, disk, attributes
        directory.extend(offset.to_le_bytes());
        directory.extend(name.bytes());
    }
    let (directory_offset, directory_size, count) = (archive.len() as u32, directory.len() as u32, files.len() as u16);
    archive.extend(directory);
    archive.extend(0x0605_4b50u32.to_le_bytes());
    archive.extend([0u8; 4]);
    archive.extend(count.to_le_bytes());
    archive.extend(count.to_le_bytes());
    archive.extend(directory_size.to_le_bytes());
    archive.extend(directory_offset.to_le_bytes());
    archive.extend(0u16.to_le_bytes());
    archive
}

/// A BMP file of one red pixel.
fn bmp_of_one_red_pixel() -> Vec<u8> {
    let mut bmp = Vec::new();
    bmp.extend(b"BM");
    bmp.extend(58u32.to_le_bytes()); // file size
    bmp.extend(0u32.to_le_bytes());
    bmp.extend(54u32.to_le_bytes()); // where the pixels start
    bmp.extend(40u32.to_le_bytes()); // header size
    bmp.extend(1i32.to_le_bytes()); // width
    bmp.extend(1i32.to_le_bytes()); // height
    bmp.extend(1u16.to_le_bytes()); // planes
    bmp.extend(24u16.to_le_bytes()); // bits per pixel
    bmp.extend([0u8; 24]); // no compression, sizes and palettes left to defaults
    bmp.extend([0, 0, 255, 0]); // blue, green, red, padding
    bmp
}

/// Changes the first page of a document and returns the id of the document it comes back as.
fn reshape_one(fixture: &Fixture, document: u64, change: Value) -> u64 {
    let mut request = json!({ "pages": [{ "documentId": document, "page": 0 }] });
    for (key, value) in change.as_object().expect("an object") {
        request[key] = value.clone();
    }
    fixture.app.invoke("reshape_pages", request).expect("the page is changed")["documentId"].as_u64().expect("document id")
}

#[test]
fn reads_a_picture_file_for_the_interface() {
    let fixture = Fixture::new("picture", &[(100, 100)]);
    let path = fixture.dir.join("square.png");
    // The same picture, decoded by hand from its base64.
    let bytes: Vec<u8> = {
        let letters = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut bits = 0u32;
        let mut count = 0;
        let mut bytes = Vec::new();
        for letter in marked_picture().bytes().filter(|letter| *letter != b'=') {
            bits = (bits << 6) | letters.iter().position(|known| *known == letter).expect("base64") as u32;
            count += 6;
            if count >= 8 {
                count -= 8;
                bytes.push((bits >> count) as u8);
            }
        }
        bytes
    };
    fs::write(&path, &bytes).expect("picture file");

    let picture = fixture.app.invoke("read_picture", json!({ "path": path })).expect("read");
    assert_eq!(picture["width"], 2);
    assert_eq!(picture["height"], 2);
    assert_eq!(picture["data"], marked_picture());
    assert_eq!(picture["type"], "image/png");

    // The same picture as a page to combine with documents: it shows under its own name.
    let page = fixture.app.invoke("open_document", json!({ "path": path, "asPages": true })).expect("picture as a page");
    assert_eq!(page["fileName"], "square.png");
    // 2 pixels at the usual 96 dots per inch are 1.5 points.
    assert_eq!(page["pageSizes"], json!([1.5, 1.5]));
    let page_id = page["documentId"].as_u64().expect("document id");
    let document_id = fixture.open()["documentId"].as_u64().expect("document id");
    let combined = fixture.dir.join("combined.pdf");
    let pages = json!([{ "documentId": document_id, "page": 0 }, { "documentId": page_id, "page": 0 }]);
    fixture.app.invoke("save_pages", json!({ "destination": combined, "baseDocumentId": document_id, "pages": pages })).expect("combine");
    let opened = fixture.app.invoke("open_document", json!({ "path": combined })).expect("open combined");
    assert_eq!(opened["pageSizes"], json!([100.0, 100.0, 1.5, 1.5]));
    // Without being asked to, a picture is not opened as a document to edit.
    let refused = fixture.app.invoke("open_document", json!({ "path": path }));
    assert!(matches!(refused, Err(AppError::Failed { code: "cannot-open", .. })), "{refused:?}");

    // A text file is laid out on A4 pages, and its words can be found.
    let notes = fixture.dir.join("notes.txt");
    fs::write(&notes, "First line of the notes\nSecond line, with diacritics: ăîâșț\n".repeat(3)).expect("text file");
    let text_pages = fixture.app.invoke("open_document", json!({ "path": notes, "asPages": true })).expect("text as pages");
    assert_eq!(text_pages["fileName"], "notes.txt");
    assert_eq!(text_pages["pageSizes"], json!([595.0, 842.0]));
    let found = fixture
        .app
        .invoke("search_text", json!({ "documentId": text_pages["documentId"], "query": "Second line", "fromPage": 0, "pageCount": 5 }))
        .expect("search");
    assert_eq!(found["pages"][0]["boxes"].as_array().expect("boxes").len(), 12, "three times four numbers: {found}");

    // An e-book is laid out on pages, and its words can be found.
    let book = fixture.dir.join("story.epub");
    let chapter = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><head><title>Story</title></head><body><h1>Chapter one</h1><p>It was a quiet morning in the archive.</p></body></html>";
    let package = b"<?xml version=\"1.0\" encoding=\"UTF-8\"?><package xmlns=\"http://www.idpf.org/2007/opf\" version=\"2.0\" unique-identifier=\"id\"><metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\"><dc:title>Story</dc:title><dc:identifier id=\"id\">story</dc:identifier><dc:language>en</dc:language></metadata><manifest><item id=\"one\" href=\"one.xhtml\" media-type=\"application/xhtml+xml\"/></manifest><spine><itemref idref=\"one\"/></spine></package>";
    let container = b"<?xml version=\"1.0\"?><container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\"><rootfiles><rootfile full-path=\"book.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles></container>";
    fs::write(
        &book,
        zip_of(&[("mimetype", b"application/epub+zip"), ("META-INF/container.xml", container), ("book.opf", package), ("one.xhtml", chapter)]),
    )
    .expect("e-book");
    let book_pages = fixture.app.invoke("open_document", json!({ "path": book, "asPages": true })).expect("e-book as pages");
    assert_eq!(book_pages["fileName"], "story.epub");
    assert_eq!(book_pages["pageSizes"], json!([595.0, 842.0]));
    let found = fixture
        .app
        .invoke("search_text", json!({ "documentId": book_pages["documentId"], "query": "quiet morning", "fromPage": 0, "pageCount": 5 }))
        .expect("search");
    assert_eq!(found["pages"].as_array().expect("pages").len(), 1, "{found}");

    // A comic book archive: each picture in it is a page.
    let comic = fixture.dir.join("comic.cbz");
    let page_picture = fs::read(&path).expect("the picture written above");
    fs::write(&comic, zip_of(&[("01.png", &page_picture), ("02.png", &page_picture)])).expect("comic");
    let comic_pages = fixture.app.invoke("open_document", json!({ "path": comic, "asPages": true })).expect("comic as pages");
    assert_eq!(comic_pages["pageSizes"].as_array().expect("sizes").len(), 4, "two pages: {comic_pages}");

    // A picture the interface decoded itself arrives as pixels, with its name.
    let decoded = fixture
        .app
        .invoke("open_document", json!({ "picture": marked_picture(), "name": "drawing.webp", "asPages": true }))
        .expect("decoded picture as a page");
    assert_eq!(decoded["fileName"], "drawing.webp");
    assert_eq!(decoded["pageSizes"], json!([1.5, 1.5]));

    // A picture format only the interface reads is sent back to it; anything else is refused.
    fs::write(fixture.dir.join("drawing.webp"), b"RIFF....WEBP").expect("file");
    let for_interface = fixture.app.invoke("open_document", json!({ "path": fixture.dir.join("drawing.webp"), "asPages": true }));
    assert!(matches!(for_interface, Err(AppError::Failed { code: "decode-in-interface", .. })), "{for_interface:?}");
    let raw = fixture.app.invoke("read_picture", json!({ "path": fixture.dir.join("drawing.webp") })).expect("raw picture");
    assert_eq!(raw["type"], "image/webp");
    assert_eq!(raw["width"], 0);
    fs::write(fixture.dir.join("program.exe"), b"MZ").expect("file");
    let other = fixture.app.invoke("open_document", json!({ "path": fixture.dir.join("program.exe"), "asPages": true }));
    assert!(matches!(other, Err(AppError::Failed { code: "cannot-open", .. })), "{other:?}");

    // A format the engine reads but a web view does not comes back as PNG.
    let bitmap = fixture.dir.join("dot.bmp");
    fs::write(&bitmap, bmp_of_one_red_pixel()).expect("bitmap");
    let shown = fixture.app.invoke("read_picture", json!({ "path": bitmap })).expect("bitmap");
    assert_eq!(shown["type"], "image/png");
    assert_eq!((shown["width"].clone(), shown["height"].clone()), (json!(1), json!(1)));
    assert!(shown["data"].as_str().expect("data").starts_with("iVBOR"), "PNG data");
    let bitmap_page = fixture.app.invoke("open_document", json!({ "path": bitmap, "asPages": true })).expect("bitmap as a page");
    assert_eq!(bitmap_page["fileName"], "dot.bmp");

    let not_one = fixture.app.invoke("read_picture", json!({ "path": fixture.pdf.with_extension("txt") }));
    assert!(matches!(not_one, Err(AppError::Failed { code: "cannot-open", .. })), "{not_one:?}");
    fs::write(fixture.dir.join("words.png"), b"just words").expect("file");
    let words = fixture.app.invoke("read_picture", json!({ "path": fixture.dir.join("words.png") }));
    assert!(matches!(words, Err(AppError::Failed { code: "not-a-picture", .. })), "{words:?}");
}

#[test]
fn draws_page_numbers_and_a_watermark_over_pages() {
    const WHITE: [u8; 3] = [255, 255, 255];
    let fixture = Fixture::new("stamp", &[(200, 300), (300, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // The second page is shown turned, so both are 200 wide and 300 tall for the reader.
    let pages = json!([{ "documentId": id, "page": 0 }, { "documentId": id, "page": 1, "rotation": 90 }]);
    assert_eq!(Drawn::page(&fixture, id, 0).at(100, 150), WHITE);

    // A picture over the middle of every page; the pages keep their size.
    // The picture is two by two red pixels, half see-through.
    let picture = json!({ "data": "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGP4z8DQAMIMMAYAOOgF/REzMMkAAAAASUVORK5CYII=", "width": 0.5 });
    let marked = fixture.app.invoke("reshape_pages", json!({ "pages": pages, "picture": picture })).expect("watermark");
    let marked_id = marked["documentId"].as_u64().expect("document id");
    assert_eq!(marked["pageSizes"], json!([200.0, 300.0, 200.0, 300.0]));
    for page in 0..2 {
        let drawn = Drawn::page(&fixture, marked_id, page);
        let [red, green, blue] = drawn.at(100, 150);
        // Red over white, see-through: paler than plain red, and not white.
        assert!(red > 200 && green == blue && (60..200).contains(&green), "page {page}: {:?}", [red, green, blue]);
        assert_eq!(drawn.at(10, 10), WHITE, "page {page}");
    }

    // A number at the bottom of every page, in the middle: dark where the digit is.
    let label = json!({ "texts": ["1", "2"], "place": "bottom-center", "size": 40, "margin": 20 });
    let numbered = fixture.app.invoke("reshape_pages", json!({ "pages": pages, "label": label })).expect("numbers");
    let numbered_id = numbered["documentId"].as_u64().expect("document id");
    for page in 0..2 {
        let drawn = Drawn::page(&fixture, numbered_id, page);
        let darkest = (80..120)
            .flat_map(|x| (245..285).map(move |y| (x, y)))
            .map(|(x, y)| drawn.at(x, y)[0])
            .min()
            .expect("pixels");
        assert!(darkest < 80, "page {page}: no digit near the bottom middle (darkest {darkest})");
        assert_eq!(drawn.at(100, 40), WHITE, "page {page}");
    }

    // An image put in a chosen area, a filled rectangle, and text at a point.
    let red_square = marked_picture();
    let placed = reshape_one(&fixture, id, json!({ "picture": { "data": red_square, "area": { "x": 20, "y": 30, "width": 40, "height": 40 } } }));
    let drawn = Drawn::page(&fixture, placed, 0);
    assert!(drawn.at(40, 50)[0] > 200 && drawn.at(40, 50)[1] < 200, "{:?}", drawn.at(40, 50));
    assert_eq!(drawn.at(100, 150), WHITE);

    // A second picture on a page that already has one: each keeps its own.
    let blue_square = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAD0lEQVR4nGNgYPgPRmAKABf2A/1+6zfzAAAAAElFTkSuQmCC";
    let twice = reshape_one(&fixture, placed, json!({ "picture": { "data": blue_square, "area": { "x": 120, "y": 200, "width": 40, "height": 40 } } }));
    let drawn = Drawn::page(&fixture, twice, 0);
    assert!(drawn.at(40, 50)[0] > 200 && drawn.at(40, 50)[2] < 200, "the first picture is still red: {:?}", drawn.at(40, 50));
    assert_eq!(drawn.at(140, 220), [0, 0, 255], "the second picture is blue");

    let shape = json!({ "kind": "rectangle", "area": { "x": 50, "y": 100, "width": 100, "height": 60 }, "color": [0, 0, 1], "lineWidth": 4, "fill": [0, 1, 0] });
    let shaped = reshape_one(&fixture, id, json!({ "shape": shape }));
    let drawn = Drawn::page(&fixture, shaped, 0);
    assert_eq!(drawn.at(100, 130), [0, 255, 0], "the fill");
    assert_eq!(drawn.at(51, 130), [0, 0, 255], "the line");
    assert_eq!(drawn.at(30, 130), WHITE);

    let written = reshape_one(&fixture, id, json!({ "text": { "text": "HHHH\nHHHH", "x": 20, "y": 40, "size": 40, "color": [1, 0, 0] } }));
    let drawn = Drawn::page(&fixture, written, 0);
    let reddest = |rows: std::ops::Range<usize>| {
        (20..140).flat_map(|x| rows.clone().map(move |y| (x, y))).filter(|(x, y)| drawn.at(*x, *y) == [255, 0, 0]).count()
    };
    assert!(reddest(40..70) > 100, "the first line, under y = 40");
    assert!(reddest(90..120) > 100, "the second line, one line lower");
    assert_eq!(reddest(0..38), 0, "nothing above the point");

    // Text the built-in font cannot write is refused, so the interface can draw it instead.
    let request = json!({ "pages": [{ "documentId": id, "page": 0 }], "text": { "text": "مرحبا", "x": 20, "y": 40, "size": 20 } });
    let refused = fixture.app.invoke("reshape_pages", request);
    assert!(matches!(refused, Err(AppError::Failed { code: "letters-missing", .. })), "{refused:?}");

    // One text for each page, a place that exists, a picture that is one.
    let reshape = |change: Value| {
        let mut request = json!({ "pages": pages });
        for (key, value) in change.as_object().expect("an object") {
            request[key] = value.clone();
        }
        fixture.app.invoke("reshape_pages", request)
    };
    let too_few = reshape(json!({ "label": { "texts": ["1"], "place": "bottom-center", "size": 12, "margin": 20 } }));
    assert!(matches!(too_few, Err(AppError::InvalidRequest(_))), "{too_few:?}");
    let nowhere = reshape(json!({ "label": { "texts": ["1", "2"], "place": "middle", "size": 12, "margin": 20 } }));
    assert!(matches!(nowhere, Err(AppError::InvalidRequest(_))), "{nowhere:?}");
    let not_a_picture = reshape(json!({ "picture": { "data": "aGVsbG8=", "width": 0.5 } }));
    assert!(not_a_picture.is_err(), "{not_a_picture:?}");
}

#[test]
fn splits_a_document_into_several_files() {
    let fixture = Fixture::new("split", &[(100, 200), (300, 400), (500, 600)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    let page = |page: u64| json!({ "documentId": id, "page": page });
    let request = |names: [&str; 2]| {
        json!({
            "folder": fixture.dir,
            "baseDocumentId": id,
            "parts": [
                { "fileName": names[0], "pages": [page(0), page(1)] },
                { "fileName": names[1], "pages": [page(2)] },
            ],
        })
    };

    let answer = fixture.app.invoke("split_document", request(["part 1.pdf", "part 2.pdf"])).expect("split");
    let files: Vec<PathBuf> = serde_json::from_value(answer["files"].clone()).expect("file list");
    assert_eq!(files, [fixture.dir.join("part 1.pdf"), fixture.dir.join("part 2.pdf")]);

    let first = fixture.app.invoke("open_document", json!({ "path": files[0] })).expect("open part 1");
    assert_eq!(first["pageSizes"], json!([100.0, 200.0, 300.0, 400.0]));
    let second = fixture.app.invoke("open_document", json!({ "path": files[1] })).expect("open part 2");
    assert_eq!(second["pageSizes"], json!([500.0, 600.0]));

    // A name already taken stops the whole split: the new file is not written either.
    let again = fixture.app.invoke("split_document", request(["part 3.pdf", "part 1.pdf"]));
    assert!(matches!(again, Err(AppError::Failed { code: "destination-exists", .. })), "{again:?}");
    assert!(!fixture.dir.join("part 3.pdf").exists());

    // A name may not lead out of the chosen folder.
    let outside = fixture.app.invoke("split_document", request(["../escaped.pdf", "part 4.pdf"]));
    assert!(matches!(outside, Err(AppError::InvalidRequest(_))), "{outside:?}");
}

#[test]
fn refuses_to_write_over_an_open_file_or_an_empty_document() {
    let fixture = Fixture::new("save-errors", &[(600, 800)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    let page = json!({ "documentId": id, "page": 0 });

    let over_itself = fixture.app.invoke("save_pages", json!({ "destination": fixture.pdf, "pages": [page] }));
    assert!(matches!(over_itself, Err(AppError::Failed { code: "destination-in-use", .. })));

    let destination = fixture.dir.join("out.pdf");
    let empty = fixture.app.invoke("save_pages", json!({ "destination": destination, "pages": [] }));
    assert!(matches!(empty, Err(AppError::Failed { code: "save-failed", .. })));

    let missing_page = json!({ "documentId": id, "page": 9 });
    let missing = fixture.app.invoke("save_pages", json!({ "destination": destination, "pages": [missing_page] }));
    assert!(matches!(missing, Err(AppError::InvalidRequest(_))));
    assert!(!destination.exists());
}

/// What is left beside a file after it was written: nothing, when all went well.
fn leftovers(dir: &Path) -> Vec<String> {
    let names = fs::read_dir(dir).expect("reads").flatten().map(|entry| entry.file_name().to_string_lossy().into_owned());
    names.filter(|name| name.ends_with(".new") || name.ends_with(".replacing") || name.ends_with(".saving") || name.ends_with(".part")).collect()
}

#[test]
fn leaves_a_file_that_is_there_alone_or_replaces_it_when_asked() {
    let fixture = Fixture::new("replace", &[(600, 800)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    let page = json!({ "documentId": id, "page": 0 });
    let destination = fixture.dir.join("result.pdf");
    fs::write(&destination, b"already here").expect("writes");

    // Kept: the request fails and the file is as it was.
    let kept = fixture.app.invoke("save_pages", json!({ "destination": destination, "keepExisting": true, "pages": [page] }));
    assert!(matches!(kept, Err(AppError::Failed { code: "destination-exists", .. })), "{kept:?}");
    assert_eq!(fs::read(&destination).expect("reads"), b"already here");

    // Replaced: the result takes its place.
    fixture.app.invoke("save_pages", json!({ "destination": destination, "replace": true, "pages": [page] })).expect("replaces");
    assert!(fs::read(&destination).expect("reads").starts_with(b"%PDF"));
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));

    // The other formats too: left alone, then replaced.
    let words = fixture.dir.join("words.txt");
    fs::write(&words, b"already here").expect("writes");
    let request = |keep: bool| json!({ "destination": words, "format": "txt", "pages": [page], "keepExisting": keep, "replace": !keep });
    assert!(matches!(fixture.app.invoke("export_document", request(true)), Err(AppError::Failed { code: "destination-exists", .. })));
    assert_eq!(fs::read(&words).expect("reads"), b"already here");
    fixture.app.invoke("export_document", request(false)).expect("replaces");
    assert_ne!(fs::read(&words).expect("reads"), b"already here");
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));
}

#[test]
fn replaces_the_file_it_was_made_from_only_once_the_result_is_whole() {
    let fixture = Fixture::new("replace-source", &[(600, 800), (300, 200)]);
    let original = fs::read(&fixture.pdf).expect("reads");
    let id = fixture.open()["documentId"].as_u64().unwrap();

    // A result that cannot be made leaves the file as it was, and nothing beside it.
    let missing = json!([{ "documentId": id, "page": 9 }]);
    assert!(fixture.app.invoke("save_pages", json!({ "destination": fixture.pdf, "baseDocumentId": id, "replace": true, "pages": missing })).is_err());
    assert_eq!(fs::read(&fixture.pdf).expect("reads"), original);
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));

    // Written over its own file: the pages swapped and the first one turned.
    let pages = json!([{ "documentId": id, "page": 1 }, { "documentId": id, "page": 0, "rotation": 90 }]);
    fixture.app.invoke("save_pages", json!({ "destination": fixture.pdf, "baseDocumentId": id, "replace": true, "pages": pages })).expect("replaces");
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));
    // The document that read the file was closed so that it could be replaced.
    assert!(fixture.app.invoke("document_facts", json!({ "documentId": id })).is_err());
    let reopened = fixture.open();
    assert_eq!(reopened["pageSizes"], json!([300.0, 200.0, 800.0, 600.0]));

    // When the result cannot take the place of what is there, that stays as it was.
    let id = reopened["documentId"].as_u64().unwrap();
    let busy = fixture.dir.join("busy.pdf");
    fs::create_dir_all(busy.join("inside")).expect("a folder in the way");
    let refused = fixture.app.invoke("save_pages", json!({ "destination": busy, "replace": true, "pages": [{ "documentId": id, "page": 0 }] }));
    assert!(matches!(refused, Err(AppError::Failed { code: "destination-busy", .. })), "{refused:?}");
    assert!(busy.join("inside").is_dir());
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));
}

#[test]
fn says_which_files_are_there() {
    let fixture = Fixture::new("existing", &[(600, 800)]);
    let missing = fixture.dir.join("missing.pdf");
    let answer = fixture.app.invoke("existing_files", json!({ "paths": [fixture.pdf, missing] })).expect("answers");
    assert_eq!(answer["existing"], json!([fixture.pdf]));
}

#[test]
fn reports_what_is_wrong_with_a_request() {
    let fixture = Fixture::new("errors", &[(600, 800)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();

    assert!(matches!(fixture.resource(&format!("page/{id}/7"), &[]), Err(AppError::NotFound(_))));
    assert!(matches!(fixture.resource("page/999/0", &[]), Err(AppError::NotFound(_))));
    assert!(matches!(fixture.resource(&format!("page/{id}/x"), &[]), Err(AppError::InvalidRequest(_))));
    assert!(matches!(fixture.resource(&format!("poster/{id}/0"), &[]), Err(AppError::NotFound(_))));
    assert!(matches!(fixture.app.invoke("fly", Value::Null), Err(AppError::NotFound(_))));
    assert!(matches!(fixture.app.invoke("open_document", json!({})), Err(AppError::InvalidRequest(_))));

    let missing = fixture.app.invoke("open_document", json!({ "path": fixture.dir.join("nope.pdf") }));
    assert!(matches!(missing, Err(AppError::Failed { code: "cannot-open", .. })));

    fixture.app.invoke("close_document", json!({ "documentId": id })).expect("closes");
    assert!(matches!(fixture.resource(&format!("page/{id}/0"), &[]), Err(AppError::NotFound(_))));
}

#[test]
fn writes_a_draft_and_receives_a_file_in_pieces() {
    let fixture = Fixture::new("drafts", &[(200, 300), (400, 300), (300, 300)]);
    let (app, source) = (&fixture.app, &fixture.pdf);
    let opened = fixture.open();
    let id = opened["documentId"].as_u64().expect("an id");

    // Two pages taken out become a PDF of the program's own, under the name asked for.
    let draft = app
      .invoke("new_draft", json!({ "name": "pages_of_source.pdf", "baseDocumentId": id, "pages": [
        { "documentId": id, "page": 2, "rotation": 0 }, { "documentId": id, "page": 0, "rotation": 0 }
      ] }))
      .expect("writes the draft");
    let path = PathBuf::from(draft["path"].as_str().expect("a path"));
    assert_eq!(path.file_name().and_then(|name| name.to_str()), Some("pages_of_source.pdf"));
    let reopened = app.invoke("open_document", json!({ "path": path })).expect("opens the draft");
    assert_eq!(reopened["pageSizes"], json!([300.0, 300.0, 200.0, 300.0]));
    assert!(app.invoke("new_draft", json!({ "name": "../outside.pdf", "pages": [] })).is_err());

    // A file handed over in two pieces ends up whole.
    let first = app.invoke("receive_file", json!({ "name": "note.txt", "data": "SGVsbG8s" })).expect("first piece");
    let received = first["path"].as_str().expect("a path").to_owned();
    app.invoke("receive_file", json!({ "into": received, "data": "IHdvcmxk" })).expect("second piece");
    assert_eq!(fs::read_to_string(&received).expect("reads"), "Hello, world");
    // Only the program's own files can be added to.
    assert!(app.invoke("receive_file", json!({ "into": source, "data": "IHdvcmxk" })).is_err());
}

#[test]
fn draws_what_the_user_marked_on_a_page() {
    let fixture = Fixture::new("marks", &[(200, 200), (200, 100)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    let marks = json!([
        // A red box with a blue filling, in the upper left quarter.
        { "kind": "rectangle", "x": 20, "y": 20, "width": 60, "height": 60, "stroke": [1, 0, 0], "fill": [0, 0, 1], "lineWidth": 4 },
        // A green arrow along the bottom, pointing right.
        { "kind": "arrow", "x": 20, "y": 170, "width": 160, "height": 0, "stroke": [0, 0.6, 0], "lineWidth": 4 },
        // A half see-through black dot, and a highlight over nothing.
        { "kind": "dot", "x": 120, "y": 20, "width": 40, "height": 40, "stroke": [0, 0, 0], "opacity": 0.5 },
        { "kind": "highlight", "x": 100, "y": 100, "width": 60, "height": 20, "fill": [1, 1, 0], "opacity": 0.5 },
        // Text with letters the built-in fonts do not have, bold and turned.
        { "kind": "text", "x": 20, "y": 110, "width": 60, "height": 15, "text": "Ștampilă", "font": "serif", "bold": true, "size": 12, "stroke": [0, 0, 0] },
    ]);
    // The second page is turned by the user: its mark turns with it.
    let turned = json!([{ "kind": "rectangle", "x": 0, "y": 0, "width": 40, "height": 20, "fill": [1, 0, 0] }]);
    let destination = fixture.dir.join("marked.pdf");
    fixture
        .app
        .invoke(
            "save_pages",
            json!({ "destination": destination, "baseDocumentId": id, "pages": [
                { "documentId": id, "page": 0, "marks": marks },
                { "documentId": id, "page": 1, "rotation": 90, "marks": turned },
            ] }),
        )
        .expect("writes the marks");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens");
    let saved_id = saved["documentId"].as_u64().expect("document id");

    let first = Drawn::page(&fixture, saved_id, 0);
    assert_eq!(first.at(50, 50), [0, 0, 255], "the filling");
    assert_eq!(first.at(20, 50), [255, 0, 0], "the line around it");
    let [red, green, blue] = first.at(100, 170);
    assert!(green > 120 && red < 40 && blue < 40, "the arrow's line");
    assert_eq!(first.at(10, 150), [255, 255, 255], "untouched paper");
    let [grey, ..] = first.at(140, 40);
    assert!((100..160).contains(&grey), "a half see-through dot: {grey}");
    let [red, green, blue] = first.at(130, 110);
    assert!(red > 240 && green > 240 && blue < 150, "the highlight");

    // Turned a quarter clockwise, the top-left corner of the page is shown at the top right.
    let second = Drawn::page(&fixture, saved_id, 1);
    assert_eq!(saved["pageSizes"][2], json!(100.0));
    assert_eq!(second.at(90, 20), [255, 0, 0], "the mark went with its page");
    assert_eq!(second.at(10, 20), [255, 255, 255]);

    // The text is real text: it can be found, special letters included.
    let found = fixture
        .app
        .invoke("search_text", json!({ "documentId": saved_id, "query": "Ștampilă", "fromPage": 0, "pageCount": 2 }))
        .expect("searches");
    assert_eq!(found["pages"].as_array().map(Vec::len), Some(1));
}

#[test]
fn shares_a_picture_between_marks_and_blacks_out_what_is_redacted() {
    let fixture = Fixture::new("marks-shared", &[(100, 100), (100, 100)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // The picture comes with the first mark only; the second names it.
    let with_picture = json!([{ "kind": "picture", "x": 10, "y": 10, "width": 40, "height": 40, "data": marked_picture(), "dataId": 7 }]);
    let by_name = json!([
        { "kind": "picture", "x": 50, "y": 50, "width": 40, "height": 40, "dataId": 7 },
        { "kind": "redact", "x": 10, "y": 10, "width": 30, "height": 20 },
    ]);
    let destination = fixture.dir.join("shared.pdf");
    fixture
        .app
        .invoke(
            "save_pages",
            json!({ "destination": destination, "baseDocumentId": id, "pages": [
                { "documentId": id, "page": 0, "marks": with_picture },
                { "documentId": id, "page": 1, "marks": by_name },
            ] }),
        )
        .expect("writes the marks");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens")["documentId"].as_u64().expect("id");
    let first = Drawn::page(&fixture, saved, 0);
    let second = Drawn::page(&fixture, saved, 1);
    assert_ne!(first.at(30, 30), [255, 255, 255], "the picture on the first page");
    assert_ne!(second.at(70, 70), [255, 255, 255], "the same picture on the second page");
    assert_eq!(second.at(20, 20), [0, 0, 0], "the black box left by redacting");
    assert_eq!(second.at(45, 20), [255, 255, 255]);

    // A picture named but never sent is refused.
    let missing = json!([{ "kind": "picture", "x": 0, "y": 0, "width": 10, "height": 10, "dataId": 3 }]);
    let refused = fixture.app.invoke(
        "save_pages",
        json!({ "destination": fixture.dir.join("none.pdf"), "pages": [{ "documentId": id, "page": 0, "marks": missing }] }),
    );
    assert!(matches!(refused, Err(AppError::InvalidRequest(_))));
}

#[test]
fn writes_a_document_out_in_other_formats() {
    let fixture = Fixture::new("export", &[(200, 100), (100, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    let text = json!([{ "kind": "text", "x": 20, "y": 20, "width": 60, "height": 15, "text": "Exported", "size": 12, "stroke": [0, 0, 0] }]);
    let pages = json!([{ "documentId": id, "page": 0, "marks": text }, { "documentId": id, "page": 1 }]);
    let export = |name: &str, format: &str| -> Vec<PathBuf> {
        let answer = fixture
            .app
            .invoke("export_document", json!({ "destination": fixture.dir.join(name), "format": format, "baseDocumentId": id, "pages": pages, "resolution": 72 }))
            .unwrap_or_else(|error| panic!("exports as {format}: {error:?}"));
        answer["files"].as_array().expect("files").iter().map(|file| PathBuf::from(file.as_str().expect("a path"))).collect()
    };

    // Pictures: one per page, numbered, at the size asked for.
    let pictures = export("pages.png", "png");
    assert_eq!(pictures.len(), 2);
    assert!(pictures[0].ends_with("pages_001.png") && pictures[1].ends_with("pages_002.png"));
    assert_eq!(png_size(&fs::read(&pictures[0]).expect("reads")), (200, 100));
    assert_eq!(&fs::read(&export("pages.jpg", "jpg")[1]).expect("reads")[..3], &[0xFF, 0xD8, 0xFF]);
    // Asking again does not write over what is there.
    assert!(fixture.app.invoke("export_document", json!({ "destination": fixture.dir.join("pages.png"), "format": "png", "pages": pages })).is_err());

    // One file for the whole document.
    let tiff = fs::read(&export("pages.tiff", "tiff")[0]).expect("reads");
    assert_eq!(&tiff[..4], b"II\x2a\x00");
    // What was written on the page is in the text, and the pages are apart.
    let words = fs::read_to_string(&export("words.txt", "txt")[0]).expect("reads");
    assert!(words.contains("Exported") && words.contains('\u{c}'));
    assert!(fs::read_to_string(&export("page.html", "html")[0]).expect("reads").contains("Exported"));
    assert!(fs::read_to_string(&export("letters.xml", "xml")[0]).expect("reads").starts_with("<?xml"));
    assert!(fs::read_to_string(&export("drawing.svg", "svg")[0]).expect("reads").contains("<svg"));
    assert!(fs::read(&export("print.ps", "ps")[0]).expect("reads").starts_with(b"%!PS"));
    // Word processor documents are zip archives.
    assert_eq!(&fs::read(&export("letter.docx", "docx")[0]).expect("reads")[..2], b"PK");
    assert_eq!(&fs::read(&export("letter.odt", "odt")[0]).expect("reads")[..2], b"PK");

    assert!(matches!(
        fixture.app.invoke("export_document", json!({ "destination": fixture.dir.join("x.exe"), "format": "exe", "pages": pages })),
        Err(AppError::InvalidRequest(_))
    ));
}

#[test]
fn writes_a_copied_page_twice_and_text_in_a_font_of_the_computer() {
    let fixture = Fixture::new("copies", &[(200, 100), (100, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // The first page three times (copied and pasted), the last of them written on.
    let named = json!([{ "kind": "text", "x": 10, "y": 10, "width": 60, "height": 15, "text": "Copy", "font": "Arial", "bold": true, "size": 12, "stroke": [0, 0, 0] }]);
    let pages = json!([
        { "documentId": id, "page": 0 }, { "documentId": id, "page": 1 }, { "documentId": id, "page": 0 },
        { "documentId": id, "page": 0, "rotation": 90, "marks": named },
    ]);
    let destination = fixture.dir.join("copies.pdf");
    fixture.app.invoke("save_pages", json!({ "destination": destination, "baseDocumentId": id, "pages": pages })).expect("writes copies");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens");
    assert_eq!(saved["pageSizes"], json!([200.0, 100.0, 100.0, 200.0, 200.0, 100.0, 100.0, 200.0]));
    let found = fixture
        .app
        .invoke("search_text", json!({ "documentId": saved["documentId"], "query": "Copy", "fromPage": 0, "pageCount": 4 }))
        .expect("searches");
    assert_eq!(found["pages"][0]["page"], json!(3));

    // The fonts of the computer are listed by name (none where the system cannot say).
    let fonts = fixture.app.invoke("list_fonts", json!({})).expect("lists fonts");
    assert!(fonts["families"].is_array());
}

#[test]
fn rewrites_a_line_of_text() {
    let fixture = Fixture::new("rewrite", &[(300, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // A document with two lines of text, made by writing them on an empty page.
    let written = json!([
        { "kind": "text", "x": 20, "y": 20, "width": 100, "height": 15, "text": "First line", "size": 12, "stroke": [0, 0, 0] },
        { "kind": "text", "x": 20, "y": 60, "width": 100, "height": 15, "text": "Second line", "font": "serif", "bold": true, "size": 14, "stroke": [1, 0, 0] },
    ]);
    let source = fixture.dir.join("two-lines.pdf");
    fixture
        .app
        .invoke("save_pages", json!({ "destination": source, "pages": [{ "documentId": id, "page": 0, "marks": written }] }))
        .expect("writes the lines");
    let opened = fixture.app.invoke("open_document", json!({ "path": source })).expect("opens")["documentId"].as_u64().expect("id");

    // The lines are told apart, with where they stand and how they are written.
    let lines = fixture.app.invoke("text_lines", json!({ "documentId": opened, "page": 0 })).expect("reads the lines");
    let lines = lines["lines"].as_array().expect("lines");
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[1]["text"], "Second line");
    assert_eq!(lines[1]["font"], "serif");
    assert_eq!(lines[1]["bold"], true);
    assert!((lines[1]["size"].as_f64().expect("size") - 14.0).abs() < 0.5);
    assert!(lines[1]["color"][0].as_f64().expect("red") > 0.9);
    let (x, y) = (lines[1]["x"].as_f64().expect("x"), lines[1]["y"].as_f64().expect("y"));
    assert!((x - 20.0).abs() < 3.0 && (y - 60.0).abs() < 6.0, "at {x}, {y}");

    // The second line is taken out and written anew; the first stays.
    let rewrite = json!([
        { "kind": "erase", "x": x, "y": y, "width": lines[1]["width"], "height": lines[1]["height"] },
        { "kind": "text", "x": x, "y": y, "width": 100, "height": 15, "text": "Changed", "size": 14, "stroke": [0, 0, 0] },
    ]);
    let destination = fixture.dir.join("rewritten.pdf");
    fixture
        .app
        .invoke("save_pages", json!({ "destination": destination, "pages": [{ "documentId": opened, "page": 0, "marks": rewrite }] }))
        .expect("rewrites");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens")["documentId"].as_u64().expect("id");
    let found = |query: &str| {
        let answer = fixture.app.invoke("search_text", json!({ "documentId": saved, "query": query, "fromPage": 0, "pageCount": 1 })).expect("searches");
        answer["pages"].as_array().map_or(0, Vec::len)
    };
    assert_eq!(found("Second"), 0, "the old text is gone from the file");
    assert_eq!(found("Changed"), 1);
    assert_eq!(found("First line"), 1);
    // Nothing was drawn where the old line stood.
    let drawn = Drawn::page(&fixture, saved, 0);
    assert_eq!(drawn.at(250, 68), [255, 255, 255]);
}

#[test]
fn writes_links_fields_bookmarks_and_attached_files() {
    let fixture = Fixture::new("additions", &[(600, 800), (300, 200)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    let attached = fixture.dir.join("notes.txt");
    fs::write(&attached, "kept with the document").expect("a file to attach");

    let marks = json!([
        { "kind": "link", "x": 50, "y": 100, "width": 120, "height": 20, "url": "https://syntelab.com/a b" },
        { "kind": "link", "x": 50, "y": 140, "width": 120, "height": 20, "toPage": 1 },
        { "kind": "textField", "x": 50, "y": 200, "width": 200, "height": 24, "name": "Nume" },
        { "kind": "textField", "x": 50, "y": 240, "width": 200, "height": 24, "name": "Nume" },
        { "kind": "checkBox", "x": 50, "y": 280, "width": 14, "height": 14, "name": "De acord" },
        { "kind": "signatureField", "x": 50, "y": 320, "width": 180, "height": 48, "name": "Semnătură" },
        { "kind": "bookmark", "x": 20, "y": 300, "width": 18, "height": 18, "name": "Capitolul întâi" },
        { "kind": "attachment", "x": 500, "y": 40, "width": 18, "height": 22, "rotation": 90, "stroke": [0.8, 0.1, 0.1], "name": "notes.txt", "author": "Ana", "path": attached },
    ]);
    let destination = fixture.dir.join("with-additions.pdf");
    fixture
        .app
        .invoke(
            "save_pages",
            json!({
                "destination": destination,
                "pages": [{ "documentId": id, "page": 0, "marks": marks }, { "documentId": id, "page": 1 }],
            }),
        )
        .expect("saves");

    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens")["documentId"].as_u64().expect("id");
    // The fields can be filled in like those of any form; two of one name are told apart.
    let fields = fixture.app.invoke("form_fields", json!({ "documentId": saved })).expect("fields")["fields"].clone();
    let names: Vec<&str> = fields.as_array().expect("a list").iter().map(|field| field["name"].as_str().unwrap_or("")).collect();
    assert_eq!(names, ["Nume", "Nume 2", "De acord"]);
    assert_eq!(fields[0]["kind"], "text");
    assert_eq!(fields[2]["kind"], "checkbox");
    assert_eq!(fields[2]["on"], "Yes");
    let area = &fields[0]["area"];
    assert!((area[0].as_f64().expect("x") - 50.0).abs() < 1.0 && (area[1].as_f64().expect("y") - 200.0).abs() < 1.0, "at {area}");

    // The attached file is listed and can be taken out again.
    let files = fixture.app.invoke("attached_files", json!({ "documentId": saved })).expect("lists");
    assert_eq!(files["files"], json!([{ "name": "notes.txt", "size": 22 }]));
    let taken_out = fixture.dir.join("taken-out.txt");
    fixture.app.invoke("save_attached_file", json!({ "documentId": saved, "name": "notes.txt", "destination": taken_out })).expect("writes it out");
    assert_eq!(fs::read_to_string(&taken_out).expect("the file"), "kept with the document");

    // The bookmark leads to its page.
    let facts = fixture.app.invoke("document_facts", json!({ "documentId": saved })).expect("facts");
    assert_eq!(facts["bookmarks"], json!([{ "title": "Capitolul întâi", "page": 0, "children": [] }]));

    // Links, the signature field and the attached file are in the file as PDF keeps them.
    let bytes = fs::read(&destination).expect("the saved file");
    let document = mupdf::pdf::PdfDocument::from_bytes(&bytes).expect("a pdf");
    let page = document.find_page(0).expect("page");
    let annotations = page.get_dict("Annots").expect("reads").expect("annotations");
    let mut kinds = Vec::new();
    for index in 0..annotations.len().expect("a list") {
        let annotation = annotations.get_array(index as i32).expect("reads").expect("an entry");
        let subtype = String::from_utf8(annotation.get_dict("Subtype").expect("reads").expect("a kind").as_name().expect("a name")).expect("text");
        if subtype == "Link" {
            let leads = match annotation.get_dict("A").expect("reads") {
                Some(action) => action.get_dict("URI").expect("reads").expect("an address").as_string().expect("text"),
                None => format!("page {}", document.lookup_page_number(&annotation.get_dict("Dest").expect("reads").expect("a place").get_array(0).expect("reads").expect("a page")).expect("a number")),
            };
            kinds.push(format!("Link {leads}"));
        } else {
            if subtype == "FileAttachment" {
                // Who attached it is said, and the clip turned a quarter takes a lying box.
                assert_eq!(annotation.get_dict("T").expect("reads").expect("an author").as_string().expect("text"), "Ana");
                let rect = annotation.get_dict("Rect").expect("reads").expect("a box");
                let side = |index: i32| rect.get_array(index).expect("reads").expect("a number").as_float().expect("a number");
                assert!((side(2) - side(0) - 22.0).abs() < 0.1 && (side(3) - side(1) - 18.0).abs() < 0.1);
            }
            kinds.push(subtype);
        }
    }
    assert_eq!(kinds, ["Link https://syntelab.com/a%20b", "Link page 1", "Widget", "Widget", "Widget", "Widget", "FileAttachment"]);
    let files = document.embedded_files().expect("attached files");
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].name, "notes.txt");
    assert_eq!(document.load_embedded_file("notes.txt").expect("reads").expect("the file"), b"kept with the document");
}

#[test]
fn adds_lists_and_radio_buttons_and_changes_bookmarks_and_attached_files() {
    let fixture = Fixture::new("changes", &[(600, 800), (300, 200)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    let attached = fixture.dir.join("notes.txt");
    fs::write(&attached, "kept with the document").expect("a file to attach");

    let marks = json!([
        { "kind": "choiceField", "x": 50, "y": 100, "width": 160, "height": 22, "name": "Țară", "options": ["România", "Italia", " "] },
        { "kind": "radioButton", "x": 50, "y": 140, "width": 14, "height": 14, "name": "Plată", "value": "Card" },
        { "kind": "radioButton", "x": 80, "y": 140, "width": 14, "height": 14, "name": "Plată", "value": "Numerar" },
        { "kind": "link", "x": 50, "y": 200, "width": 120, "height": 20, "url": "https://syntelab.com" },
        { "kind": "link", "x": 50, "y": 240, "width": 120, "height": 20, "toPage": 1 },
        { "kind": "bookmark", "x": 20, "y": 100, "width": 18, "height": 18, "name": "Unu" },
        { "kind": "bookmark", "x": 20, "y": 300, "width": 18, "height": 18, "name": "Doi" },
        { "kind": "bookmark", "x": 20, "y": 500, "width": 18, "height": 18, "name": "Trei" },
        { "kind": "attachment", "x": 500, "y": 40, "width": 18, "height": 22, "name": "notes.txt", "path": attached },
    ]);
    let first = fixture.dir.join("first.pdf");
    fixture
        .app
        .invoke("save_pages", json!({ "destination": first, "pages": [{ "documentId": id, "page": 0, "marks": marks }, { "documentId": id, "page": 1 }] }))
        .expect("saves");
    let saved = fixture.app.invoke("open_document", json!({ "path": first })).expect("opens")["documentId"].as_u64().expect("id");

    // A list to choose from, and two buttons of one group, each with an answer of its own.
    let fields = fixture.app.invoke("form_fields", json!({ "documentId": saved })).expect("fields")["fields"].clone();
    let fields = fields.as_array().expect("a list");
    assert_eq!(fields.len(), 3);
    assert_eq!(fields[0]["kind"], "choice");
    assert_eq!(fields[0]["options"], json!([{ "value": "România", "text": "România" }, { "value": "Italia", "text": "Italia" }]));
    assert_eq!((fields[1]["kind"].as_str(), fields[2]["kind"].as_str()), (Some("radio"), Some("radio")));
    assert_eq!((fields[1]["name"].as_str(), fields[2]["name"].as_str()), (Some("Plată"), Some("Plată")));
    assert_eq!((fields[1]["on"].as_str(), fields[2]["on"].as_str()), (Some("Card1"), Some("Numerar2")));

    // The links of the page are read back: where they are and where they lead.
    let links = fixture.app.invoke("page_links", json!({ "documentId": saved, "page": 0 })).expect("links")["links"].clone();
    let links = links.as_array().expect("a list");
    assert_eq!(links.len(), 2);
    let address = links.iter().find(|link| !link["url"].is_null()).expect("a link to an address");
    assert_eq!(address["url"], "https://syntelab.com");
    assert!((address["x"].as_f64().expect("x") - 50.0).abs() < 1.0 && (address["y"].as_f64().expect("y") - 200.0).abs() < 1.0);
    assert_eq!(links.iter().find(|link| !link["page"].is_null()).expect("a link to a page")["page"], 1);

    // Saved again with changes: the middle bookmark goes, the last gets another title, the file is taken out.
    let second = fixture.dir.join("second.pdf");
    fixture
        .app
        .invoke(
            "save_pages",
            json!({
                "destination": second,
                "baseDocumentId": saved,
                "pages": [{ "documentId": saved, "page": 0 }, { "documentId": saved, "page": 1 }],
                "changes": { "bookmarks": [{ "path": [1], "remove": true }, { "path": [2], "title": "Al treilea" }], "detach": ["notes.txt"] },
            }),
        )
        .expect("saves with changes");
    let changed = fixture.app.invoke("open_document", json!({ "path": second })).expect("opens")["documentId"].as_u64().expect("id");
    let facts = fixture.app.invoke("document_facts", json!({ "documentId": changed })).expect("facts");
    let titles: Vec<&str> = facts["bookmarks"].as_array().expect("a list").iter().map(|bookmark| bookmark["title"].as_str().unwrap_or("")).collect();
    assert_eq!(titles, ["Unu", "Al treilea"]);
    assert_eq!(fixture.app.invoke("attached_files", json!({ "documentId": changed })).expect("lists")["files"], json!([]));
    let bytes = fs::read(&second).expect("the saved file");
    let document = mupdf::pdf::PdfDocument::from_bytes(&bytes).expect("a pdf");
    let annotations = document.find_page(0).expect("page").get_dict("Annots").expect("reads").expect("annotations");
    let clips = (0..annotations.len().expect("a list"))
        .filter(|index| {
            let kind = annotations.get_array(*index as i32).expect("reads").expect("an entry").get_dict("Subtype").expect("reads").expect("a kind").as_name().expect("a name");
            kind == b"FileAttachment"
        })
        .count();
    assert_eq!(clips, 0, "the paper clip went with its file");
}

/// Signing needs the certificates of the system: Windows only for now.
#[cfg(windows)]
#[test]
fn signs_a_document_with_a_certificate_and_checks_the_signature() {
    let fixture = Fixture::new("sign", &[(600, 800), (300, 200)]);
    let id = fixture.open()["documentId"].as_u64().unwrap();
    let certificate = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../crates/syntelab-platform/tests/fixtures/test-signer.pfx");

    // The file with a certificate is opened with its password only.
    let facts = fixture.app.invoke("certificate_of_file", json!({ "path": certificate, "password": "test-only" })).expect("opens");
    assert_eq!(facts["subject"], "Syntelab Test Signer");
    let refused = fixture.app.invoke("certificate_of_file", json!({ "path": certificate, "password": "wrong" }));
    assert!(matches!(refused, Err(AppError::Failed { code: "wrong-password", .. })), "{refused:?}");

    // A document that was never signed has no signatures.
    assert_eq!(fixture.app.invoke("signatures", json!({ "documentId": id })).expect("looks")["signatures"], json!([]));

    let signed_path = fixture.dir.join("signed.pdf");
    let request = |destination: &Path, password: &str| {
        json!({
            "destination": destination,
            "baseDocumentId": id,
            // The first page is turned: the box of the signature turns with it.
            "pages": [
                { "documentId": id, "page": 0, "rotation": 90, "marks": [{ "kind": "text", "x": 100, "y": 600, "width": 200, "height": 15, "text": "Signed by the test", "size": 10, "stroke": [0, 0, 0] }] },
                { "documentId": id, "page": 1 },
            ],
            "certificate": { "path": certificate, "password": password },
            "place": { "page": 0, "x": 100, "y": 600, "width": 200, "height": 60 },
            // What the signature shows, placed in its box.
            "look": [{ "kind": "text", "x": 10, "y": 10, "width": 180, "height": 15, "text": "Semnat de Ștefan", "size": 10, "stroke": [0, 0, 0.6] }],
            "reason": "Încercare",
            "location": "București",
        })
    };
    let refused = fixture.app.invoke("sign_document", request(&signed_path, "wrong"));
    assert!(matches!(refused, Err(AppError::Failed { code: "wrong-password", .. })), "{refused:?}");
    assert!(!signed_path.exists(), "nothing is written when signing is refused");

    let answer = fixture.app.invoke("sign_document", request(&signed_path, "test-only")).expect("signs");
    assert_eq!(answer["signer"], "Syntelab Test Signer");
    assert!(!fixture.dir.join("signed.pdf.saving").exists() && !fixture.dir.join("signed.pdf.room").exists());

    let signed = fixture.app.invoke("open_document", json!({ "path": signed_path })).expect("the signed file opens");
    assert_eq!(signed["pageSizes"], json!([800.0, 600.0, 300.0, 200.0]));
    let signed_id = signed["documentId"].as_u64().expect("id");
    let signatures = fixture.app.invoke("signatures", json!({ "documentId": signed_id })).expect("looks")["signatures"].clone();
    assert_eq!(signatures.as_array().map(Vec::len), Some(1));
    let signature = &signatures[0];
    assert_eq!(signature["signer"], "Syntelab Test Signer");
    assert_eq!(signature["reason"], "Încercare");
    assert_eq!(signature["location"], "București");
    assert_eq!(signature["intact"], true);
    assert_eq!(signature["wholeFile"], true);
    // Made for the tests: no computer trusts it.
    assert_eq!(signature["trust"], "untrusted");
    assert!(signature["time"].as_str().is_some_and(|time| time.starts_with("D:20") && time.ends_with('Z')));

    // The signature is in the file as PAdES asks, and its field is where the box was drawn.
    let bytes = fs::read(&signed_path).expect("the signed file");
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("/ETSI.CAdES.detached") && text.contains("/Adobe.PPKLite"));
    let document = mupdf::pdf::PdfDocument::from_bytes(&bytes).expect("a pdf");
    let fields = document.find_page(0).expect("page").get_dict("Annots").expect("reads").expect("annotations");
    let field = fields.get_array(0).expect("reads").expect("the field");
    let at = text.find("/FT").unwrap_or(0);
    let rect = field.get_dict("Rect").expect("reads").unwrap_or_else(|| panic!("no box; the file says: {}", &text[at.saturating_sub(200)..(at + 200).min(text.len())]));
    let side = |index: i32| rect.get_array(index).expect("reads").expect("a number").as_float().expect("a number");
    assert_eq!([side(0), side(1), side(2), side(3)], [100.0, 140.0, 300.0, 200.0]);

    // What the signature shows is the picture of its field, with its text in it.
    let look = fields.get_array(0).expect("reads").expect("the field").get_dict("AP").expect("reads").expect("a picture").get_dict("N").expect("reads").expect("the usual one");
    let drawn = String::from_utf8_lossy(&look.read_stream().expect("a stream")).into_owned();
    assert!(drawn.contains("Tj"), "{drawn}");
    drop(document);

    // A second person signs the same file: the signature is added to its end, and the first stays good.
    let twice_path = fixture.dir.join("signed-twice.pdf");
    let second = |destination: &Path, lock: bool| {
        json!({ "destination": destination, "baseDocumentId": signed_id, "certificate": { "path": certificate, "password": "test-only" }, "reason": "A doua", "lock": lock })
    };
    fixture.app.invoke("sign_document", second(&twice_path, true)).expect("signs again");
    let twice_bytes = fs::read(&twice_path).expect("the file");
    assert!(twice_bytes.starts_with(&bytes), "the file signed before is still there, byte for byte");
    let twice_id = fixture.app.invoke("open_document", json!({ "path": twice_path })).expect("opens")["documentId"].as_u64().expect("id");
    let both = fixture.app.invoke("signatures", json!({ "documentId": twice_id })).expect("looks")["signatures"].clone();
    assert_eq!(both.as_array().map(Vec::len), Some(2));
    assert_eq!((both[0]["intact"].as_bool(), both[0]["wholeFile"].as_bool(), both[0]["signedAfter"].as_bool(), both[0]["locks"].as_bool()), (Some(true), Some(false), Some(true), Some(false)));
    assert_eq!((both[1]["intact"].as_bool(), both[1]["wholeFile"].as_bool(), both[1]["locks"].as_bool()), (Some(true), Some(true), Some(true)));
    assert_eq!(both[1]["reason"], "A doua");

    // The second signature closed the document: a third is refused, and nothing is written.
    let third_path = fixture.dir.join("signed-thrice.pdf");
    let refused = fixture.app.invoke("sign_document", json!({ "destination": third_path, "baseDocumentId": twice_id, "certificate": { "path": certificate, "password": "test-only" } }));
    assert!(matches!(refused, Err(AppError::Failed { code: "document-locked", .. })), "{refused:?}");
    assert!(!third_path.exists());

    // Pages taken out of a signed file into a new one leave the signatures behind: there, they would be broken.
    let taken_path = fixture.dir.join("taken-out.pdf");
    fixture.app.invoke("save_pages", json!({ "destination": taken_path, "baseDocumentId": twice_id, "pages": [{ "documentId": twice_id, "page": 0 }] })).expect("saves");
    let taken_id = fixture.app.invoke("open_document", json!({ "path": taken_path })).expect("opens")["documentId"].as_u64().expect("id");
    assert_eq!(fixture.app.invoke("signatures", json!({ "documentId": taken_id })).expect("looks")["signatures"], json!([]));
    let taken = fs::read(&taken_path).expect("the file");
    let taken_text = String::from_utf8_lossy(&taken);
    assert!(!taken_text.contains("/ByteRange") && !taken_text.contains("/DocMDP"), "nothing of the signatures is left");
    // And it can be signed anew, by anyone.
    let anew_path = fixture.dir.join("signed-anew.pdf");
    fixture.app.invoke("sign_document", json!({ "destination": anew_path, "baseDocumentId": taken_id, "certificate": { "path": certificate, "password": "test-only" } })).expect("signs the new file");

    // One byte of the page changed after signing: the signature no longer fits.
    let mut changed = bytes.clone();
    let at = changed.windows(6).position(|window| window == b"stream").expect("a stream") + 12;
    changed[at] ^= 0x01;
    let changed_path = fixture.dir.join("changed.pdf");
    fs::write(&changed_path, &changed).expect("writes");
    if let Ok(opened) = fixture.app.invoke("open_document", json!({ "path": changed_path })) {
        let looked = fixture.app.invoke("signatures", json!({ "documentId": opened["documentId"] })).expect("looks")["signatures"].clone();
        assert_eq!(looked[0]["intact"], false);
    }

    // Something added after the signature: it is intact, but no longer covers the whole file.
    let mut longer = bytes.clone();
    longer.extend_from_slice(b"\n% added later\n");
    let longer_path = fixture.dir.join("longer.pdf");
    fs::write(&longer_path, &longer).expect("writes");
    let opened = fixture.app.invoke("open_document", json!({ "path": longer_path })).expect("opens");
    let looked = fixture.app.invoke("signatures", json!({ "documentId": opened["documentId"] })).expect("looks")["signatures"].clone();
    assert_eq!((looked[0]["intact"].as_bool(), looked[0]["wholeFile"].as_bool()), (Some(true), Some(false)));
}

/// Signing needs the certificates of the system: Windows only for now.
#[cfg(windows)]
#[test]
fn signs_a_file_in_its_own_place() {
    let fixture = Fixture::new("sign-in-place", &[(600, 800)]);
    let certificate = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../crates/syntelab-platform/tests/fixtures/test-signer.pfx");
    let signatures_of_file = |fixture: &Fixture| {
        let id = fixture.open()["documentId"].as_u64().expect("id");
        let found = fixture.app.invoke("signatures", json!({ "documentId": id })).expect("looks")["signatures"].clone();
        fixture.app.invoke("close_document", json!({ "documentId": id })).expect("closes");
        found
    };

    // Written anew and signed: the signed file takes the place of the one it was made from, which this program had open.
    let id = fixture.open()["documentId"].as_u64().expect("id");
    let request = json!({ "destination": fixture.pdf, "baseDocumentId": id, "replace": true, "pages": [{ "documentId": id, "page": 0 }], "certificate": { "path": certificate, "password": "test-only" } });
    fixture.app.invoke("sign_document", request).expect("signs in place");
    let found = signatures_of_file(&fixture);
    assert_eq!(found.as_array().map(Vec::len), Some(1));
    assert_eq!(found[0]["intact"], true);

    // Only signed: the signature is added to the end of the file, in its own place too, and the first one stays good.
    let signed = fs::read(&fixture.pdf).expect("reads");
    let id = fixture.open()["documentId"].as_u64().expect("id");
    let request = json!({ "destination": fixture.pdf, "baseDocumentId": id, "replace": true, "certificate": { "path": certificate, "password": "test-only" } });
    fixture.app.invoke("sign_document", request).expect("signs again in place");
    assert!(fs::read(&fixture.pdf).expect("reads").starts_with(&signed));
    let found = signatures_of_file(&fixture);
    assert_eq!(found.as_array().map(Vec::len), Some(2));
    assert_eq!((found[0]["intact"].as_bool(), found[1]["intact"].as_bool(), found[1]["wholeFile"].as_bool()), (Some(true), Some(true), Some(true)));
    assert!(leftovers(&fixture.dir).is_empty(), "{:?}", leftovers(&fixture.dir));
}

#[test]
fn finds_the_pictures_of_a_page_and_moves_one() {
    let fixture = Fixture::new("pictures", &[(200, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // A page with two pictures on it, written into the file first.
    let with_pictures = fixture.dir.join("with-pictures.pdf");
    let marks = json!([
        { "kind": "picture", "x": 20, "y": 20, "width": 40, "height": 40, "data": marked_picture(), "dataId": 1 },
        { "kind": "picture", "x": 120, "y": 120, "width": 60, "height": 60, "dataId": 1 },
    ]);
    fixture
        .app
        .invoke("save_pages", json!({ "destination": with_pictures, "pages": [{ "documentId": id, "page": 0, "marks": marks }] }))
        .expect("saves");
    let opened = fixture.app.invoke("open_document", json!({ "path": with_pictures })).expect("opens")["documentId"].as_u64().expect("id");

    // Both are found, where they were put.
    let pictures = fixture.app.invoke("page_pictures", json!({ "documentId": opened, "page": 0 })).expect("lists")["pictures"].clone();
    let pictures = pictures.as_array().expect("a list");
    assert_eq!(pictures.len(), 2);
    let at = |picture: &Value| ["x", "y", "width", "height"].map(|side| picture[side].as_f64().expect("a number").round());
    assert_eq!(at(&pictures[0]), [20.0, 20.0, 40.0, 40.0]);
    assert_eq!(at(&pictures[1]), [120.0, 120.0, 60.0, 60.0]);

    // The pixels of one come back as a PNG, to be put on the page anew.
    let taken = fixture.app.invoke("page_picture", json!({ "documentId": opened, "page": 0, "picture": 0 })).expect("reads");
    assert_eq!(taken["type"], "image/png");
    let data = taken["data"].as_str().expect("data");
    assert!(data.starts_with("iVBOR"), "PNG data");
    assert!(fixture.app.invoke("page_picture", json!({ "documentId": opened, "page": 0, "picture": 5 })).is_err());

    // The first picture is taken out of the file and put elsewhere; the second stays.
    let drawn_before = Drawn::page(&fixture, opened, 0);
    assert_ne!(drawn_before.at(40, 40), [255, 255, 255]);
    let moved = fixture.dir.join("moved.pdf");
    let marks = json!([
        { "kind": "erasePicture", "x": 20, "y": 20, "width": 40, "height": 40 },
        { "kind": "picture", "x": 20, "y": 120, "width": 40, "height": 40, "data": data },
    ]);
    fixture
        .app
        .invoke("save_pages", json!({ "destination": moved, "baseDocumentId": opened, "pages": [{ "documentId": opened, "page": 0, "marks": marks }] }))
        .expect("saves");
    let after = fixture.app.invoke("open_document", json!({ "path": moved })).expect("opens")["documentId"].as_u64().expect("id");
    let drawn = Drawn::page(&fixture, after, 0);
    assert_eq!(drawn.at(40, 40), [255, 255, 255], "nothing is left where the picture was");
    assert_eq!(drawn.at(40, 140), drawn_before.at(40, 40), "the same picture, at its new place");
    assert_eq!(drawn.at(150, 150), drawn_before.at(150, 150), "the other picture stays");
    let left = fixture.app.invoke("page_pictures", json!({ "documentId": after, "page": 0 })).expect("lists")["pictures"].clone();
    assert_eq!(left.as_array().map(Vec::len), Some(2), "the one that stayed, and the one put anew");
}

#[test]
fn writes_text_that_is_found_but_not_seen() {
    let fixture = Fixture::new("hidden-text", &[(300, 200)]);
    let id = fixture.open()["documentId"].as_u64().expect("document id");
    // What reading a scanned page gives: words, each with its box. One lies on its side.
    let marks = json!([
        { "kind": "hiddenText", "x": 0, "y": 0, "width": 300, "height": 200, "words": [
            { "text": "Ștampilă", "x": 40, "y": 50, "width": 90, "height": 20 },
            { "text": "rotundă", "x": 140, "y": 50, "width": 80, "height": 20 },
        ] },
        { "kind": "hiddenText", "x": 0, "y": 0, "width": 300, "height": 200, "turn": 90, "words": [
            { "text": "Lateral", "x": 260, "y": 40, "width": 18, "height": 90 },
        ] },
    ]);
    let destination = fixture.dir.join("read.pdf");
    fixture
        .app
        .invoke("save_pages", json!({ "destination": destination, "pages": [{ "documentId": id, "page": 0, "marks": marks }] }))
        .expect("saves");
    let saved = fixture.app.invoke("open_document", json!({ "path": destination })).expect("opens")["documentId"].as_u64().expect("id");

    // The words are found, where their boxes are…
    let found = |query: &str| fixture.app.invoke("search_text", json!({ "documentId": saved, "query": query, "fromPage": 0, "pageCount": 1 })).expect("searches");
    let hit = found("Ștampilă");
    let boxes = hit["pages"][0]["boxes"].as_array().expect("boxes").clone();
    // One box: x, y, width and height, in points from the top-left corner.
    assert_eq!(boxes.len(), 4, "{hit}");
    let side = |index: usize| boxes[index].as_f64().expect("a number");
    assert!((side(0) - 40.0).abs() < 4.0 && (side(2) - 90.0).abs() < 8.0, "across: {hit}");
    assert!(side(1) > 40.0 && side(1) + side(3) < 80.0, "down: {hit}");
    assert_eq!(found("rotundă")["pages"].as_array().map(Vec::len), Some(1));
    assert_eq!(found("Lateral")["pages"].as_array().map(Vec::len), Some(1));

    // …and nothing of them is seen: the page is as white as it was.
    let drawn = Drawn::page(&fixture, saved, 0);
    for (x, y) in [(60, 60), (85, 58), (180, 60), (268, 80)] {
        assert_eq!(drawn.at(x, y), [255, 255, 255], "at {x}, {y}");
    }
}

/// The pixels of a PNG, red-green-blue, with its width and height.
fn rgb_of(png: &[u8]) -> (Vec<u8>, usize, usize) {
    let mut reader = png::Decoder::new(png).read_info().expect("png header");
    let mut pixels = vec![0; reader.output_buffer_size()];
    let info = reader.next_frame(&mut pixels).expect("png data");
    assert_eq!(info.color_type.samples(), 3);
    pixels.truncate(info.buffer_size());
    (pixels, info.width as usize, info.height as usize)
}

#[test]
fn draws_a_piece_of_a_page_exactly_as_it_is_in_the_whole_page() {
    let fixture = Fixture::new("tiles", &[(100, 100)]);
    // Text on it, so a piece out of place would not match.
    let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/generated/small.pdf");
    let id = fixture.app.invoke("open_document", json!({ "path": sample })).expect("open sample")["documentId"].as_u64().unwrap();

    for rotate in ["0", "90"] {
        let whole = fixture.resource(&format!("page/{id}/0"), &[("scale", "1.7"), ("rotate", rotate)]).expect("the page draws");
        let (pixels, width, height) = rgb_of(&whole.bytes);
        // A piece in the middle, and one reaching past the corner (cut at the edge).
        for (x, y, w, h) in [(100, 150, 300, 200), (width - 50, height - 40, 512, 512)] {
            let tile = format!("{x},{y},{w},{h}");
            let piece = fixture.resource(&format!("page/{id}/0"), &[("scale", "1.7"), ("rotate", rotate), ("tile", &tile)]).expect("the piece draws");
            let (piece_pixels, piece_width, piece_height) = rgb_of(&piece.bytes);
            assert_eq!((piece_width, piece_height), (w.min(width - x), h.min(height - y)), "{rotate}° {tile}");
            let differing = (0..piece_height)
                .flat_map(|row| (0..piece_width * 3).map(move |at| (row, at)))
                .filter(|&(row, at)| piece_pixels[row * piece_width * 3 + at].abs_diff(pixels[(y + row) * width * 3 + x * 3 + at]) > 8)
                .count();
            assert!(differing * 200 < piece_pixels.len(), "{rotate}° {tile}: {differing} values differ");
        }
    }
    // A piece outside the page is no picture.
    assert!(fixture.resource(&format!("page/{id}/0"), &[("scale", "1"), ("tile", "99999,0,10,10")]).is_err());
}

/// With PDFium installed (named by `SYNTELAB_PDFIUM`), pages on screen are drawn by it: the same size as MuPDF
/// draws them, the same way up, and with the same things in the same places.
#[test]
fn draws_pages_with_pdfium_where_mupdf_would_put_them() {
    use pdf_organizer_backend::engine::{PdfFile, Rotation, ScreenPages};
    if std::env::var_os("SYNTELAB_PDFIUM").is_none() {
        eprintln!("SYNTELAB_PDFIUM is not set: nothing to compare");
        return;
    }
    let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../tests/fixtures/generated/small.pdf");
    let file = PdfFile::open(&sample).expect("open sample");
    let mut screen = ScreenPages::new(sample.clone());
    assert!(screen.drawn_by_pdfium(&file), "PDFium did not open the sample");

    for rotation in [Rotation::None, Rotation::Quarter, Rotation::Half, Rotation::ThreeQuarters] {
        let sharp = screen.page_png(&file, 0, 1.3, rotation).expect("PDFium draws the page");
        let plain = file.render_png(0, 1.3, rotation).expect("MuPDF draws the page");
        let (sharp, width, height) = rgb_of(&sharp);
        let (plain, plain_width, plain_height) = rgb_of(&plain);
        assert_eq!((width, height), (plain_width, plain_height), "{rotation:?}");
        // Seen as gray blocks of 8 × 8 pixels, the two pictures are alike: what is drawn is in the same place.
        let block = |pixels: &[u8], bx: usize, by: usize| {
            let mut sum = 0u32;
            for y in by * 8..(by * 8 + 8).min(height) {
                for x in bx * 8..(bx * 8 + 8).min(width) {
                    let at = (y * width + x) * 3;
                    sum += u32::from(pixels[at]) + u32::from(pixels[at + 1]) + u32::from(pixels[at + 2]);
                }
            }
            sum / 192
        };
        let (mut differing, mut blocks, mut inked) = (0, 0, 0);
        for by in 0..height / 8 {
            for bx in 0..width / 8 {
                let (a, b) = (block(&sharp, bx, by), block(&plain, bx, by));
                blocks += 1;
                inked += usize::from(b < 250);
                differing += usize::from(a.abs_diff(b) > 40);
            }
        }
        assert!(inked > 10, "{rotation:?}: the sample page should have something on it");
        assert!(differing * 50 < blocks, "{rotation:?}: {differing} of {blocks} blocks differ");
        // Pieces are cut from exactly that picture.
        let tile = pdf_organizer_backend::engine::Tile::parse("40,30,200,100").unwrap();
        let piece = screen.tile_png(&file, 0, 1.3, rotation, tile).expect("PDFium draws the piece");
        let (piece, piece_width, piece_height) = rgb_of(&piece);
        assert_eq!((piece_width, piece_height), (200, 100));
        let differing = (0..100)
            .flat_map(|row| (0..600).map(move |at| (row, at)))
            .filter(|&(row, at)| piece[row * 600 + at].abs_diff(sharp[(30 + row) * width * 3 + 40 * 3 + at]) > 8)
            .count();
        assert!(differing * 200 < piece.len(), "{rotation:?}: {differing} values of the piece differ");
    }
}
