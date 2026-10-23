//! YAML read into the tree of JSON, and the tree of JSON written as YAML.
//!
//! Reading is done by `yaml-rust2` (YAML 1.2), which hands over the events of a document; what they mean as JSON is
//! decided here, by the core schema of YAML 1.2: `null`, `true` and `false`, whole numbers (also `0x` and `0o`) and
//! numbers with a point or an exponent are what they look like, everything else is a string. Anchors and aliases are
//! written out where they are used, and `<<` merges as it does everywhere. Several documents become an array.
//!
//! Writing is done here: block style, strings without quotes where that is safe, texts of several lines as `|`
//! blocks.

use std::collections::HashMap;
use std::io::{self, Write};

use yaml_rust2::parser::{Event, MarkedEventReceiver, Parser, Tag};
use yaml_rust2::scanner::{Marker, TScalarStyle};

use crate::codec::{CodecError, Wrong};
use crate::json::{Grown, Options, Style};
use crate::tree::{self, quoted, unquoted, Node};
use crate::whole::{json_text, json_tree, Notes, Said, Whole};

/// What a text of YAML held.
pub struct Read {
    /// Its documents, in order.
    pub documents: Vec<Node>,
    /// How deep the deepest of them is nested.
    pub depth: u64,
}

enum Open {
    Sequence(Vec<Node>, usize),
    /// The members so far, the key that waits for its value, the anchor.
    Mapping(Vec<(Box<str>, Node)>, Option<Box<str>>, usize),
}

struct Loader {
    open: Vec<Open>,
    anchors: HashMap<usize, Node>,
    read: Read,
    /// How many values aliases may still write out. A few lines of aliases to aliases can stand for more values than
    /// any memory holds; this is what stops such a text, and no text written in earnest comes near it.
    aliases_left: u64,
    too_many_aliases: bool,
}

/// How many values a value is made of.
fn weight(node: &Node) -> u64 {
    let mut waiting = vec![node];
    let mut count = 0;
    while let Some(node) = waiting.pop() {
        count += 1;
        match node {
            Node::Scalar(_) => {}
            Node::Array(items) => waiting.extend(items),
            Node::Object(members) => waiting.extend(members.iter().map(|(_, value)| value)),
        }
    }
    count
}

fn minified(node: &Node) -> String {
    let mut written = Vec::new();
    // Writing into memory does not fail.
    let _ = tree::write(node, &mut written, &tree::Writing { options: Options::of(Style::Minify), one_line_within: 0 });
    String::from_utf8_lossy(&written).into_owned()
}

/// A whole number of YAML written in another base, as JSON writes numbers; none when it is too large to be counted.
fn in_base(digits: &str, base: u32) -> Option<Box<str>> {
    (!digits.is_empty()).then(|| u128::from_str_radix(digits, base).ok()).flatten().map(|number| number.to_string().into_boxed_str())
}

/// What a plain scalar is in JSON when it is no string: `null`, `true`, `false` or a number written as JSON writes them.
pub fn resolved(text: &str) -> Option<Box<str>> {
    match text {
        "" | "~" | "null" | "Null" | "NULL" => return Some("null".into()),
        "true" | "True" | "TRUE" => return Some("true".into()),
        "false" | "False" | "FALSE" => return Some("false".into()),
        _ => {}
    }
    if let Some(digits) = text.strip_prefix("0x") {
        return in_base(digits, 16);
    }
    if let Some(digits) = text.strip_prefix("0o") {
        return in_base(digits, 8);
    }
    let (negative, rest) = match text.as_bytes().first() {
        Some(b'-') => (true, &text[1..]),
        Some(b'+') => (false, &text[1..]),
        _ => (false, text),
    };
    let (mantissa, exponent) = match rest.find(['e', 'E']) {
        Some(at) => (&rest[..at], Some(&rest[at + 1..])),
        None => (rest, None),
    };
    let (whole, fraction) = match mantissa.find('.') {
        Some(at) => (&mantissa[..at], Some(&mantissa[at + 1..])),
        None => (mantissa, None),
    };
    let digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());
    if !digits(whole) || !fraction.is_none_or(digits) || (whole.is_empty() && fraction.is_none_or(str::is_empty)) {
        return None;
    }
    let mut number = String::with_capacity(text.len() + 1);
    if negative {
        number.push('-');
    }
    // JSON has no number that begins with a needless zero, or with a point.
    let whole = whole.trim_start_matches('0');
    number.push_str(if whole.is_empty() { "0" } else { whole });
    if let Some(fraction) = fraction.filter(|fraction| !fraction.is_empty()) {
        number.push('.');
        number.push_str(fraction);
    }
    if let Some(exponent) = exponent {
        let power = exponent.strip_prefix(['-', '+']).unwrap_or(exponent);
        if power.is_empty() || !digits(power) {
            return None;
        }
        number.push('e');
        number.push_str(exponent);
    }
    Some(number.into_boxed_str())
}

