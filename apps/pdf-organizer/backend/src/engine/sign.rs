//! Signing a PDF with a certificate, and finding the signatures a PDF has
//! (MuPDF binding for the objects; the signature itself is made by whoever
//! calls, see `syntelab-platform`).
//!
//! A signature covers every byte of the file except its own place. So the
//! file is written first with room left for the signature and for the numbers
//! that say what it covers; then those numbers are filled in, the bytes are
//! signed, and the signature is written into its room. This is the PAdES
//! baseline form (`ETSI.CAdES.detached`); with a time stamp kept in the
//! signature, PAdES B-T. A document's own time stamp (`/DocTimeStamp`,
//! `ETSI.RFC3161`) is written the same way, with the stamp in the room.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use mupdf::pdf::{PdfDocument, PdfObject, PdfWriteOptions};

use super::additions::{add_object, add_to_form, push_annotation, text_string};
use super::marks::{self, Mark};
use super::page_change::{failed, own_box_turned};
use super::{Area, EngineError};

/// The room left for a signature, in bytes: enough for the certificates of a long chain, and for a time stamp with the
/// certificates of its authority.
const SIGNATURE_ROOM: usize = 32_768;
/// What stands for a number of the byte range until it is known: as wide as any place in a file can be written.
const UNKNOWN: &str = "1111111111";

/// One place where a signature shows.
#[derive(Debug, Clone, PartialEq)]
pub struct ShownSignature {
    /// The page, from 0.
    pub page: usize,
    /// The box on the page as it was shown before the user's own turn
    /// (`added_rotation`, degrees), like what is drawn on a page.
    pub area: Area,
    pub added_rotation: i32,
    /// What shows in the box: marks placed in it (from its top-left corner),
    /// drawn as the picture of the signature itself, not into the page.
    /// Empty: the box shows nothing.
    pub look: Vec<Mark>,
}

/// What a signature says about itself, and where it shows.
#[derive(Debug, Clone, PartialEq)]
pub struct SignatureRequest {
    /// Where the signature shows: on one page, or the same signature on
    /// several (one field, with a box on each page). Empty: it shows nowhere.
    pub shown: Vec<ShownSignature>,
    /// Who signs.
    pub name: String,
    pub reason: String,
    pub location: String,
    /// After this signature nothing more may be changed, and no one else can sign.
    pub lock: bool,
    /// The file is added to at its end and not written anew: the signatures
    /// it already has stay as good as they were.
    pub added_to: bool,
    /// A time stamp of the document itself (`/DocTimeStamp`), not a signature: it shows nowhere, says nothing of
    /// anyone, and closes nothing. What is handed back to be put in its room is the stamp.
    pub time_stamp_only: bool,
    /// Room the signature needs beyond the usual, in bytes: for what its certificate's issuer said of it, kept inside it.
    pub extra_room: usize,
}

/// A signature found in a file.
#[derive(Debug, Clone, PartialEq)]
pub struct FoundSignature {
    /// The name of its field in the form.
    pub field: String,
    /// The number of its field's object in the file (0 when it has none of its own): its boxes on the pages say it.
    pub object: i32,
    /// What the signature says of itself; empty where it says nothing.
    pub name: String,
    pub reason: String,
    pub location: String,
    /// When it was made, as PDF writes moments (`D:20261010120000Z`).
    pub time: String,
    /// The bytes it covers: from `ranges[0]` for `ranges[1]` bytes, and from `ranges[2]` for `ranges[3]`.
    pub ranges: [usize; 4],
    /// The signature itself: a CMS message.
    pub message: Vec<u8>,
    /// It closes the document: nothing may be changed after it, and no one else can sign.
    pub locks: bool,
    /// A time stamp of the document (`/DocTimeStamp`): `message` is the stamp itself, not a signature.
    pub time_stamp_only: bool,
}

impl FoundSignature {
    /// True when the signature covers the whole of a file of this length but
    /// its own place: nothing was added after it.
    pub fn covers(&self, file_length: usize) -> bool {
        let [first_start, first_length, second_start, second_length] = self.ranges;
        first_start == 0 && second_start >= first_length && second_start + second_length == file_length
    }

