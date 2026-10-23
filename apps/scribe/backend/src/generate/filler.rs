//! Filler text: words that mean nothing together, shaped like writing —
//! paragraphs, lists, headings, whole pages — and written as plain text,
//! HTML, Markdown or JSON.

use serde::Deserialize;
use serde_json::json;

use super::words::{BUSINESS, CLASSIC_START, ENGLISH, FOOD, LATIN, ROMANIAN};
use super::{Dice, MOST_CHARACTERS};
use crate::ops::OpError;

/// The words the filler is made of.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Vocabulary {
    /// The printers' Latin: "lorem ipsum".
    #[default]
    Latin,
    English,
    Romanian,
    /// The words of offices and slide decks.
    Business,
    /// The words of the kitchen.
    Food,
    /// The user's own words.
    Custom,
}

/// What `count` counts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    #[default]
    Paragraphs,
    Sentences,
    Words,
    /// Lists, each of some items.
    Lists,
    /// Headings alone.
    Headings,
    /// Parts of a page: each a heading, a paragraph or two, now and then a list.
    Page,
}

/// How long the sentences are.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SentenceLength {
    #[default]
    Mixed,
    Short,
    Medium,
    Long,
}

impl SentenceLength {
    /// The fewest and the most words of a sentence.
    fn words(self) -> (usize, usize) {
        match self {
            SentenceLength::Mixed => (5, 16),
            SentenceLength::Short => (3, 8),
            SentenceLength::Medium => (8, 15),
            SentenceLength::Long => (15, 28),
        }
    }
}

/// What the filler is written as.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    #[default]
    Plain,
    Html,
    Markdown,
    Json,
}

/// Filler with its choices, as the interface asks for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Filler {
    pub words: Vocabulary,
    pub unit: Unit,
    pub count: usize,
    /// Latin filler starts with the words it is known by.
    pub classic_start: bool,
    pub sentences: SentenceLength,
    /// The most characters written; 0 for as many as it takes.
    pub limit: usize,
    /// For `custom`: the words to use, parted by spaces, commas or new lines.
    pub own_words: String,
    /// Words that are not to be used, parted the same way.
    pub leave_out: String,
    pub format: Format,
    /// How many items a list has, and whether they are numbered.
    pub items: usize,
    pub ordered: bool,
    /// The level of the headings: 1 the largest, 6 the smallest.
    pub level: u8,
    /// The same seed gives the same text.
    pub seed: Option<u64>,
}

impl Default for Filler {
    fn default() -> Self {
        Self {
            words: Vocabulary::default(),
            unit: Unit::default(),
            count: 3,
            classic_start: false,
            sentences: SentenceLength::default(),
            limit: 0,
            own_words: String::new(),
            leave_out: String::new(),
            format: Format::default(),
            items: 5,
            ordered: false,
            level: 2,
            seed: None,
        }
    }
}

/// Sentences a paragraph has: between these.
const PARAGRAPH: (usize, usize) = (3, 7);
/// Words a heading and an item of a list have: between these.
const HEADING: (usize, usize) = (2, 6);
const ITEM: (usize, usize) = (2, 7);
/// A word takes about this many bytes with its space: used to refuse what would be too much before writing it.
const ROOM_FOR_A_WORD: usize = 8;

/// A piece of what is written.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Block {
    Heading(String),
    Paragraph(String),
    List(Vec<String>),
}

/// Words typed by the user, in small letters: parted by spaces, commas, semicolons or new lines.
fn typed_words(typed: &str) -> Vec<String> {
    let mut words: Vec<String> = Vec::new();
    for word in typed.split(|letter: char| letter.is_whitespace() || matches!(letter, ',' | ';')).map(str::trim).filter(|word| !word.is_empty()) {
        let word = word.to_lowercase();
        if !words.contains(&word) {
            words.push(word);
        }
    }
    words
}

struct Writer<'a> {
    words: Vec<&'a str>,
    dice: &'a mut Dice,
    /// The word written last: the next is another.
    last: usize,
    /// Words the text starts with before any is picked.
    start: &'static [&'static str],
    sentence: (usize, usize),
}

