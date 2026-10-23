//! What is written from the shape of a sample: a JSON Schema that the sample fits, and TypeScript declarations
//! of its type.

use crate::shape::{Member, Shape};
use crate::tree::{quoted, Node};

fn pair(key: &str, value: Node) -> (Box<str>, Node) {
    (quoted(key), value)
}

fn text(value: &str) -> Node {
    Node::Scalar(quoted(value))
}

/// The schema of a shape, as a tree of JSON. Call inside [`crate::tree::deep`].
fn schema_of(shape: &Shape) -> Node {
    let typed = |name: &str| Node::Object(vec![pair("type", text(name))]);
    match shape {
        Shape::Null => typed("null"),
        Shape::Bool => typed("boolean"),
        Shape::Integer => typed("integer"),
        Shape::Number => typed("number"),
        Shape::Text => typed("string"),
        Shape::Array(items) => {
            let mut members = vec![pair("type", text("array"))];
            if let Some(items) = items {
                members.push(pair("items", schema_of(items)));
            }
            Node::Object(members)
        }
        Shape::Object(known) => {
            let mut members = vec![pair("type", text("object")), pair("properties", Node::Object(known.iter().map(|member| pair(&member.key, schema_of(&member.shape))).collect()))];
            let required: Vec<Node> = known.iter().filter(|member| member.required).map(|member| text(&member.key)).collect();
            if !required.is_empty() {
                members.push(pair("required", Node::Array(required)));
            }
            Node::Object(members)
        }
        Shape::OneOf(choices) => {
            // Kinds that need no more than their name are said together; the others each in full.
            let plain = |choice: &Shape| matches!(choice, Shape::Null | Shape::Bool | Shape::Integer | Shape::Number | Shape::Text);
            if choices.iter().all(plain) {
                let names = choices.iter().map(|choice| {
                    let mut made = schema_of(choice);
                    match &mut made {
                        Node::Object(members) if !members.is_empty() => members.remove(0).1,
                        _ => Node::null(),
                    }
                });
                return Node::Object(vec![pair("type", Node::Array(names.collect()))]);
            }
            Node::Object(vec![pair("anyOf", Node::Array(choices.iter().map(schema_of).collect()))])
        }
    }
}

/// The address of the draft a schema is written for, by the name the interface gives it.
pub fn draft_address(draft: &str) -> Option<&'static str> {
    Some(match draft {
        "2020-12" => "https://json-schema.org/draft/2020-12/schema",
        "2019-09" => "https://json-schema.org/draft/2019-09/schema",
        "07" => "http://json-schema.org/draft-07/schema#",
        "06" => "http://json-schema.org/draft-06/schema#",
        "04" => "http://json-schema.org/draft-04/schema#",
        _ => return None,
    })
}

/// A JSON Schema that the sample fits, saying which draft it is written for. Call inside [`crate::tree::deep`].
pub fn schema(shape: &Shape, draft: &'static str) -> Node {
    let mut members = vec![pair("$schema", text(draft))];
    let mut made = schema_of(shape);
    if let Node::Object(rest) = &mut made {
        members.append(rest);
    }
    Node::Object(members)
}

/// How TypeScript declarations are written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Declared {
    /// The name of the type of the whole document.
    pub root: String,
    /// `interface Name { … }`; else `type Name = { … }`.
    pub interfaces: bool,
    pub exported: bool,
    /// Every member is `readonly`, and arrays are `readonly T[]`.
    pub readonly: bool,
}

/// A text as a name of a type: its words run together, each with a capital; `Value` when nothing is left.
fn type_name(text: &str) -> String {
    let mut name = String::new();
    let mut capital = true;
    for letter in text.chars() {
        if letter.is_alphanumeric() || letter == '_' || letter == '$' {
            if capital {
                name.extend(letter.to_uppercase());
            } else {
                name.push(letter);
            }
            capital = false;
        } else {
            capital = true;
        }
    }
    if name.is_empty() || name.starts_with(|letter: char| letter.is_ascii_digit()) {
        name.insert_str(0, "Value");
    }
    name
}

