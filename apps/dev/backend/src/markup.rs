//! XML and HTML written again: spread out, on one line, or only read to see that they are right.
//!
//! The text is read a token at a time (a tag, a comment, a run of text) and written as it is read, so a file is as
//! large as the disk lets it be; only a token that is not whole yet waits in memory.
//!
//! XML is read strictly: tags must close in the order they opened, attributes must be written whole, there is one
//! root; what is wrong is told with its place. HTML is read as browsers read it, forgivingly: tags that need no end
//! (`<br>`, `<li>`), any case, loose ends. Elements that stand inside a line of text (`<b>`, `<a>`) stay in it, and
//! what `<pre>`, `<script>`, `<style>` and `<textarea>` hold is left exactly as it is.

use std::io::Write;

use crate::codec::{CodecError, Letters, Place, Stage, Wrong};
use crate::json::Style;

/// Elements of HTML that have no content and no end.
const VOID: &[&str] = &["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
/// Elements of HTML that stand inside a line of text.
const INLINE: &[&str] = &[
    "a", "abbr", "b", "bdi", "bdo", "big", "br", "cite", "code", "data", "del", "dfn", "em", "font", "i", "img", "ins", "kbd", "label", "mark", "q", "s", "samp", "small", "span", "strike", "strong", "sub", "sup",
    "time", "tt", "u", "var", "wbr",
];
/// Elements of HTML whose content is left as it is, to their end tag.
const RAW: &[&str] = &["script", "style", "pre", "textarea"];
/// A first element by one of these names says the text is HTML when nothing else does.
const TELLS_HTML: &[&str] = &["html", "head", "body", "div", "span", "p", "ul", "ol", "h1", "h2", "h3", "h4", "h5", "h6", "script", "style", "meta", "br", "img"];
/// Elements whose start ends a paragraph that was left open.
const ENDS_PARAGRAPH: &[&str] = &[
    "address", "article", "aside", "blockquote", "div", "dl", "fieldset", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "ul",
];

/// Whether the start of `new` ends the element `top`, left open, as HTML has it.
fn ends(new: &str, top: &str) -> bool {
    match top {
        "p" => ENDS_PARAGRAPH.contains(&new),
        "li" => new == "li",
        "dt" | "dd" => matches!(new, "dt" | "dd"),
        "td" | "th" => matches!(new, "td" | "th" | "tr" | "tbody" | "thead" | "tfoot"),
        "tr" => matches!(new, "tr" | "tbody" | "thead" | "tfoot"),
        "thead" | "tbody" | "tfoot" => matches!(new, "tbody" | "thead" | "tfoot"),
        "option" => matches!(new, "option" | "optgroup"),
        "optgroup" => new == "optgroup",
        _ => false,
    }
}

/// What the text is read as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// Told from how the text begins.
    Auto,
    Xml,
    Html,
}

/// A part of a line of text: text itself, or something that stands in it and is written as it is.
enum Piece {
    Text(String),
    Kept(String),
}

pub struct Markup {
    style: Style,
    drop_comments: bool,
    /// Whether the text is HTML; not known until something tells.
    html: Option<bool>,
    letters: Letters,
    /// What was read and is not written yet, from `at` on.
    held: String,
    at: usize,
    /// How far into the token that is not whole its end was already sought.
    sought: usize,
    place: Place,
    /// The element of HTML whose content is being passed as it is.
    raw: Option<String>,
    /// The end tag that is next is the one of that element.
    ends_raw: bool,
    /// The elements that are open, each with where it was opened.
    open: Vec<(String, Wrong)>,
    /// The element opened last has nothing in it yet but what `run` holds.
    fresh: bool,
    run: Vec<Piece>,
    wrote: bool,
    elements: u64,
    roots: u64,
    /// Something other than white space was read.
    any: bool,
}

fn is_name_start(letter: char) -> bool {
    letter.is_alphabetic() || letter == '_' || letter == ':'
}

