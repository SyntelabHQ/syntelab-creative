//! JSON held whole, as a tree: for what cannot be done as the text goes by (keys put in order, short lists kept
//! on one line, values taken out or moved about).
//!
//! The tree is built from JSON that [`crate::json`] has already checked and
//! written on one line, so nothing can be wrong with it here. Strings and
//! numbers are kept as they were written, letter for letter. A tree takes
//! memory in step with the text it holds: that is the price of these
//! choices, and the only limit on them.

use std::io::{self, Write};

use crate::json::{Options, Style};

/// A value of JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Node {
    /// A number, a string (with its quotes and its escapes), `true`, `false` or `null`, as it was written.
    Scalar(Box<str>),
    Array(Vec<Node>),
    /// The members in the order they stand in; each key with its quotes and its escapes.
    Object(Vec<(Box<str>, Node)>),
}

impl Node {
    pub fn null() -> Node {
        Node::Scalar("null".into())
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Node::Scalar(text) if &**text == "null")
    }

    /// An empty string, an empty array or an empty object.
    pub fn is_empty(&self) -> bool {
        match self {
            Node::Scalar(text) => &**text == "\"\"",
            Node::Array(items) => items.is_empty(),
            Node::Object(members) => members.is_empty(),
        }
    }

    /// The text of a string, without its quotes and with its escapes read; none for what is no string.
    pub fn as_text(&self) -> Option<String> {
        match self {
            Node::Scalar(text) if text.starts_with('"') => Some(unquoted(text)),
            _ => None,
        }
    }
}

// A tree nested very deep is taken apart from a list, not by calls within calls: those would run out of stack.
impl Drop for Node {
    fn drop(&mut self) {
        let mut waiting: Vec<Node> = Vec::new();
        let take = |node: &mut Node, waiting: &mut Vec<Node>| match node {
            Node::Scalar(_) => {}
            Node::Array(items) => waiting.append(items),
            Node::Object(members) => waiting.extend(members.drain(..).map(|(_, value)| value)),
        };
        take(self, &mut waiting);
        while let Some(mut node) = waiting.pop() {
            take(&mut node, &mut waiting);
        }
    }
}

/// A string of JSON (with its quotes) as the text it stands for.
pub fn unquoted(quoted: &str) -> String {
    let inside = quoted.get(1..quoted.len().saturating_sub(1)).unwrap_or_default();
    if !inside.contains('\\') {
        return inside.to_owned();
    }
    let mut read = crate::escape::Unescape::new(crate::escape::Flavor::Json);
    let mut bytes = Vec::with_capacity(inside.len());
    let done = crate::codec::Stage::push(&mut read, inside.as_bytes(), &mut bytes).and_then(|()| crate::codec::Stage::finish(&mut read, &mut bytes));
    match done {
        Ok(()) => String::from_utf8_lossy(&bytes).into_owned(),
        // It was checked before it came here; should it not read all the same, it is taken as it stands.
        Err(_) => inside.to_owned(),
    }
}

/// A text as a string of JSON, with its quotes.
pub fn quoted(text: &str) -> Box<str> {
    let mut write = crate::escape::Escape::new(crate::escape::Flavor::Json);
    let mut bytes = Vec::with_capacity(text.len() + 2);
    bytes.push(b'"');
    // Writing into memory does not fail, and what is given is text.
    let _ = crate::codec::Stage::push(&mut write, text.as_bytes(), &mut bytes);
    bytes.push(b'"');
    String::from_utf8_lossy(&bytes).into_owned().into_boxed_str()
}

/// A value as a row of the tree the interface draws: what it is, and what can be said of it on one line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Row {
    /// Its key, for a member of an object (as the text it stands for).
    pub key: Option<String>,
    /// `object`, `array`, `string`, `number`, `boolean` or `null`.
    pub kind: &'static str,
    /// How many members or items it holds, for an object or an array.
    pub children: usize,
    /// A scalar as it is written (a string with its quotes), cut short when it is very long.
    pub text: String,
}

/// The longest a scalar is shown in a row; what is longer ends in `…`.
const LONGEST_SHOWN: usize = 300;

