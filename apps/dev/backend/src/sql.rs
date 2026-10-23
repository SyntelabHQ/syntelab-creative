//! SQL written again: each clause on its line, or everything on one line.
//!
//! The text is read a token at a time and written as it is read, so a dump is as large as the disk lets it be. No
//! dialect is asked for: the tokens of the common ones are all known (strings with `''` and with `\'`, names in
//! `"…"`, `` `…` `` and `[…]`, `$tag$…$tag$`, `--` and `/* */` comments, `::`, `:name`, `@name`), and only what
//! stands between tokens is changed, with the case of keywords when that is asked for. What a statement means is
//! never checked: only a string or a comment that never ends is told to be wrong.

use std::collections::VecDeque;
use std::io::Write;

use crate::codec::{CodecError, Letters, Place, Stage, Wrong};
use crate::json::Style;

/// How keywords are written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Case {
    Upper,
    Lower,
    /// As they were.
    Keep,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Start,
    Word,
    Keyword,
    Number,
    /// A string, or a name in quotes.
    Text,
    Operator,
    /// A sign before a number: nothing stands between the two.
    Unary,
    Comma,
    Semicolon,
    Open,
    Close,
    Dot,
    Cast,
    LineComment,
    BlockComment,
}

struct Token {
    kind: Kind,
    text: String,
    /// White space stood before it; a line break did.
    spaced: bool,
    on_new_line: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Within {
    /// The statement itself, or a query in parentheses: clauses on their lines.
    Query,
    /// A list in parentheses whose items stand on a line each (the columns of `CREATE TABLE`).
    List,
    /// Parentheses that stay on their line.
    Inline,
    Case,
}

struct Frame {
    within: Within,
    /// How deep the lines of its clauses are pushed in.
    indent: usize,
    /// A clause was begun: what follows stands one level deeper.
    body: bool,
    /// Nothing was written inside yet.
    fresh: bool,
}

fn is_keyword(upper: &str) -> bool {
    matches!(
        upper,
        "ADD" | "ALL" | "ALTER" | "AND" | "ANY" | "AS" | "ASC" | "BEGIN" | "BETWEEN" | "BY" | "CASCADE" | "CASE" | "CHECK" | "COLUMN" | "COMMIT" | "CONSTRAINT" | "CREATE" | "CROSS" | "CURRENT" | "DATABASE" | "DEFAULT"
            | "DELETE" | "DESC" | "DISTINCT" | "DROP" | "ELSE" | "END" | "EXCEPT" | "EXISTS" | "FALSE" | "FETCH" | "FIRST" | "FOLLOWING" | "FOR" | "FOREIGN" | "FROM" | "FULL" | "GRANT" | "GROUP" | "HAVING" | "IF"
            | "ILIKE" | "IN" | "INDEX" | "INNER" | "INSERT" | "INTERSECT" | "INTO" | "IS" | "JOIN" | "KEY" | "LAST" | "LATERAL" | "LEFT" | "LIKE" | "LIMIT" | "NATURAL" | "NEXT" | "NOT" | "NULL" | "NULLS" | "OFFSET"
            | "ON" | "ONLY" | "OR" | "ORDER" | "OUTER" | "OVER" | "PARTITION" | "PRECEDING" | "PRIMARY" | "RANGE" | "RECURSIVE" | "REFERENCES" | "RETURNING" | "REVOKE" | "RIGHT" | "ROLLBACK" | "ROW" | "ROWS"
            | "SELECT" | "SET" | "TABLE" | "THEN" | "TRUE" | "TRUNCATE" | "UNBOUNDED" | "UNION" | "UNIQUE" | "UPDATE" | "USING" | "VALUES" | "VIEW" | "WHEN" | "WHERE" | "WINDOW" | "WITH"
    )
}

/// Keywords after which a `(` never belongs to them as it does to the name of a function.
fn stands_apart(upper: &str) -> bool {
    matches!(
        upper,
        "ALL" | "AND" | "ANY" | "AS" | "BETWEEN" | "BY" | "CASE" | "ELSE" | "EXCEPT" | "EXISTS" | "FROM" | "HAVING" | "IN" | "INTERSECT" | "JOIN" | "LIKE" | "NOT" | "ON" | "OR" | "OVER" | "RETURNING" | "SELECT" | "SET"
            | "THEN" | "UNION" | "USING" | "VALUES" | "WHEN" | "WHERE"
    )
}

fn is_word_letter(letter: char) -> bool {
    letter.is_alphanumeric() || matches!(letter, '_' | '$' | '@' | '#')
}

pub struct Sql {
    style: Style,
    case: Case,
    letters: Letters,
    /// What was read and is not made into tokens yet, from `at` on.
    held: String,
    at: usize,
    /// How far into the token that is not whole its end was already sought.
    sought: usize,
    place: Place,
    spaced: bool,
    on_new_line: bool,
    /// Tokens that wait for those after them: some keywords are of several words.
    queue: VecDeque<Token>,
    frames: Vec<Frame>,
    /// The next token begins a line pushed in this deep; and a line is left empty before it.
    line: Option<usize>,
    blank: bool,
    wrote: bool,
    /// How deep the line being written is pushed in.
    level: usize,
    previous: Kind,
    /// The word written last, in capitals; empty when the last token was no word.
    previous_word: String,
    /// The first word of the statement, in capitals.
    first_word: String,
    /// `BETWEEN`s whose `AND` has not come.
    between: u32,
    statements: u64,
    in_statement: bool,
}

impl Sql {
    /// `style`: spread out by spaces or by a tab, or on one line ([`Style::Minify`], which leaves comments out).
    pub fn new(style: Style, case: Case) -> Self {
        Sql {
            style,
            case,
            letters: Letters::default(),
            held: String::new(),
            at: 0,
            sought: 0,
            place: Place::default(),
            spaced: false,
            on_new_line: false,
            queue: VecDeque::new(),
            frames: vec![Frame { within: Within::Query, indent: 0, body: false, fresh: true }],
            line: None,
            blank: false,
            wrote: false,
            level: 0,
            previous: Kind::Start,
            previous_word: String::new(),
            first_word: String::new(),
            between: 0,
            statements: 0,
            in_statement: false,
        }
    }