/// Where the tag that begins `text` ends (after its `>`), quotes minded; none when it is not whole.
fn tag_end(text: &str) -> Option<usize> {
    let mut quote = None;
    for (index, byte) in text.bytes().enumerate() {
        match (quote, byte) {
            (None, b'"' | b'\'') => quote = Some(byte),
            (Some(open), close) if open == close => quote = None,
            (None, b'>') => return Some(index + 1),
            _ => {}
        }
    }
    None
}

/// Where a `<!DOCTYPE …>` ends: it may hold declarations of its own between `[` and `]`.
fn doctype_end(text: &str) -> Option<usize> {
    let mut quote = None;
    let mut inner = 0usize;
    for (index, byte) in text.bytes().enumerate() {
        match (quote, byte) {
            (None, b'"' | b'\'') => quote = Some(byte),
            (Some(open), close) if open == close => quote = None,
            (None, b'[') => inner += 1,
            (None, b']') => inner = inner.saturating_sub(1),
            (None, b'>') if inner == 0 => return Some(index + 1),
            _ => {}
        }
    }
    None
}

/// A tag with the space inside it made plain: one space between its parts, none before its end. What stands in
/// quotes is left as it is.
fn tidy(tag: &str) -> String {
    let mut tidy = String::with_capacity(tag.len());
    let mut quote = None;
    let mut space = false;
    for letter in tag.chars() {
        match quote {
            Some(open) => {
                tidy.push(letter);
                if letter == open {
                    quote = None;
                }
            }
            None if letter.is_whitespace() => space = true,
            None => {
                if std::mem::take(&mut space) && !matches!(letter, '>' | '/' | '?') {
                    tidy.push(' ');
                }
                if matches!(letter, '"' | '\'') {
                    quote = Some(letter);
                }
                tidy.push(letter);
            }
        }
    }
    tidy
}

/// A reference in XML (`&amp;`, `&#10;`, `&#xA;`) begins at each `&`: where one does not, counted in bytes.
fn bad_reference(text: &str) -> Option<usize> {
    let mut at = 0;
    while let Some(found) = text[at..].find('&') {
        let start = at + found;
        let Some(end) = text[start..].find(';').map(|end| start + end) else { return Some(start) };
        let name = &text[start + 1..end];
        let fine = match name.strip_prefix('#') {
            Some(number) => match number.strip_prefix('x') {
                Some(hex) => !hex.is_empty() && hex.bytes().all(|byte| byte.is_ascii_hexdigit()),
                None => !number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()),
            },
            None => name.chars().next().is_some_and(is_name_start) && name.chars().all(|letter| letter.is_alphanumeric() || matches!(letter, '_' | ':' | '-' | '.')),
        };
        if !fine {
            return Some(start);
        }
        at = end + 1;
    }
    None
}

/// Runs of white space made one space each.
fn collapsed(text: &str) -> String {
    let mut collapsed = String::with_capacity(text.len());
    let mut space = false;
    for letter in text.chars() {
        if letter.is_whitespace() {
            space = true;
        } else {
            if std::mem::take(&mut space) || collapsed.is_empty() && text.starts_with(char::is_whitespace) {
                collapsed.push(' ');
            }
            collapsed.push(letter);
        }
    }
    // A run that is only white space is one space too: between two inline elements it is what keeps their words apart.
    if space {
        collapsed.push(' ');
    }
    collapsed
}