impl Node {
    fn row(&self, key: Option<&str>) -> Row {
        let key = key.map(unquoted);
        match self {
            Node::Array(items) => Row { key, kind: "array", children: items.len(), text: String::new() },
            Node::Object(members) => Row { key, kind: "object", children: members.len(), text: String::new() },
            Node::Scalar(written) => {
                let kind = match &**written {
                    "null" => "null",
                    "true" | "false" => "boolean",
                    text if text.starts_with('"') => "string",
                    _ => "number",
                };
                let text = if written.chars().count() > LONGEST_SHOWN { written.chars().take(LONGEST_SHOWN).chain(['…']).collect() } else { written.to_string() };
                Row { key, kind, children: 0, text }
            }
        }
    }

    /// The value at the end of a way of places (the third item of the first member…); none when the way leads nowhere.
    pub fn at(&self, way: &[usize]) -> Option<&Node> {
        let mut node = self;
        for &place in way {
            node = match node {
                Node::Array(items) => items.get(place)?,
                Node::Object(members) => &members.get(place)?.1,
                Node::Scalar(_) => return None,
            };
        }
        Some(node)
    }

    /// The row of this value itself.
    pub fn as_row(&self) -> Row {
        self.row(None)
    }

    /// So many of its members or items as rows, from a place on.
    pub fn rows(&self, from: usize, count: usize) -> Vec<Row> {
        match self {
            Node::Scalar(_) => Vec::new(),
            Node::Array(items) => items.iter().skip(from).take(count).map(|item| item.row(None)).collect(),
            Node::Object(members) => members.iter().skip(from).take(count).map(|(key, value)| value.row(Some(key))).collect(),
        }
    }
}

/// A place where what is sought was found: the way of places to it, and its row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Hit {
    pub way: Vec<usize>,
    pub row: Row,
}

/// Every key and every scalar that holds `sought` (whatever its capitals), in the order of the document: the first
/// `most` of them, and how many there are in all. Call inside [`deep`].
pub fn find(node: &Node, sought: &str, most: usize) -> (Vec<Hit>, usize) {
    fn look(node: &Node, key: Option<&str>, sought: &str, most: usize, way: &mut Vec<usize>, hits: &mut Vec<Hit>, count: &mut usize) {
        let in_key = key.is_some_and(|key| unquoted(key).to_lowercase().contains(sought));
        let in_value = matches!(node, Node::Scalar(text) if text.to_lowercase().contains(sought));
        if in_key || in_value {
            *count += 1;
            if hits.len() < most {
                hits.push(Hit { way: way.clone(), row: node.row(key) });
            }
        }
        match node {
            Node::Scalar(_) => {}
            Node::Array(items) => {
                for (place, item) in items.iter().enumerate() {
                    way.push(place);
                    look(item, None, sought, most, way, hits, count);
                    way.pop();
                }
            }
            Node::Object(members) => {
                for (place, (key, value)) in members.iter().enumerate() {
                    way.push(place);
                    look(value, Some(key), sought, most, way, hits, count);
                    way.pop();
                }
            }
        }
    }
    let (mut hits, mut count) = (Vec::new(), 0);
    look(node, None, &sought.to_lowercase(), most, &mut Vec::new(), &mut hits, &mut count);
    (hits, count)
}

/// What is being put together while the text is read.
enum Building {
    Array(Vec<Node>),
    Object(Vec<(Box<str>, Node)>, Option<Box<str>>),
}