    /// The two runs of bytes it covers, cut out of the file; `None` when they are not inside it.
    pub fn covered<'a>(&self, file: &'a [u8]) -> Option<[&'a [u8]; 2]> {
        let [first_start, first_length, second_start, second_length] = self.ranges;
        Some([file.get(first_start..first_start.checked_add(first_length)?)?, file.get(second_start..second_start.checked_add(second_length)?)?])
    }
}

/// Signs the PDF at `unsigned` and writes the signed file to `destination`.
/// `sign` is handed the bytes to sign, in two runs, and answers with the
/// signature (a detached CMS message), or with why there is none.
pub fn sign_file(
    unsigned: &Path,
    destination: &Path,
    request: &SignatureRequest,
    sign: &dyn Fn(&[&[u8]]) -> Result<Vec<u8>, EngineError>,
) -> Result<(), EngineError> {
    // Added to: a copy of the file is opened, and what is new is written after what it has.
    let room = with_ending(destination, ".room");
    let room_name = room.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?.to_owned();
    let name = if request.added_to {
        fs::copy(unsigned, &room).map_err(|error| EngineError::Failed(error.to_string()))?;
        room_name.clone()
    } else {
        unsigned.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?.to_owned()
    };
    let room_size = SIGNATURE_ROOM + request.extra_room;
    let signed = sign_opened(&name, &room_name, request, room_size);
    let read = signed.and_then(|()| fs::read(&room).map_err(|error| EngineError::Failed(error.to_string())));
    let _ = fs::remove_file(&room);
    let mut bytes = read?;

    // …then the numbers are filled in, the bytes signed, and the signature put in its room.
    let (gap_start, gap_end) = fill_byte_range(&mut bytes, room_size)?;
    let message = sign(&[&bytes[..gap_start], &bytes[gap_end..]])?;
    if message.len() > room_size {
        return Err(EngineError::Failed("the signature is larger than the room left for it".into()));
    }
    let written: String = message.iter().map(|byte| format!("{byte:02X}")).collect();
    bytes[gap_start + 1..gap_start + 1 + written.len()].copy_from_slice(written.as_bytes());

    let partial = with_ending(destination, ".part");
    let moved = fs::write(&partial, &bytes).and_then(|()| fs::rename(&partial, destination));
    if moved.is_err() {
        let _ = fs::remove_file(&partial);
    }
    moved.map_err(|error| EngineError::Failed(error.to_string()))
}

/// Adds to the end of the signed file at `path` what a reader needs to check its signatures and time stamps later
/// without asking anyone: certificates, and what their issuers said of them (the document security store of PAdES,
/// `/DSS`). The signatures in the file stay as good as they were: nothing they cover is touched.
pub fn add_validation_data(path: &Path, certificates: &[Vec<u8>], ocsp: &[Vec<u8>], crls: &[Vec<u8>]) -> Result<(), EngineError> {
    if certificates.is_empty() && ocsp.is_empty() && crls.is_empty() {
        return Ok(());
    }
    let copy = with_ending(path, ".dss");
    let name = copy.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?.to_owned();
    fs::copy(path, &copy).map_err(|error| EngineError::Failed(error.to_string()))?;
    let written = (|| {
        let mut document = PdfDocument::open(&name).map_err(failed)?;
        if !document.can_be_saved_incrementally() {
            return Err(EngineError::Failed("this file cannot be added to".into()));
        }
        let mut catalog = document.catalog().map_err(failed)?;
        let mut store = match catalog.get_dict("DSS").map_err(failed)? {
            Some(store) if store.is_dict().unwrap_or(false) => store,
            _ => {
                let store = add_object(&mut document, "<< >>")?;
                catalog.dict_put("DSS", store.try_clone().map_err(failed)?).map_err(failed)?;
                store
            }
        };
        for (key, items) in [("Certs", certificates), ("OCSPs", ocsp), ("CRLs", crls)] {
            if items.is_empty() {
                continue;
            }
            let mut list = match store.get_dict(key).map_err(failed)? {
                Some(list) if list.is_array().unwrap_or(false) => list,
                _ => {
                    store.dict_put(key, document.new_array().map_err(failed)?).map_err(failed)?;
                    store.get_dict(key).map_err(failed)?.ok_or_else(|| EngineError::Failed("the store takes no list".into()))?
                }
            };
            for item in items {
                let buffer = mupdf::Buffer::from_bytes(item).map_err(failed)?;
                list.array_push(document.add_stream(&buffer, None, false).map_err(failed)?).map_err(failed)?;
            }
        }
        let mut options = PdfWriteOptions::default();
        options.set_incremental(true);
        document.save_with_options(&name, options).map_err(failed)
    })();
    let moved = written.and_then(|()| fs::rename(&copy, path).map_err(|error| EngineError::Failed(error.to_string())));
    if moved.is_err() {
        let _ = fs::remove_file(&copy);
    }
    moved
}

