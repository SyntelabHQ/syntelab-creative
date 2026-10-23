//! JSONPath (RFC 9535): a query read, and run on a tree of JSON.
//!
//! All of the standard is here: names, wildcards, indexes, slices, filters,
//! descendants, and the functions `length`, `count`, `match`, `search` and
//! `value`. What a query finds is given with the way to each value, written
//! as the standard writes it (`$['a'][0]`).
//!
//! The patterns of `match` and `search` are run by the `regex` crate, whose
//! dialect holds the one the standard asks for (RFC 9485).

use regex::Regex;

use crate::tree::{unquoted, Node};

/// Where a query stops being one: the place of the letter, from 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BadQuery {
    pub column: usize,
}

#[derive(Debug, Clone, PartialEq)]
enum Literal {
    Null,
    Bool(bool),
    Number(f64),
    Text(String),
}

#[derive(Debug, Clone)]
enum Selector {
    Name(String),
    Wildcard,
    Index(i64),
    Slice(Option<i64>, Option<i64>, Option<i64>),
    Filter(Test),
}

#[derive(Debug, Clone)]
struct Segment {
    /// `..`: the selectors are tried on every value under the one at hand, not only on its children.
    descendant: bool,
    selectors: Vec<Selector>,
}

/// A query inside a filter: from the value being tested (`@`) or from the whole document (`$`).
#[derive(Debug, Clone)]
struct Inner {
    from_root: bool,
    segments: Vec<Segment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Compare {
    Equal,
    NotEqual,
    Less,
    LessOrEqual,
    Greater,
    GreaterOrEqual,
}

/// Something that gives one value, or nothing.
#[derive(Debug, Clone)]
enum Operand {
    Literal(Literal),
    Query(Inner),
    Length(Box<Operand>),
    Count(Inner),
    Value(Inner),
}

/// Something that is true or false of the value being tested.
#[derive(Debug, Clone)]
enum Test {
    Or(Vec<Test>),
    And(Vec<Test>),
    Not(Box<Test>),
    Compare(Operand, Compare, Operand),
    Exists(Inner),
    /// `match` (the whole text) or `search` (some part of it), with the pattern made ready when it is a literal.
    Pattern { text: Operand, pattern: Operand, whole: bool, ready: Option<Regex> },
}

/// A query, read and ready to be run.
#[derive(Debug, Clone)]
pub struct Query {
    segments: Vec<Segment>,
}

struct Reader {
    letters: Vec<char>,
    at: usize,
}

type Read<T> = Result<T, BadQuery>;

impl Reader {
    fn bad<T>(&self) -> Read<T> {
        Err(BadQuery { column: self.at + 1 })
    }

    fn peek(&self) -> Option<char> {
        self.letters.get(self.at).copied()
    }

    fn peek_at(&self, ahead: usize) -> Option<char> {
        self.letters.get(self.at + ahead).copied()
    }

    fn take(&mut self, wanted: char) -> bool {
        let there = self.peek() == Some(wanted);
        if there {
            self.at += 1;
        }
        there
    }

    fn expect(&mut self, wanted: char) -> Read<()> {
        if self.take(wanted) {
            Ok(())
        } else {
            self.bad()
        }
    }

    fn takes(&mut self, wanted: &str) -> bool {
        let there = wanted.chars().enumerate().all(|(ahead, letter)| self.peek_at(ahead) == Some(letter));
        if there {
            self.at += wanted.chars().count();
        }
        there
    }

    fn blanks(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.at += 1;
        }
    }

    fn segments(&mut self) -> Read<Vec<Segment>> {
        let mut segments = Vec::new();
        loop {
            let before = self.at;
            self.blanks();
            let descendant = self.takes("..");
            if descendant {
                let selectors = match self.peek() {
                    Some('[') => self.bracketed()?,
                    Some('*') => {
                        self.at += 1;
                        vec![Selector::Wildcard]
                    }
                    _ => vec![Selector::Name(self.short_name()?)],
                };
                segments.push(Segment { descendant, selectors });
            } else if self.peek() == Some('[') {
                let selectors = self.bracketed()?;
                segments.push(Segment { descendant, selectors });
            } else if self.peek() == Some('.') {
                self.at += 1;
                let selectors = if self.take('*') { vec![Selector::Wildcard] } else { vec![Selector::Name(self.short_name()?)] };
                segments.push(Segment { descendant, selectors });
            } else {
                // The blanks that were passed over belong to what follows the query.
                self.at = before;
                return Ok(segments);
            }
        }
    }