/// Builds the tree of JSON that is known to be right and written on one line (what [`crate::json`] writes when it
/// minifies). None when the computer has no memory left for it.
pub fn build(minified: &str) -> Option<Node> {
    let bytes = minified.as_bytes();
    let mut open: Vec<Building> = Vec::new();
    let mut root: Option<Node> = None;
    let mut at = 0;
    while at < bytes.len() {
        let start = at;
        let value = match bytes[at] {
            b'{' => {
                open.push(Building::Object(Vec::new(), None));
                at += 1;
                continue;
            }
            b'[' => {
                open.push(Building::Array(Vec::new()));
                at += 1;
                continue;
            }
            b',' | b':' => {
                at += 1;
                continue;
            }
            b'}' | b']' => {
                at += 1;
                match open.pop()? {
                    Building::Array(items) => Node::Array(items),
                    Building::Object(members, _) => Node::Object(members),
                }
            }
            b'"' => {
                at += 1;
                while bytes[at] != b'"' {
                    at += if bytes[at] == b'\\' { 2 } else { 1 };
                }
                at += 1;
                let text: Box<str> = minified[start..at].into();
                // In an object, a string that comes when no key waits for its value is a key.
                if let Some(Building::Object(_, key @ None)) = open.last_mut() {
                    *key = Some(text);
                    continue;
                }
                Node::Scalar(text)
            }
            _ => {
                while at < bytes.len() && !matches!(bytes[at], b',' | b'}' | b']') {
                    at += 1;
                }
                Node::Scalar(minified[start..at].into())
            }
        };
        match open.last_mut() {
            None => root = Some(value),
            Some(Building::Array(items)) => {
                if items.len() == items.capacity() && items.try_reserve(items.len().max(4)).is_err() {
                    return None;
                }
                items.push(value);
            }
            Some(Building::Object(members, key)) => {
                if members.len() == members.capacity() && members.try_reserve(members.len().max(4)).is_err() {
                    return None;
                }
                members.push((key.take()?, value));
            }
        }
    }
    root
}

/// Runs something that calls itself once for each level of nesting, on a stack large enough for `depth` levels:
/// how deep a tree may be is then a matter of memory, not of the size of the usual stack. None when the system has
/// no memory for such a stack.
pub fn deep<T: Send>(depth: u64, work: impl FnOnce() -> T + Send) -> Option<T> {
    let stack = (16usize << 20).saturating_add(usize::try_from(depth).unwrap_or(usize::MAX).saturating_mul(1024));
    std::thread::scope(|scope| match std::thread::Builder::new().stack_size(stack).spawn_scoped(scope, work) {
        Ok(running) => match running.join() {
            Ok(done) => Some(done),
            Err(panic) => std::panic::resume_unwind(panic),
        },
        Err(_) => None,
    })
}

/// Puts the members of every object in the order of their keys (as text, letter by letter). Members with the same
/// key stay in the order they were in. Call inside [`deep`].
pub fn sort_keys(node: &mut Node) {
    match node {
        Node::Scalar(_) => {}
        Node::Array(items) => items.iter_mut().for_each(sort_keys),
        Node::Object(members) => {
            members.iter_mut().for_each(|(_, value)| sort_keys(value));
            members.sort_by_cached_key(|(key, _)| unquoted(key));
        }
    }
}

/// How long a value is when written on one line with a space after each comma and each colon; none as soon as it
/// is known to be longer than `most`. Call inside [`deep`] (though what fits on a line is never deep).
fn on_one_line(node: &Node, most: usize) -> Option<usize> {
    let within = |length: usize| (length <= most).then_some(length);
    match node {
        Node::Scalar(text) => within(text.chars().count()),
        Node::Array(items) => {
            let mut length = 2;
            for (index, item) in items.iter().enumerate() {
                length += on_one_line(item, most.checked_sub(length)?)? + if index > 0 { 2 } else { 0 };
                within(length)?;
            }
            within(length)
        }
        Node::Object(members) => {
            let mut length = 2;
            for (index, (key, value)) in members.iter().enumerate() {
                length += key.chars().count() + 2 + if index > 0 { 2 } else { 0 };
                length += on_one_line(value, most.checked_sub(length)?)?;
                within(length)?;
            }
            within(length)
        }
    }
}

/// How a tree is written.
pub struct Writing {
    pub options: Options,
    /// An array or an object that fits in so many letters with what stands before it is written on one line; 0 for
    /// each item on a line of its own.
    pub one_line_within: usize,
}

struct Writer<'a, W: Write> {
    out: W,
    writing: &'a Writing,
}

