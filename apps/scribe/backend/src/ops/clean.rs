//! Cleaning a text: its spaces, its quotes, the marks on its letters, the tags of a web page.

use serde::Deserialize;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

use super::{lines_of, text_of, OpError, Outcome};

/// Which end of a line is meant.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Side {
    #[default]
    Both,
    Start,
    End,
}

/// The quotation marks a text is given.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QuoteStyle {
    /// "straight" and 'straight': what keyboards type.
    Straight,
    /// “English” and ‘English’.
    English,
    /// „Romanian” and «inside».
    Romanian,
    /// „German“ and ‚German‘.
    German,
    /// « French » and “inside”.
    French,
}

/// How many lines came out other than they went in.
fn changed_lines<S: AsRef<str>>(before: &[&str], after: &[S]) -> usize {
    before.iter().zip(after).filter(|(one, other)| **one != other.as_ref()).count()
}

pub fn trim_lines(text: &str, side: Side) -> Outcome {
    let (lines, ended) = lines_of(text);
    let trimmed: Vec<&str> = lines
        .iter()
        .map(|line| match side {
            Side::Both => line.trim(),
            Side::Start => line.trim_start(),
            Side::End => line.trim_end(),
        })
        .collect();
    Outcome { changed: changed_lines(&lines, &trimmed), text: text_of(&trimmed, ended) }
}

/// Runs of spaces and tabs inside a line become one space; those at its ends go. Line endings stay.
pub fn clean_spaces(text: &str) -> Outcome {
    let (lines, ended) = lines_of(text);
    let cleaned: Vec<String> = lines
        .iter()
        .map(|line| {
            let mut out = String::with_capacity(line.len());
            let mut after_space = true;
            for letter in line.chars() {
                // Spaces of every kind: the plain one, the tab, the one that does not break, the thin ones.
                let space = letter == '\t' || (letter.is_whitespace() && letter != '\n');
                if space {
                    if !after_space {
                        out.push(' ');
                    }
                } else {
                    out.push(letter);
                }
                after_space = space;
            }
            out.truncate(out.trim_end().len());
            out
        })
        .collect();
    Outcome { changed: changed_lines(&lines, &cleaned), text: text_of(&cleaned, ended) }
}

pub fn tabs_to_spaces(text: &str, width: usize) -> Result<Outcome, OpError> {
    if width == 0 || width > 16 {
        return Err(OpError::BadChoice("a tab is 1 to 16 spaces wide"));
    }
    let (lines, ended) = lines_of(text);
    let spaced: Vec<String> = lines
        .iter()
        .map(|line| {
            let mut out = String::with_capacity(line.len());
            let mut column = 0;
            for letter in line.chars() {
                if letter == '\t' {
                    // Up to the next stop, as an editor shows it.
                    let fill = width - column % width;
                    out.extend(std::iter::repeat_n(' ', fill));
                    column += fill;
                } else {
                    out.push(letter);
                    column += 1;
                }
            }
            out
        })
        .collect();
    Ok(Outcome { changed: changed_lines(&lines, &spaced), text: text_of(&spaced, ended) })
}

/// Only the spaces a line starts with become tabs: spaces inside it are part of the text.
pub fn spaces_to_tabs(text: &str, width: usize) -> Result<Outcome, OpError> {
    if width == 0 || width > 16 {
        return Err(OpError::BadChoice("a tab is 1 to 16 spaces wide"));
    }
    let (lines, ended) = lines_of(text);
    let tabbed: Vec<String> = lines
        .iter()
        .map(|line| {
            let indent: usize = line.chars().take_while(|letter| *letter == ' ' || *letter == '\t').map(|letter| if letter == '\t' { width } else { 1 }).sum();
            let rest = line.trim_start_matches([' ', '\t']);
            format!("{}{}{rest}", "\t".repeat(indent / width), " ".repeat(indent % width))
        })
        .collect();
    Ok(Outcome { changed: changed_lines(&lines, &tabbed), text: text_of(&tabbed, ended) })
}

/// Every quotation mark of the text, whatever style it is in.
fn is_double_quote(letter: char) -> bool {
    matches!(letter, '"' | '“' | '”' | '„' | '‟' | '«' | '»')
}