    /// A name written without quotes after a dot.
    fn short_name(&mut self) -> Read<String> {
        let first = |letter: char| letter.is_ascii_alphabetic() || letter == '_' || !letter.is_ascii();
        let mut name = String::new();
        match self.peek() {
            Some(letter) if first(letter) => {
                name.push(letter);
                self.at += 1;
            }
            _ => return self.bad(),
        }
        while let Some(letter) = self.peek().filter(|&letter| first(letter) || letter.is_ascii_digit()) {
            name.push(letter);
            self.at += 1;
        }
        Ok(name)
    }

    fn bracketed(&mut self) -> Read<Vec<Selector>> {
        self.expect('[')?;
        let mut selectors = Vec::new();
        loop {
            self.blanks();
            selectors.push(self.selector()?);
            self.blanks();
            if self.take(']') {
                return Ok(selectors);
            }
            self.expect(',')?;
        }
    }

    fn selector(&mut self) -> Read<Selector> {
        match self.peek() {
            Some('\'' | '"') => Ok(Selector::Name(self.quoted()?)),
            Some('*') => {
                self.at += 1;
                Ok(Selector::Wildcard)
            }
            Some('?') => {
                self.at += 1;
                self.blanks();
                Ok(Selector::Filter(self.or()?))
            }
            _ => {
                let start = self.whole_number()?;
                self.blanks();
                if !self.take(':') {
                    return start.map(Selector::Index).ok_or(BadQuery { column: self.at + 1 });
                }
                self.blanks();
                let end = self.whole_number()?;
                self.blanks();
                let step = if self.take(':') {
                    self.blanks();
                    self.whole_number()?
                } else {
                    None
                };
                Ok(Selector::Slice(start, end, step))
            }
        }
    }

    /// A whole number as indexes are written (no leading zero, no `-0`); none when there is no number here.
    fn whole_number(&mut self) -> Read<Option<i64>> {
        let start = self.at;
        if self.peek() == Some('-') {
            self.at += 1;
        }
        let digits = self.at;
        while self.peek().is_some_and(|letter| letter.is_ascii_digit()) {
            self.at += 1;
        }
        if self.at == digits {
            if self.at > start {
                return self.bad();
            }
            return Ok(None);
        }
        let written: String = self.letters[start..self.at].iter().collect();
        let leading_zero = self.letters[digits] == '0' && self.at - digits > 1;
        if leading_zero || written == "-0" {
            self.at = start;
            return self.bad();
        }
        // Beyond what the standard lets an index be (the whole numbers a double holds exactly), it is no index.
        match written.parse::<i64>() {
            Ok(number) if number.unsigned_abs() < (1 << 53) => Ok(Some(number)),
            _ => {
                self.at = start;
                self.bad()
            }
        }
    }

    fn quoted(&mut self) -> Read<String> {
        let Some(quote) = self.peek() else { return self.bad() };
        self.at += 1;
        let mut text = String::new();
        loop {
            let Some(letter) = self.peek() else { return self.bad() };
            self.at += 1;
            if letter == quote {
                return Ok(text);
            }
            if letter < ' ' {
                self.at -= 1;
                return self.bad();
            }
            if letter != '\\' {
                text.push(letter);
                continue;
            }
            let Some(escaped) = self.peek() else { return self.bad() };
            self.at += 1;
            match escaped {
                'b' => text.push('\u{8}'),
                'f' => text.push('\u{c}'),
                'n' => text.push('\n'),
                'r' => text.push('\r'),
                't' => text.push('\t'),
                '/' | '\\' => text.push(escaped),
                '\'' | '"' if escaped == quote => text.push(escaped),
                'u' => {
                    let unit = self.four_hex()?;
                    let point = match unit {
                        0xD800..=0xDBFF => {
                            if !self.takes("\\u") {
                                return self.bad();
                            }
                            let low = self.four_hex()?;
                            if !(0xDC00..=0xDFFF).contains(&low) {
                                return self.bad();
                            }
                            0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                        }
                        0xDC00..=0xDFFF => return self.bad(),
                        _ => unit,
                    };
                    match char::from_u32(point) {
                        Some(letter) => text.push(letter),
                        None => return self.bad(),
                    }
                }
                _ => {
                    self.at -= 1;
                    return self.bad();
                }
            }
        }
    }