impl<W: Write> Writer<'_, W> {
    fn scalar(&mut self, text: &str) -> io::Result<()> {
        if !self.writing.options.ascii || text.is_ascii() {
            return self.out.write_all(text.as_bytes());
        }
        let mut units = [0u16; 2];
        let mut written = String::with_capacity(text.len() * 2);
        for letter in text.chars() {
            if letter.is_ascii() {
                written.push(letter);
            } else {
                letter.encode_utf16(&mut units).iter().for_each(|unit| written.push_str(&format!("\\u{unit:04x}")));
            }
        }
        self.out.write_all(written.as_bytes())
    }

    fn new_line(&mut self, levels: usize) -> io::Result<()> {
        let (unit, width): (&[u8], usize) = match self.writing.options.style {
            Style::Spaces(width) => (b" ", usize::from(width)),
            Style::Tab => (b"\t", 1),
            Style::Minify | Style::Check => return Ok(()),
        };
        self.out.write_all(if self.writing.options.crlf { b"\r\n" } else { b"\n" })?;
        for _ in 0..levels * width {
            self.out.write_all(unit)?;
        }
        Ok(())
    }

    /// How many letters a level is pushed in by, for telling what still fits on a line.
    fn indent_width(&self) -> usize {
        match self.writing.options.style {
            Style::Spaces(width) => usize::from(width),
            Style::Tab => 4,
            Style::Minify | Style::Check => 0,
        }
    }

    /// A value on one line. `tight`: without the spaces after commas and colons.
    fn flat(&mut self, node: &Node, tight: bool) -> io::Result<()> {
        let comma: &[u8] = if tight { b"," } else { b", " };
        let colon: &[u8] = if tight || !self.writing.options.colon_space { b":" } else { b": " };
        match node {
            Node::Scalar(text) => self.scalar(text),
            Node::Array(items) => {
                self.out.write_all(b"[")?;
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        self.out.write_all(comma)?;
                    }
                    self.flat(item, tight)?;
                }
                self.out.write_all(b"]")
            }
            Node::Object(members) => {
                self.out.write_all(b"{")?;
                for (index, (key, value)) in members.iter().enumerate() {
                    if index > 0 {
                        self.out.write_all(comma)?;
                    }
                    self.scalar(key)?;
                    self.out.write_all(colon)?;
                    self.flat(value, tight)?;
                }
                self.out.write_all(b"}")
            }
        }
    }

    /// A value with each item on a line of its own, `levels` deep; `before` is how many letters stand before it on its line.
    fn spread(&mut self, node: &Node, levels: usize, before: usize) -> io::Result<()> {
        let within = self.writing.one_line_within;
        if node.is_empty() || matches!(node, Node::Scalar(_)) || (within > 0 && on_one_line(node, within.saturating_sub(before)).is_some()) {
            return self.flat(node, false);
        }
        let inside = (levels + 1) * self.indent_width();
        match node {
            Node::Scalar(_) => Ok(()),
            Node::Array(items) => {
                self.out.write_all(b"[")?;
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        self.out.write_all(b",")?;
                    }
                    self.new_line(levels + 1)?;
                    self.spread(item, levels + 1, inside)?;
                }
                self.new_line(levels)?;
                self.out.write_all(b"]")
            }
            Node::Object(members) => {
                self.out.write_all(b"{")?;
                for (index, (key, value)) in members.iter().enumerate() {
                    if index > 0 {
                        self.out.write_all(b",")?;
                    }
                    self.new_line(levels + 1)?;
                    self.scalar(key)?;
                    let colon: &[u8] = if self.writing.options.colon_space { b": " } else { b":" };
                    self.out.write_all(colon)?;
                    self.spread(value, levels + 1, inside + key.chars().count() + colon.len())?;
                }
                self.new_line(levels)?;
                self.out.write_all(b"}")
            }
        }
    }
}

/// Writes a tree as its options say. Call inside [`deep`].
pub fn write(node: &Node, out: impl Write, writing: &Writing) -> io::Result<()> {
    let mut writer = Writer { out, writing };
    match writing.options.style {
        Style::Check => return Ok(()),
        Style::Minify => writer.flat(node, true)?,
        Style::Spaces(_) | Style::Tab => writer.spread(node, 0, 0)?,
    }
    if writing.options.final_newline {
        writer.out.write_all(if writing.options.crlf { b"\r\n" } else { b"\n" })?;
    }
    writer.out.flush()
}