/// What a scalar of YAML is in JSON.
fn scalar(value: &str, style: TScalarStyle, tag: Option<&Tag>) -> Node {
    let kind = tag.filter(|tag| tag.handle == "tag:yaml.org,2002:").map(|tag| tag.suffix.as_str());
    let string = match kind {
        Some("str") => true,
        Some("int" | "float" | "bool" | "null") => false,
        // What stands in quotes, or in a block, is a string whatever it looks like.
        _ => style != TScalarStyle::Plain,
    };
    Node::Scalar(match resolved(value).filter(|_| !string) {
        Some(known) => known,
        None => quoted(value),
    })
}

impl Loader {
    /// A value is whole: it goes where the document has it.
    fn value(&mut self, node: Node, anchor: usize) {
        if anchor > 0 {
            self.anchors.insert(anchor, node.clone());
        }
        match self.open.last_mut() {
            None => self.read.documents.push(node),
            Some(Open::Sequence(items, _)) => items.push(node),
            Some(Open::Mapping(members, key, _)) => match key.take() {
                Some(key) => members.push((key, node)),
                // A key of JSON is a string: what is none is written as the text it would be in JSON.
                None => {
                    *key = Some(match &node {
                        Node::Scalar(text) if text.starts_with('"') => text.clone(),
                        Node::Scalar(text) => quoted(text),
                        other => quoted(&minified(other)),
                    })
                }
            },
        }
    }

    /// `<<` with a mapping, or a list of them: their members become members here, unless the key is already written.
    fn merged(members: Vec<(Box<str>, Node)>) -> Vec<(Box<str>, Node)> {
        if !members.iter().any(|(key, _)| &**key == "\"<<\"") {
            return members;
        }
        let own: Vec<Box<str>> = members.iter().filter(|(key, _)| &**key != "\"<<\"").map(|(key, _)| key.clone()).collect();
        let mut all: Vec<(Box<str>, Node)> = Vec::with_capacity(members.len());
        let take = |from: &Node, all: &mut Vec<(Box<str>, Node)>| {
            if let Node::Object(theirs) = from {
                for (key, value) in theirs {
                    if !own.contains(key) && !all.iter().any(|(known, _)| known == key) {
                        all.push((key.clone(), value.clone()));
                    }
                }
            }
        };
        for (key, value) in members {
            if &*key != "\"<<\"" {
                all.push((key, value));
                continue;
            }
            match &value {
                Node::Array(several) => several.iter().for_each(|one| take(one, &mut all)),
                one @ Node::Object(_) => take(one, &mut all),
                // `<<` with anything else is a key like any other.
                Node::Scalar(_) => all.push((key, value)),
            }
        }
        all
    }
}

