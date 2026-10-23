//! HTML's character references, both ways, as text comes.
//!
//! Written: the five signs HTML reads as its own (`& < > " '`), or those and
//! every letter that is not ASCII; each by its name where HTML 4 has one, or
//! by its number, decimal or hexadecimal.
//!
//! Read back: every name the HTML standard knows, and every number. A name
//! that is not known is left as it is, and told of at the end; so is a `&`
//! that starts nothing.

use std::io::Write;

use crate::codec::{CodecError, Letters, Stage};
use crate::entity_names::{HTML4, NAMED};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    /// By name where HTML 4 has one (`&eacute;`), by decimal number otherwise.
    Named,
    Decimal,
    Hexadecimal,
}

pub struct Encode {
    /// Letters that are not ASCII are written as references too.
    beyond_ascii: bool,
    form: Form,
    letters: Letters,
}

impl Encode {
    pub fn new(beyond_ascii: bool, form: Form) -> Self {
        Encode { beyond_ascii, form, letters: Letters::default() }
    }

    fn reference(&self, letter: char, into: &mut String) {
        let point = u32::from(letter);
        match self.form {
            Form::Named => match HTML4.binary_search_by_key(&point, |&(known, _)| known) {
                Ok(at) => {
                    into.push('&');
                    into.push_str(HTML4[at].1);
                    into.push(';');
                }
                // The one of the five that HTML 4 had no name for.
                Err(_) if letter == '\'' => into.push_str("&apos;"),
                Err(_) => into.push_str(&format!("&#{point};")),
            },
            Form::Decimal => into.push_str(&format!("&#{point};")),
            Form::Hexadecimal => into.push_str(&format!("&#x{point:X};")),
        }
    }
}

impl Stage for Encode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        let mut written = String::with_capacity(text.len() + text.len() / 8);
        for letter in text.chars() {
            if matches!(letter, '&' | '<' | '>' | '"' | '\'') || (self.beyond_ascii && !letter.is_ascii()) {
                self.reference(letter, &mut written);
            } else {
                written.push(letter);
            }
        }
        out.write_all(written.as_bytes()).map_err(Into::into)
    }

    fn finish(&mut self, _out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()
    }
}

/// The longest a reference can be, from its `&` to its `;`: the longest name is 31 letters.
const LONGEST: usize = 40;
/// How many names that were not known are kept to be told of.
const MOST_TOLD: usize = 20;

#[derive(Default)]
pub struct Decode {
    letters: Letters,
    /// From a `&` on, what may still turn out to be a reference: kept until its `;` comes, or it grows too long.
    held: String,
    /// Names that were not known, each once, the first of them; and how many times one was met.
    unknown: Vec<String>,
    unknown_count: u64,
}

/// The names HTML still reads without their `;` (the standard's legacy ones: those of HTML 4 for Latin-1, and the five
/// signs), in the order of the names.
const WITHOUT_SEMICOLON: &[&str] = &[
    "AElig", "AMP", "Aacute", "Acirc", "Agrave", "Aring", "Atilde", "Auml", "COPY", "Ccedil", "ETH", "Eacute",
    "Ecirc", "Egrave", "Euml", "GT", "Iacute", "Icirc", "Igrave", "Iuml", "LT", "Ntilde", "Oacute", "Ocirc", "Ograve",
    "Oslash", "Otilde", "Ouml", "QUOT", "REG", "THORN", "Uacute", "Ucirc", "Ugrave", "Uuml", "Yacute", "aacute",
    "acirc", "acute", "aelig", "agrave", "amp", "aring", "atilde", "auml", "brvbar", "ccedil", "cedil", "cent",
    "copy", "curren", "deg", "divide", "eacute", "ecirc", "egrave", "eth", "euml", "frac12", "frac14", "frac34", "gt",
    "iacute", "icirc", "iexcl", "igrave", "iquest", "iuml", "laquo", "lt", "macr", "micro", "middot", "nbsp", "not",
    "ntilde", "oacute", "ocirc", "ograve", "ordf", "ordm", "oslash", "otilde", "ouml", "para", "plusmn", "pound",
    "quot", "raquo", "reg", "sect", "shy", "sup1", "sup2", "sup3", "szlig", "thorn", "times", "uacute", "ucirc",
    "ugrave", "uml", "uuml", "yacute", "yen", "yuml",
];

/// The text a reference stands for (what is between `&` and `;`); none when it stands for nothing.
fn meaning(inside: &str) -> Option<String> {
    if let Some(number) = inside.strip_prefix('#') {
        let point = match number.strip_prefix(['x', 'X']) {
            Some(hex) if !hex.is_empty() => u32::from_str_radix(hex, 16).ok()?,
            Some(_) => return None,
            None => number.parse().ok()?,
        };
        // What is no letter (0, the halves of a pair, beyond the last) is shown as the sign for "not a letter", as browsers do.
        return Some(char::from_u32(point).filter(|&letter| letter != '\0').unwrap_or('\u{FFFD}').to_string());
    }
    NAMED.binary_search_by(|&(name, _)| name.cmp(inside)).ok().map(|at| NAMED[at].1.to_owned())
}

impl Decode {
    /// What was held ended before a `;` came, `next` after it (none at the end): it is read as a reference only
    /// when it is a whole name HTML takes without its `;`, and not followed by `=` (as in an attribute, so that
    /// `?a=1&copy=2` stays as it is).
    fn ended(&mut self, next: Option<char>, written: &mut String) {
        let held = std::mem::take(&mut self.held);
        let name = held.strip_prefix('&').unwrap_or_default();
        match WITHOUT_SEMICOLON.binary_search(&name).ok().and_then(|_| meaning(name)) {
            Some(text) if next != Some('=') => written.push_str(&text),
            _ => written.push_str(&held),
        }
    }