/// The name of the tag that begins `tag`, and whether it ends itself (`/>`). For XML, how it is written is checked:
/// what is wrong with it is a code.
fn start_tag(tag: &str, strict: bool) -> Result<(&str, bool), &'static str> {
    let inside = tag.strip_prefix('<').and_then(|rest| rest.strip_suffix('>')).unwrap_or_default();
    let (inside, closes_itself) = match inside.strip_suffix('/') {
        Some(inside) => (inside, true),
        None => (inside, false),
    };
    let name_end = inside.find(|letter: char| letter.is_whitespace() || letter == '/').unwrap_or(inside.len());
    let name = &inside[..name_end];
    if !strict {
        return Ok((name, closes_itself));
    }
    if !name.chars().next().is_some_and(is_name_start) {
        return Err("bad-tag");
    }
    let mut rest = inside[name_end..].trim_start();
    let mut seen: Vec<&str> = Vec::new();
    while !rest.is_empty() {
        let end = rest.find(|letter: char| letter.is_whitespace() || letter == '=').unwrap_or(rest.len());
        let attribute = &rest[..end];
        if !attribute.chars().next().is_some_and(is_name_start) {
            return Err("bad-attribute");
        }
        let value = rest[end..].trim_start().strip_prefix('=').ok_or("bad-attribute")?.trim_start();
        let quote = value.chars().next().filter(|quote| matches!(quote, '"' | '\'')).ok_or("bad-attribute")?;
        let close = value[1..].find(quote).ok_or("bad-attribute")?;
        let text = &value[1..1 + close];
        if text.contains('<') {
            return Err("bad-attribute");
        }
        if bad_reference(text).is_some() {
            return Err("bad-reference");
        }
        if seen.contains(&attribute) {
            return Err("duplicate-attribute");
        }
        seen.push(attribute);
        let after = &value[close + 2..];
        if !(after.is_empty() || after.starts_with(char::is_whitespace)) {
            return Err("bad-attribute");
        }
        rest = after.trim_start();
    }
    Ok((name, closes_itself))
}

impl Markup {
    /// `style`: how it is written again ([`Style::Check`] writes nothing). `drop_comments`: comments are left out.
    pub fn new(kind: Kind, style: Style, drop_comments: bool) -> Self {
        Markup {
            style,
            drop_comments,
            html: match kind {
                Kind::Auto => None,
                Kind::Xml => Some(false),
                Kind::Html => Some(true),
            },
            letters: Letters::default(),
            held: String::new(),
            at: 0,
            sought: 0,
            place: Place::default(),
            raw: None,
            ends_raw: false,
            open: Vec::new(),
            fresh: false,
            run: Vec::new(),
            wrote: false,
            elements: 0,
            roots: 0,
            any: false,
        }
    }

    fn html(&self) -> bool {
        self.html == Some(true)
    }

    fn put(&mut self, text: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        if self.style != Style::Check && !text.is_empty() {
            out.write_all(text.as_bytes())?;
            self.wrote = true;
        }
        Ok(())
    }

    /// A new line, pushed in as deep as the elements that are open.
    fn line(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        let pushed = match self.style {
            Style::Spaces(spaces) => " ".repeat(usize::from(spaces) * self.open.len()),
            Style::Tab => "\t".repeat(self.open.len()),
            Style::Minify | Style::Check => return Ok(()),
        };
        if self.wrote {
            out.write_all(b"\n")?;
        }
        out.write_all(pushed.as_bytes())?;
        Ok(())
    }

    /// The text that waits is written. `alone`: it is all its element holds, and stands on the line of its tags;
    /// else it gets a line of its own, without the space around it.
    fn flush(&mut self, alone: bool, out: &mut dyn Write) -> Result<(), CodecError> {
        if self.run.is_empty() {
            return Ok(());
        }
        let html = self.html();
        let mut text = String::new();
        for piece in std::mem::take(&mut self.run) {
            match piece {
                // In HTML any run of white space shows as one space.
                Piece::Text(written) if html => text.push_str(&collapsed(&written)),
                Piece::Text(written) | Piece::Kept(written) => text.push_str(&written),
            }
        }
        if text.trim().is_empty() {
            return Ok(());
        }
        if alone && !html {
            // The text of an element of XML is its value: it is left as it stands.
            return self.put(&text, out);
        }
        if !alone {
            self.line(out)?;
        }
        self.put(text.trim(), out)
    }

    fn decide(&mut self, html: bool) {
        if self.html.is_none() {
            self.html = Some(html);
        }
    }

    fn text(&mut self, text: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let blank = text.trim().is_empty();
        if !blank {
            self.any = true;
            // Text before any element: only HTML has that.
            self.decide(true);
        }
        if !self.html() && !blank {
            if self.open.is_empty() {
                return Err(self.place.wrong("text-outside-root").into());
            }
            if let Some(at) = bad_reference(text) {
                let mut place = self.place;
                text.as_bytes()[..at].iter().for_each(|&byte| place.pass(byte));
                return Err(place.wrong("bad-reference").into());
            }
        }
        if self.run.last().is_none() && blank {
            // White space between tags is how the text was laid out, not a part of it.
            return Ok(());
        }
        let _ = out;
        self.run.push(Piece::Text(text.to_owned()));
        Ok(())
    }