    fn top(&mut self) -> &mut Frame {
        if self.frames.is_empty() {
            self.frames.push(Frame { within: Within::Query, indent: 0, body: false, fresh: true });
        }
        let last = self.frames.len() - 1;
        &mut self.frames[last]
    }

    /// How deep what stands inside the innermost frame is pushed in.
    fn inside(&mut self) -> usize {
        let top = self.top();
        top.indent + usize::from(top.within == Within::Query && top.body)
    }

    fn space(&self, kind: Kind, spaced: bool) -> bool {
        if matches!(kind, Kind::Comma | Kind::Semicolon | Kind::Close | Kind::Dot | Kind::Cast) || matches!(self.previous, Kind::Start | Kind::Open | Kind::Dot | Kind::Cast | Kind::Unary) {
            return false;
        }
        if kind == Kind::Open {
            // After a name, a `(` stands as it stood: it may be a call (`count(x)`) or a list (`t (a, b)`).
            return match self.previous {
                Kind::Keyword => spaced || stands_apart(&self.previous_word),
                Kind::Word | Kind::Text | Kind::Close => spaced,
                _ => true,
            };
        }
        true
    }

    fn write(&mut self, text: &str, kind: Kind, spaced: bool, out: &mut dyn Write) -> Result<(), CodecError> {
        let line = self.line.take();
        let blank = std::mem::take(&mut self.blank);
        match (line, self.style) {
            (Some(level), Style::Spaces(_) | Style::Tab) => {
                if self.wrote {
                    out.write_all(if blank { b"\n\n" } else { b"\n" })?;
                }
                match self.style {
                    Style::Spaces(spaces) => write!(out, "{:width$}", "", width = usize::from(spaces) * level)?,
                    _ => out.write_all("\t".repeat(level).as_bytes())?,
                }
                self.level = level;
            }
            _ => {
                if self.wrote && self.space(kind, spaced) {
                    out.write_all(b" ")?;
                }
            }
        }
        out.write_all(text.as_bytes())?;
        self.wrote = true;
        self.previous = kind;
        self.previous_word.clear();
        Ok(())
    }