    fn four_hex(&mut self) -> Read<u32> {
        let mut unit = 0;
        for _ in 0..4 {
            let Some(digit) = self.peek().and_then(|letter| letter.to_digit(16)) else { return self.bad() };
            unit = unit * 16 + digit;
            self.at += 1;
        }
        Ok(unit)
    }

    fn or(&mut self) -> Read<Test> {
        let mut tests = vec![self.and()?];
        loop {
            self.blanks();
            if !self.takes("||") {
                break;
            }
            self.blanks();
            tests.push(self.and()?);
        }
        Ok(if tests.len() == 1 { tests.remove(0) } else { Test::Or(tests) })
    }

    fn and(&mut self) -> Read<Test> {
        let mut tests = vec![self.basic()?];
        loop {
            self.blanks();
            if !self.takes("&&") {
                break;
            }
            self.blanks();
            tests.push(self.basic()?);
        }
        Ok(if tests.len() == 1 { tests.remove(0) } else { Test::And(tests) })
    }

    fn basic(&mut self) -> Read<Test> {
        if self.peek() == Some('!') && self.peek_at(1) != Some('=') {
            self.at += 1;
            self.blanks();
            let negated = self.basic_inner(true)?;
            return Ok(Test::Not(Box::new(negated)));
        }
        self.basic_inner(false)
    }

    /// What can be tested: something in brackets, a comparison, a query that finds something, `match` or `search`.
    /// `negated`: it comes after a `!`, where a comparison cannot stand.
    fn basic_inner(&mut self, negated: bool) -> Read<Test> {
        if self.take('(') {
            self.blanks();
            let inside = self.or()?;
            self.blanks();
            self.expect(')')?;
            return Ok(inside);
        }
        let start = self.at;
        if let Some(whole) = self.pattern_call()? {
            return Ok(whole);
        }
        let left = self.operand()?;
        self.blanks();
        let compare = [("==", Compare::Equal), ("!=", Compare::NotEqual), ("<=", Compare::LessOrEqual), (">=", Compare::GreaterOrEqual), ("<", Compare::Less), (">", Compare::Greater)].into_iter().find(|(sign, _)| self.takes(sign));
        match compare {
            Some((_, compare)) if !negated => {
                // What is compared gives one value at the most: a query that could give several is not let by.
                if !single(&left) {
                    self.at = start;
                    return self.bad();
                }
                self.blanks();
                let right_at = self.at;
                let right = self.operand()?;
                if !single(&right) {
                    self.at = right_at;
                    return self.bad();
                }
                Ok(Test::Compare(left, compare, right))
            }
            Some(_) => self.bad(),
            // Alone, only a query can stand: it is true when it finds something.
            None => match left {
                Operand::Query(inner) => Ok(Test::Exists(inner)),
                _ => {
                    self.at = start;
                    self.bad()
                }
            },
        }
    }

    /// `match(text, pattern)` or `search(text, pattern)`, when one of them stands here.
    fn pattern_call(&mut self) -> Read<Option<Test>> {
        let whole = if self.takes("match(") {
            true
        } else if self.takes("search(") {
            false
        } else {
            return Ok(None);
        };
        self.blanks();
        let text = self.operand()?;
        self.blanks();
        self.expect(',')?;
        self.blanks();
        let pattern_at = self.at;
        let pattern = self.operand()?;
        self.blanks();
        self.expect(')')?;
        let ready = match &pattern {
            Operand::Literal(Literal::Text(written)) => match pattern_of(written, whole) {
                Some(ready) => Some(ready),
                None => {
                    self.at = pattern_at;
                    return self.bad();
                }
            },
            _ => None,
        };
        Ok(Some(Test::Pattern { text, pattern, whole, ready }))
    }

    fn operand(&mut self) -> Read<Operand> {
        match self.peek() {
            Some('\'' | '"') => Ok(Operand::Literal(Literal::Text(self.quoted()?))),
            Some('@') => {
                self.at += 1;
                Ok(Operand::Query(Inner { from_root: false, segments: self.segments()? }))
            }
            Some('$') => {
                self.at += 1;
                Ok(Operand::Query(Inner { from_root: true, segments: self.segments()? }))
            }
            _ if self.takes("true") => Ok(Operand::Literal(Literal::Bool(true))),
            _ if self.takes("false") => Ok(Operand::Literal(Literal::Bool(false))),
            _ if self.takes("null") => Ok(Operand::Literal(Literal::Null)),
            _ if self.takes("length(") => {
                self.blanks();
                let of = self.operand()?;
                self.blanks();
                self.expect(')')?;
                Ok(Operand::Length(Box::new(of)))
            }
            _ if self.takes("count(") => Ok(Operand::Count(self.inner_argument()?)),
            _ if self.takes("value(") => Ok(Operand::Value(self.inner_argument()?)),
            _ => self.number().map(|number| Operand::Literal(Literal::Number(number))),
        }
    }