impl MarkedEventReceiver for Loader {
    fn on_event(&mut self, event: Event, _mark: Marker) {
        match event {
            Event::Scalar(value, style, anchor, tag) => self.value(scalar(&value, style, tag.as_ref()), anchor),
            Event::SequenceStart(anchor, _) => self.open.push(Open::Sequence(Vec::new(), anchor)),
            Event::MappingStart(anchor, _) => self.open.push(Open::Mapping(Vec::new(), None, anchor)),
            Event::SequenceEnd | Event::MappingEnd => {
                self.read.depth = self.read.depth.max(self.open.len() as u64);
                match self.open.pop() {
                    Some(Open::Sequence(items, anchor)) => self.value(Node::Array(items), anchor),
                    Some(Open::Mapping(members, _, anchor)) => self.value(Node::Object(Self::merged(members)), anchor),
                    None => {}
                }
            }
            Event::Alias(anchor) => {
                let node = match self.anchors.get(&anchor) {
                    Some(known) => {
                        let needs = weight(known);
                        if needs > self.aliases_left {
                            self.too_many_aliases = true;
                            Node::null()
                        } else {
                            self.aliases_left -= needs;
                            known.clone()
                        }
                    }
                    None => Node::null(),
                };
                self.value(node, 0);
            }
            Event::Nothing | Event::StreamStart | Event::StreamEnd | Event::DocumentStart | Event::DocumentEnd => {}
        }
    }
}

/// The place of a mark of the library in the text, counted as editors count.
fn place(text: &str, mark: &Marker, code: &'static str) -> Wrong {
    let line = mark.line().max(1);
    let mut offset = 0u64;
    let mut lines = text.split_inclusive('\n');
    for before in lines.by_ref().take(line - 1) {
        offset += before.encode_utf16().count() as u64;
    }
    let column: u64 = lines.next().unwrap_or_default().chars().take(mark.col()).map(|letter| letter.len_utf16() as u64).sum();
    Wrong { code, line: line as u64, column: column + 1, offset: offset + column }
}

/// Reads a text of YAML. What is wrong with it is told with its place and with what the library said (in English).
pub fn read(text: &str) -> Result<Read, Said> {
    let allowed = 4_000_000u64.saturating_add((text.len() as u64).saturating_mul(200));
    let mut loader = Loader { open: Vec::new(), anchors: HashMap::new(), read: Read { documents: Vec::new(), depth: 0 }, aliases_left: allowed, too_many_aliases: false };
    let mut parser = Parser::new_from_str(text);
    if let Err(error) = parser.load(&mut loader, true) {
        return Err(Said(place(text, error.marker(), "bad-yaml").into(), Some(error.info().to_owned())));
    }
    if loader.too_many_aliases {
        return Err(Wrong::nowhere("too-many-aliases").into());
    }
    Ok(loader.read)
}

/// Whether a string can be written without quotes and be read back as the same string by every reader of YAML.
fn plain(text: &str) -> bool {
    let Some(first) = text.chars().next() else { return false };
    if text.starts_with(char::is_whitespace) || text.ends_with(char::is_whitespace) || "-?:,[]{}#&*!|>'\"%@`".contains(first) {
        return false;
    }
    if text.chars().any(|letter| letter.is_control() || matches!(letter, '\u{85}' | '\u{2028}' | '\u{2029}' | '\u{feff}')) {
        return false;
    }
    if text.contains(": ") || text.contains(" #") || text.ends_with(':') || text.starts_with("...") {
        return false;
    }
    // What another reader would take for a number, a truth, nothing, or a date or a time (YAML 1.1 has more of them).
    let lower = text.to_ascii_lowercase();
    if resolved(text).is_some() || matches!(lower.as_str(), "yes" | "no" | "on" | "off" | "y" | "n" | "true" | "false" | "null" | ".inf" | "+.inf" | "-.inf" | ".nan") {
        return false;
    }
    !(first.is_ascii_digit() || first == '+' || first == '.') || !(text.contains(':') || text.contains('-') || text.contains('_'))
}

/// Whether a text of several lines can be written as a `|` block and be read back as it is.
fn block(text: &str) -> bool {
    let first_written = text.split('\n').find(|line| !line.is_empty());
    text.contains('\n')
        && first_written.is_some_and(|line| !line.starts_with([' ', '\t']))
        && !text.chars().any(|letter| (letter.is_control() && letter != '\n' && letter != '\t') || matches!(letter, '\u{85}' | '\u{2028}' | '\u{2029}' | '\u{feff}'))
}

struct Writer<'a> {
    out: &'a mut dyn Write,
    /// How many spaces each level is pushed in by.
    indent: usize,
}