    fn keyword(&mut self, text: &str, upper: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let written = match self.case {
            Case::Upper => upper.to_owned(),
            Case::Lower => upper.to_lowercase(),
            Case::Keep => text.to_owned(),
        };
        self.write(&written, Kind::Keyword, true, out)?;
        // Of a keyword of several words, the last one is what a `(` may follow.
        self.previous_word = upper.rsplit(' ').next().unwrap_or_default().to_owned();
        Ok(())
    }

    /// The words that wait right after the one in hand, in capitals, as long as they are words.
    fn ahead(&self) -> Vec<String> {
        self.queue.iter().take(3).take_while(|token| matches!(token.kind, Kind::Word)).map(|token| token.text.to_uppercase()).collect()
    }

    /// Takes `count` waiting words into the keyword in hand.
    fn joined(&mut self, text: &mut String, upper: &mut String, count: usize) {
        for _ in 0..count {
            if let Some(next) = self.queue.pop_front() {
                text.push(' ');
                text.push_str(&next.text);
                upper.push(' ');
                upper.push_str(&next.text.to_uppercase());
            }
        }
    }

    fn word(&mut self, token: Token, out: &mut dyn Write) -> Result<(), CodecError> {
        let mut text = token.text;
        let mut upper = text.to_uppercase();
        let ahead = self.ahead();
        let next = |at: usize| ahead.get(at).map(String::as_str);
        let joins = |word: &str| matches!(word, "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS" | "NATURAL" | "OUTER");
        // Keywords of several words are one.
        let more = match upper.as_str() {
            "GROUP" | "ORDER" | "PARTITION" if next(0) == Some("BY") => 1,
            "INSERT" if next(0) == Some("INTO") => 1,
            "DELETE" if next(0) == Some("FROM") => 1,
            "UNION" | "EXCEPT" | "INTERSECT" if matches!(next(0), Some("ALL" | "DISTINCT")) => 1,
            word if joins(word) => match ahead.iter().position(|word| word == "JOIN") {
                Some(at) if ahead[..at].iter().all(|word| joins(word)) => at + 1,
                _ => 0,
            },
            _ => 0,
        };
        self.joined(&mut text, &mut upper, more);
        if !is_keyword(upper.split(' ').next().unwrap_or_default()) {
            self.write(&text, Kind::Word, token.spaced, out)?;
            self.top().fresh = false;
            return Ok(());
        }
        if self.first_word.is_empty() {
            self.first_word = upper.split(' ').next().unwrap_or_default().to_owned();
        }
        let previous = self.previous_word.clone();
        let clause = match upper.as_str() {
            "SELECT" | "WHERE" | "GROUP BY" | "ORDER BY" | "HAVING" | "LIMIT" | "OFFSET" | "VALUES" | "RETURNING" | "WINDOW" | "INSERT INTO" | "DELETE FROM" => true,
            // `IS DISTINCT FROM`, `ON UPDATE`, `FOR UPDATE`, `ON DELETE SET NULL`, `CHARACTER SET` are no clauses.
            "FROM" => previous != "DISTINCT",
            "UPDATE" => !matches!(previous.as_str(), "ON" | "FOR"),
            "SET" => matches!(self.first_word.as_str(), "UPDATE" | "SET" | "INSERT" | "MERGE") && !matches!(previous.as_str(), "DELETE" | "UPDATE"),
            _ => false,
        };
        let fresh = self.top().fresh;
        if upper == "SELECT" && fresh && matches!(self.top().within, Within::Inline | Within::List) {
            // Parentheses that hold a query: it is spread out as any other.
            let top = self.top();
            if top.within == Within::Inline {
                top.indent += 1;
            }
            top.within = Within::Query;
        }
        let top = self.top();
        let (within, indent) = (top.within, top.indent);
        top.fresh = false;
        let query = within == Within::Query;
        match upper.as_str() {
            _ if clause && query => {
                self.line = Some(indent);
                self.keyword(&text, &upper, out)?;
                self.top().body = true;
                self.line = Some(indent + 1);
            }
            "UNION" | "UNION ALL" | "UNION DISTINCT" | "EXCEPT" | "EXCEPT ALL" | "EXCEPT DISTINCT" | "INTERSECT" | "INTERSECT ALL" | "INTERSECT DISTINCT" if query => {
                self.line = Some(indent);
                self.keyword(&text, &upper, out)?;
                self.top().body = false;
                self.line = Some(indent);
            }
            "AND" if self.between > 0 => {
                self.between -= 1;
                self.keyword(&text, &upper, out)?;
            }
            "AND" | "OR" if query => {
                self.line = Some(indent + 1);
                self.keyword(&text, &upper, out)?;
            }
            join if query && (join == "JOIN" || join.ends_with(" JOIN")) => {
                self.line = Some(indent + 1);
                self.keyword(&text, &upper, out)?;
            }
            "CASE" => {
                self.keyword(&text, &upper, out)?;
                let level = self.level;
                self.frames.push(Frame { within: Within::Case, indent: level + 1, body: false, fresh: false });
            }
            "WHEN" | "ELSE" if within == Within::Case => {
                self.line = Some(indent);
                self.keyword(&text, &upper, out)?;
            }
            "END" if within == Within::Case => {
                self.frames.pop();
                self.line = Some(indent.saturating_sub(1));
                self.keyword(&text, &upper, out)?;
            }
            "BETWEEN" => {
                self.between += 1;
                self.keyword(&text, &upper, out)?;
            }
            _ => self.keyword(&text, &upper, out)?,
        }
        Ok(())
    }