    /// The one argument of `count` and `value`: a query, then the closing bracket.
    fn inner_argument(&mut self) -> Read<Inner> {
        self.blanks();
        let from_root = match self.peek() {
            Some('@') => false,
            Some('$') => true,
            _ => return self.bad(),
        };
        self.at += 1;
        let segments = self.segments()?;
        self.blanks();
        self.expect(')')?;
        Ok(Inner { from_root, segments })
    }

    /// A number as JSON writes them.
    fn number(&mut self) -> Read<f64> {
        let start = self.at;
        if self.peek() == Some('-') {
            self.at += 1;
        }
        while self.peek().is_some_and(|letter| letter.is_ascii_digit() || matches!(letter, '.' | 'e' | 'E' | '+' | '-')) {
            self.at += 1;
        }
        let written: String = self.letters[start..self.at].iter().collect();
        // Checked by the reader of JSON itself: what it does not take as one number is none here either.
        let is_number = crate::json::transform_text(&written, crate::json::Style::Check, &mut |_| true).is_ok() && written.starts_with(|letter: char| letter == '-' || letter.is_ascii_digit());
        match written.parse::<f64>() {
            Ok(number) if is_number => Ok(number),
            _ => {
                self.at = start;
                self.bad()
            }
        }
    }
}

/// An operand that gives one value at the most: a literal, a function, or a query made only of names and indexes.
fn single(operand: &Operand) -> bool {
    match operand {
        Operand::Query(inner) => inner.segments.iter().all(|segment| !segment.descendant && matches!(segment.selectors.as_slice(), [Selector::Name(_) | Selector::Index(_)])),
        _ => true,
    }
}

/// A pattern as the standard writes them, made ready. For `match` it must fit the whole text.
fn pattern_of(written: &str, whole: bool) -> Option<Regex> {
    Regex::new(&if whole { format!("^(?:{written})$") } else { written.to_owned() }).ok()
}

impl Query {
    /// Reads a query. It starts with `$`.
    pub fn read(text: &str) -> Result<Query, BadQuery> {
        let mut reader = Reader { letters: text.chars().collect(), at: 0 };
        reader.blanks();
        reader.expect('$')?;
        let segments = reader.segments()?;
        reader.blanks();
        if reader.at < reader.letters.len() {
            return reader.bad();
        }
        Ok(Query { segments })
    }

    /// Everything the query finds in a document, in the order of the document, each with the way to it. Call
    /// inside [`crate::tree::deep`]: a `..` goes as deep as the document does.
    pub fn find<'a>(&self, root: &'a Node) -> Vec<Found<'a>> {
        run(&self.segments, vec![Found { node: root, way: "$".to_owned() }], root)
    }
}

/// A value that was found, and the way to it from the root.
#[derive(Debug, Clone, PartialEq)]
pub struct Found<'a> {
    pub node: &'a Node,
    pub way: String,
}

/// A name as it is written in the way to a value: in single quotes, with what must be escaped.
fn way_name(name: &str) -> String {
    let mut written = String::with_capacity(name.len() + 4);
    written.push_str("['");
    for letter in name.chars() {
        match letter {
            '\'' => written.push_str("\\'"),
            '\\' => written.push_str("\\\\"),
            '\u{8}' => written.push_str("\\b"),
            '\u{c}' => written.push_str("\\f"),
            '\n' => written.push_str("\\n"),
            '\r' => written.push_str("\\r"),
            '\t' => written.push_str("\\t"),
            letter if letter < ' ' => written.push_str(&format!("\\u{:04x}", u32::from(letter))),
            letter => written.push(letter),
        }
    }
    written.push_str("']");
    written
}

fn run<'a>(segments: &[Segment], from: Vec<Found<'a>>, root: &'a Node) -> Vec<Found<'a>> {
    let mut found = from;
    for segment in segments {
        let mut next = Vec::new();
        for at in &found {
            if segment.descendant {
                descend(at, segment, root, &mut next);
            } else {
                select(at, segment, root, &mut next);
            }
        }
        found = next;
    }
    found
}