impl Writer<'_> {
    fn pad(&mut self, level: usize) -> io::Result<()> {
        write!(self.out, "{:width$}", "", width = level * self.indent)
    }

    fn double_quoted(&mut self, text: &str) -> io::Result<()> {
        self.out.write_all(b"\"")?;
        for letter in text.chars() {
            match letter {
                '"' => self.out.write_all(b"\\\"")?,
                '\\' => self.out.write_all(b"\\\\")?,
                '\n' => self.out.write_all(b"\\n")?,
                '\t' => self.out.write_all(b"\\t")?,
                '\r' => self.out.write_all(b"\\r")?,
                '\u{85}' => self.out.write_all(b"\\N")?,
                '\u{2028}' => self.out.write_all(b"\\L")?,
                '\u{2029}' => self.out.write_all(b"\\P")?,
                '\u{feff}' => self.out.write_all(b"\\uFEFF")?,
                control if control.is_control() => write!(self.out, "\\x{:02X}", control as u32)?,
                other => write!(self.out, "{other}")?,
            }
        }
        self.out.write_all(b"\"")
    }

    /// A string where a key or a value of one line goes.
    fn string(&mut self, text: &str) -> io::Result<()> {
        if plain(text) {
            self.out.write_all(text.as_bytes())
        } else {
            self.double_quoted(text)
        }
    }

    /// A value that is no array and no object with something in it, after what holds it, with the line break that ends it.
    fn leaf(&mut self, node: &Node, level: usize) -> io::Result<()> {
        match node {
            Node::Array(_) => self.out.write_all(b"[]\n"),
            Node::Object(_) => self.out.write_all(b"{}\n"),
            Node::Scalar(raw) if !raw.starts_with('"') => writeln!(self.out, "{raw}"),
            Node::Scalar(raw) => {
                let text = unquoted(raw);
                if !block(&text) {
                    self.string(&text)?;
                    return self.out.write_all(b"\n");
                }
                // How the line breaks at the end are kept: none (`-`), one, or all of them (`+`).
                let ending = text.len() - text.trim_end_matches('\n').len();
                let (mark, lines) = match ending {
                    0 => ("|-", text.as_str()),
                    1 => ("|", &text[..text.len() - 1]),
                    _ => ("|+", &text[..text.len() - 1]),
                };
                writeln!(self.out, "{mark}")?;
                for line in lines.split('\n') {
                    if !line.is_empty() {
                        self.pad(level + 1)?;
                        self.out.write_all(line.as_bytes())?;
                    }
                    self.out.write_all(b"\n")?;
                }
                Ok(())
            }
        }
    }

    /// An array or an object with something in it, each item or member on its line. `begun`: the line of the first
    /// one is already begun (by the `-` of the array this one is an item of).
    fn nested(&mut self, node: &Node, level: usize, begun: bool) -> io::Result<()> {
        match node {
            Node::Array(items) => {
                for (index, item) in items.iter().enumerate() {
                    if index > 0 || !begun {
                        self.pad(level)?;
                    }
                    self.out.write_all(b"-")?;
                    if item.is_empty() || matches!(item, Node::Scalar(_)) {
                        self.out.write_all(b" ")?;
                        self.leaf(item, level)?;
                    } else {
                        // What the item holds begins on the line of its `-`, and the rest stands under that.
                        write!(self.out, "{:width$}", "", width = self.indent.saturating_sub(1).max(1))?;
                        self.nested(item, level + 1, true)?;
                    }
                }
            }
            Node::Object(members) => {
                for (index, (key, value)) in members.iter().enumerate() {
                    if index > 0 || !begun {
                        self.pad(level)?;
                    }
                    self.string(&unquoted(key))?;
                    self.out.write_all(b":")?;
                    if value.is_empty() || matches!(value, Node::Scalar(_)) {
                        self.out.write_all(b" ")?;
                        self.leaf(value, level)?;
                    } else {
                        self.out.write_all(b"\n")?;
                        self.nested(value, level + 1, false)?;
                    }
                }
            }
            Node::Scalar(_) => {}
        }
        Ok(())
    }
}