    /// Something that stands on a line of its own: a comment, a declaration, an instruction.
    fn apart(&mut self, text: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        self.any = true;
        self.flush(false, out)?;
        self.fresh = false;
        self.line(out)?;
        self.put(text, out)
    }

    fn start(&mut self, tag: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let here = self.place;
        let (name, closes_itself) = start_tag(tag, false).unwrap_or_default();
        let lower = name.to_ascii_lowercase();
        self.decide(TELLS_HTML.contains(&lower.as_str()));
        self.elements += 1;
        if self.html() {
            if INLINE.contains(&lower.as_str()) {
                self.run.push(Piece::Kept(tidy(tag)));
                return Ok(());
            }
            while self.open.last().is_some_and(|(top, _)| ends(&lower, top)) {
                self.flush(false, out)?;
                self.open.pop();
                self.fresh = false;
            }
            self.flush(false, out)?;
            self.line(out)?;
            self.put(&tidy(tag), out)?;
            self.fresh = false;
            if RAW.contains(&lower.as_str()) && !closes_itself {
                self.raw = Some(lower);
            } else if !(closes_itself || VOID.contains(&lower.as_str())) {
                self.open.push((lower, here.wrong("unclosed-tag")));
                self.fresh = true;
            }
            return Ok(());
        }
        start_tag(tag, true).map_err(|code| here.wrong(code))?;
        if self.open.is_empty() {
            if self.roots > 0 {
                return Err(here.wrong("several-roots").into());
            }
            self.roots += 1;
        }
        self.flush(false, out)?;
        self.line(out)?;
        self.put(&tidy(tag), out)?;
        self.fresh = !closes_itself;
        if !closes_itself {
            self.open.push((name.to_owned(), here.wrong("unclosed-tag")));
        }
        Ok(())
    }

    fn end(&mut self, tag: &str, out: &mut dyn Write) -> Result<(), CodecError> {
        let here = self.place;
        let name = tag[2..].trim_end_matches('>').trim();
        if std::mem::take(&mut self.ends_raw) {
            // The end of an element whose content was passed as it is: it goes right after that content.
            return self.put(&tidy(tag), out);
        }
        if self.html() {
            let lower = name.to_ascii_lowercase();
            if INLINE.contains(&lower.as_str()) {
                self.run.push(Piece::Kept(tidy(tag)));
                return Ok(());
            }
            match self.open.iter().rposition(|(open, _)| *open == lower) {
                // An end with no start: it is written where it stands, and changes nothing.
                None => return self.apart(&tidy(tag), out),
                // What was opened inside and never ended, ends here.
                Some(at) => {
                    while self.open.len() > at + 1 {
                        self.flush(false, out)?;
                        self.open.pop();
                        self.fresh = false;
                    }
                }
            }
        } else {
            match self.open.last() {
                None => return Err(here.wrong("unexpected-end-tag").into()),
                Some((open, _)) if open != name => return Err(here.wrong("mismatched-tag").into()),
                Some(_) => {}
            }
        }
        if std::mem::take(&mut self.fresh) {
            self.flush(true, out)?;
            self.open.pop();
        } else {
            self.flush(false, out)?;
            self.open.pop();
            self.line(out)?;
        }
        self.put(&tidy(tag), out)
    }

    /// `count` bytes of what is held were dealt with.
    fn pass(&mut self, count: usize) {
        self.held.as_bytes()[self.at..self.at + count].iter().for_each(|&byte| self.place.pass(byte));
        self.at += count;
        self.sought = 0;
    }