/// Opens the file at `name`, gives it the signature's field with room left
/// for the signature itself, and writes it to `room_name`.
fn sign_opened(name: &str, room_name: &str, request: &SignatureRequest, room_size: usize) -> Result<(), EngineError> {
    let mut document = PdfDocument::open(name).map_err(failed)?;
    if request.added_to && !document.can_be_saved_incrementally() {
        return Err(EngineError::Failed("this file cannot be added to; it has to be written anew".into()));
    }
    let signed_before = !found_in(&document)?.is_empty();
    let page_count = usize::try_from(document.page_count().map_err(failed)?).unwrap_or(0);
    if page_count == 0 {
        return Err(EngineError::Failed("a document needs at least one page".into()));
    }
    // Each place: its page, its box in the page's own grid, and what shows there, turned as the page lies.
    let mut places: Vec<(usize, [f32; 4], Option<(Area, i32, &[Mark])>)> = Vec::new();
    for place in request.shown.iter().filter(|place| place.page < page_count) {
        let page = document.find_page(place.page as i32).map_err(failed)?;
        // The box was drawn on the page as it lay before the user's turn was written into it.
        let rotation = page.get_dict_inheritable("Rotate").map_err(failed)?.map(|value| value.as_int()).transpose().map_err(failed)?.unwrap_or(0);
        let turned = rotation - place.added_rotation;
        places.push((place.page, own_box_turned(&page, place.area, turned)?, Some((place.area, turned, place.look.as_slice()))));
    }
    // A signature that shows nowhere still belongs to a page: the first.
    if places.is_empty() {
        places.push((0, [0.0; 4], None));
    }

    let room = "0".repeat(room_size * 2);
    let mut signature = add_object(
        &mut document,
        &if request.time_stamp_only {
            // The moment is the authority's, inside the stamp.
            format!("<< /Type /DocTimeStamp /Filter /Adobe.PPKLite /SubFilter /ETSI.RFC3161 /ByteRange [0 {UNKNOWN} {UNKNOWN} {UNKNOWN}] /Contents <{room}> >>")
        } else {
            format!(
                "<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /ETSI.CAdES.detached /ByteRange [0 {UNKNOWN} {UNKNOWN} {UNKNOWN}] /Contents <{room}> /M ({}) >>",
                pdf_moment(SystemTime::now()),
            )
        },
    )?;
    let said: Vec<(&str, &String)> = if request.time_stamp_only { Vec::new() } else { vec![("Name", &request.name), ("Reason", &request.reason), ("Location", &request.location)] };
    for (key, said) in said {
        if !said.trim().is_empty() {
            signature.dict_put(key, document.new_object_from_str(&text_string(said.trim())).map_err(failed)?).map_err(failed)?;
        }
    }
    let lock = request.lock && !request.time_stamp_only;
    if lock {
        // The first signature of a document closes it as a whole ("certifies" it: no changes allowed);
        // a later one says the same through its field, which is what a document already signed allows.
        let method = if signed_before { "/FieldMDP /TransformParams << /Type /TransformParams /Action /All /V /1.2 >>" } else { "/DocMDP /TransformParams << /Type /TransformParams /P 1 /V /1.2 >>" };
        signature
            .dict_put("Reference", document.new_object_from_str(&format!("[<< /Type /SigRef /TransformMethod {method} >>]")).map_err(failed)?)
            .map_err(failed)?;
    }

    // One place: the field is its own box. Several: one field, with a box on each page, all of the same signature.
    let alone = places.len() == 1;
    let field_name = free_field_name(&document)?;
    // 132: printed with the page, and not to be moved or changed.
    let mut field = add_object(
        &mut document,
        &if alone { format!("<< /Type /Annot /Subtype /Widget /FT /Sig /T {} /F 132 >>", text_string(&field_name)) } else { format!("<< /FT /Sig /T {} >>", text_string(&field_name)) },
    )?;
    field.dict_put("V", signature.try_clone().map_err(failed)?).map_err(failed)?;
    if lock {
        field.dict_put("Lock", document.new_object_from_str("<< /Type /SigFieldLock /Action /All /P 1 >>").map_err(failed)?).map_err(failed)?;
        if !signed_before {
            let mut permissions = document.new_dict().map_err(failed)?;
            permissions.dict_put("DocMDP", signature).map_err(failed)?;
            document.catalog().map_err(failed)?.dict_put("Perms", permissions).map_err(failed)?;
        }
    }
    let mut kids = if alone {
        None
    } else {
        field.dict_put("Kids", document.new_array().map_err(failed)?).map_err(failed)?;
        Some(field.get_dict("Kids").map_err(failed)?.ok_or_else(|| EngineError::Failed("the field takes no boxes".into()))?)
    };
    for (page_index, [x0, y0, x1, y1], shown) in places {
        let mut page = document.find_page(page_index as i32).map_err(failed)?;
        let mut widget = if alone { field.try_clone().map_err(failed)? } else { add_object(&mut document, "<< /Type /Annot /Subtype /Widget /F 132 >>")? };
        widget.dict_put("Rect", document.new_object_from_str(&format!("[{x0} {y0} {x1} {y1}]")).map_err(failed)?).map_err(failed)?;
        widget.dict_put("P", page.try_clone().map_err(failed)?).map_err(failed)?;
        if let Some(kids) = kids.as_mut() {
            widget.dict_put("Parent", field.try_clone().map_err(failed)?).map_err(failed)?;
            kids.array_push(widget.try_clone().map_err(failed)?).map_err(failed)?;
        }
        if let Some((area, rotation, look)) = shown {
            // What shows of the signature is the box's own picture: the page itself is not drawn on,
            // so signatures made before this one are not disturbed. It stands upright on a page that lies turned.
            let turn = match rotation.rem_euclid(360) {
                90 => [0.0, 1.0, -1.0, 0.0],
                180 => [-1.0, 0.0, 0.0, -1.0],
                270 => [0.0, -1.0, 1.0, 0.0],
                _ => [1.0, 0.0, 0.0, 1.0],
            };
            let picture = marks::appearance(&mut document, look, area.width.abs(), area.height.abs(), turn)?;
            let mut appearance = document.new_dict().map_err(failed)?;
            appearance.dict_put("N", picture).map_err(failed)?;
            widget.dict_put("AP", appearance).map_err(failed)?;
        }
        push_annotation(&document, &mut page, widget)?;
    }
    add_to_form(&mut document, field, true, false)?;

    // Written once with the room left empty…
    let mut options = PdfWriteOptions::default();
    if request.added_to {
        options.set_incremental(true);
    } else {
        options.set_compress(true);
    }
    document.save_with_options(room_name, options).map_err(failed)
}