    fn token(&mut self, token: Token, out: &mut dyn Write) -> Result<(), CodecError> {
        let minify = self.style == Style::Minify;
        if !matches!(token.kind, Kind::LineComment | Kind::BlockComment | Kind::Semicolon) && !self.in_statement {
            self.in_statement = true;
            self.statements += 1;
        }
        match token.kind {
            Kind::LineComment | Kind::BlockComment => {
                // On one line a comment to the end of the line would take the rest with it; hints to the database stay.
                let hint = token.text.starts_with("/*+") || token.text.starts_with("/*!");
                if minify && !hint {
                    return Ok(());
                }
                let text = token.text.trim_end().to_owned();
                if !token.on_new_line {
                    // It stood after something on its line, and stays there; the line that was to begin waits.
                    let (line, blank) = (self.line.take(), std::mem::take(&mut self.blank));
                    let level = self.level;
                    self.write(&text, token.kind, true, out)?;
                    self.blank = blank;
                    self.line = line.or((token.kind == Kind::LineComment).then_some(level));
                    return Ok(());
                }
                if self.wrote && self.line.is_none() {
                    self.line = Some(self.level);
                }
                let again = self.line.unwrap_or(self.level);
                self.write(&text, token.kind, true, out)?;
                // What follows a comment that had a line to itself stands on the next one.
                self.line = Some(again);
                return Ok(());
            }
            Kind::Word => return self.word(token, out),
            Kind::Semicolon => {
                self.write(";", Kind::Semicolon, false, out)?;
                self.frames.clear();
                self.line = Some(0);
                self.blank = true;
                self.first_word.clear();
                self.between = 0;
                self.in_statement = false;
                return Ok(());
            }
            Kind::Comma => {
                self.write(",", Kind::Comma, false, out)?;
                let top = self.top();
                match top.within {
                    Within::Query if top.body => self.line = Some(top.indent + 1),
                    Within::List => self.line = Some(top.indent),
                    _ => {}
                }
            }
            Kind::Open if token.text == "(" => {
                let inside = self.inside();
                // The columns of a table that is created stand on a line each.
                let list = self.first_word == "CREATE" && self.frames.len() == 1 && !self.frames[0].body;
                self.write("(", Kind::Open, token.spaced, out)?;
                self.top().fresh = false;
                if list {
                    self.frames.push(Frame { within: Within::List, indent: inside + 1, body: false, fresh: true });
                    self.line = Some(inside + 1);
                } else {
                    self.frames.push(Frame { within: Within::Inline, indent: inside, body: false, fresh: true });
                }
                return Ok(());
            }
            Kind::Close if token.text == ")" => {
                // A `CASE` left open inside the parentheses ends with them.
                while self.frames.len() > 1 && self.top().within == Within::Case {
                    self.frames.pop();
                }
                let closed = if self.frames.len() > 1 { self.frames.pop() } else { None };
                match closed {
                    Some(Frame { within: Within::Query, indent, .. }) => self.line = Some(indent.saturating_sub(1)),
                    Some(Frame { within: Within::List, indent, fresh, .. }) => self.line = (!fresh).then_some(indent.saturating_sub(1)),
                    _ => {}
                }
                self.write(")", Kind::Close, false, out)?;
            }
            kind => {
                let unary = kind == Kind::Operator && matches!(token.text.as_str(), "-" | "+") && matches!(self.previous, Kind::Start | Kind::Operator | Kind::Unary | Kind::Open | Kind::Comma | Kind::Keyword);
                self.write(&token.text, if unary { Kind::Unary } else { kind }, token.spaced, out)?;
            }
        }
        self.top().fresh = false;
        Ok(())
    }

