//! The order of words as each language has it.
//!
//! Every language sorts its own way: Romanian has ș after s and ț after t,
//! Swedish has å, ä, ö after z, Spanish has ñ after n. The rules are those
//! of Unicode (CLDR), through ICU4X; a language the rules do not know is
//! sorted by the common rules, which are right for most.

use std::cmp::Ordering;

use icu_collator::options::{CollatorOptions, Strength};
use icu_collator::{Collator, CollatorBorrowed};
use icu_locale_core::Locale;

/// Compares texts by the rules of a language.
pub struct Sorter {
    collator: CollatorBorrowed<'static>,
}

impl Sorter {
    /// `language` is a code like `ro` or `pt-BR`; without one (or with one
    /// that is not a language code) the common rules are used. With
    /// `case_sensitive`, a word in small letters comes before the same word
    /// with capitals; without it they are the same. With `numbers`, runs of
    /// digits count as the numbers they write: `file2` before `file10`.
    pub fn new(language: Option<&str>, case_sensitive: bool, numbers: bool) -> Self {
        let wanted = language.map(str::trim).filter(|code| !code.is_empty()).unwrap_or("und");
        let named = |code: &str| format!("{code}{}", if numbers { "-u-kn" } else { "" }).parse::<Locale>().ok();
        let locale = named(wanted).or_else(|| named("und")).unwrap_or(Locale::UNKNOWN);
        let mut options = CollatorOptions::default();
        // Marks on letters always count; the case only when asked.
        options.strength = Some(if case_sensitive { Strength::Tertiary } else { Strength::Secondary });
        let collator = Collator::try_new(locale.into(), options).or_else(|_| Collator::try_new(Default::default(), options)).expect("the common rules of sorting are part of the program");
        Self { collator }
    }

    pub fn compare(&self, one: &str, other: &str) -> Ordering {
        self.collator.compare(one, other)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sorted(words: &[&str], language: Option<&str>, case_sensitive: bool, numbers: bool) -> Vec<String> {
        let sorter = Sorter::new(language, case_sensitive, numbers);
        let mut words: Vec<String> = words.iter().map(|word| (*word).to_owned()).collect();
        words.sort_by(|one, other| sorter.compare(one, other));
        words
    }

    #[test]
    fn sorts_by_the_rules_of_the_language() {
        // In Romanian ș is a letter of its own, after s; by the common rules it is an s with a mark.
        assert_eq!(sorted(&["șarpe", "soare", "sus", "apă", "abur", "zid"], Some("ro"), false, false), ["abur", "apă", "soare", "sus", "șarpe", "zid"]);
        assert_eq!(sorted(&["șarpe", "soare", "sus"], None, false, false), ["șarpe", "soare", "sus"]);
        // Swedish: ä comes after z.
        assert_eq!(sorted(&["zebra", "äpple", "apa"], Some("sv"), false, false), ["apa", "zebra", "äpple"]);
        assert_eq!(sorted(&["zebra", "äpple", "apa"], Some("de"), false, false), ["apa", "äpple", "zebra"]);
    }

    #[test]
    fn counts_the_case_only_when_asked() {
        let same = Sorter::new(None, false, false);
        assert_eq!(same.compare("Apa", "apa"), Ordering::Equal);
        assert_eq!(same.compare("apa", "apă"), Ordering::Less, "a mark on a letter always counts");
        assert_eq!(sorted(&["B", "a", "A", "b"], None, true, false), ["a", "A", "b", "B"]);
    }

    #[test]
    fn counts_numbers_as_numbers_when_asked() {
        assert_eq!(sorted(&["file10", "file2", "file1"], None, false, true), ["file1", "file2", "file10"]);
        assert_eq!(sorted(&["file10", "file2", "file1"], None, false, false), ["file1", "file10", "file2"]);
    }

    #[test]
    fn falls_back_to_the_common_rules() {
        assert_eq!(sorted(&["b", "a"], Some("not a language"), false, false), ["a", "b"]);
        assert_eq!(sorted(&["b", "a"], Some(""), false, false), ["a", "b"]);
    }
}
