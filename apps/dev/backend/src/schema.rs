//! A JSON document checked against a JSON Schema (drafts 4, 6, 7, 2019-09 and 2020-12). The checking itself is
//! the `jsonschema` crate's.
//!
//! Nothing is ever fetched: a schema that points to another by an address
//! (`$ref` to `https://…` or to a file) is refused, not followed. Both the
//! schema and the document are held whole in memory while they are checked.

use jsonschema::{Draft, Validator};
use serde::Deserialize;
use serde_json::Value;

use crate::json::{self, JsonError, RunError, Style};
use crate::tree;

/// One place where a document does not fit its schema.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Misfit {
    /// The way to the value in the document, as a JSON Pointer (empty for the whole document).
    pub at: String,
    /// The way to the rule in the schema, as a JSON Pointer.
    pub rule: String,
    /// What is wrong, as the checker says it (in English).
    pub message: String,
}

/// Why a schema cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BadSchema {
    /// It is not JSON: where, and why.
    NotJson(JsonError),
    /// It is JSON, and no schema: what the checker says of it (in English).
    NotSchema(String),
    Unknown,
}

/// A text of JSON as the value the checker works on. It is checked first by the reader that holds nothing, which
/// says where it is wrong and how deep it goes; only then is it read whole, on a stack as deep as it is.
fn value_of(text: &str) -> Result<(Value, u64), RunError> {
    let (_, stats) = json::transform_text(text, Style::Check, &mut |_| true)?;
    let read = tree::deep(stats.depth.saturating_mul(32), || {
        let mut reader = serde_json::Deserializer::from_str(text);
        reader.disable_recursion_limit();
        Value::deserialize(&mut reader)
    });
    match read {
        Some(Ok(value)) => Ok((value, stats.depth)),
        Some(Err(_)) => Err(RunError::Io(std::io::ErrorKind::InvalidData.into())),
        None => Err(RunError::NoMemory),
    }
}

/// A schema made ready to check documents with. `draft` is `auto` (what the schema itself says with `$schema`,
/// the newest otherwise) or one of `04`, `06`, `07`, `2019-09`, `2020-12`. `formats`: what `format` asks for
/// (`email`, `date-time`…) is checked too, not only noted.
pub fn ready(schema: &str, draft: &str, formats: bool) -> Result<Validator, BadSchema> {
    let (schema, _) = value_of(schema.trim_start_matches('\u{feff}')).map_err(|error| match error {
        RunError::Json(error) => BadSchema::NotJson(error),
        _ => BadSchema::Unknown,
    })?;
    let options = jsonschema::options().should_validate_formats(formats);
    let options = match draft {
        "04" => options.with_draft(Draft::Draft4),
        "06" => options.with_draft(Draft::Draft6),
        "07" => options.with_draft(Draft::Draft7),
        "2019-09" => options.with_draft(Draft::Draft201909),
        "2020-12" => options.with_draft(Draft::Draft202012),
        _ => options,
    };
    options.build(&schema).map_err(|error| BadSchema::NotSchema(error.to_string()))
}

/// Where a document does not fit a schema; nothing when it fits. The document must be JSON: what is wrong with it
/// otherwise is told as for every other tool.
pub fn check(validator: &Validator, document: &str) -> Result<Vec<Misfit>, RunError> {
    let (value, depth) = value_of(document.trim_start_matches('\u{feff}'))?;
    // Checking goes as deep as the document does, and so does taking the value apart afterwards.
    tree::deep(depth.saturating_mul(64), move || {
        let misfits = validator.iter_errors(&value).map(|error| Misfit { at: error.instance_path().to_string(), rule: error.schema_path().to_string(), message: error.to_string() }).collect();
        drop(value);
        misfits
    })
    .ok_or(RunError::NoMemory)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCHEMA: &str = r#"{
        "type": "object",
        "properties": { "id": { "type": "integer", "minimum": 1 }, "email": { "type": "string", "format": "email" }, "tags": { "type": "array", "items": { "type": "string" } } },
        "required": ["id"]
    }"#;

    fn misfits(schema: &str, draft: &str, formats: bool, document: &str) -> Vec<(String, String)> {
        let validator = ready(schema, draft, formats).expect("a schema");
        check(&validator, document).expect("JSON").into_iter().map(|misfit| (misfit.at, misfit.rule)).collect()
    }

    #[test]
    fn says_where_a_document_does_not_fit() {
        assert_eq!(misfits(SCHEMA, "auto", false, r#"{"id": 3, "tags": ["a"]}"#), []);
        assert_eq!(
            misfits(SCHEMA, "auto", false, r#"{"id": 0, "tags": ["a", 2]}"#),
            [("/id".to_owned(), "/properties/id/minimum".to_owned()), ("/tags/1".to_owned(), "/properties/tags/items/type".to_owned())]
        );
        assert_eq!(misfits(SCHEMA, "auto", false, "[]"), [(String::new(), "/type".to_owned())]);
        assert_eq!(misfits(SCHEMA, "auto", false, r#"{"tags": []}"#), [(String::new(), "/required".to_owned())]);
    }

    #[test]
    fn formats_are_checked_only_when_asked() {
        let document = r#"{"id": 1, "email": "not an address"}"#;
        assert_eq!(misfits(SCHEMA, "2020-12", false, document), []);
        assert_eq!(misfits(SCHEMA, "2020-12", true, document), [("/email".to_owned(), "/properties/email/format".to_owned())]);
    }

    #[test]
    fn the_draft_is_the_one_asked_for_or_the_one_the_schema_names() {
        // `exclusiveMinimum` is a yes or no beside `minimum` in draft 4, and a number of its own from draft 6 on.
        let old = r#"{"minimum": 1, "exclusiveMinimum": true}"#;
        assert_eq!(misfits(old, "04", false, "1").len(), 1);
        assert_eq!(misfits(r#"{"$schema": "http://json-schema.org/draft-04/schema#", "minimum": 1, "exclusiveMinimum": true}"#, "auto", false, "1").len(), 1);
        assert_eq!(misfits(r#"{"exclusiveMinimum": 1}"#, "07", false, "1").len(), 1);
    }

    #[test]
    fn what_is_no_schema_is_told_and_nothing_is_fetched() {
        assert!(matches!(ready("{\"type\": ", "auto", false), Err(BadSchema::NotJson(error)) if error.line == 1));
        assert!(matches!(ready(r#"{"type": "nothing"}"#, "auto", false), Err(BadSchema::NotSchema(_))));
        // A schema that lives at an address is not gone for.
        assert!(ready(r#"{"$ref": "https://example.com/schema.json"}"#, "auto", false).is_err());
        let validator = ready("{}", "auto", false).expect("a schema");
        assert!(matches!(check(&validator, "[1,"), Err(RunError::Json(_))));
    }

    #[test]
    fn a_very_deep_document_is_checked() {
        let deep = 50_000;
        let document = format!("{}{}", "[".repeat(deep), "]".repeat(deep));
        let validator = ready(r#"{"type": "array"}"#, "auto", false).expect("a schema");
        assert_eq!(check(&validator, &document).expect("JSON"), []);
    }
}