    /// `count` bytes of what is held are a token of this kind.
    fn take(&mut self, count: usize, kind: Kind) {
        let text = self.held[self.at..self.at + count].to_owned();
        text.bytes().for_each(|byte| self.place.pass(byte));
        self.at += count;
        self.sought = 0;
        self.queue.push_back(Token { kind, text, spaced: std::mem::take(&mut self.spaced), on_new_line: std::mem::take(&mut self.on_new_line) });
    }

    /// Makes tokens of what is held, as far as they are whole. `last`: nothing more will come.
    fn tokens(&mut self, last: bool) -> Result<(), CodecError> {
        loop {
            let rest = &self.held[self.at..];
            let Some(first) = rest.chars().next() else { break };
            if first.is_whitespace() {
                self.spaced = true;
                self.on_new_line |= first == '\n';
                self.place.pass_letter(first);
                self.at += first.len_utf8();
                continue;
            }
            let bytes = rest.as_bytes();
            let second = bytes.get(1).copied();
            // What may go on past the end of what is held waits for it.
            let whole = |end: usize| (end < rest.len() || last).then_some(end);
            let found: Option<(usize, Kind)> = if rest.starts_with("--") {
                match rest.find('\n') {
                    Some(end) => Some((end, Kind::LineComment)),
                    None => last.then_some((rest.len(), Kind::LineComment)),
                }
            } else if rest.starts_with("/*") {
                let from = self.sought.saturating_sub(1).max(2).min(rest.len());
                match bytes[from..].windows(2).position(|pair| pair == b"*/") {
                    Some(end) => Some((from + end + 2, Kind::BlockComment)),
                    None if last => return Err(self.place.wrong("unclosed-comment").into()),
                    None => {
                        self.sought = rest.len();
                        None
                    }
                }
            } else if matches!(first, '\'' | '"' | '`') || (first == '[' && !matches!(self.queue.back().map(|token| token.kind), Some(Kind::Word | Kind::Text | Kind::Close))) {
                let close = if first == '[' { b']' } else { first as u8 };
                let mut at = self.sought.max(1);
                let mut end = None;
                while at < bytes.len() {
                    if bytes[at] == b'\\' && first == '\'' {
                        if at + 1 >= bytes.len() {
                            break;
                        }
                        at += 2;
                    } else if bytes[at] == close {
                        if at + 1 >= bytes.len() && !last {
                            // The quote may be the first of a pair.
                            break;
                        }
                        if bytes.get(at + 1) == Some(&close) && first != '[' {
                            at += 2;
                        } else {
                            end = Some(at + 1);
                            break;
                        }
                    } else {
                        at += 1;
                    }
                }
                match end {
                    Some(end) => Some((end, Kind::Text)),
                    None if last => return Err(self.place.wrong("unclosed-string").into()),
                    None => {
                        self.sought = at.min(bytes.len());
                        None
                    }
                }
            } else if first == '$' && rest[1..].find('$').is_some_and(|end| rest[1..1 + end].chars().all(|letter| letter.is_alphanumeric() || letter == '_')) {
                // `$tag$ … $tag$`: a string of PostgreSQL in which nothing is an escape.
                let tag = &rest[..rest[1..].find('$').unwrap_or(0) + 2];
                let from = self.sought.saturating_sub(tag.len()).max(tag.len()).min(rest.len());
                match rest.as_bytes()[from..].windows(tag.len()).position(|window| window == tag.as_bytes()) {
                    Some(end) => Some((from + end + tag.len(), Kind::Text)),
                    None if last => return Err(self.place.wrong("unclosed-string").into()),
                    None => {
                        self.sought = rest.len();
                        None
                    }
                }
            } else if first.is_ascii_digit() {
                let mut end = self.sought.max(1);
                while end < bytes.len() {
                    let byte = bytes[end];
                    let signed_power = matches!(byte, b'+' | b'-') && matches!(bytes[end - 1], b'e' | b'E') && bytes[..end - 1].iter().all(|byte| byte.is_ascii_digit() || *byte == b'.') && bytes.get(end + 1).is_some_and(u8::is_ascii_digit);
                    if !(byte.is_ascii_alphanumeric() || byte == b'.' || byte == b'_' || signed_power) {
                        break;
                    }
                    end += 1;
                }
                // The sign of a power may be the next byte to come.
                let cut = end >= bytes.len().saturating_sub(1) && !last;
                if cut {
                    self.sought = end.min(bytes.len()).saturating_sub(2).max(1);
                    None
                } else {
                    Some((end, Kind::Number))
                }
            } else if is_word_letter(first) || (first == ':' && second.is_some_and(|second| second.is_ascii_alphabetic() || second == b'_')) {
                let from = self.sought.max(first.len_utf8());
                let end = rest[from..].find(|letter: char| !is_word_letter(letter)).map_or(rest.len(), |end| from + end);
                match whole(end) {
                    Some(end) => Some((end, Kind::Word)),
                    None => {
                        self.sought = end;
                        None
                    }
                }
            } else {
                let (end, kind) = match first {
                    ',' => (1, Kind::Comma),
                    ';' => (1, Kind::Semicolon),
                    '(' | '[' => (1, Kind::Open),
                    ')' | ']' => (1, Kind::Close),
                    '.' => (1, Kind::Dot),
                    '-' if second == Some(b'>') => (if bytes.get(2) == Some(&b'>') { 3 } else { 2 }, Kind::Operator),
                    '<' | '>' | '=' | '!' | '|' | ':' | '&' | '~' | '^' => {
                        let end = bytes.iter().position(|byte| !matches!(byte, b'<' | b'>' | b'=' | b'!' | b'|' | b':' | b'&' | b'~' | b'^')).unwrap_or(bytes.len());
                        (end, if &rest[..end] == "::" { Kind::Cast } else { Kind::Operator })
                    }
                    other => (other.len_utf8(), Kind::Operator),
                };
                // `-` may begin `--` or `->`, `/` may begin `/*`, and signs that go together may not all be here yet.
                (end + 2 < rest.len() || last).then_some((end, kind))
            };
            match found {
                Some((count, kind)) => self.take(count, kind),
                None => break,
            }
        }
        self.held.drain(..self.at);
        self.at = 0;
        Ok(())
    }