/// Finds the room left for the signature (from its `<` to after its `>`) and
/// writes what the signature covers into the byte range before it.
fn fill_byte_range(bytes: &mut [u8], room_size: usize) -> Result<(usize, usize), EngineError> {
    let lost = || EngineError::Failed("the room left for the signature was not found in the file".into());
    // The last of each in the file: signatures made before have rooms and ranges of their own, further up.
    let zeros = vec![b'0'; room_size * 2];
    let digits = find_last(bytes, &zeros).ok_or_else(lost)?;
    let (gap_start, gap_end) = (digits.checked_sub(1).ok_or_else(lost)?, digits + zeros.len() + 1);
    if bytes.get(gap_start) != Some(&b'<') || bytes.get(gap_end - 1) != Some(&b'>') {
        return Err(lost());
    }

    let unknown = format!("{UNKNOWN} {UNKNOWN} {UNKNOWN}");
    let numbers = find_last(bytes, unknown.as_bytes()).ok_or_else(lost)?;
    let open = bytes[..numbers].iter().rposition(|byte| *byte == b'[').ok_or_else(lost)?;
    let close = find(bytes, b"]", numbers).ok_or_else(lost)?;
    if !bytes[..open].trim_ascii_end().ends_with(b"/ByteRange") {
        return Err(lost());
    }
    // The same number of bytes as before, so nothing in the file moves.
    let known = format!("0 {gap_start} {gap_end} {}", bytes.len() - gap_end);
    let inside = close - open - 1;
    if known.len() > inside {
        return Err(lost());
    }
    bytes[open + 1..close].copy_from_slice(format!("{known:<inside$}").as_bytes());
    Ok((gap_start, gap_end))
}

