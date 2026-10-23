//! Romanian typed without diacritics, written with them again.
//!
//! Built here from nothing: a list of words written by hand (`words.txt`),
//! the endings Romanian always writes with diacritics (`endings`), and the
//! neighbours of the few words that can be read in more than one way
//! (`context`). A word is changed only when one reading is left; the others
//! are given back as doubtful, for a person to settle. Words the list does
//! not have are left as they are: this is not a dictionary of the language.

pub mod context;
pub mod endings;
pub mod lexicon;

use context::Around;
use lexicon::{has_diacritics, lexicon, plain};

/// A word that can be read in more than one way, and was not settled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Doubt {
    /// Where the word is in the text given back, in UTF-16 units (as the editor counts).
    pub from: usize,
    pub to: usize,
    /// The ways it can be written, the likelier first, in the capitals it was typed with.
    pub choices: Vec<String>,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Restored {
    pub text: String,
    /// How many words were written with their diacritics.
    pub changed: usize,
    pub doubtful: Vec<Doubt>,
}

/// A word of the text, with what is needed to look around it.
struct Word<'a> {
    /// Where it starts and ends in the text, in bytes.
    start: usize,
    end: usize,
    written: &'a str,
    typed: String,
    /// What lies between it and the word before: only spaces, a hyphen, or something that parts them.
    gap: Gap,
    /// It is the first word of a sentence: its capital says nothing about it.
    first: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Gap {
    Spaces,
    Hyphen,
    /// A mark, a new line, the start of the text: the words do not read together.
    Break,
}

fn words_of(text: &str) -> Vec<Word<'_>> {
    let mut words = Vec::new();
    let mut gap = Gap::Break;
    let mut first = true;
    let mut letters = text.char_indices().peekable();
    while let Some((start, letter)) = letters.next() {
        if !letter.is_alphabetic() {
            first = first || matches!(letter, '.' | '!' | '?' | '…' | '\n');
            gap = match (gap, letter) {
                (Gap::Break, _) => Gap::Break,
                (_, ' ' | '\t' | '\u{a0}') => gap,
                (Gap::Spaces, '-') if start > 0 && !text[..start].ends_with(' ') => Gap::Hyphen,
                _ => Gap::Break,
            };
            continue;
        }
        let mut end = start + letter.len_utf8();
        while let Some((at, next)) = letters.peek().copied().filter(|(_, next)| next.is_alphabetic()) {
            end = at + next.len_utf8();
            letters.next();
        }
        let written = &text[start..end];
        words.push(Word { start, end, written, typed: plain(written), gap, first });
        gap = Gap::Spaces;
        first = false;
    }
    words
}

/// A form in small letters, written with the capitals the word was typed with. Both have as many letters.
fn in_the_capitals_of(typed: &str, form: &str) -> String {
    typed.chars().zip(form.chars()).flat_map(|(was, letter)| if was.is_uppercase() { letter.to_uppercase().collect::<Vec<_>>() } else { vec![letter] }).collect()
}