impl<'a> Writer<'a> {
    fn word(&mut self) -> &'a str {
        if let Some((first, rest)) = self.start.split_first() {
            self.start = rest;
            return first;
        }
        loop {
            let index = self.dice.below(self.words.len());
            if index != self.last {
                self.last = index;
                return self.words[index];
            }
        }
    }

    fn some_words(&mut self, (fewest, most): (usize, usize)) -> Vec<&'a str> {
        let length = self.dice.between(fewest, most);
        (0..length).map(|_| self.word()).collect()
    }

    fn sentence(&mut self) -> String {
        let length = self.dice.between(self.sentence.0, self.sentence.1).max(self.start.len());
        let words: Vec<&str> = (0..length).map(|_| self.word()).collect();
        // A long sentence takes a breath or two, never right at its ends.
        let mut commas = Vec::new();
        if length >= 8 {
            commas.push(self.dice.between(2, length - 4));
            if length >= 13 && self.dice.below(2) == 0 {
                commas.push(self.dice.between(2, length - 4));
            }
        }
        sentence_of(&words, &commas)
    }

    fn paragraph(&mut self) -> String {
        let length = self.dice.between(PARAGRAPH.0, PARAGRAPH.1);
        (0..length).map(|_| self.sentence()).collect::<Vec<_>>().join(" ")
    }

    /// Words with a capital first and no full stop: a heading, an item of a list.
    fn phrase(&mut self, length: (usize, usize)) -> String {
        let words = self.some_words(length);
        capitalized(&words.join(" "))
    }

    fn list(&mut self, items: usize) -> Vec<String> {
        (0..items).map(|_| self.phrase(ITEM)).collect()
    }
}

fn capitalized(text: &str) -> String {
    let mut letters = text.chars();
    match letters.next() {
        Some(first) => first.to_uppercase().chain(letters).collect(),
        None => String::new(),
    }
}

/// Words written as a sentence: a capital first, a full stop last, a comma after the words numbered in `commas`.
fn sentence_of(words: &[&str], commas: &[usize]) -> String {
    let mut text = String::with_capacity(words.len() * ROOM_FOR_A_WORD);
    for (index, word) in words.iter().enumerate() {
        if index > 0 {
            text.push(' ');
        }
        text.push_str(word);
        if commas.contains(&index) && index + 1 < words.len() {
            text.push(',');
        }
    }
    text.push('.');
    capitalized(&text)
}

/// A text cut to at most `room` characters, at the end of a word, and ended as a sentence when it was one.
fn cut_to(text: &str, room: usize) -> String {
    if text.chars().count() <= room {
        return text.to_owned();
    }
    let ended = text.ends_with('.');
    // Room is kept for the full stop.
    let kept: String = text.chars().take(room.saturating_sub(usize::from(ended))).collect();
    let whole = kept.rfind(' ').map_or("", |at| &kept[..at]);
    let bare = whole.trim_end_matches([',', '.', ' ']);
    if bare.is_empty() {
        String::new()
    } else if ended {
        format!("{bare}.")
    } else {
        bare.to_owned()
    }
}

/// The blocks that fit in `limit` characters: what comes after is left out, the one that crosses it is cut.
fn within(blocks: Vec<Block>, limit: usize) -> Vec<Block> {
    let mut room = limit;
    let mut kept = Vec::new();
    for block in blocks {
        if room == 0 {
            break;
        }
        let fitted = match block {
            Block::Heading(text) => Some(cut_to(&text, room)).filter(|text| !text.is_empty()).map(Block::Heading),
            Block::Paragraph(text) => Some(cut_to(&text, room)).filter(|text| !text.is_empty()).map(Block::Paragraph),
            Block::List(items) => {
                let mut left = room;
                let mut fitting = Vec::new();
                for item in items {
                    let length = item.chars().count();
                    if length > left {
                        break;
                    }
                    left -= length;
                    fitting.push(item);
                }
                Some(fitting).filter(|items| !items.is_empty()).map(Block::List)
            }
        };
        let Some(fitted) = fitted else {
            break;
        };
        let used: usize = match &fitted {
            Block::Heading(text) | Block::Paragraph(text) => text.chars().count(),
            Block::List(items) => items.iter().map(|item| item.chars().count()).sum(),
        };
        // What parts two blocks counts too.
        room = room.saturating_sub(used + 2);
        kept.push(fitted);
    }
    kept
}