fn is_single_quote(letter: char) -> bool {
    matches!(letter, '‘' | '’' | '‚' | '‛' | '‹' | '›')
}

pub fn quotes(text: &str, to: QuoteStyle) -> Outcome {
    // The opening and closing mark of each level, with what goes between a French mark and the words.
    let (double, single, inner_space): ((&str, &str), (&str, &str), &str) = match to {
        QuoteStyle::Straight => (("\"", "\""), ("'", "'"), ""),
        QuoteStyle::English => (("“", "”"), ("‘", "’"), ""),
        QuoteStyle::Romanian => (("„", "”"), ("«", "»"), ""),
        QuoteStyle::German => (("„", "“"), ("‚", "‘"), ""),
        QuoteStyle::French => (("«", "»"), ("“", "”"), "\u{a0}"),
    };
    let letters: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 16);
    let mut changed = 0;
    let (mut double_open, mut single_open) = (false, false);
    for (index, letter) in letters.iter().copied().enumerate() {
        let before = index.checked_sub(1).and_then(|at| letters.get(at)).copied();
        let after = letters.get(index + 1).copied();
        let opens = |open: bool| -> bool {
            // A mark opens at the start, after a space or an opening bracket; else it closes what is open.
            let at_start = before.is_none_or(|letter| letter.is_whitespace() || matches!(letter, '(' | '[' | '{' | '—' | '–' | '-'));
            if at_start {
                true
            } else {
                !open && after.is_some_and(char::is_alphanumeric) && !before.is_some_and(char::is_alphanumeric)
            }
        };
        if is_double_quote(letter) {
            let opening = opens(double_open);
            double_open = opening;
            let put = if opening { format!("{}{inner_space}", double.0) } else { format!("{inner_space}{}", double.1) };
            if put != letter.to_string() {
                changed += 1;
            }
            out.push_str(&put);
        } else if is_single_quote(letter) || letter == '\'' {
            // An apostrophe inside a word is not a quotation mark: "don't", "l'été".
            let inside_word = before.is_some_and(char::is_alphanumeric) && after.is_some_and(char::is_alphanumeric);
            if inside_word {
                let apostrophe = if to == QuoteStyle::Straight { '\'' } else { '’' };
                if apostrophe != letter {
                    changed += 1;
                }
                out.push(apostrophe);
                continue;
            }
            let opening = opens(single_open);
            single_open = opening;
            let put = if opening { single.0 } else { single.1 };
            if put != letter.to_string() {
                changed += 1;
            }
            out.push_str(put);
        } else {
            out.push(letter);
        }
    }
    Outcome { changed, text: out }
}

/// What the names of the most used characters of a web page stand for.
const ENTITIES: &[(&str, &str)] = &[
    ("amp", "&"),
    ("lt", "<"),
    ("gt", ">"),
    ("quot", "\""),
    ("apos", "'"),
    ("nbsp", "\u{a0}"),
    ("ndash", "–"),
    ("mdash", "—"),
    ("hellip", "…"),
    ("laquo", "«"),
    ("raquo", "»"),
    ("ldquo", "“"),
    ("rdquo", "”"),
    ("bdquo", "„"),
    ("lsquo", "‘"),
    ("rsquo", "’"),
    ("copy", "©"),
    ("reg", "®"),
    ("trade", "™"),
    ("euro", "€"),
    ("deg", "°"),
];

/// Tags whose end is a new line in the text that is read.
const BLOCKS: &[&str] = &["p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article", "header", "footer", "blockquote", "pre", "table", "ul", "ol", "title", "hr"];
/// Tags whose inside is not text to read.
const UNSEEN: &[&str] = &["script", "style", "head", "noscript", "template"];

fn entity(name: &str) -> Option<String> {
    if let Some(number) = name.strip_prefix('#') {
        let code = match number.strip_prefix(['x', 'X']) {
            Some(hex) => u32::from_str_radix(hex, 16).ok()?,
            None => number.parse().ok()?,
        };
        return char::from_u32(code).map(String::from);
    }
    ENTITIES.iter().find(|(known, _)| *known == name).map(|(_, text)| (*text).to_owned())
}