/// The selectors of a segment tried on a value and on everything under it, the value first.
fn descend<'a>(at: &Found<'a>, segment: &Segment, root: &'a Node, into: &mut Vec<Found<'a>>) {
    select(at, segment, root, into);
    match at.node {
        Node::Scalar(_) => {}
        Node::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                descend(&Found { node: item, way: format!("{}[{index}]", at.way) }, segment, root, into);
            }
        }
        Node::Object(members) => {
            for (key, value) in members {
                descend(&Found { node: value, way: format!("{}{}", at.way, way_name(&unquoted(key))) }, segment, root, into);
            }
        }
    }
}

fn select<'a>(at: &Found<'a>, segment: &Segment, root: &'a Node, into: &mut Vec<Found<'a>>) {
    for selector in &segment.selectors {
        match (selector, at.node) {
            (Selector::Name(name), Node::Object(members)) => {
                // The last member of that name is the one a reader of JSON keeps.
                if let Some((_, value)) = members.iter().rev().find(|(key, _)| unquoted(key) == *name) {
                    into.push(Found { node: value, way: format!("{}{}", at.way, way_name(name)) });
                }
            }
            (Selector::Wildcard, Node::Array(items)) => items.iter().enumerate().for_each(|(index, item)| into.push(Found { node: item, way: format!("{}[{index}]", at.way) })),
            (Selector::Wildcard, Node::Object(members)) => members.iter().for_each(|(key, value)| into.push(Found { node: value, way: format!("{}{}", at.way, way_name(&unquoted(key))) })),
            (Selector::Index(index), Node::Array(items)) => {
                let length = items.len() as i64;
                let place = if *index < 0 { length + index } else { *index };
                if (0..length).contains(&place) {
                    into.push(Found { node: &items[place as usize], way: format!("{}[{place}]", at.way) });
                }
            }
            (Selector::Slice(start, end, step), Node::Array(items)) => {
                for place in slice(items.len() as i64, *start, *end, *step) {
                    into.push(Found { node: &items[place as usize], way: format!("{}[{place}]", at.way) });
                }
            }
            (Selector::Filter(test), Node::Array(items)) => {
                for (index, item) in items.iter().enumerate() {
                    if holds(test, item, root) {
                        into.push(Found { node: item, way: format!("{}[{index}]", at.way) });
                    }
                }
            }
            (Selector::Filter(test), Node::Object(members)) => {
                for (key, value) in members {
                    if holds(test, value, root) {
                        into.push(Found { node: value, way: format!("{}{}", at.way, way_name(&unquoted(key))) });
                    }
                }
            }
            _ => {}
        }
    }
}

/// The places a slice takes from an array of `length` items, in the order it takes them (RFC 9535, 2.3.4.2.2).
fn slice(length: i64, start: Option<i64>, end: Option<i64>, step: Option<i64>) -> Vec<i64> {
    let step = step.unwrap_or(1);
    if step == 0 {
        return Vec::new();
    }
    let within = |place: i64| if place >= 0 { place } else { length + place };
    let mut places = Vec::new();
    if step > 0 {
        let lower = within(start.unwrap_or(0)).clamp(0, length);
        let upper = within(end.unwrap_or(length)).clamp(0, length);
        let mut place = lower;
        while place < upper {
            places.push(place);
            place += step;
        }
    } else {
        let upper = within(start.unwrap_or(length - 1)).clamp(-1, length - 1);
        let lower = within(end.unwrap_or(-length - 1)).clamp(-1, length - 1);
        let mut place = upper;
        while place > lower {
            places.push(place);
            place += step;
        }
    }
    places
}

/// A value as comparisons see it.
#[derive(Debug, Clone)]
enum Seen<'a> {
    Nothing,
    Literal(Literal),
    Node(&'a Node),
}

/// A scalar of the document as a literal; none for an array or an object.
fn literal_of(node: &Node) -> Option<Literal> {
    let Node::Scalar(text) = node else { return None };
    Some(match &**text {
        "null" => Literal::Null,
        "true" => Literal::Bool(true),
        "false" => Literal::Bool(false),
        written if written.starts_with('"') => Literal::Text(unquoted(written)),
        written => Literal::Number(written.parse().unwrap_or(f64::NAN)),
    })
}