    /// Deals with every token that is whole. `last`: nothing more will come.
    fn tokens(&mut self, last: bool, out: &mut dyn Write) -> Result<(), CodecError> {
        loop {
            let rest = &self.held[self.at..];
            if rest.is_empty() {
                break;
            }
            if let Some(name) = self.raw.clone() {
                // Passed as it is, to the end tag of the element.
                let from = self.sought.min(rest.len());
                let found = rest.as_bytes()[from..].windows(name.len() + 2).position(|window| window.starts_with(b"</") && window[2..].eq_ignore_ascii_case(name.as_bytes())).map(|found| from + found);
                let count = match found {
                    Some(found) => found,
                    None if last => rest.len(),
                    None => {
                        self.sought = rest.len().saturating_sub(name.len() + 2);
                        // A letter of several bytes is not cut: the search goes on from a whole one.
                        while !rest.is_char_boundary(self.sought) {
                            self.sought -= 1;
                        }
                        break;
                    }
                };
                let content = rest[..count].to_owned();
                self.put(&content, out)?;
                self.pass(count);
                if found.is_some() {
                    self.raw = None;
                    self.ends_raw = true;
                }
                continue;
            }
            let second = rest.chars().nth(1);
            let markup = rest.starts_with('<') && second.is_none_or(|second| is_name_start(second) || matches!(second, '/' | '!' | '?'));
            if !markup {
                if rest.starts_with('<') && second.is_some() {
                    // A `<` that begins nothing: text in HTML, a mistake in XML.
                    if self.html.is_none() {
                        self.html = Some(true);
                    }
                    if self.html != Some(true) {
                        return Err(self.place.wrong("bad-tag").into());
                    }
                }
                let from = self.sought.max(1).min(rest.len());
                let count = match rest.as_bytes()[from..].iter().position(|&byte| byte == b'<') {
                    Some(found) => from + found,
                    None if last => rest.len(),
                    None => {
                        self.sought = rest.len();
                        break;
                    }
                };
                let text = rest[..count].to_owned();
                self.text(&text, out)?;
                self.pass(count);
                continue;
            }
            // Too little to tell what begins here.
            if rest.len() < 9 && !last {
                break;
            }
            let ended_by = |mark: &str, from: usize| {
                let from = self.sought.saturating_sub(mark.len()).max(from).min(rest.len());
                rest.as_bytes()[from..].windows(mark.len()).position(|window| window == mark.as_bytes()).map(|found| from + found + mark.len())
            };
            let (end, what) = if rest.starts_with("<!--") {
                (ended_by("-->", 4), 'c')
            } else if rest.starts_with("<![CDATA[") {
                (ended_by("]]>", 9), 'd')
            } else if rest.starts_with("<?") {
                (ended_by("?>", 2), 'i')
            } else if rest.starts_with("<!") {
                (doctype_end(rest), 't')
            } else if rest.starts_with("</") {
                (tag_end(rest), 'e')
            } else {
                (tag_end(rest), 's')
            };
            let Some(end) = end else {
                if !last {
                    self.sought = rest.len();
                    break;
                }
                if self.html != Some(true) {
                    return Err(self.place.wrong("unclosed-markup").into());
                }
                // HTML: what never ends is text.
                let text = rest.to_owned();
                self.run.push(Piece::Text(text));
                let count = self.held.len() - self.at;
                self.pass(count);
                break;
            };
            let token = rest[..end].to_owned();
            match what {
                'c' if self.drop_comments => {}
                'c' => self.apart(&token, out)?,
                // Marked as text to be taken as it is: it stays in its line.
                'd' => self.run.push(Piece::Kept(token)),
                'i' => {
                    if token.starts_with("<?xml") {
                        self.decide(false);
                    }
                    self.apart(&token, out)?;
                }
                't' => {
                    self.decide(token.get(2..14).is_some_and(|start| start.eq_ignore_ascii_case("doctype html")));
                    self.apart(&tidy(&token), out)?;
                }
                'e' => self.end(&token, out)?,
                _ => self.start(&token, out)?,
            }
            self.pass(end);
        }
        // What was dealt with is let go of.
        self.held.drain(..self.at);
        self.at = 0;
        Ok(())
    }
}