fn find(bytes: &[u8], wanted: &[u8], from: usize) -> Option<usize> {
    bytes.get(from..)?.windows(wanted.len()).position(|window| window == wanted).map(|at| at + from)
}

fn find_last(bytes: &[u8], wanted: &[u8]) -> Option<usize> {
    bytes.windows(wanted.len()).rposition(|window| window == wanted)
}

fn with_ending(path: &Path, ending: &str) -> PathBuf {
    let mut name = path.file_name().map(|name| name.to_os_string()).unwrap_or_default();
    name.push(ending);
    path.with_file_name(name)
}

/// A name no field of the form has yet: `Signature1`, `Signature2`…
fn free_field_name(document: &PdfDocument) -> Result<String, EngineError> {
    let mut taken = Vec::new();
    for_each_field(document, &mut |field, _| {
        if let Some(name) = field.get_dict("T")?.and_then(|name| name.as_string().ok()) {
            taken.push(name);
        }
        Ok(())
    })?;
    Ok((1..).map(|number| format!("Signature{number}")).find(|name| !taken.contains(name)).unwrap_or_default())
}

/// Every field of the form, with those under it, each with the kind it has or takes from above.
fn for_each_field(document: &PdfDocument, each: &mut dyn FnMut(&PdfObject, Option<Vec<u8>>) -> Result<(), mupdf::Error>) -> Result<(), EngineError> {
    fn walk(fields: &PdfObject, kind_above: Option<Vec<u8>>, depth: usize, each: &mut dyn FnMut(&PdfObject, Option<Vec<u8>>) -> Result<(), mupdf::Error>) -> Result<(), mupdf::Error> {
        // A form that leads back into itself is not followed for ever.
        if depth > 32 || !fields.is_array()? {
            return Ok(());
        }
        for index in 0..fields.len()? {
            let Some(field) = fields.get_array(index as i32)? else {
                continue;
            };
            let kind = field.get_dict("FT")?.and_then(|kind| kind.as_name().ok()).or_else(|| kind_above.clone());
            each(&field, kind.clone())?;
            if let Some(kids) = field.get_dict("Kids")? {
                walk(&kids, kind, depth + 1, each)?;
            }
        }
        Ok(())
    }
    let Some(form) = document.catalog().map_err(failed)?.get_dict("AcroForm").map_err(failed)? else {
        return Ok(());
    };
    let Some(fields) = form.get_dict("Fields").map_err(failed)? else {
        return Ok(());
    };
    walk(&fields, None, 0, each).map_err(failed)
}