/// The text of a web page as it is read: without tags, scripts and styles, with the named characters written out.
pub fn strip_html(text: &str) -> Outcome {
    let mut out = String::with_capacity(text.len());
    let mut tags = 0;
    let mut rest = text;
    // The name of the tag whose inside is being passed over (a script, a style).
    let mut unseen: Option<String> = None;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("<!--") {
            rest = after.find("-->").map_or("", |end| &after[end + 3..]);
            tags += 1;
            continue;
        }
        if rest.starts_with('<') && rest[1..].starts_with(|letter: char| letter.is_ascii_alphabetic() || letter == '/' || letter == '!') {
            let Some(end) = rest.find('>') else {
                // Not a tag after all: a "<" in the text.
                out.push('<');
                rest = &rest[1..];
                continue;
            };
            let inside = rest[1..end].trim();
            let closing = inside.starts_with('/');
            let name: String = inside.trim_start_matches('/').chars().take_while(|letter| letter.is_ascii_alphanumeric()).collect::<String>().to_lowercase();
            rest = &rest[end + 1..];
            tags += 1;
            match &unseen {
                Some(waited) if closing && *waited == name => unseen = None,
                Some(_) => {}
                None if !closing && UNSEEN.contains(&name.as_str()) && !inside.ends_with('/') => unseen = Some(name),
                None if BLOCKS.contains(&name.as_str()) && !out.ends_with('\n') && !out.is_empty() => out.push('\n'),
                None => {}
            }
            continue;
        }
        let letter = rest.chars().next().unwrap_or(' ');
        if unseen.is_some() {
            rest = &rest[letter.len_utf8()..];
            continue;
        }
        if letter == '&' {
            if let Some(end) = rest[..rest.len().min(12)].find(';') {
                if let Some(written) = entity(&rest[1..end]) {
                    out.push_str(&written);
                    rest = &rest[end + 1..];
                    continue;
                }
            }
        }
        out.push(letter);
        rest = &rest[letter.len_utf8()..];
    }
    // A page is written with spaces and new lines that are not part of what is read.
    let read: Vec<String> = out.split('\n').map(|line| line.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|line| !line.is_empty()).collect();
    Outcome { changed: tags, text: read.join("\n") }
}

/// Letters that are not a plain letter with a mark put on it, and what they are written as without it.
fn plain_form(letter: char) -> Option<&'static str> {
    Some(match letter {
        'ß' => "ss",
        'ẞ' => "SS",
        'æ' => "ae",
        'Æ' => "AE",
        'œ' => "oe",
        'Œ' => "OE",
        'ø' => "o",
        'Ø' => "O",
        'đ' => "d",
        'Đ' => "D",
        'ł' => "l",
        'Ł' => "L",
        'þ' => "th",
        'Þ' => "Th",
        'ð' => "d",
        'Ð' => "D",
        'ı' => "i",
        'ħ' => "h",
        'Ħ' => "H",
        _ => return None,
    })
}

pub fn remove_diacritics(text: &str) -> Outcome {
    let mut out = String::with_capacity(text.len());
    let mut changed = 0;
    for letter in text.chars() {
        if letter.is_ascii() {
            out.push(letter);
            continue;
        }
        if let Some(plain) = plain_form(letter) {
            out.push_str(plain);
            changed += 1;
            continue;
        }
        // The letter taken apart: what is left when its marks are dropped. Only for Latin and Greek letters:
        // in other alphabets a mark makes another letter (й is not и), and in some scripts marks are the vowels.
        let parts: Vec<char> = std::iter::once(letter).nfd().collect();
        let base_fits = parts.first().is_some_and(|base| base.is_ascii_alphabetic() || ('Ͱ'..='Ͽ').contains(base));
        if parts.len() > 1 && base_fits {
            out.extend(parts.into_iter().filter(|part| !is_combining_mark(*part)));
            changed += 1;
        } else {
            out.push(letter);
        }
    }
    Outcome { changed, text: out }
}