/// Writes Romanian diacritics where the words are known. With `guess`, a doubtful word takes its likelier reading too.
pub fn restore(text: &str, guess: bool) -> Restored {
    let words = words_of(text);
    let known = lexicon();
    let mut restored = String::with_capacity(text.len() + text.len() / 16);
    let mut changed = 0;
    let mut doubtful = Vec::new();
    let mut copied = 0;
    // Where the text given back has got to, as the editor counts.
    let mut units = 0;
    for (index, word) in words.iter().enumerate() {
        let between = &text[copied..word.start];
        restored.push_str(between);
        units += between.encode_utf16().count();
        copied = word.end;

        let next = words.get(index + 1).filter(|next| next.gap != Gap::Break);
        let around = Around {
            before: (word.gap != Gap::Break && index > 0).then(|| words[index - 1].typed.as_str()),
            after: next.map(|next| next.typed.as_str()),
            tied_to_next: next.is_some_and(|next| next.gap == Gap::Hyphen),
        };
        let length = word.written.encode_utf16().count();
        // A word already written with diacritics is someone's choice: it stays.
        let written = if has_diacritics(word.written) {
            None
        } else if let Some(readings) = known.get(&word.typed) {
            let settled = if readings.forms.len() == 1 { Some(0) } else { context::settle(&word.typed, readings, around) };
            match settled.or(guess.then_some(0)) {
                Some(place) => Some(in_the_capitals_of(word.written, &readings.forms[place])),
                None => {
                    doubtful.push(Doubt { from: units, to: units + length, choices: readings.forms.iter().map(|form| in_the_capitals_of(word.written, form)).collect() });
                    None
                }
            }
        } else {
            // A name inside a sentence is not a word to guess the ending of: Ferdinand, Thailand.
            let name = !word.first && word.written.chars().next().is_some_and(char::is_uppercase);
            (!name).then(|| endings::with_ending(&word.typed)).flatten().map(|form| in_the_capitals_of(word.written, &form))
        };
        match written {
            Some(written) if written != word.written => {
                changed += 1;
                restored.push_str(&written);
            }
            _ => restored.push_str(word.written),
        }
        units += length;
    }
    restored.push_str(&text[copied..]);
    Restored { text: restored, changed, doubtful }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sure(text: &str) -> String {
        restore(text, false).text
    }

    #[test]
    fn writes_the_words_that_have_one_reading() {
        assert_eq!(sure("Si in tara veche"), "Și în tara veche", "tara could be țara or țară: left for a person");
        assert_eq!(sure("Si in tara aceea"), "Și în țara aceea");
        assert_eq!(sure("Astazi nu stiu daca vine cineva pana maine."), "Astăzi nu știu dacă vine cineva până mâine.");
        assert_eq!(sure("BUCURESTI este capitala Romaniei"), "BUCUREȘTI este capitala României");
        assert_eq!(sure("Informatiile despre situatia natiunii"), "Informațiile despre situația națiunii");
        assert_eq!(sure("Vorbeste incet, mergand spre padure."), "Vorbește încet, mergând spre pădure.");
    }

    #[test]
    fn settles_by_the_neighbours_where_they_are_enough() {
        assert_eq!(sure("Vreau sa-mi spui ca vii."), "Vreau să-mi spui ca vii.", "ca after spui: not known");
        assert_eq!(sure("Cred ca da. Pentru ca sa stii."), "Cred că da. Pentru ca să știi.");
        assert_eq!(sure("Va rog sa veniti. Nu va ploua."), "Vă rog să veniți. Nu va ploua.");
        assert_eq!(sure("Locuiesc intr-o casa mare, la tara."), "Locuiesc într-o casă mare, la țară.");
        assert_eq!(sure("Casa mea este in oras."), "Casa mea este în oraș.");
    }

    #[test]
    fn gives_back_the_doubtful_words_with_their_readings() {
        let restored = restore("Fata are o carte. Vine si mama.", false);
        assert_eq!(restored.text, "Fata are o carte. Vine și mama.");
        assert_eq!(restored.changed, 1);
        assert_eq!(restored.doubtful.len(), 2);
        assert_eq!(restored.doubtful[0], Doubt { from: 0, to: 4, choices: vec!["Fata".into(), "Fată".into(), "Fața".into(), "Față".into()] });
        assert_eq!((restored.doubtful[1].from, restored.doubtful[1].to), (26, 30));
        assert_eq!(restored.doubtful[1].choices, ["mama", "mamă"]);
    }

    #[test]
    fn counts_places_as_the_editor_does() {
        // 😀 takes two units in the editor; ă takes one.
        let restored = restore("😀 fără, tata", false);
        assert_eq!(restored.doubtful[0].from, 9);
        let units: Vec<u16> = restored.text.encode_utf16().collect();
        assert_eq!(String::from_utf16_lossy(&units[9..13]), "tata");
    }

    #[test]
    fn guesses_only_when_asked() {
        let guessed = restore("O fata vede ca ploua.", true);
        assert!(guessed.doubtful.is_empty());
        assert_eq!(guessed.text, "O fata vede că ploua.", "fata has more than two readings: the likelier is taken");
    }

    #[test]
    fn leaves_what_is_already_written_and_what_it_does_not_know() {
        assert_eq!(sure("Țara mea, ţara ta"), "Țara mea, ţara ta");
        assert_eq!(sure("Hello world, Ferdinand si Thailand"), "Hello world, Ferdinand și Thailand");
        assert_eq!(sure(""), "");
        let same = "Mere, pere, prune: toate bune.";
        assert_eq!(restore(same, false), Restored { text: same.to_owned(), changed: 0, doubtful: Vec::new() });
    }

    #[test]
    fn keeps_the_text_as_long_as_it_was() {
        let typed = "Maine dimineata, cand rasare soarele, plecam spre munti cu fratii.";
        let restored = restore(typed, true);
        assert_eq!(restored.text.encode_utf16().count(), typed.encode_utf16().count());
        assert_eq!(restored.text, "Mâine dimineața, când răsare soarele, plecam spre munți cu frații.");
    }

    #[test]
    fn restores_a_letter_as_people_write_them() {
        let typed = "Buna ziua! Va scriu pentru ca as dori sa aflu mai multe informatii despre oferta dumneavoastra. Am vazut ca aveti preturi bune si ca livrati in toata tara. Sotia mea si cu mine cautam o masina noua pentru familie, iar baiatul nostru incepe scoala in toamna. Va multumesc si astept raspunsul dumneavoastra cat mai curand.";
        let restored = restore(typed, false);
        assert_eq!(
            restored.text,
            "Bună ziua! Vă scriu pentru că aș dori să aflu mai multe informații despre oferta dumneavoastră. Am văzut că aveți prețuri bune și ca livrați în toată țara. Soția mea și cu mine căutăm o mașină noua pentru familie, iar băiatul nostru începe scoala în toamnă. Vă mulțumesc și aștept răspunsul dumneavoastră cât mai curând."
        );
        let doubtful: Vec<&str> = restored.doubtful.iter().map(|doubt| doubt.choices[0].as_str()).collect();
        assert_eq!(doubtful, ["oferta", "că", "nouă", "școala"]);
        // The likelier readings are the right ones here.
        let guessed = restore(typed, true).text;
        assert!(guessed.contains("și că livrați") && guessed.contains("o mașină nouă") && guessed.contains("începe școala"), "{guessed}");
    }
}