/// Takes the signatures made with a certificate out of a document that is
/// written anew. A signature covers the bytes of the file it was made in: in
/// another file it would only show as broken. What it showed on its page goes
/// with it. Fields left empty for a signer stay.
pub(super) fn drop_signatures(document: &mut PdfDocument) -> Result<(), EngineError> {
    fn signed(field: &PdfObject) -> Result<bool, mupdf::Error> {
        // A box of a signature shown on several pages has its kind and its signature from the field above it.
        let parent = field.get_dict("Parent")?;
        let kind = match field.get_dict("FT")? {
            Some(kind) => Some(kind),
            None => parent.as_ref().map(|parent| parent.get_dict("FT")).transpose()?.flatten(),
        };
        let value = match field.get_dict("V")? {
            Some(value) => Some(value),
            None => parent.as_ref().map(|parent| parent.get_dict("V")).transpose()?.flatten(),
        };
        let is_signature = kind.and_then(|kind| kind.as_name().ok()).as_deref() == Some(b"Sig".as_slice());
        Ok(is_signature && value.is_some_and(|signature| signature.is_dict().unwrap_or(false)))
    }
    fn prune(fields: &mut PdfObject, depth: usize) -> Result<usize, mupdf::Error> {
        if depth > 32 || !fields.is_array()? {
            return Ok(0);
        }
        let mut dropped = 0;
        for index in (0..fields.len()? as i32).rev() {
            let Some(field) = fields.get_array(index)? else {
                continue;
            };
            if signed(&field)? {
                fields.array_delete(index)?;
                dropped += 1;
            } else if let Some(mut kids) = field.get_dict("Kids")? {
                dropped += prune(&mut kids, depth + 1)?;
            }
        }
        Ok(dropped)
    }

    let mut dropped = 0;
    for index in 0..document.page_count().map_err(failed)? {
        let page = document.find_page(index).map_err(failed)?;
        if let Some(mut annotations) = page.get_dict("Annots").map_err(failed)? {
            dropped += prune(&mut annotations, 32).map_err(failed)?;
        }
    }
    let mut catalog = document.catalog().map_err(failed)?;
    if let Some(mut form) = catalog.get_dict("AcroForm").map_err(failed)? {
        if let Some(mut fields) = form.get_dict("Fields").map_err(failed)? {
            dropped += prune(&mut fields, 0).map_err(failed)?;
        }
        if dropped > 0 {
            form.dict_delete("SigFlags").map_err(failed)?;
        }
    }
    if dropped > 0 {
        // What a signature said may no longer be done to the document went with that signature.
        catalog.dict_delete("Perms").map_err(failed)?;
    }
    Ok(())
}

/// The signatures of the file at `path`, in the order of its form. Fields left empty for a signer are not among them.
pub fn signatures(path: &Path) -> Result<Vec<FoundSignature>, EngineError> {
    let name = path.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    found_in(&PdfDocument::open(name).map_err(failed)?)
}

fn found_in(document: &PdfDocument) -> Result<Vec<FoundSignature>, EngineError> {
    let mut found = Vec::new();
    for_each_field(document, &mut |field, kind| {
        if kind.as_deref() != Some(b"Sig".as_slice()) {
            return Ok(());
        }
        let Some(signature) = field.get_dict("V")?.filter(|signature| signature.is_dict().unwrap_or(false)) else {
            return Ok(());
        };
        let (Some(range), Some(contents)) = (signature.get_dict("ByteRange")?, signature.get_dict("Contents")?) else {
            return Ok(());
        };
        let mut ranges = [0_usize; 4];
        for (index, number) in ranges.iter_mut().enumerate() {
            *number = range.get_array(index as i32)?.map(|number| number.as_int()).transpose()?.and_then(|number| usize::try_from(number).ok()).unwrap_or(0);
        }
        let said = |key: &str| -> Result<String, mupdf::Error> { Ok(signature.get_dict(key)?.and_then(|said| said.as_string().ok()).unwrap_or_default()) };
        found.push(FoundSignature {
            field: field.get_dict("T")?.and_then(|name| name.as_string().ok()).unwrap_or_default(),
            object: field.as_indirect().unwrap_or(0),
            name: said("Name")?,
            reason: said("Reason")?,
            location: said("Location")?,
            time: said("M")?,
            ranges,
            message: without_padding(contents.as_bytes()?),
            // Said by the signature itself (it certifies the document), or by its field.
            locks: field.get_dict("Lock")?.is_some() || signature.get_dict("Reference")?.is_some(),
            time_stamp_only: signature.get_dict("SubFilter")?.and_then(|kind| kind.as_name().ok()).as_deref() == Some(b"ETSI.RFC3161".as_slice()),
        });
        Ok(())
    })?;
    Ok(found)
}