fn escaped(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// The blocks written as asked.
fn written(blocks: &[Block], filler: &Filler) -> String {
    let level = filler.level.clamp(1, 6) as usize;
    let item = |index: usize, text: &str| if filler.ordered { format!("{}. {text}", index + 1) } else { format!("- {text}") };
    match filler.format {
        Format::Plain | Format::Markdown => blocks
            .iter()
            .map(|block| match block {
                Block::Heading(text) if filler.format == Format::Markdown => format!("{} {text}", "#".repeat(level)),
                Block::Heading(text) | Block::Paragraph(text) => text.clone(),
                Block::List(items) => items.iter().enumerate().map(|(index, text)| item(index, text)).collect::<Vec<_>>().join("\n"),
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        Format::Html => blocks
            .iter()
            .map(|block| match block {
                Block::Heading(text) => format!("<h{level}>{}</h{level}>", escaped(text)),
                Block::Paragraph(text) => format!("<p>{}</p>", escaped(text)),
                Block::List(items) => {
                    let tag = if filler.ordered { "ol" } else { "ul" };
                    let lines: String = items.iter().map(|text| format!("  <li>{}</li>\n", escaped(text))).collect();
                    format!("<{tag}>\n{lines}</{tag}>")
                }
            })
            .collect::<Vec<_>>()
            .join("\n"),
        Format::Json => {
            let listed: Vec<serde_json::Value> = blocks
                .iter()
                .map(|block| match block {
                    Block::Heading(text) => json!({ "type": "heading", "level": level, "text": text }),
                    Block::Paragraph(text) => json!({ "type": "paragraph", "text": text }),
                    Block::List(items) => json!({ "type": "list", "ordered": filler.ordered, "items": items }),
                })
                .collect();
            serde_json::to_string_pretty(&json!({ "blocks": listed })).unwrap_or_default()
        }
    }
}

/// Filler as asked.
pub fn write(filler: &Filler, dice: &mut Dice) -> Result<String, OpError> {
    if filler.count == 0 {
        return Err(OpError::BadChoice("nothing to write"));
    }
    let sentence = filler.sentences.words();
    let items = filler.items.clamp(1, 1000);
    let most_words = match filler.unit {
        Unit::Paragraphs => filler.count.saturating_mul(sentence.1 * PARAGRAPH.1),
        Unit::Sentences => filler.count.saturating_mul(sentence.1),
        Unit::Words => filler.count,
        Unit::Lists => filler.count.saturating_mul(items * ITEM.1),
        Unit::Headings => filler.count.saturating_mul(HEADING.1),
        Unit::Page => filler.count.saturating_mul(HEADING.1 + 2 * sentence.1 * PARAGRAPH.1 + items * ITEM.1),
    };
    if most_words.saturating_mul(ROOM_FOR_A_WORD) > MOST_CHARACTERS {
        return Err(OpError::BadChoice("too much to write"));
    }

    let own = typed_words(&filler.own_words);
    let left_out = typed_words(&filler.leave_out);
    let listed: Vec<&str> = match filler.words {
        Vocabulary::Latin => LATIN.to_vec(),
        Vocabulary::English => ENGLISH.to_vec(),
        Vocabulary::Romanian => ROMANIAN.to_vec(),
        Vocabulary::Business => BUSINESS.to_vec(),
        Vocabulary::Food => FOOD.to_vec(),
        Vocabulary::Custom => own.iter().map(String::as_str).collect(),
    };
    let words: Vec<&str> = listed.into_iter().filter(|word| !left_out.iter().any(|out| out == word)).collect();
    // No word is written twice in a row: that takes two at least.
    if words.len() < 2 {
        return Err(OpError::BadChoice("words needed"));
    }
    let start = if filler.classic_start && filler.words == Vocabulary::Latin && left_out.is_empty() { CLASSIC_START } else { &[] };
    let mut writer = Writer { words, dice, last: usize::MAX, start, sentence };

    let blocks: Vec<Block> = match filler.unit {
        Unit::Words => {
            let words: Vec<&str> = (0..filler.count).map(|_| writer.word()).collect();
            vec![Block::Paragraph(sentence_of(&words, &[]))]
        }
        Unit::Sentences => vec![Block::Paragraph((0..filler.count).map(|_| writer.sentence()).collect::<Vec<_>>().join(" "))],
        Unit::Paragraphs => (0..filler.count).map(|_| Block::Paragraph(writer.paragraph())).collect(),
        Unit::Lists => (0..filler.count).map(|_| Block::List(writer.list(items))).collect(),
        Unit::Headings => (0..filler.count).map(|_| Block::Heading(writer.phrase(HEADING))).collect(),
        Unit::Page => {
            let mut blocks = Vec::new();
            for part in 0..filler.count {
                blocks.push(Block::Heading(writer.phrase(HEADING)));
                blocks.push(Block::Paragraph(writer.paragraph()));
                // Every other part has a list; the others a second paragraph.
                if part % 2 == 0 {
                    blocks.push(Block::List(writer.list(items)));
                } else {
                    blocks.push(Block::Paragraph(writer.paragraph()));
                }
            }
            blocks
        }
    };
    let blocks = if filler.limit > 0 { within(blocks, filler.limit) } else { blocks };
    Ok(written(&blocks, filler))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words_in(text: &str) -> usize {
        text.split_whitespace().count()
    }

    fn filler(words: Vocabulary, unit: Unit, count: usize) -> Filler {
        Filler { words, unit, count, ..Filler::default() }
    }

    fn made(filler: &Filler, seed: u64) -> String {
        write(filler, &mut Dice::seeded(seed)).expect("writes")
    }

    #[test]
    fn writes_as_many_words_sentences_or_paragraphs_as_asked() {
        let words = made(&filler(Vocabulary::English, Unit::Words, 25), 1);
        assert_eq!(words_in(&words), 25);
        assert!(words.ends_with('.') && words.chars().next().is_some_and(char::is_uppercase), "{words}");

        let sentences = made(&filler(Vocabulary::Latin, Unit::Sentences, 6), 2);
        assert_eq!(sentences.matches('.').count(), 6);
        assert!(!sentences.contains('\n'));

        let paragraphs = made(&filler(Vocabulary::Romanian, Unit::Paragraphs, 4), 3);
        assert_eq!(paragraphs.split("\n\n").count(), 4);
        for paragraph in paragraphs.split("\n\n") {
            assert!((PARAGRAPH.0..=PARAGRAPH.1).contains(&paragraph.matches('.').count()), "{paragraph}");
        }
    }

    #[test]
    fn shapes_sentences_like_writing() {
        let text = made(&filler(Vocabulary::English, Unit::Sentences, 300), 9);
        for sentence in text.split(". ") {
            let length = words_in(sentence);
            assert!((5..=16).contains(&length), "{sentence}");
            assert!(sentence.chars().next().is_some_and(char::is_uppercase), "{sentence}");
            assert!(!sentence.contains(",,") && !sentence.trim_end_matches('.').ends_with(','), "{sentence}");
        }
        assert!(text.contains(','));
        assert!(!text.contains("  "));
    }

    #[test]
    fn writes_sentences_as_long_as_asked() {
        for (length, fewest, most) in [(SentenceLength::Short, 3, 8), (SentenceLength::Medium, 8, 15), (SentenceLength::Long, 15, 28)] {
            let text = made(&Filler { sentences: length, ..filler(Vocabulary::English, Unit::Sentences, 80) }, 4);
            for sentence in text.split(". ") {
                assert!((fewest..=most).contains(&words_in(sentence)), "{length:?}: {sentence}");
            }
        }
    }

    #[test]
    fn never_writes_a_word_twice_in_a_row() {
        let text = made(&filler(Vocabulary::Latin, Unit::Words, 5000), 4).to_lowercase();
        let words: Vec<&str> = text.trim_end_matches('.').split(' ').collect();
        assert!(words.windows(2).all(|pair| pair[0] != pair[1]));
    }

    #[test]
    fn latin_can_start_with_the_words_it_is_known_by() {
        let classic = |words, unit, count| Filler { classic_start: true, ..filler(words, unit, count) };
        assert!(made(&classic(Vocabulary::Latin, Unit::Paragraphs, 2), 5).starts_with("Lorem ipsum dolor sit amet"));
        assert_eq!(made(&classic(Vocabulary::Latin, Unit::Words, 2), 5), "Lorem ipsum.");
        // Only Latin has such a start.
        assert!(!made(&classic(Vocabulary::English, Unit::Sentences, 1), 5).starts_with("Lorem"));
    }

    #[test]
    fn romanian_is_written_with_its_own_letters() {
        let text = made(&filler(Vocabulary::Romanian, Unit::Paragraphs, 30), 6);
        assert!(text.contains('ă') && text.contains('ș') && text.contains('ț') && text.contains('î'));
        // Never the cedilla forms older keyboards wrote.
        assert!(!text.contains('ş') && !text.contains('ţ'));
    }

    #[test]
    fn writes_lists_headings_and_pages() {
        let lists = made(&Filler { items: 4, ..filler(Vocabulary::English, Unit::Lists, 2) }, 7);
        assert_eq!(lists.split("\n\n").count(), 2);
        assert!(lists.lines().filter(|line| !line.is_empty()).all(|line| line.starts_with("- ")), "{lists}");
        assert_eq!(lists.lines().filter(|line| line.starts_with("- ")).count(), 8);
        let numbered = made(&Filler { items: 3, ordered: true, ..filler(Vocabulary::English, Unit::Lists, 1) }, 7);
        assert!(numbered.starts_with("1. ") && numbered.contains("\n3. "), "{numbered}");

        let headings = made(&filler(Vocabulary::Business, Unit::Headings, 5), 8);
        assert_eq!(headings.split("\n\n").count(), 5);
        assert!(headings.split("\n\n").all(|heading| !heading.ends_with('.') && (2..=6).contains(&words_in(heading))), "{headings}");

        let page = made(&Filler { format: Format::Markdown, level: 3, ..filler(Vocabulary::Food, Unit::Page, 2) }, 9);
        assert_eq!(page.matches("### ").count(), 2);
        assert!(page.contains("\n- "), "{page}");
    }

    #[test]
    fn writes_html_and_json() {
        let html = made(&Filler { format: Format::Html, ordered: true, items: 2, ..filler(Vocabulary::Latin, Unit::Page, 1) }, 3);
        assert!(html.starts_with("<h2>") && html.contains("</h2>\n<p>") && html.contains("<ol>\n  <li>") && html.ends_with("</ol>"), "{html}");
        let json: serde_json::Value = serde_json::from_str(&made(&Filler { format: Format::Json, ..filler(Vocabulary::Latin, Unit::Page, 2) }, 3)).expect("valid JSON");
        let blocks = json["blocks"].as_array().expect("blocks");
        assert_eq!(blocks.len(), 6);
        assert_eq!((blocks[0]["type"].as_str(), blocks[0]["level"].as_u64(), blocks[2]["type"].as_str()), (Some("heading"), Some(2), Some("list")));
        assert_eq!(escaped("a < b & c"), "a &lt; b &amp; c");
    }

    #[test]
    fn stays_within_a_limit_of_characters() {
        for seed in 1..40 {
            let text = made(&Filler { limit: 280, ..filler(Vocabulary::English, Unit::Paragraphs, 5) }, seed);
            assert!(text.chars().count() <= 280, "{} characters", text.chars().count());
            assert!(text.ends_with('.') && !text.ends_with(",."), "{text}");
            assert!(text.chars().count() > 200, "little room is left unused: {text}");
        }
        assert_eq!(cut_to("One two three.", 9), "One two.");
        assert_eq!(cut_to("One two three", 9), "One two");
        assert_eq!(cut_to("Extraordinarily.", 5), "");
    }

    #[test]
    fn uses_the_words_given_and_leaves_out_the_ones_named() {
        let own = made(&Filler { own_words: "Unu, doi\ntrei;  patru unu".into(), ..filler(Vocabulary::Custom, Unit::Words, 60) }, 2).to_lowercase();
        assert!(own.trim_end_matches('.').split(' ').all(|word| ["unu", "doi", "trei", "patru"].contains(&word)), "{own}");
        let without = made(&Filler { leave_out: "ipsum DOLOR".into(), classic_start: true, ..filler(Vocabulary::Latin, Unit::Words, 3000) }, 2).to_lowercase();
        assert!(!without.contains("ipsum") && !without.contains(" dolor "), "the words named are not used, not even at the start");
        assert_eq!(write(&filler(Vocabulary::Custom, Unit::Words, 5), &mut Dice::seeded(1)), Err(OpError::BadChoice("words needed")));
        assert_eq!(write(&Filler { own_words: "unu".into(), ..filler(Vocabulary::Custom, Unit::Words, 5) }, &mut Dice::seeded(1)), Err(OpError::BadChoice("words needed")));
    }

    #[test]
    fn refuses_nothing_and_too_much() {
        assert_eq!(write(&filler(Vocabulary::Latin, Unit::Words, 0), &mut Dice::seeded(1)), Err(OpError::BadChoice("nothing to write")));
        assert_eq!(write(&filler(Vocabulary::Latin, Unit::Paragraphs, 10_000_000), &mut Dice::seeded(1)), Err(OpError::BadChoice("too much to write")));
    }

    #[test]
    fn word_lists_are_plain_words() {
        for list in [LATIN, ENGLISH, ROMANIAN, BUSINESS, FOOD] {
            assert!(list.len() >= 100);
            assert!(list.iter().all(|word| !word.is_empty() && word.chars().all(|letter| letter.is_alphabetic() && letter.is_lowercase())));
            let mut sorted = list.to_vec();
            sorted.sort_unstable();
            sorted.dedup();
            assert_eq!(sorted.len(), list.len(), "a word is listed twice");
        }
    }
}