/// Romanian written with the letters old systems had (a cedilla under s and
/// t) put right (a comma under them), so that a search typed on a Romanian
/// keyboard finds the words.
pub fn repair_romanian(text: &str) -> Outcome {
    let mut changed = 0;
    let repaired: String = text
        .chars()
        .map(|letter| {
            let right = match letter {
                'ş' => 'ș',
                'Ş' => 'Ș',
                'ţ' => 'ț',
                'Ţ' => 'Ț',
                other => other,
            };
            if right != letter {
                changed += 1;
            }
            right
        })
        .collect();
    Outcome { changed, text: repaired }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_the_ends_of_lines() {
        assert_eq!(trim_lines("  a  \n\tb\t\n", Side::Both).text, "a\nb\n");
        assert_eq!(trim_lines("  a  ", Side::Start).text, "a  ");
        let end = trim_lines("  a  \nb", Side::End);
        assert_eq!((end.text.as_str(), end.changed), ("  a\nb", 1));
    }

    #[test]
    fn makes_one_space_of_many() {
        assert_eq!(clean_spaces("  a   b\t\tc \u{a0} d  \n\n x").text, "a b c d\n\nx");
    }

    #[test]
    fn turns_tabs_into_spaces_up_to_the_next_stop() {
        assert_eq!(tabs_to_spaces("\ta\tb", 4).expect("works").text, "    a   b");
        assert_eq!(tabs_to_spaces("ab\tc", 4).expect("works").text, "ab  c");
        assert!(tabs_to_spaces("a", 0).is_err());
    }

    #[test]
    fn turns_the_spaces_a_line_starts_with_into_tabs() {
        assert_eq!(spaces_to_tabs("        a  b\n      c\nd", 4).expect("works").text, "\t\ta  b\n\t  c\nd");
        assert_eq!(spaces_to_tabs("  \t  a", 4).expect("works").text, "\t\ta");
    }

    #[test]
    fn gives_a_text_the_quotes_of_a_language() {
        assert_eq!(quotes("He said \"yes\" and 'no'.", QuoteStyle::English).text, "He said “yes” and ‘no’.");
        assert_eq!(quotes("A zis \"da\".", QuoteStyle::Romanian).text, "A zis „da”.");
        assert_eq!(quotes("Er sagte \"ja\".", QuoteStyle::German).text, "Er sagte „ja“.");
        assert_eq!(quotes("Il a dit \"oui\".", QuoteStyle::French).text, "Il a dit «\u{a0}oui\u{a0}».");
        // Back to what a keyboard types, whatever they were.
        assert_eq!(quotes("„da” «nu» “yes” ‘no’", QuoteStyle::Straight).text, "\"da\" \"nu\" \"yes\" 'no'");
    }

    #[test]
    fn leaves_an_apostrophe_inside_a_word_an_apostrophe() {
        assert_eq!(quotes("don't say 'no'", QuoteStyle::English).text, "don’t say ‘no’");
        assert_eq!(quotes("don’t", QuoteStyle::Straight).text, "don't");
    }

    #[test]
    fn reads_a_web_page_as_text() {
        let page = "<html><head><title>T</title><style>p { color: red }</style></head>\n<body>\n  <h1>Title</h1>\n  <p>One &amp; two&nbsp;&#8212; <b>three</b>&hellip;</p>\n  <script>var x = '<p>';</script>\n  <!-- hidden -->\n  <ul><li>a</li><li>b &lt; c</li></ul>\n</body></html>";
        // A space that does not break is still a space: what is read has plain ones.
        assert_eq!(strip_html(page).text, "Title\nOne & two — three…\na\nb < c");
        // Text with a "<" that is not a tag stays as it is.
        assert_eq!(strip_html("1 < 2 and 3 > 2").text, "1 < 2 and 3 > 2");
    }

    #[test]
    fn takes_the_marks_off_letters() {
        let plain = remove_diacritics("Șase țări în Århus: straße, cœur, Łódź, Điện, ñ");
        assert_eq!(plain.text, "Sase tari in Arhus: strasse, coeur, Lodz, Dien, n");
        assert_eq!(remove_diacritics("plain text 123").changed, 0);
        // Letters of other alphabets are left as they are.
        assert_eq!(remove_diacritics("Чай, ёж, 日本").text, "Чай, ёж, 日本");
        assert_eq!(remove_diacritics("Αθήνα").text, "Αθηνα");
    }

    #[test]
    fn puts_the_right_romanian_letters() {
        let repaired = repair_romanian("Şase ţări şi încă una");
        assert_eq!((repaired.text.as_str(), repaired.changed), ("Șase țări și încă una", 3));
    }
}
