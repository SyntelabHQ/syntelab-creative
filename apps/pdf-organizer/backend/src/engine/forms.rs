//! Form fields: reading what a document asks for, and writing the answers
//! into the file that is being saved (MuPDF binding).

use std::path::Path;

use mupdf::pdf::{PdfDocument, PdfObject, PdfWidget, WidgetType};

use super::{EngineError, TextBox};

/// What kind of answer a field takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FieldKind {
    Text,
    Checkbox,
    /// One of several buttons with the same name; choosing one clears the others.
    Radio,
    /// One of a list of choices.
    Choice,
}

impl FieldKind {
    /// The name the interface uses.
    pub fn name(self) -> &'static str {
        match self {
            Self::Text => "text",
            Self::Checkbox => "checkbox",
            Self::Radio => "radio",
            Self::Choice => "choice",
        }
    }
}

/// One field of a form, as it sits on a page.
#[derive(Debug, Clone, PartialEq)]
pub struct FormField {
    /// The page it is on, from 0.
    pub page: usize,
    /// What tells it apart from every other object of its file; stays the
    /// same for as long as the file is not rewritten.
    pub id: i32,
    /// The field's own name in the form; radio buttons of one group share it.
    pub name: String,
    /// What the form calls it for the reader, when it says.
    pub label: String,
    pub kind: FieldKind,
    /// What is filled in now. For a checkbox or a radio button: its `on`
    /// value when it is ticked, else `Off`.
    pub value: String,
    /// Where it is on the page as shown, in points from the top-left corner.
    pub area: TextBox,
    pub read_only: bool,
    /// A text field of several lines.
    pub multiline: bool,
    /// For a choice: each answer as `(value, text shown)`.
    pub options: Vec<(String, String)>,
    /// For a checkbox or a radio button: the value that means "ticked".
    pub on: Option<String>,
    /// For a text field: the most letters it takes.
    pub max_length: Option<usize>,
}

/// Every field of the form in `path` that can be filled in. Buttons that only
/// do something and signature fields are left out.
pub fn form_fields(path: &Path) -> Result<Vec<FormField>, EngineError> {
    let name = path.to_str().ok_or_else(|| EngineError::Failed("the file name is not valid Unicode".into()))?;
    let document = PdfDocument::open(name).map_err(failed)?;
    let page_count = document.page_count().map_err(failed)?;
    let mut fields = Vec::new();
    for page_number in 0..page_count {
        let page = document.load_pdf_page(page_number).map_err(failed)?;
        let bounds = page.bounds().map_err(failed)?;
        for widget in page.widgets() {
            // A field that cannot be read does not hide the others.
            if let Ok(Some(field)) = describe(&widget, page_number as usize, bounds.x0, bounds.y0) {
                fields.push(field);
            }
        }
    }
    Ok(fields)
}

fn describe(widget: &PdfWidget, page: usize, origin_x: f32, origin_y: f32) -> Result<Option<FormField>, mupdf::Error> {
    let kind = match widget.r#type()? {
        WidgetType::Text => FieldKind::Text,
        WidgetType::Checkbox => FieldKind::Checkbox,
        WidgetType::RadioButton => FieldKind::Radio,
        WidgetType::Combobox | WidgetType::Listbox => FieldKind::Choice,
        WidgetType::Button | WidgetType::Signature | WidgetType::Unknown => return Ok(None),
    };
    let object = widget.annotation().object();
    let bounds = widget.annotation().bounds()?;
    let flags = widget.field_flags()?;
    let ticks = matches!(kind, FieldKind::Checkbox | FieldKind::Radio);

    let on = if ticks { on_value(&object)? } else { None };
    let value = if ticks {
        // What a button shows is its own state, whatever the group's value says.
        let state = object.get_dict("AS")?.map(|state| state.as_name()).transpose()?;
        match (state, &on) {
            (Some(state), Some(on)) if state == on.as_bytes() => on.clone(),
            _ => "Off".to_owned(),
        }
    } else {
        widget.value()?.unwrap_or_default()
    };

    Ok(Some(FormField {
        page,
        id: widget.xref()?,
        name: widget.name()?.unwrap_or_default(),
        label: widget.label()?.unwrap_or_default(),
        kind,
        value,
        area: TextBox {
            x: bounds.x0 - origin_x,
            y: bounds.y0 - origin_y,
            width: bounds.x1 - bounds.x0,
            height: bounds.y1 - bounds.y0,
        },
        read_only: widget.is_readonly()?,
        multiline: flags.contains(mupdf::pdf::FieldFlags::MULTILINE),
        options: if kind == FieldKind::Choice { options(&object)? } else { Vec::new() },
        on,
        max_length: object
            .get_dict_inheritable("MaxLen")?
            .map(|length| length.as_int())
            .transpose()?
            .and_then(|length| usize::try_from(length).ok())
            .filter(|length| *length > 0),
    }))
}

/// The value that means "ticked": the name of the button's picture that is not `Off`.
fn on_value(widget: &PdfObject) -> Result<Option<String>, mupdf::Error> {
    let Some(pictures) = widget.get_dict("AP")?.map(|appearance| appearance.get_dict("N")).transpose()?.flatten() else {
        return Ok(None);
    };
    for index in 0..pictures.dict_len()? {
        let Some(key) = pictures.get_dict_key(index as i32)? else {
            continue;
        };
        let name = String::from_utf8_lossy(&key.as_name()?).into_owned();
        if name != "Off" {
            return Ok(Some(name));
        }
    }
    Ok(None)
}

/// The answers a choice offers: plain texts, or pairs of value and text shown.
fn options(widget: &PdfObject) -> Result<Vec<(String, String)>, mupdf::Error> {
    let Some(list) = widget.get_dict_inheritable("Opt")? else {
        return Ok(Vec::new());
    };
    let mut options = Vec::new();
    for index in 0..list.len()? {
        let Some(entry) = list.get_array(index as i32)? else {
            continue;
        };
        if entry.is_array()? {
            let text = |at: i32| entry.get_array(at).and_then(|part| part.map(|part| part.as_string()).transpose());
            if let (Some(value), Some(shown)) = (text(0)?, text(1)?) {
                options.push((value, shown));
            }
        } else {
            let text = entry.as_string()?;
            options.push((text.clone(), text));
        }
    }
    Ok(options)
}

/// Writes answers into the fields of one page of `document`: each as `(id,
/// value)`. An id that is not on the page is passed over (a page copied in
/// from another file has other ids).
pub(super) fn fill(document: &mut PdfDocument, page_number: i32, answers: &[(i32, String)]) -> Result<(), EngineError> {
    if answers.is_empty() {
        return Ok(());
    }
    let mut page = document.load_pdf_page(page_number).map_err(failed)?;
    let widgets: Vec<PdfWidget> = page.widgets().collect();
    for mut widget in widgets {
        let id = widget.xref().map_err(failed)?;
        let Some((_, value)) = answers.iter().find(|(wanted, _)| *wanted == id) else {
            continue;
        };
        widget.set_value(document, value, true).map_err(failed)?;
        // Redraws the field with its new answer.
        widget.update().map_err(failed)?;
    }
    page.update().map_err(failed)?;
    Ok(())
}

fn failed(error: mupdf::Error) -> EngineError {
    EngineError::Failed(error.to_string())
}