impl Stage for Markup {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        if self.held.try_reserve(text.len()).is_err() {
            return Err(CodecError::NoMemory);
        }
        // The mark some programs put before a text is not part of it.
        let first = self.held.is_empty() && self.place.wrong("").offset == 0;
        self.held.push_str(if first { text.strip_prefix('\u{feff}').unwrap_or(&text) } else { &text });
        self.tokens(false, out)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        self.tokens(true, out)?;
        self.flush(false, out)?;
        if self.elements == 0 && !self.any {
            return Err(Wrong::nowhere("empty").into());
        }
        if !self.html() {
            if let Some((_, opened)) = self.open.last() {
                return Err((*opened).into());
            }
            if self.roots == 0 {
                return Err(Wrong::nowhere("no-root").into());
            }
        }
        Ok(())
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        vec![(if self.html() { "markup-html" } else { "markup-xml" }, self.elements.to_string())]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::{problem, through};

    fn written(text: &str, kind: Kind, style: Style) -> String {
        let whole = String::from_utf8(through(&mut Markup::new(kind, style, false), text.as_bytes(), 1_000_000).expect("read")).expect("text");
        // Whatever the size of the pieces, the result is the same.
        for at_once in [1, 2, 7, 13] {
            assert_eq!(String::from_utf8(through(&mut Markup::new(kind, style, false), text.as_bytes(), at_once).expect("read")).expect("text"), whole, "{at_once} at a time");
        }
        whole
    }

    #[test]
    fn xml_is_spread_out() {
        let xml = "<?xml version=\"1.0\"?><!DOCTYPE note [<!ENTITY a \"b\">]><note  id = \"1\"   lang='ro' ><to> Ana </to><!-- hm --><body>text <b>bold</b> more</body><empty></empty><none/><data><![CDATA[a < b]]></data>\n\n</note>";
        assert_eq!(
            written(xml, Kind::Auto, Style::Spaces(2)),
            "<?xml version=\"1.0\"?>\n<!DOCTYPE note [<!ENTITY a \"b\">]>\n<note id = \"1\" lang='ro'>\n  <to> Ana </to>\n  <!-- hm -->\n  <body>\n    text\n    <b>bold</b>\n    more\n  </body>\n  <empty></empty>\n  <none/>\n  <data><![CDATA[a < b]]></data>\n</note>"
        );
        assert_eq!(written("<a><b><c>x</c></b></a>", Kind::Xml, Style::Tab), "<a>\n\t<b>\n\t\t<c>x</c>\n\t</b>\n</a>");
    }

    #[test]
    fn xml_is_put_on_one_line_and_what_it_says_stays() {
        assert_eq!(written("<a>\n  <b> x </b>\n  <c>\n    text\n    <d/>\n  </c>\n</a>\n", Kind::Xml, Style::Minify), "<a><b> x </b><c>text<d/></c></a>");
        let mut stage = Markup::new(Kind::Xml, Style::Minify, true);
        assert_eq!(through(&mut stage, b"<a><!-- gone --><b/></a>", 5).expect("read"), b"<a><b/></a>");
        assert_eq!(stage.notes(), vec![("markup-xml", "2".to_string())]);
        assert_eq!(through(&mut Markup::new(Kind::Xml, Style::Check, false), b"<a><b/></a>", 5).expect("read"), b"");
    }

    #[test]
    fn what_is_wrong_with_xml_is_told_with_its_place() {
        let wrong = |text: &str| problem(through(&mut Markup::new(Kind::Xml, Style::Check, false), text.as_bytes(), 4));
        assert_eq!(wrong("<a>\n  <b>x</c>\n</a>"), ("mismatched-tag", 2, 7));
        assert_eq!(wrong("<a>\n<b>"), ("unclosed-tag", 2, 1));
        assert_eq!(wrong("<a></a></b>"), ("unexpected-end-tag", 1, 8));
        assert_eq!(wrong("<a/><b/>"), ("several-roots", 1, 5));
        assert_eq!(wrong("<a/>text"), ("text-outside-root", 1, 5));
        assert_eq!(wrong("<a b=1/>"), ("bad-attribute", 1, 1));
        assert_eq!(wrong("<a b=\"1\" b=\"2\"/>"), ("duplicate-attribute", 1, 1));
        assert_eq!(wrong("<a>é &amp; &#10; &#xA; x & y</a>"), ("bad-reference", 1, 26));
        assert_eq!(wrong("<a>1 < 2</a>"), ("bad-tag", 1, 6));
        assert_eq!(wrong("<a><!-- never"), ("unclosed-markup", 1, 4));
        assert_eq!(wrong("<a b=\"x"), ("unclosed-markup", 1, 1));
        assert_eq!(wrong("  \n"), ("empty", 0, 0));
        assert_eq!(wrong("<!-- only -->"), ("no-root", 0, 0));
        assert!(through(&mut Markup::new(Kind::Xml, Style::Check, false), "<ns:a xmlns:ns=\"u\" a.b-c=\"&lt;\"><é/></ns:a>".as_bytes(), 3).is_ok());
    }