/// A key as it is written in a declaration: as it is when it is a name, in quotes otherwise.
fn member_name(key: &str) -> String {
    let mut letters = key.chars();
    let is_name = letters.next().is_some_and(|first| first.is_alphabetic() || first == '_' || first == '$') && letters.all(|letter| letter.is_alphanumeric() || letter == '_' || letter == '$');
    if is_name {
        key.to_owned()
    } else {
        quoted(key).into()
    }
}

struct Declaring<'a> {
    how: &'a Declared,
    /// The declarations written so far, each with its name; the name of the whole document first.
    written: Vec<(String, String)>,
}

impl Declaring<'_> {
    /// A name no declaration has yet: the one asked for, or it with a number after.
    fn free_name(&self, wanted: &str) -> String {
        let taken = |name: &str| self.written.iter().any(|(known, _)| known == name);
        if !taken(wanted) {
            return wanted.to_owned();
        }
        (2..).map(|number| format!("{wanted}{number}")).find(|name| !taken(name)).unwrap_or_default()
    }

    /// Declares an object under a name made from `wanted`, and gives that name.
    fn declare(&mut self, wanted: &str, members: &[Member]) -> String {
        let name = self.free_name(wanted);
        // Its place is taken before its members are gone through, so they come after it.
        let at = self.written.len();
        self.written.push((name.clone(), String::new()));
        let mut body = String::new();
        for member in members {
            let kind = self.kind(&member.shape, &format!("{name}{}", type_name(&member.key)));
            body.push_str(&format!("  {}{}{}: {kind};\n", if self.how.readonly { "readonly " } else { "" }, member_name(&member.key), if member.required { "" } else { "?" }));
        }
        let export = if self.how.exported { "export " } else { "" };
        self.written[at].1 = if self.how.interfaces { format!("{export}interface {name} {{\n{body}}}") } else { format!("{export}type {name} = {{\n{body}}};") };
        name
    }

    /// The type of a shape as it is written where it is used. `named`: the name an object met here would be declared under.
    fn kind(&mut self, shape: &Shape, named: &str) -> String {
        match shape {
            Shape::Null => "null".into(),
            Shape::Bool => "boolean".into(),
            Shape::Integer | Shape::Number => "number".into(),
            Shape::Text => "string".into(),
            Shape::Array(items) => {
                let item = match items {
                    Some(items) => self.kind(items, &format!("{named}Item")),
                    None => "unknown".into(),
                };
                let item = if item.contains(" | ") { format!("({item})") } else { item };
                format!("{}{item}[]", if self.how.readonly { "readonly " } else { "" })
            }
            Shape::Object(members) => self.declare(named, members),
            Shape::OneOf(choices) => {
                let mut kinds: Vec<String> = Vec::new();
                for choice in choices {
                    let kind = self.kind(choice, named);
                    // A readonly array among other kinds is put in brackets, or `readonly` would be read as theirs too.
                    let kind = if kind.starts_with("readonly ") { format!("({kind})") } else { kind };
                    if !kinds.contains(&kind) {
                        kinds.push(kind);
                    }
                }
                kinds.join(" | ")
            }
        }
    }
}