/// What can be done to the values of a tree before it is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    /// Members and items that are `null` are taken out.
    DropNulls,
    /// So are empty strings, empty arrays and empty objects, and whatever becomes empty by it.
    DropEmpties,
    /// Everything nested is brought up into one object, each value under the way to it: `{"a":{"b":[1]}}` gives `{"a.b.0":1}`.
    Flatten,
    /// The other way: keys with dots are made into nested objects, and into arrays where the names are 0, 1, 2…
    Unflatten,
    /// The whole document becomes one string that holds it.
    Stringify,
    /// A document that is one string holding JSON becomes that JSON.
    Parse,
}

impl Change {
    pub fn of(name: &str) -> Option<Change> {
        Some(match name {
            "drop-nulls" => Change::DropNulls,
            "drop-empties" => Change::DropEmpties,
            "flatten" => Change::Flatten,
            "unflatten" => Change::Unflatten,
            "stringify" => Change::Stringify,
            "parse" => Change::Parse,
            _ => return None,
        })
    }
}

fn drop_where(node: &mut Node, gone: fn(&Node) -> bool) {
    match node {
        Node::Scalar(_) => {}
        Node::Array(items) => {
            items.iter_mut().for_each(|item| drop_where(item, gone));
            items.retain(|item| !gone(item));
        }
        Node::Object(members) => {
            members.iter_mut().for_each(|(_, value)| drop_where(value, gone));
            members.retain(|(_, value)| !gone(value));
        }
    }
}

fn flatten_into(node: Node, way: &str, flat: &mut Vec<(Box<str>, Node)>) {
    let mut node = node;
    let under = |name: &str| if way.is_empty() { name.to_owned() } else { format!("{way}.{name}") };
    match &mut node {
        // What is empty has nothing to bring up, and stays as it is under its own way.
        Node::Array(items) if !items.is_empty() => {
            for (index, item) in std::mem::take(items).into_iter().enumerate() {
                flatten_into(item, &under(&index.to_string()), flat);
            }
        }
        Node::Object(members) if !members.is_empty() => {
            for (key, value) in std::mem::take(members) {
                flatten_into(value, &under(&unquoted(&key)), flat);
            }
        }
        _ => flat.push((quoted(way), node)),
    }
}

/// Puts `value` in `into` at the end of a way of names, making the objects on the way.
fn place(into: &mut Vec<(Box<str>, Node)>, names: &[&str], value: Node) {
    let Some((first, rest)) = names.split_first() else { return };
    let key = quoted(first);
    if rest.is_empty() {
        into.push((key, value));
        return;
    }
    let at = match into.iter().position(|(known, inner)| *known == key && matches!(inner, Node::Object(_))) {
        Some(at) => at,
        None => {
            into.push((key, Node::Object(Vec::new())));
            into.len() - 1
        }
    };
    if let Node::Object(inner) = &mut into[at].1 {
        place(inner, rest, value);
    }
}

/// Objects whose keys are 0, 1, 2… in that order become arrays, from the inside out.
fn lists(node: &mut Node) {
    let Node::Object(members) = node else { return };
    members.iter_mut().for_each(|(_, value)| lists(value));
    let numbered = !members.is_empty() && members.iter().enumerate().all(|(index, (key, _))| unquoted(key) == index.to_string());
    if numbered {
        *node = Node::Array(std::mem::take(members).into_iter().map(|(_, value)| value).collect());
    }
}