    fn written(&mut self, last: bool, out: &mut dyn Write) -> Result<(), CodecError> {
        // Three tokens are kept back: a keyword may be of as many words more.
        while self.queue.len() > 3 || (last && !self.queue.is_empty()) {
            if let Some(token) = self.queue.pop_front() {
                self.token(token, out)?;
            }
        }
        Ok(())
    }
}

impl Stage for Sql {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        if self.held.try_reserve(text.len()).is_err() {
            return Err(CodecError::NoMemory);
        }
        let first = self.held.is_empty() && !self.wrote && self.queue.is_empty() && self.place.wrong("").offset == 0;
        self.held.push_str(if first { text.strip_prefix('\u{feff}').unwrap_or(&text) } else { &text });
        self.tokens(false)?;
        self.written(false, out)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        self.tokens(true)?;
        self.written(true, out)?;
        if !self.wrote && self.statements == 0 {
            return Err(Wrong::nowhere("empty").into());
        }
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        vec![("sql-statements", self.statements.to_string())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn written(sql: &str, style: Style, case: Case) -> String {
        let whole = String::from_utf8(through(&mut Sql::new(style, case), sql.as_bytes(), 1_000_000).expect("read")).expect("text");
        // Whatever the size of the pieces, the result is the same.
        for at_once in [1, 2, 3, 7, 16] {
            assert_eq!(String::from_utf8(through(&mut Sql::new(style, case), sql.as_bytes(), at_once).expect("read")).expect("text"), whole, "{at_once} at a time");
        }
        whole
    }

    fn spread(sql: &str) -> String {
        written(sql, Style::Spaces(2), Case::Upper)
    }

    #[test]
    fn clauses_stand_on_their_lines() {
        assert_eq!(
            spread("select a,b as c, count(*) from t left outer join u on u.id=t.id and u.x>1 where a=1 and (b=2 or c in (1,2)) group by a,b having count(*)>1 order by a desc limit 10 offset 5;"),
            "SELECT\n  a,\n  b AS c,\n  count(*)\nFROM\n  t\n  LEFT OUTER JOIN u ON u.id = t.id\n  AND u.x > 1\nWHERE\n  a = 1\n  AND (b = 2 OR c IN (1, 2))\nGROUP BY\n  a,\n  b\nHAVING\n  count(*) > 1\nORDER BY\n  a DESC\nLIMIT\n  10\nOFFSET\n  5;"
        );
    }

    #[test]
    fn queries_inside_queries_are_spread_too() {
        assert_eq!(
            spread("with x as (select 1 as a union all select 2) select * from x where a in (select a from y where b between 1 and 5 and c is not null)"),
            "WITH x AS (\n  SELECT\n    1 AS a\n  UNION ALL\n  SELECT\n    2\n)\nSELECT\n  *\nFROM\n  x\nWHERE\n  a IN (\n    SELECT\n      a\n    FROM\n      y\n    WHERE\n      b BETWEEN 1 AND 5\n      AND c IS NOT NULL\n  )"
        );
    }

    #[test]
    fn the_other_statements_are_spread_as_well() {
        assert_eq!(spread("insert into t (a,b) values (1,'x'),(2,'y'); update t set a=-1,b=b+1 where id=3;delete from t where a is null"), "INSERT INTO\n  t (a, b)\nVALUES\n  (1, 'x'),\n  (2, 'y');\n\nUPDATE\n  t\nSET\n  a = -1,\n  b = b + 1\nWHERE\n  id = 3;\n\nDELETE FROM\n  t\nWHERE\n  a IS NULL");
        assert_eq!(
            spread("create table t (id int primary key, name varchar(50) not null default 'x', price decimal(10,2), foreign key (o) references p(id) on delete set null on update cascade);"),
            "CREATE TABLE t (\n  id int PRIMARY KEY,\n  name varchar(50) NOT NULL DEFAULT 'x',\n  price decimal(10, 2),\n  FOREIGN KEY (o) REFERENCES p(id) ON DELETE SET NULL ON UPDATE CASCADE\n);"
        );
        assert_eq!(spread("select case when a>1 then 'x' when a is null then 'n' else 'y' end as k, sum(b) over (partition by c order by d) from t for update"), "SELECT\n  CASE\n    WHEN a > 1 THEN 'x'\n    WHEN a IS NULL THEN 'n'\n    ELSE 'y'\n  END AS k,\n  sum(b) OVER (PARTITION BY c ORDER BY d)\nFROM\n  t FOR UPDATE");
    }

    #[test]
    fn what_is_no_keyword_is_left_as_it_is() {
        let sql = "select \"From\", `select`, [order], 'it''s where', 'a\\'b', $$ select 1 $$, $f$ x $f$, a::int, b->>'k', :name, @v, #tmp, 1.5e-3, 0xFF, t.*, x<>y, a||b, extract(year from d) from \"T\"";
        assert_eq!(
            written(sql, Style::Spaces(4), Case::Lower),
            "select\n    \"From\",\n    `select`,\n    [order],\n    'it''s where',\n    'a\\'b',\n    $$ select 1 $$,\n    $f$ x $f$,\n    a::int,\n    b ->> 'k',\n    :name,\n    @v,\n    #tmp,\n    1.5e-3,\n    0xFF,\n    t.*,\n    x <> y,\n    a || b,\n    extract(year from d)\nfrom\n    \"T\""
        );
        assert_eq!(written("Select a From t Where b", Style::Tab, Case::Keep), "Select\n\ta\nFrom\n\tt\nWhere\n\tb");
    }

    #[test]
    fn comments_keep_their_lines() {
        assert_eq!(spread("-- first\nselect a, -- the a\n b /* inline */ from t\n/* own\n line */\nwhere x=1 -- end"), "-- first\nSELECT\n  a, -- the a\n  b /* inline */\nFROM\n  t\n  /* own\n line */\nWHERE\n  x = 1 -- end");
    }

    #[test]
    fn everything_goes_on_one_line() {
        let mut stage = Sql::new(Style::Minify, Case::Keep);
        let out = through(&mut stage, b"select  a ,\n  b -- gone\nfrom t /* gone */ /*+ kept */\nwhere a = -1 ;\n\nselect count( * ) from (select 1) x;", 5).expect("read");
        assert_eq!(String::from_utf8(out).expect("text"), "select a, b from t /*+ kept */ where a = -1; select count(*) from (select 1) x;");
        assert_eq!(stage.notes(), vec![("sql-statements", "2".to_string())]);
    }

    #[test]
    fn what_never_ends_is_told_with_its_place() {
        let wrong = |sql: &str| problem(through(&mut Sql::new(Style::Spaces(2), Case::Upper), sql.as_bytes(), 3));
        assert_eq!(wrong("select 1\nfrom t where a = 'open"), ("unclosed-string", 2, 18));
        assert_eq!(wrong("select /* open"), ("unclosed-comment", 1, 8));
        assert_eq!(wrong("  \n "), ("empty", 0, 0));
    }

    #[test]
    fn a_long_string_is_not_sought_through_again_for_each_piece() {
        let sql = format!("insert into t values ('{}', 0x{});", "x''".repeat(1_000_000), "AB".repeat(1_000_000));
        assert!(through(&mut Sql::new(Style::Minify, Case::Keep), sql.as_bytes(), 4096).expect("read").len() > 5_000_000);
    }
}