/// TypeScript declarations of the type of the sample. Call inside [`crate::tree::deep`].
pub fn typescript(shape: &Shape, how: &Declared) -> String {
    let root = type_name(&how.root);
    let mut declaring = Declaring { how, written: Vec::new() };
    if let Shape::Object(members) = shape {
        declaring.declare(&root, members);
    } else {
        // The document is no object: its type is given a name all the same, and what it holds is declared after.
        declaring.written.push((root.clone(), String::new()));
        let kind = declaring.kind(shape, &root);
        declaring.written[0].1 = format!("{}type {root} = {kind};", if how.exported { "export " } else { "" });
    }
    let mut text = declaring.written.into_iter().map(|(_, declared)| declared).collect::<Vec<_>>().join("\n\n");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::{Options, Style};
    use crate::tree::{build, write, Writing};

    fn shape(text: &str) -> Shape {
        let (minified, _) = crate::json::transform_text(text, Style::Minify, &mut |_| true).expect("JSON");
        crate::shape::of(&build(&minified).expect("a tree"))
    }

    fn schema_text(sample: &str) -> String {
        let mut out = Vec::new();
        write(&schema(&shape(sample), draft_address("2020-12").expect("a draft")), &mut out, &Writing { options: Options::of(Style::Minify), one_line_within: 0 }).expect("written");
        String::from_utf8(out).expect("text")
    }

    #[test]
    fn a_schema_is_written_from_a_sample() {
        assert_eq!(
            schema_text(r#"{"id": 7, "name": "x", "tags": ["a"], "price": 1.5, "on": true, "none": null, "empty": []}"#),
            r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"id":{"type":"integer"},"name":{"type":"string"},"tags":{"type":"array","items":{"type":"string"}},"price":{"type":"number"},"on":{"type":"boolean"},"none":{"type":"null"},"empty":{"type":"array"}},"required":["id","name","tags","price","on","none","empty"]}"#
        );
        // Items that differ: a key some lack is not required, kinds that differ are a choice.
        assert_eq!(
            schema_text(r#"[{"a": 1, "b": "x"}, {"a": null}]"#),
            r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"array","items":{"type":"object","properties":{"a":{"type":["integer","null"]},"b":{"type":"string"}},"required":["a"]}}"#
        );
        assert_eq!(schema_text(r#"[1, [2]]"#), r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"array","items":{"anyOf":[{"type":"integer"},{"type":"array","items":{"type":"integer"}}]}}"#);
        assert_eq!(draft_address("07"), Some("http://json-schema.org/draft-07/schema#"));
        assert_eq!(draft_address("99"), None);
    }

    fn declared(sample: &str, change: impl FnOnce(&mut Declared)) -> String {
        let mut how = Declared { root: "Root".into(), interfaces: true, exported: true, readonly: false };
        change(&mut how);
        typescript(&shape(sample), &how)
    }

    #[test]
    fn declarations_are_written_from_a_sample() {
        let sample = r#"{"id": 7, "user name": "x", "tags": ["a"], "address": {"city": "Iași", "zip": null}, "orders": [{"total": 1.5}, {"total": 2, "note": "n"}], "mixed": [1, "a"], "empty": []}"#;
        assert_eq!(
            declared(sample, |_| {}),
            "export interface Root {\n  id: number;\n  \"user name\": string;\n  tags: string[];\n  address: RootAddress;\n  orders: RootOrdersItem[];\n  mixed: (number | string)[];\n  empty: unknown[];\n}\n\nexport interface RootAddress {\n  city: string;\n  zip: null;\n}\n\nexport interface RootOrdersItem {\n  total: number;\n  note?: string;\n}\n"
        );
        assert_eq!(
            declared(r#"{"a": [1], "b": {"c": true}}"#, |how| (how.interfaces, how.exported, how.readonly, how.root) = (false, false, true, "api response".into())),
            "type ApiResponse = {\n  readonly a: readonly number[];\n  readonly b: ApiResponseB;\n};\n\ntype ApiResponseB = {\n  readonly c: boolean;\n};\n"
        );
    }

    #[test]
    fn a_document_that_is_no_object_is_named_too() {
        assert_eq!(declared(r#"[{"a": 1}, {"a": 2}]"#, |_| {}), "export type Root = RootItem[];\n\nexport interface RootItem {\n  a: number;\n}\n");
        assert_eq!(declared("[1, null]", |_| {}), "export type Root = (number | null)[];\n");
        assert_eq!(declared("\"x\"", |how| how.root = "9 lives".into()), "export type Value9Lives = string;\n");
        // Two objects that would get the same name are told apart.
        assert_eq!(declared(r#"{"a": {"x": 1}, "A": {"y": 1}}"#, |_| {}), "export interface Root {\n  a: RootA;\n  A: RootA2;\n}\n\nexport interface RootA {\n  x: number;\n}\n\nexport interface RootA2 {\n  y: number;\n}\n");
    }
}