/// A CMS message cut to its own length: the room it was written into is longer, filled up with zeros.
fn without_padding(mut message: Vec<u8>) -> Vec<u8> {
    let length = match message.as_slice() {
        [0x30, short, ..] if *short < 0x80 => 2 + usize::from(*short),
        [0x30, long, rest @ ..] if (0x81..=0x84).contains(long) => {
            let count = usize::from(*long & 0x7F);
            match rest.get(..count) {
                Some(digits) => 2 + count + digits.iter().fold(0_usize, |length, digit| (length << 8) | usize::from(*digit)),
                None => message.len(),
            }
        }
        _ => message.len(),
    };
    message.truncate(length.min(message.len()));
    message
}

/// A moment as PDF writes it, in universal time: `D:20261010120000Z`.
fn pdf_moment(moment: SystemTime) -> String {
    let seconds = moment.duration_since(UNIX_EPOCH).map(|since| since.as_secs() as i64).unwrap_or(0);
    let (days, of_day) = (seconds.div_euclid(86_400), seconds.rem_euclid(86_400));
    // Days since 1970 as a date of the calendar (the well-known way by eras of 400 years).
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_shifted = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_shifted + 2) / 5 + 1;
    let month = if month_shifted < 10 { month_shifted + 3 } else { month_shifted - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!("D:{year:04}{month:02}{day:02}{:02}{:02}{:02}Z", of_day / 3_600, of_day % 3_600 / 60, of_day % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn writes_moments_as_pdf_does() {
        assert_eq!(pdf_moment(UNIX_EPOCH), "D:19700101000000Z");
        // 10 October 2026, 12:34:56 UTC; and the last day of a leap February.
        assert_eq!(pdf_moment(UNIX_EPOCH + Duration::from_secs(1_791_635_696)), "D:20261010123456Z");
        assert_eq!(pdf_moment(UNIX_EPOCH + Duration::from_secs(1_709_251_199)), "D:20240229235959Z");
    }

    #[test]
    fn cuts_a_signature_to_its_own_length() {
        assert_eq!(without_padding(vec![0x30, 0x02, 1, 2, 0, 0, 0]), [0x30, 0x02, 1, 2]);
        let mut long = vec![0x30, 0x82, 0x01, 0x00];
        long.extend(std::iter::repeat_n(7, 256));
        long.extend([0, 0, 0]);
        assert_eq!(without_padding(long).len(), 260);
        // What is no message is left as it is.
        assert_eq!(without_padding(vec![1, 2, 3]), [1, 2, 3]);
    }

    #[test]
    fn keeps_what_checking_needs_after_what_the_file_had() {
        let folder = std::env::temp_dir().join(format!("syntelab-dss-{}", std::process::id()));
        fs::create_dir_all(&folder).expect("a folder");
        let path = folder.join("stamped.pdf");
        super::super::blank_pdf(200.0, 200.0, 1, &path).expect("a document");
        let before = fs::read(&path).expect("read");

        add_validation_data(&path, &[vec![0x30, 0x01, 0x01]], &[vec![0x30, 0x00]], &[]).expect("added");
        let after = fs::read(&path).expect("read");
        assert!(after.len() > before.len() && after.starts_with(&before), "added after what the file had, nothing of it changed");
        // Added to again: the lists grow.
        add_validation_data(&path, &[vec![0x30, 0x01, 0x02]], &[], &[vec![0x30, 0x00]]).expect("added again");

        let document = PdfDocument::open(path.to_str().expect("a name")).expect("opens");
        let store = document.catalog().expect("catalog").get_dict("DSS").expect("read").expect("a store");
        let count = |key: &str| store.get_dict(key).expect("read").map_or(0, |list| list.len().expect("a list"));
        assert_eq!((count("Certs"), count("OCSPs"), count("CRLs")), (2, 1, 1));
        let first = store.get_dict("Certs").expect("read").expect("certs").get_array(0).expect("read").expect("one");
        assert_eq!(first.read_stream().expect("its bytes"), [0x30, 0x01, 0x01]);
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn tells_which_signature_each_box_on_a_page_is() {
        let folder = std::env::temp_dir().join(format!("syntelab-sig-boxes-{}", std::process::id()));
        fs::create_dir_all(&folder).expect("a folder");
        let blank = folder.join("blank.pdf");
        super::super::blank_pdf(200.0, 300.0, 2, &blank).expect("a document");
        let place = |page: usize, x: f32| ShownSignature { page, area: Area { x, y: 20.0, width: 60.0, height: 30.0 }, added_rotation: 0, look: Vec::new() };
        let request = |shown: Vec<ShownSignature>| SignatureRequest { shown, name: "A".into(), reason: String::new(), location: String::new(), lock: false, added_to: true, time_stamp_only: false, extra_room: 0 };
        let fake = |_: &[&[u8]]| Ok(vec![0x30, 0x00]);
        // A first signature on the first page; a second, added to it, on both pages.
        let once = folder.join("once.pdf");
        sign_file(&blank, &once, &request(vec![place(0, 10.0)]), &fake).expect("signed");
        let twice = folder.join("twice.pdf");
        sign_file(&once, &twice, &request(vec![place(0, 100.0), place(1, 10.0)]), &fake).expect("signed again");

        let found = signatures(&twice).expect("read");
        assert_eq!(found.len(), 2);
        assert!(found.iter().all(|signature| signature.object > 0) && found[0].object != found[1].object, "{found:?}");
        let file = super::super::mupdf_file::PdfFile::open(&twice).expect("opens");
        let on = |page: usize| {
            let mut boxes: Vec<(f32, usize)> = file.signature_boxes(page).expect("boxes").iter().map(|(area, field)| (area.x, found.iter().position(|signature| signature.object == *field).expect("a signature of the list"))).collect();
            boxes.sort_by(|a, b| a.0.total_cmp(&b.0));
            boxes.into_iter().map(|(_, index)| index).collect::<Vec<_>>()
        };
        assert_eq!(on(0), [0, 1]);
        assert_eq!(on(1), [1]);
        let _ = fs::remove_dir_all(&folder);
    }

    #[test]
    fn fills_in_what_the_signature_covers() {
        let mut file = format!("%PDF /ByteRange [0 {UNKNOWN} {UNKNOWN} {UNKNOWN}] /Contents <{}> tail", "0".repeat(SIGNATURE_ROOM * 2)).into_bytes();
        let length = file.len();
        let (start, end) = fill_byte_range(&mut file, SIGNATURE_ROOM).expect("found");
        assert_eq!((file[start], file[end - 1]), (b'<', b'>'));
        assert_eq!(end - start, SIGNATURE_ROOM * 2 + 2);
        assert_eq!(file.len(), length, "nothing moved");
        let text = String::from_utf8_lossy(&file[..80]).into_owned();
        assert!(text.contains(&format!("[0 {start} {end} {}", length - end)), "{text}");

        let signature = FoundSignature { field: String::new(), object: 0, name: String::new(), reason: String::new(), location: String::new(), time: String::new(), ranges: [0, start, end, length - end], message: Vec::new(), locks: false, time_stamp_only: false };
        assert!(signature.covers(length));
        assert!(!signature.covers(length + 10), "something was added after it");
        assert!(fill_byte_range(&mut b"no room here".to_vec(), SIGNATURE_ROOM).is_err());
    }
}