    #[test]
    fn html_is_spread_out_as_browsers_read_it() {
        let html = "<!doctype html><HTML><head><meta charset=utf-8><title>T</title></head><body><p>One <b>bold</b>\n   and <a href=\"x\">link</a>.<p>Two<br>lines<ul><li>a<li>b <i>c</i></ul><img src=a.png><div></div></body></html>";
        assert_eq!(
            written(html, Kind::Auto, Style::Spaces(2)),
            "<!doctype html>\n<HTML>\n  <head>\n    <meta charset=utf-8>\n    <title>T</title>\n  </head>\n  <body>\n    <p>\n      One <b>bold</b> and <a href=\"x\">link</a>.\n    <p>\n      Two<br>lines\n    <ul>\n      <li>\n        a\n      <li>\n        b <i>c</i>\n    </ul>\n    <img src=a.png>\n    <div></div>\n  </body>\n</html>"
        );
    }

    #[test]
    fn what_must_stay_as_it_is_in_html_does() {
        let html = "<div><pre>  a\n    b </pre><script>if (a < b && c > d) { x = \"</div>\"; }</script><STYLE>\n a { b: c }\n</STYLE><textarea>\n t </textarea></div>";
        assert_eq!(written(html, Kind::Html, Style::Spaces(2)), "<div>\n  <pre>  a\n    b </pre>\n  <script>if (a < b && c > d) { x = \"</div>\"; }</script>\n  <STYLE>\n a { b: c }\n</STYLE>\n  <textarea>\n t </textarea>\n</div>");
        assert_eq!(written("<div>\n  <p> a   b </p>\n  <pre> x  y </pre>\n</div>", Kind::Html, Style::Minify), "<div><p>a b</p><pre> x  y </pre></div>");
    }

    #[test]
    fn the_space_between_two_inline_elements_of_html_stays() {
        let html = "<div><span>a</span> <span>b</span>\n<b>c</b></div>";
        assert_eq!(written(html, Kind::Html, Style::Minify), "<div><span>a</span> <span>b</span> <b>c</b></div>");
        assert_eq!(written(html, Kind::Html, Style::Spaces(2)), "<div><span>a</span> <span>b</span> <b>c</b></div>");
    }

    #[test]
    fn html_forgives() {
        // Ends with no start, a `<` that begins nothing, tags never ended, text before anything.
        assert_eq!(written("hello <b>x</b></div> 1 < 2 <section><p>open", Kind::Auto, Style::Spaces(2)), "hello <b>x</b>\n</div>\n1 < 2\n<section>\n  <p>\n    open");
        assert_eq!(written("<table><tr><td>1<td>2<tr><td>3</table>", Kind::Html, Style::Minify), "<table><tr><td>1<td>2<tr><td>3</table>");
        assert_eq!(written("<div><span>never", Kind::Auto, Style::Minify), "<div><span>never");
        let mut stage = Markup::new(Kind::Auto, Style::Minify, false);
        through(&mut stage, b"<div><br></div>", 4).expect("read");
        assert_eq!(stage.notes(), vec![("markup-html", "2".to_string())]);
    }

    #[test]
    fn a_long_text_is_not_sought_through_again_for_each_piece() {
        let text = format!("<a>{}</a>", "x".repeat(3_000_000));
        assert_eq!(through(&mut Markup::new(Kind::Xml, Style::Minify, false), text.as_bytes(), 4096).expect("read").len(), text.len());
    }
}
