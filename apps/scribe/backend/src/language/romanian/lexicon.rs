//! The Romanian words Scribe knows how to write: read once from `words.txt`.

use std::collections::HashMap;
use std::sync::OnceLock;

/// The ways a word typed without diacritics can be written.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Readings {
    /// Each right way to write it, in the order the list gives them: the likelier first.
    pub forms: Vec<String>,
}

impl Readings {
    /// The two forms of a feminine word that differ only in their last letter (casa, casă): which is which.
    pub fn with_and_without_article(&self) -> Option<(usize, usize)> {
        let without = self.forms.iter().position(|form| form.ends_with('ă'))?;
        let stem = self.forms[without].strip_suffix('ă')?;
        let with = self.forms.iter().position(|form| form.strip_suffix('a') == Some(stem))?;
        Some((with, without))
    }
}

/// A letter without its Romanian mark; the letter itself when it has none.
pub fn plain_letter(letter: char) -> char {
    match letter {
        'ă' | 'â' => 'a',
        'î' => 'i',
        'ș' | 'ş' => 's',
        'ț' | 'ţ' => 't',
        'Ă' | 'Â' => 'A',
        'Î' => 'I',
        'Ș' | 'Ş' => 'S',
        'Ț' | 'Ţ' => 'T',
        other => other,
    }
}

/// A word as it is typed without diacritics, in small letters: what the list is looked up by.
pub fn plain(word: &str) -> String {
    word.chars().map(plain_letter).flat_map(char::to_lowercase).collect()
}

/// True for a word that is written with at least one Romanian diacritic.
pub fn has_diacritics(word: &str) -> bool {
    word.chars().any(|letter| plain_letter(letter) != letter)
}

/// The ways the words of the list can be written, by how they are typed without diacritics.
pub fn lexicon() -> &'static HashMap<String, Readings> {
    static LEXICON: OnceLock<HashMap<String, Readings>> = OnceLock::new();
    LEXICON.get_or_init(|| read(include_str!("words.txt")))
}

/// Reads a list written as `words.txt` says at its top.
fn read(list: &str) -> HashMap<String, Readings> {
    let mut words: HashMap<String, Readings> = HashMap::new();
    let mut add = |form: String| {
        let readings = words.entry(plain(&form)).or_default();
        if !readings.forms.contains(&form) {
            readings.forms.push(form);
        }
    };
    for line in list.lines().filter(|line| !line.starts_with('#')) {
        for entry in line.split_whitespace() {
            for written in entry.split('=').filter(|written| !written.is_empty()) {
                let written = written.to_lowercase();
                // A mark after a word ending in ă: its form ending in a is right too; for a noun (~) it is the likelier.
                let noun = written.ends_with('~');
                match written.strip_suffix(['~', '^']) {
                    Some(word) => {
                        let with_article = word.strip_suffix('ă').map(|stem| format!("{stem}a"));
                        if noun {
                            with_article.clone().into_iter().for_each(&mut add);
                        }
                        add(word.to_owned());
                        if !noun {
                            with_article.into_iter().for_each(&mut add);
                        }
                    }
                    None => add(written),
                }
            }
        }
    }
    // A word that is only ever written without diacritics is no business of the list.
    words.retain(|_, readings| readings.forms.iter().any(|form| has_diacritics(form)));
    words
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_marks_of_the_list() {
        let words = read("# a note\nși casă~ să=sa =peste pește mare=mare cântă^");
        assert_eq!(words["si"].forms, ["și"]);
        assert_eq!(words["casa"].forms, ["casa", "casă"]);
        assert_eq!(words["sa"].forms, ["să", "sa"]);
        assert_eq!(words["peste"].forms, ["peste", "pește"], "the likelier reading is the one written first");
        assert_eq!(words["canta"].forms, ["cântă", "cânta"]);
        assert!(!words.contains_key("mare"));
        assert_eq!(words["casa"].with_and_without_article(), Some((0, 1)));
        assert_eq!(words["sa"].with_and_without_article(), Some((1, 0)));
        assert_eq!(words["si"].with_and_without_article(), None);
    }

    #[test]
    fn the_list_is_sound() {
        let words = lexicon();
        assert!(words.len() > 1200, "{}", words.len());
        for (typed, readings) in words {
            assert!(typed.chars().all(|letter| letter.is_alphabetic() && !has_diacritics(&letter.to_string())), "{typed}");
            for form in &readings.forms {
                assert_eq!(&plain(form), typed);
                assert!(!form.contains(['ş', 'ţ']), "{form} is written with a cedilla");
            }
        }
        // Words that could be read in more than one way are known as such.
        assert_eq!(words["fata"].forms.len(), 4);
        assert_eq!(words["rau"].forms, ["râu", "rău"]);
        assert_eq!(words["tara"].forms, ["țara", "țară"]);
        assert_eq!(words["fara"].forms, ["fără"]);
    }
}