    /// What was held is no reference after all, or is one: written as it must be.
    fn settle(&mut self, written: &mut String) {
        let held = std::mem::take(&mut self.held);
        let Some(inside) = held.strip_prefix('&').and_then(|rest| rest.strip_suffix(';')) else {
            written.push_str(&held);
            return;
        };
        match meaning(inside) {
            Some(text) => written.push_str(&text),
            None => {
                self.unknown_count += 1;
                if self.unknown.len() < MOST_TOLD && !self.unknown.iter().any(|known| known == &held) {
                    self.unknown.push(held.clone());
                }
                written.push_str(&held);
            }
        }
    }
}

impl Stage for Decode {
    fn push(&mut self, piece: &[u8], out: &mut dyn Write) -> Result<(), CodecError> {
        let text = self.letters.take(piece)?;
        let mut written = String::with_capacity(text.len());
        for letter in text.chars() {
            if self.held.is_empty() {
                if letter == '&' {
                    self.held.push(letter);
                } else {
                    written.push(letter);
                }
                continue;
            }
            match letter {
                ';' => {
                    self.held.push(letter);
                    self.settle(&mut written);
                }
                // Another `&` before the `;`: the first one started nothing, unless it was a name read without its `;`; this one may.
                '&' => {
                    self.ended(Some(letter), &mut written);
                    self.held.push(letter);
                }
                _ if (letter.is_ascii_alphanumeric() || letter == '#') && self.held.len() < LONGEST => self.held.push(letter),
                _ => {
                    self.ended(Some(letter), &mut written);
                    written.push(letter);
                }
            }
        }
        out.write_all(written.as_bytes()).map_err(Into::into)
    }

    fn finish(&mut self, out: &mut dyn Write) -> Result<(), CodecError> {
        self.letters.end()?;
        let mut written = String::new();
        self.ended(None, &mut written);
        out.write_all(written.as_bytes()).map_err(Into::into)
    }

    fn notes(&self) -> Vec<(&'static str, String)> {
        if self.unknown_count == 0 {
            return Vec::new();
        }
        vec![("unknown-names", format!("{}\n{}", self.unknown_count, self.unknown.join(" ")))]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codec::tests::through;

    fn encoded(text: &str, beyond_ascii: bool, form: Form) -> String {
        String::from_utf8(through(&mut Encode::new(beyond_ascii, form), text.as_bytes(), 3).expect("encoded")).expect("text")
    }

    fn decoded(text: &str, at_once: usize) -> (String, Vec<(&'static str, String)>) {
        let mut stage = Decode::default();
        let written = String::from_utf8(through(&mut stage, text.as_bytes(), at_once).expect("decoded")).expect("text");
        (written, stage.notes())
    }

    #[test]
    fn writes_the_five_signs_and_leaves_the_rest() {
        let text = "<a href=\"x\">Tom & 'Jerry' é</a>";
        assert_eq!(encoded(text, false, Form::Named), "&lt;a href=&quot;x&quot;&gt;Tom &amp; &apos;Jerry&apos; é&lt;/a&gt;");
        assert_eq!(encoded(text, false, Form::Decimal), "&#60;a href=&#34;x&#34;&#62;Tom &#38; &#39;Jerry&#39; é&#60;/a&#62;");
        assert_eq!(encoded("<é>", false, Form::Hexadecimal), "&#x3C;é&#x3E;");
    }

    #[test]
    fn writes_what_is_not_ascii_when_asked() {
        assert_eq!(encoded("é © € 😀 ș", true, Form::Named), "&eacute; &copy; &euro; &#128512; &#537;");
        assert_eq!(encoded("é😀", true, Form::Decimal), "&#233;&#128512;");
        assert_eq!(encoded("é😀", true, Form::Hexadecimal), "&#xE9;&#x1F600;");
    }

    #[test]
    fn reads_names_and_numbers_back() {
        for at_once in 1..=9 {
            let (text, notes) = decoded("&lt;p&gt; &amp; &eacute;&#233;&#xE9;&#x1f600; &nbsp;&hellip;&NotEqualTilde; &apos;", at_once);
            assert_eq!(text, "<p> & ééé😀 \u{a0}…\u{2242}\u{338} '", "{at_once} at a time");
            assert!(notes.is_empty());
        }
        assert_eq!(decoded(&encoded("Tom & <Jerry> é ș 😀", true, Form::Named), 4).0, "Tom & <Jerry> é ș 😀");
    }

    #[test]
    fn reads_the_names_html_takes_without_their_semicolon() {
        for at_once in 1..=7 {
            assert_eq!(decoded("&amp &lt&gt, &copy 2024 &eacute.&AMP", at_once).0, "& <>, © 2024 é.&", "{at_once} at a time");
            // Only the legacy names, only whole, and not before `=` (as in a query in an attribute).
            assert_eq!(decoded("&hellip &copy2 &notin ?a=1&copy=2 &ampx", at_once).0, "&hellip &copy2 &notin ?a=1&copy=2 &ampx", "{at_once} at a time");
        }
    }

    #[test]
    fn leaves_what_is_no_reference_and_tells_of_unknown_names() {
        let (text, notes) = decoded("a & b &c; &nosuch; &nosuch; R&D &#xZZ; &amp &lt;", 5);
        assert_eq!(text, "a & b &c; &nosuch; &nosuch; R&D &#xZZ; & <");
        assert_eq!(notes, [("unknown-names", "4\n&c; &nosuch; &#xZZ;".to_owned())]);
        // A number that is no letter is shown as the sign for it, not left to break the text.
        assert_eq!(decoded("&#0;&#xD800;&#x110000;", 3).0, "\u{FFFD}\u{FFFD}\u{FFFD}");
    }
}