/// Writes a tree of JSON as YAML, each level pushed in by `indent` spaces (at least 2). Call inside [`tree::deep`].
pub fn write(node: &Node, out: &mut dyn Write, indent: usize) -> io::Result<()> {
    let mut writer = Writer { out, indent: indent.max(2) };
    if node.is_empty() || matches!(node, Node::Scalar(_)) {
        writer.leaf(node, 0)
    } else {
        writer.nested(node, 0, false)
    }
}

/// YAML written as JSON, as `options` say.
pub fn to_json(options: Options) -> Whole {
    Whole::new(move |text, out| {
        let Read { mut documents, depth } = read(text)?;
        let mut notes: Notes = Vec::new();
        let node = match documents.len() {
            0 => return Err(Wrong::nowhere("empty").into()),
            1 => documents.remove(0),
            several => {
                notes.push(("documents", several.to_string()));
                Node::Array(documents)
            }
        };
        out.write_all(&json_text(&node, depth + 1, options)?)?;
        Ok(notes)
    })
}

/// JSON written as YAML.
pub fn from_json(indent: usize) -> Whole {
    Whole::new(move |text, out| {
        let (node, depth) = json_tree(text)?;
        let written = tree::deep(depth, || {
            let mut grown = Grown::default();
            write(&node, &mut grown, indent).map(|()| grown.0)
        });
        out.write_all(&written.ok_or(CodecError::NoMemory)??)?;
        Ok(Vec::new())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};
    use crate::codec::Stage;

    fn json(yaml: &str) -> String {
        String::from_utf8(through(&mut to_json(Options::of(Style::Minify)), yaml.as_bytes(), 7).expect("read")).expect("text")
    }

    fn yaml(json: &str) -> String {
        String::from_utf8(through(&mut from_json(2), json.as_bytes(), 7).expect("written")).expect("text")
    }

    #[test]
    fn scalars_are_what_the_core_schema_says() {
        assert_eq!(json("a: 1\nb: -2.50\nc: true\nd: null\ne: ~\nf:\ng: hello\nh: '1'\ni: \"true\""), r#"{"a":1,"b":-2.50,"c":true,"d":null,"e":null,"f":null,"g":"hello","h":"1","i":"true"}"#);
        assert_eq!(json("[0x1F, 0o17, 010, +5, .5, 5., 1e3, 2E-2, 12345678901234567890123]"), "[31,15,10,5,0.5,5,1e3,2e-2,12345678901234567890123]");
        // What only YAML 1.1 took for a truth or a number is a string, and so is what JSON has no number for.
        assert_eq!(json("[yes, No, on, 1_000, .inf, .nan, 1.2.3, 0x, e5]"), r#"["yes","No","on","1_000",".inf",".nan","1.2.3","0x","e5"]"#);
        assert_eq!(json("[!!str 5, !!int '7', !!float \"1.5\"]"), r#"["5",7,1.5]"#);
    }

    #[test]
    fn structure_blocks_anchors_and_merges_are_read() {
        assert_eq!(json("list:\n  - a\n  - b: 1\n    c: [x, {y: z}]\nempty: {}\n"), r#"{"list":["a",{"b":1,"c":["x",{"y":"z"}]}],"empty":{}}"#);
        assert_eq!(json("text: |\n  one\n  two\nfolded: >-\n  one\n  two\n"), r#"{"text":"one\ntwo\n","folded":"one two"}"#);
        assert_eq!(json("base: &b {x: 1, y: 2}\nuse: *b\nmore:\n  <<: *b\n  y: 3\n  z: 4\n"), r#"{"base":{"x":1,"y":2},"use":{"x":1,"y":2},"more":{"x":1,"y":3,"z":4}}"#);
        // Keys that are no strings are written as the text they would be.
        assert_eq!(json("1: a\ntrue: b\n? [x, 1]\n: c\n"), r#"{"1":"a","true":"b","[\"x\",1]":"c"}"#);
    }

    #[test]
    fn several_documents_become_an_array_and_are_told_of() {
        let mut stage = to_json(Options::of(Style::Minify));
        assert_eq!(through(&mut stage, b"a: 1\n---\n- 2\n", 100).expect("read"), br#"[{"a":1},[2]]"#);
        assert_eq!(stage.notes(), vec![("documents", "2".to_string())]);
        assert_eq!(problem(through(&mut to_json(Options::of(Style::Minify)), b"# nothing\n", 100)), ("empty", 0, 0));
    }

    #[test]
    fn what_is_wrong_is_told_with_its_place_and_in_the_words_of_the_library() {
        let mut stage = to_json(Options::of(Style::Minify));
        let (code, line, _) = problem(through(&mut stage, "é: 1\nb: [1, 2\nc: 3\n".as_bytes(), 100));
        assert_eq!((code, line >= 2), ("bad-yaml", true));
        assert!(stage.said().is_some_and(|said| !said.is_empty()));
    }

    #[test]
    fn aliases_that_stand_for_more_than_memory_holds_are_refused() {
        let mut bomb = String::from("a: &a [x, x, x, x, x, x, x, x, x, x]\n");
        for (name, of) in ["b", "c", "d", "e", "f", "g", "h", "i", "j"].iter().zip(["a", "b", "c", "d", "e", "f", "g", "h", "i"]) {
            bomb.push_str(&format!("{name}: &{name} [*{of}, *{of}, *{of}, *{of}, *{of}, *{of}, *{of}, *{of}, *{of}, *{of}]\n"));
        }
        assert_eq!(problem(through(&mut to_json(Options::of(Style::Minify)), bomb.as_bytes(), 1000)), ("too-many-aliases", 0, 0));
    }

    #[test]
    fn json_is_written_as_blocks() {
        assert_eq!(yaml(r#"{"name":"Dev","list":[1,"two",{"a":null,"b":[true,[1,2]]}],"empty":[],"none":{},"deep":{"x":{"k":"z"}}}"#), "name: Dev\nlist:\n  - 1\n  - two\n  - a: null\n    b:\n      - true\n      - - 1\n        - 2\nempty: []\nnone: {}\ndeep:\n  x:\n    k: z\n");
        assert_eq!(yaml("[]"), "[]\n");
        assert_eq!(yaml("\"just text\""), "just text\n");
        assert_eq!(String::from_utf8(through(&mut from_json(4), br#"{"a":[{"b":1,"c":2}]}"#, 100).expect("written")).expect("text"), "a:\n    -   b: 1\n        c: 2\n");
    }

    #[test]
    fn strings_are_quoted_only_when_they_must_be() {
        assert_eq!(yaml(r##"["plain text","","true","12","1.5","null","yes"," lead","a: b","a #b","- x","#x","2024-01-02","12:30","tab\there","C:\\dir","é ü","..."]"##), "- plain text\n- \"\"\n- \"true\"\n- \"12\"\n- \"1.5\"\n- \"null\"\n- \"yes\"\n- \" lead\"\n- \"a: b\"\n- \"a #b\"\n- \"- x\"\n- \"#x\"\n- \"2024-01-02\"\n- \"12:30\"\n- \"tab\\there\"\n- C:\\dir\n- é ü\n- \"...\"\n");
        assert_eq!(yaml(r#"{"a: b":1,"":2,"ok key":3}"#), "\"a: b\": 1\n\"\": 2\nok key: 3\n");
    }

    #[test]
    fn texts_of_several_lines_are_blocks_and_come_back_as_they_were() {
        assert_eq!(yaml(r#"{"a":"one\ntwo","b":"one\n\n  two\n","c":["x\ny\n\n"]," d":"\r\n"}"#), "a: |-\n  one\n  two\nb: |\n  one\n\n    two\nc:\n  - |+\n    x\n    y\n\n\" d\": \"\\r\\n\"\n");
        for text in [r#"{"a":"one\ntwo","b":"one\n\n  two\n","c":["x\ny\n\n",{"k":"p\nq"}],"d":" lead\nline","e":"\n\nafter","f":"end\n\n\n","g":"\n"}"#, r#"["a\nb",["c\nd\n"],"\u0001","q\"uo\\te"]"#] {
            let there = yaml(text);
            assert_eq!(json(&there), text, "through:\n{there}");
        }
    }
}