/// Two values of the document are the same: scalars by what they stand for, arrays item by item, objects member
/// by member whatever their order.
fn same(first: &Node, second: &Node) -> bool {
    match (first, second) {
        (Node::Array(first), Node::Array(second)) => first.len() == second.len() && first.iter().zip(second).all(|(a, b)| same(a, b)),
        (Node::Object(first), Node::Object(second)) => first.len() == second.len() && first.iter().all(|(key, value)| second.iter().any(|(other, found)| unquoted(other) == unquoted(key) && same(value, found))),
        (Node::Scalar(_), Node::Scalar(_)) => literal_of(first) == literal_of(second),
        _ => false,
    }
}

fn equal(left: &Seen, right: &Seen) -> bool {
    let literal = |seen: &Seen| match seen {
        Seen::Literal(literal) => Some(literal.clone()),
        Seen::Node(node) => literal_of(node),
        Seen::Nothing => None,
    };
    match (left, right) {
        (Seen::Nothing, Seen::Nothing) => true,
        (Seen::Nothing, _) | (_, Seen::Nothing) => false,
        (Seen::Node(first), Seen::Node(second)) => same(first, second),
        _ => match (literal(left), literal(right)) {
            (Some(first), Some(second)) => first == second,
            _ => false,
        },
    }
}

/// Smaller than: only between two numbers, or two texts.
fn less(left: &Seen, right: &Seen) -> bool {
    let literal = |seen: &Seen| match seen {
        Seen::Literal(literal) => Some(literal.clone()),
        Seen::Node(node) => literal_of(node),
        Seen::Nothing => None,
    };
    match (literal(left), literal(right)) {
        (Some(Literal::Number(first)), Some(Literal::Number(second))) => first < second,
        (Some(Literal::Text(first)), Some(Literal::Text(second))) => first < second,
        _ => false,
    }
}

fn inner<'a>(query: &Inner, current: &'a Node, root: &'a Node) -> Vec<Found<'a>> {
    let from = if query.from_root { root } else { current };
    run(&query.segments, vec![Found { node: from, way: String::new() }], root)
}

fn seen<'a>(operand: &Operand, current: &'a Node, root: &'a Node) -> Seen<'a> {
    match operand {
        Operand::Literal(literal) => Seen::Literal(literal.clone()),
        Operand::Query(query) | Operand::Value(query) => match inner(query, current, root).as_slice() {
            [one] => Seen::Node(one.node),
            _ => Seen::Nothing,
        },
        Operand::Count(query) => Seen::Literal(Literal::Number(inner(query, current, root).len() as f64)),
        Operand::Length(of) => match seen(of, current, root) {
            Seen::Literal(Literal::Text(text)) => Seen::Literal(Literal::Number(text.chars().count() as f64)),
            Seen::Node(Node::Array(items)) => Seen::Literal(Literal::Number(items.len() as f64)),
            Seen::Node(Node::Object(members)) => Seen::Literal(Literal::Number(members.len() as f64)),
            Seen::Node(node) => match node.as_text() {
                Some(text) => Seen::Literal(Literal::Number(text.chars().count() as f64)),
                None => Seen::Nothing,
            },
            _ => Seen::Nothing,
        },
    }
}

fn text_of(seen: &Seen) -> Option<String> {
    match seen {
        Seen::Literal(Literal::Text(text)) => Some(text.clone()),
        Seen::Node(node) => node.as_text(),
        _ => None,
    }
}