/// Changes a tree. None when it cannot be done to this tree (`Parse` of what is no string holding JSON). Call inside [`deep`].
pub fn change(node: Node, change: Change) -> Option<Node> {
    let mut node = node;
    Some(match change {
        Change::DropNulls => {
            drop_where(&mut node, Node::is_null);
            node
        }
        Change::DropEmpties => {
            drop_where(&mut node, Node::is_empty);
            node
        }
        Change::Flatten => {
            if matches!(node, Node::Scalar(_)) || node.is_empty() {
                return Some(node);
            }
            let mut flat = Vec::new();
            flatten_into(node, "", &mut flat);
            Node::Object(flat)
        }
        Change::Unflatten => {
            let Node::Object(members) = &mut node else { return Some(node) };
            let mut nested = Vec::new();
            for (key, value) in std::mem::take(members) {
                let way = unquoted(&key);
                place(&mut nested, &way.split('.').collect::<Vec<_>>(), value);
            }
            let mut nested = Node::Object(nested);
            lists(&mut nested);
            nested
        }
        Change::Stringify => {
            let mut written = Vec::new();
            write(&node, &mut written, &Writing { options: Options::of(Style::Minify), one_line_within: 0 }).ok()?;
            Node::Scalar(quoted(&String::from_utf8(written).ok()?))
        }
        Change::Parse => {
            let inside = node.as_text()?;
            let (minified, _) = crate::json::transform_text(&inside, Style::Minify, &mut |_| true).ok()?;
            build(&minified)?
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(text: &str) -> Node {
        let (minified, _) = crate::json::transform_text(text, Style::Minify, &mut |_| true).expect("JSON");
        build(&minified).expect("a tree")
    }

    fn written(node: &Node, style: Style, one_line_within: usize) -> String {
        let mut out = Vec::new();
        write(node, &mut out, &Writing { options: Options::of(style), one_line_within }).expect("written");
        String::from_utf8(out).expect("text")
    }

    fn changed(text: &str, how: Change) -> String {
        written(&change(tree(text), how).expect("changed"), Style::Minify, 0)
    }

    #[test]
    fn a_tree_is_written_as_the_text_it_was_built_from() {
        let text = r#"{"a":[1,2.50,{"b":null,"é":"x\ny"}],"c":{},"d":[],"e":"","f":true}"#;
        let node = tree(text);
        assert_eq!(written(&node, Style::Minify, 0), text);
        // Spread out, it is letter for letter what the reader that never builds a tree writes.
        for style in [Style::Spaces(2), Style::Spaces(0), Style::Tab] {
            assert_eq!(written(&node, style, 0), crate::json::transform_text(text, style, &mut |_| true).expect("JSON").0, "{style:?}");
        }
        for single in ["1", "\"a\"", "null", "[]", "{}"] {
            assert_eq!(written(&tree(single), Style::Spaces(2), 0), single);
        }
    }

    #[test]
    fn a_tree_is_shown_a_row_at_a_time() {
        let node = tree(r#"{"name":"Ana","list":[1,true,null,{"é":[]}],"long":"0123456789"}"#);
        assert_eq!(node.as_row(), Row { key: None, kind: "object", children: 3, text: String::new() });
        let rows = node.rows(0, 10);
        assert_eq!(rows[0], Row { key: Some("name".into()), kind: "string", children: 0, text: "\"Ana\"".into() });
        assert_eq!((rows[1].key.as_deref(), rows[1].kind, rows[1].children), (Some("list"), "array", 4));
        let list = node.at(&[1]).expect("the list");
        assert_eq!(list.rows(1, 2).iter().map(|row| row.kind).collect::<Vec<_>>(), ["boolean", "null"]);
        assert_eq!(node.at(&[1, 3, 0]).map(Node::as_row), Some(Row { key: None, kind: "array", children: 0, text: String::new() }));
        assert_eq!(node.at(&[1, 9]), None);
        assert_eq!(node.at(&[0, 0]), None);
        let long = tree(&format!("\"{}\"", "x".repeat(1000)));
        assert_eq!(long.as_row().text.chars().count(), 301);
    }

    #[test]
    fn keys_and_values_are_found() {
        let node = tree(r#"{"Name":"Ana","list":[{"name":"Bob"},"banana",12],"n":"x"}"#);
        let (hits, count) = find(&node, "NA", 10);
        assert_eq!(count, 3);
        assert_eq!(hits.iter().map(|hit| hit.way.clone()).collect::<Vec<_>>(), [vec![0], vec![1, 0, 0], vec![1, 1]]);
        // Only the first ones are given; all of them are counted.
        let (hits, count) = find(&node, "a", 1);
        assert_eq!((hits.len(), count), (1, 3));
        assert_eq!(find(&node, "zzz", 10), (Vec::new(), 0));
    }

    #[test]
    fn keys_are_put_in_order() {
        let mut node = tree(r#"{"b":1,"a":{"z":[{"y":1,"x":2}],"é":0,"A":0},"B":2}"#);
        sort_keys(&mut node);
        assert_eq!(written(&node, Style::Minify, 0), r#"{"B":2,"a":{"A":0,"z":[{"x":2,"y":1}],"é":0},"b":1}"#);
    }

    #[test]
    fn what_is_short_stays_on_one_line() {
        let node = tree(r#"{"point":[1,2,3],"name":"a","deep":{"list":[{"a":1},{"b":[1,2]}],"long":["aaaaaaaaaaaaaaaaaaaa","bbbbbbbbbbbbbbbbbbbb"]}}"#);
        assert_eq!(written(&node, Style::Spaces(2), 40), "{\n  \"point\": [1, 2, 3],\n  \"name\": \"a\",\n  \"deep\": {\n    \"list\": [{\"a\": 1}, {\"b\": [1, 2]}],\n    \"long\": [\n      \"aaaaaaaaaaaaaaaaaaaa\",\n      \"bbbbbbbbbbbbbbbbbbbb\"\n    ]\n  }\n}");
        // With room enough, the whole of it is one line.
        assert_eq!(written(&tree("[1,[2,{\"a\":3}]]"), Style::Spaces(2), 80), "[1, [2, {\"a\": 3}]]");
    }

    #[test]
    fn values_are_taken_out() {
        let text = r#"{"a":null,"b":[1,null,"",[],{}],"c":{"d":null,"e":{"f":[]}},"g":0,"h":false}"#;
        assert_eq!(changed(text, Change::DropNulls), r#"{"b":[1,"",[],{}],"c":{"e":{"f":[]}},"g":0,"h":false}"#);
        // What becomes empty by it goes too; what is only "nothing" in some other sense (0, false, null) stays.
        assert_eq!(changed(text, Change::DropEmpties), r#"{"a":null,"b":[1,null],"c":{"d":null},"g":0,"h":false}"#);
    }

    #[test]
    fn nested_values_are_brought_up_and_put_back() {
        let text = r#"{"a":{"b":[1,{"c":"x"}],"d":{}},"e":"y","f":[]}"#;
        let flat = r#"{"a.b.0":1,"a.b.1.c":"x","a.d":{},"e":"y","f":[]}"#;
        assert_eq!(changed(text, Change::Flatten), flat);
        assert_eq!(changed(flat, Change::Unflatten), text);
        assert_eq!(changed("[1,[2]]", Change::Flatten), r#"{"0":1,"1.0":2}"#);
        assert_eq!(changed("7", Change::Flatten), "7");
    }

    #[test]
    fn a_document_becomes_a_string_and_comes_back() {
        let text = r#"{"a":"é \"q\"","b":[1]}"#;
        let string = changed(text, Change::Stringify);
        assert_eq!(string, r#""{\"a\":\"é \\\"q\\\"\",\"b\":[1]}""#);
        assert_eq!(changed(&string, Change::Parse), text);
        assert_eq!(change(tree("\"not json\""), Change::Parse), None);
        assert_eq!(change(tree("[1]"), Change::Parse), None);
    }

    #[test]
    fn a_very_deep_tree_is_built_changed_and_dropped() {
        let deep_by = 300_000;
        let text = format!("{}1{}", "[".repeat(deep_by), "]".repeat(deep_by));
        let node = build(&text).expect("a tree");
        let back = deep(deep_by as u64, || {
            let mut node = change(node, Change::DropNulls).expect("changed");
            sort_keys(&mut node);
            written(&node, Style::Minify, 0)
        });
        assert_eq!(back.map(|text| text.len()), Some(text.len()));
    }
}