fn holds(test: &Test, current: &Node, root: &Node) -> bool {
    match test {
        Test::Or(tests) => tests.iter().any(|test| holds(test, current, root)),
        Test::And(tests) => tests.iter().all(|test| holds(test, current, root)),
        Test::Not(test) => !holds(test, current, root),
        Test::Exists(query) => !inner(query, current, root).is_empty(),
        Test::Compare(left, compare, right) => {
            let (left, right) = (seen(left, current, root), seen(right, current, root));
            match compare {
                Compare::Equal => equal(&left, &right),
                Compare::NotEqual => !equal(&left, &right),
                Compare::Less => less(&left, &right),
                Compare::Greater => less(&right, &left),
                Compare::LessOrEqual => less(&left, &right) || equal(&left, &right),
                Compare::GreaterOrEqual => less(&right, &left) || equal(&left, &right),
            }
        }
        Test::Pattern { text, pattern, whole, ready } => {
            let Some(text) = text_of(&seen(text, current, root)) else { return false };
            match ready {
                Some(ready) => ready.is_match(&text),
                // A pattern that comes from the document is made ready each time; one that is no pattern fits nothing.
                None => text_of(&seen(pattern, current, root)).and_then(|written| pattern_of(&written, *whole)).is_some_and(|ready| ready.is_match(&text)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::json::Style;
    use crate::tree::{build, write, Writing};

    fn tree(text: &str) -> Node {
        let (minified, _) = crate::json::transform_text(text, Style::Minify, &mut |_| true).expect("JSON");
        build(&minified).expect("a tree")
    }

    fn text(node: &Node) -> String {
        let mut out = Vec::new();
        write(node, &mut out, &Writing { options: crate::json::Options::of(Style::Minify), one_line_within: 0 }).expect("written");
        String::from_utf8(out).expect("text")
    }

    /// What a query finds, each value on one line.
    fn found(document: &Node, query: &str) -> Vec<String> {
        Query::read(query).unwrap_or_else(|bad| panic!("{query}: wrong at {}", bad.column)).find(document).iter().map(|found| text(found.node)).collect()
    }

    fn ways(document: &Node, query: &str) -> Vec<String> {
        Query::read(query).expect("a query").find(document).into_iter().map(|found| found.way).collect()
    }

    /// The bookstore of RFC 9535, figure 1.
    const STORE: &str = r#"{ "store": { "book": [
        { "category": "reference", "author": "Nigel Rees", "title": "Sayings of the Century", "price": 8.95 },
        { "category": "fiction", "author": "Evelyn Waugh", "title": "Sword of Honour", "price": 12.99 },
        { "category": "fiction", "author": "Herman Melville", "title": "Moby Dick", "isbn": "0-553-21311-3", "price": 8.99 },
        { "category": "fiction", "author": "J. R. R. Tolkien", "title": "The Lord of the Rings", "isbn": "0-395-19395-8", "price": 22.99 }
      ], "bicycle": { "color": "red", "price": 399 } } }"#;

    #[test]
    fn the_examples_of_the_standard() {
        let store = tree(STORE);
        // RFC 9535, table 2.
        assert_eq!(found(&store, "$.store.book[*].author"), ["\"Nigel Rees\"", "\"Evelyn Waugh\"", "\"Herman Melville\"", "\"J. R. R. Tolkien\""]);
        assert_eq!(found(&store, "$..author").len(), 4);
        assert_eq!(found(&store, "$.store.*").len(), 2);
        assert_eq!(found(&store, "$.store..price"), ["8.95", "12.99", "8.99", "22.99", "399"]);
        assert_eq!(found(&store, "$..book[2].author"), ["\"Herman Melville\""]);
        assert_eq!(found(&store, "$..book[2].publisher"), [] as [&str; 0]);
        assert_eq!(found(&store, "$..book[-1].title"), ["\"The Lord of the Rings\""]);
        assert_eq!(found(&store, "$..book[0,1].price"), ["8.95", "12.99"]);
        assert_eq!(found(&store, "$..book[:2].price"), ["8.95", "12.99"]);
        assert_eq!(found(&store, "$..book[?@.isbn].title"), ["\"Moby Dick\"", "\"The Lord of the Rings\""]);
        assert_eq!(found(&store, "$..book[?@.price<10].title"), ["\"Sayings of the Century\"", "\"Moby Dick\""]);
        assert_eq!(found(&store, "$..*").len(), 27);
        assert_eq!(ways(&store, "$..book[?@.price<10].title"), ["$['store']['book'][0]['title']", "$['store']['book'][2]['title']"]);
        assert_eq!(found(&store, "$"), [text(&store)]);
    }

    #[test]
    fn slices_as_the_standard_takes_them() {
        // RFC 9535, table 9.
        let letters = tree(r#"["a","b","c","d","e","f","g"]"#);
        assert_eq!(found(&letters, "$[1:3]"), ["\"b\"", "\"c\""]);
        assert_eq!(found(&letters, "$[5:]"), ["\"f\"", "\"g\""]);
        assert_eq!(found(&letters, "$[1:5:2]"), ["\"b\"", "\"d\""]);
        assert_eq!(found(&letters, "$[5:1:-2]"), ["\"f\"", "\"d\""]);
        assert_eq!(found(&letters, "$[::-1]"), ["\"g\"", "\"f\"", "\"e\"", "\"d\"", "\"c\"", "\"b\"", "\"a\""]);
        assert_eq!(found(&letters, "$[::0]"), [] as [&str; 0]);
        assert_eq!(found(&letters, "$[-2:]"), ["\"f\"", "\"g\""]);
        assert_eq!(found(&letters, "$[10:20]"), [] as [&str; 0]);
    }

    #[test]
    fn filters_and_their_functions() {
        // RFC 9535, table 12.
        let document = tree(r#"{"a":[3,5,1,2,4,6,{"b":"j"},{"b":"k"},{"b":{}},{"b":"kilo"}],"o":{"p":1,"q":2,"r":3,"s":5,"t":{"u":6}},"e":"f"}"#);
        assert_eq!(found(&document, "$.a[?@.b == 'kilo']"), [r#"{"b":"kilo"}"#]);
        assert_eq!(found(&document, "$.a[?(@.b == 'kilo')]"), [r#"{"b":"kilo"}"#]);
        assert_eq!(found(&document, "$.a[?@>3.5]"), ["5", "4", "6"]);
        assert_eq!(found(&document, "$.a[?@.b]").len(), 4);
        assert_eq!(found(&document, "$[?@.*]").len(), 2);
        assert_eq!(found(&document, "$[?@[?@.b]]").len(), 1);
        assert_eq!(found(&document, "$.o[?@<3, ?@<3]"), ["1", "2", "1", "2"]);
        assert_eq!(found(&document, r#"$.a[?@<2 || @.b == "k"]"#), ["1", r#"{"b":"k"}"#]);
        assert_eq!(found(&document, r#"$.a[?match(@.b, "[jk]")]"#), [r#"{"b":"j"}"#, r#"{"b":"k"}"#]);
        assert_eq!(found(&document, r#"$.a[?search(@.b, "[jk]")]"#), [r#"{"b":"j"}"#, r#"{"b":"k"}"#, r#"{"b":"kilo"}"#]);
        assert_eq!(found(&document, "$.o[?@>1 && @<4]"), ["2", "3"]);
        assert_eq!(found(&document, "$.o[?@.u || @.x]"), [r#"{"u":6}"#]);
        assert_eq!(found(&document, "$.a[?@.b == $.x]"), ["3", "5", "1", "2", "4", "6"]);
        assert_eq!(found(&document, "$.a[?@ == @]").len(), 10);
        assert_eq!(found(&document, "$.a[?length(@.b) == 4]"), [r#"{"b":"kilo"}"#]);
        assert_eq!(found(&document, "$[?count(@.*) == 5]").len(), 1);
        assert_eq!(found(&document, "$.a[?value(@..b) == 'j']"), [r#"{"b":"j"}"#]);
        assert_eq!(found(&document, "$.a[?!@.b]").len(), 6);
        assert_eq!(found(&document, "$.a[?@.b != 'kilo' && @.b]").len(), 3);
    }

    #[test]
    fn names_are_read_and_ways_are_written() {
        let document = tree(r#"{"o":{"j j":{"k.k":3}},"'":{"@":2},"é":1,"a":{"b":[7]}}"#);
        assert_eq!(found(&document, "$.o['j j']['k.k']"), ["3"]);
        assert_eq!(found(&document, r#"$.o["j j"]["k.k"]"#), ["3"]);
        assert_eq!(found(&document, r#"$["'"]["@"]"#), ["2"]);
        assert_eq!(found(&document, "$.é"), ["1"]);
        assert_eq!(found(&document, r"$['é']"), ["1"]);
        assert_eq!(ways(&document, r#"$["'"]["@"]"#), [r"$['\'']['@']"]);
        assert_eq!(ways(&document, "$ .a .b [ 0 ]"), ["$['a']['b'][0]"]);
        assert_eq!(found(&document, "$..[0]"), ["7"]);
    }

    #[test]
    fn says_where_a_query_is_wrong() {
        let wrong = |query: &str| Query::read(query).expect_err(query).column;
        assert_eq!(wrong(""), 1);
        assert_eq!(wrong("store"), 1);
        assert_eq!(wrong("$.store."), 9);
        assert_eq!(wrong("$[1"), 4);
        assert_eq!(wrong("$[01]"), 3);
        assert_eq!(wrong("$['a]"), 6);
        assert_eq!(wrong("$[?@.a = 1]"), 8);
        assert_eq!(wrong("$[?@.* == 1]"), 4);
        assert_eq!(wrong("$[?length(@.a)]"), 4);
        assert_eq!(wrong("$[?match(@.a, '(')]"), 15);
        assert_eq!(wrong("$.a b"), 5);
    }
}
