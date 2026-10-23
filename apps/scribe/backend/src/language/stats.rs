//! What a text is made of: its characters, words, sentences and paragraphs,
//! and the words it uses most.
//!
//! Words and sentences are found by the rules of Unicode for every script
//! (ICU4X): Chinese, Japanese and Thai, written without spaces, are divided
//! into their words too, and "Dr. Smith" is not two sentences where the
//! rules know better.

use std::collections::HashMap;

use icu_segmenter::options::{SentenceBreakInvariantOptions, WordBreakInvariantOptions};
use icu_segmenter::{GraphemeClusterSegmenter, SentenceSegmenter, WordSegmenter};

/// A word or a phrase with how many times the text has it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Counted {
    pub text: String,
    pub count: usize,
}

/// A sentence with how many words it has.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sentence {
    pub text: String,
    pub words: usize,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Stats {
    /// Characters as a reader counts them: a letter with its marks is one, an emoji made of several codes is one.
    pub characters: usize,
    pub characters_without_spaces: usize,
    pub words: usize,
    /// Words that differ from each other, whatever their case.
    pub different_words: usize,
    pub sentences: usize,
    pub paragraphs: usize,
    pub lines: usize,
    /// Letters in a word, on average.
    pub letters_per_word: f64,
    pub words_per_sentence: f64,
    /// The words used most, most used first; words shorter than asked are left out (they are the "the" and "of" of every language).
    pub top_words: Vec<Counted>,
    /// Pairs of words that follow each other, used more than once, most used first.
    pub top_pairs: Vec<Counted>,
    pub longest_sentences: Vec<Sentence>,
    /// Runs of three words, used more than once, most used first.
    pub top_triples: Vec<Counted>,
    /// How much room the text takes when written as UTF-8, in bytes.
    pub bytes: usize,
    /// Syllables, counted as groups of vowels: right for most words of the languages written with Latin, Greek or Cyrillic letters.
    pub syllables: usize,
    /// The longest and the shortest word (the first of them, as it is written), and the shortest sentence.
    pub longest_word: String,
    pub shortest_word: String,
    pub shortest_sentence: Option<Sentence>,
    /// How many words have 1 to 3 letters, 4 to 6, 7 to 9, 10 to 12, and more.
    pub words_by_length: [usize; 5],
    /// How many sentences have up to 10 words, 11 to 20, and more.
    pub sentences_by_length: [usize; 3],
    /// How many sentences end as a question, and as an exclamation; the rest are statements.
    pub questions: usize,
    pub exclamations: usize,
}

/// True for a letter that is a vowel in the alphabets written with vowels: what a syllable is built around.
fn is_vowel(letter: char) -> bool {
    use unicode_normalization::UnicodeNormalization;
    // The letter under its marks: é is e, ă is a.
    let base = std::iter::once(letter).nfd().next().unwrap_or(letter);
    matches!(base.to_lowercase().next().unwrap_or(base), 'a' | 'e' | 'i' | 'o' | 'u' | 'y' | 'æ' | 'ø' | 'œ' | 'α' | 'ε' | 'η' | 'ι' | 'ο' | 'υ' | 'ω' | 'а' | 'е' | 'ё' | 'и' | 'о' | 'у' | 'ы' | 'э' | 'ю' | 'я' | 'і' | 'ї' | 'є')
}

/// The syllables of a word, counted as its groups of vowels; a word with letters has at least one.
pub fn syllables_of(word: &str) -> usize {
    let mut groups = 0;
    let mut in_group = false;
    for letter in word.chars() {
        let vowel = is_vowel(letter);
        groups += usize::from(vowel && !in_group);
        in_group = vowel;
    }
    groups.max(usize::from(word.chars().any(char::is_alphabetic)))
}

/// How much of the text is asked for beside the counts.
#[derive(Debug, Clone, Copy)]
pub struct Wanted {
    /// How many of the most used words and pairs.
    pub top: usize,
    /// The shortest word that counts among the most used, in letters.
    pub min_letters: usize,
    /// How many of the longest sentences.
    pub longest: usize,
}

impl Default for Wanted {
    fn default() -> Self {
        Self { top: 15, min_letters: 4, longest: 3 }
    }
}

/// The most counted of `counts`, most first; ties in the order of the alphabet, so the answer is always the same.
fn top_of(counts: HashMap<String, usize>, top: usize, at_least: usize) -> Vec<Counted> {
    let mut counted: Vec<Counted> = counts.into_iter().filter(|(_, count)| *count >= at_least).map(|(text, count)| Counted { text, count }).collect();
    counted.sort_by(|one, other| other.count.cmp(&one.count).then_with(|| one.text.cmp(&other.text)));
    counted.truncate(top);
    counted
}

pub fn measure(text: &str, wanted: Wanted) -> Stats {
    if text.is_empty() {
        return Stats::default();
    }

    // Characters.
    let graphemes: Vec<usize> = GraphemeClusterSegmenter::new().segment_str(text).collect();
    let characters = graphemes.len().saturating_sub(1);
    let characters_without_spaces = graphemes.windows(2).filter(|ends| !text[ends[0]..ends[1]].chars().all(char::is_whitespace)).count();

    // Words, each with where it is, and whether only spaces stand between it and the one before.
    let segmenter = WordSegmenter::new_auto(WordBreakInvariantOptions::default());
    let mut words: Vec<(usize, usize)> = Vec::new();
    let mut follows_directly: Vec<bool> = Vec::new();
    let mut start = 0;
    let mut only_spaces_since_word = false;
    for (end, kind) in segmenter.segment_str(text).iter_with_word_type() {
        if end == 0 {
            continue;
        }
        if kind.is_word_like() {
            follows_directly.push(!words.is_empty() && only_spaces_since_word);
            words.push((start, end));
            only_spaces_since_word = true;
        } else if !text[start..end].chars().all(|letter| letter.is_whitespace() && letter != '\n') {
            // A mark of punctuation or a new line between two words: they are not a pair.
            only_spaces_since_word = false;
        }
        start = end;
    }

    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut pairs: HashMap<String, usize> = HashMap::new();
    let mut triples: HashMap<String, usize> = HashMap::new();
    let mut letters = 0;
    let mut syllables = 0;
    let mut words_by_length = [0usize; 5];
    let (mut longest_word, mut shortest_word) = (String::new(), String::new());
    let mut previous: Option<String> = None;
    // The word before the one before, when nothing but spaces parts the three.
    let mut before_previous: Option<String> = None;
    for (index, (from, to)) in words.iter().enumerate() {
        let written = &text[*from..*to];
        let word = written.to_lowercase();
        let length = word.chars().count();
        letters += length;
        syllables += syllables_of(&word);
        words_by_length[match length {
            0..=3 => 0,
            4..=6 => 1,
            7..=9 => 2,
            10..=12 => 3,
            _ => 4,
        }] += 1;
        if length > longest_word.chars().count() {
            longest_word = written.to_owned();
        }
        if shortest_word.is_empty() || length < shortest_word.chars().count() {
            shortest_word = written.to_owned();
        }
        if !follows_directly[index] {
            (previous, before_previous) = (None, None);
        }
        if let Some(before) = &previous {
            *pairs.entry(format!("{before} {word}")).or_default() += 1;
            if let Some(first) = &before_previous {
                *triples.entry(format!("{first} {before} {word}")).or_default() += 1;
            }
        }
        *counts.entry(word.clone()).or_default() += 1;
        before_previous = previous.take();
        previous = Some(word);
    }
    let different_words = counts.len();
    let long_enough: HashMap<String, usize> = counts.into_iter().filter(|(word, _)| word.chars().count() >= wanted.min_letters).collect();

    // Sentences: what the rules divide the text into, where there is at least a word.
    let ends: Vec<usize> = SentenceSegmenter::new(SentenceBreakInvariantOptions::default()).segment_str(text).collect();
    let mut sentences: Vec<Sentence> = Vec::new();
    let mut next_word = 0;
    for bounds in ends.windows(2) {
        let mut inside = 0;
        while next_word < words.len() && words[next_word].0 < bounds[1] {
            inside += 1;
            next_word += 1;
        }
        if inside > 0 {
            sentences.push(Sentence { text: text[bounds[0]..bounds[1]].split_whitespace().collect::<Vec<_>>().join(" "), words: inside });
        }
    }
    let sentence_count = sentences.len();
    let mut sentences_by_length = [0usize; 3];
    let (mut questions, mut exclamations) = (0, 0);
    for sentence in &sentences {
        sentences_by_length[match sentence.words {
            0..=10 => 0,
            11..=20 => 1,
            _ => 2,
        }] += 1;
        // What a sentence ends with, past the quotation marks and brackets that may close it.
        match sentence.text.trim_end_matches(|letter: char| !letter.is_alphanumeric() && !matches!(letter, '?' | '!' | '؟' | '？' | '！' | ';')).chars().last() {
            Some('?' | '؟' | '？') => questions += 1,
            Some('!' | '！') => exclamations += 1,
            _ => {}
        }
    }
    let shortest_sentence = sentences.iter().min_by_key(|sentence| sentence.words).cloned();
    sentences.sort_by_key(|sentence| std::cmp::Reverse(sentence.words));
    sentences.truncate(wanted.longest);

    let ratio = |part: usize, whole: usize| if whole == 0 { 0.0 } else { part as f64 / whole as f64 };
    Stats {
        characters,
        characters_without_spaces,
        words: words.len(),
        different_words,
        sentences: sentence_count,
        paragraphs: text.split('\n').fold((0, false), |(count, inside), line| if line.trim().is_empty() { (count, false) } else { (count + usize::from(!inside), true) }).0,
        lines: text.split('\n').count(),
        letters_per_word: ratio(letters, words.len()),
        words_per_sentence: ratio(words.len(), sentence_count),
        top_words: top_of(long_enough, wanted.top, 1),
        top_pairs: top_of(pairs, wanted.top, 2),
        longest_sentences: sentences,
        top_triples: top_of(triples, wanted.top, 2),
        bytes: text.len(),
        syllables,
        longest_word,
        shortest_word,
        shortest_sentence,
        words_by_length,
        sentences_by_length,
        questions,
        exclamations,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stats(text: &str) -> Stats {
        measure(text, Wanted::default())
    }

    #[test]
    fn counts_what_a_text_is_made_of() {
        let counted = stats("Ana are mere. Ana are și pere!\n\nAl doilea paragraf, mai scurt.\n");
        assert_eq!((counted.words, counted.sentences, counted.paragraphs, counted.lines), (12, 3, 2, 4));
        assert_eq!(counted.different_words, 10);
        assert_eq!(stats("").words, 0);
        assert_eq!(stats("   \n ").paragraphs, 0);
    }

    #[test]
    fn counts_characters_as_a_reader_does() {
        // A letter written as a letter and a mark is one; so is a family made of four people.
        let counted = stats("a\u{326} 👨‍👩‍👧‍👦 é");
        assert_eq!((counted.characters, counted.characters_without_spaces), (5, 3));
    }

    #[test]
    fn finds_words_in_scripts_written_without_spaces() {
        // "I am a student." in Japanese; "Hello world" in Thai.
        assert!(stats("私は学生です。").words >= 3);
        assert!(stats("สวัสดีชาวโลก").words >= 2);
        // Words of other alphabets, and words with an apostrophe or a hyphen inside.
        assert_eq!(stats("Привет, мир! don't well-known").words, 4 + usize::from(stats("well-known").words == 2));
    }

    #[test]
    fn says_which_words_and_pairs_are_used_most() {
        let counted = stats("The quick fox. The quick dog! A quick fox, the Quick cat.");
        assert_eq!(counted.top_words.first(), Some(&Counted { text: "quick".to_owned(), count: 4 }));
        // Short words are left out of the most used; "fox" has three letters.
        assert!(counted.top_words.iter().all(|word| word.text.chars().count() >= 4));
        assert_eq!(counted.top_pairs.first(), Some(&Counted { text: "the quick".to_owned(), count: 3 }));
        // A full stop stands between "fox" and "The": they are not a pair.
        assert!(counted.top_pairs.iter().all(|pair| pair.text != "fox the"));
    }

    #[test]
    fn counts_syllables_as_groups_of_vowels() {
        for (word, syllables) in [("casa", 2), ("înțelepciune", 5), ("the", 1), ("rhythm", 1), ("beautiful", 3), ("școală", 2), ("привет", 2), ("ελληνικά", 4), ("123", 0), ("brr", 1)] {
            assert_eq!(syllables_of(word), syllables, "{word}");
        }
        assert_eq!(stats("Ana are mere.").syllables, 6);
    }

    #[test]
    fn says_more_of_the_words_and_the_sentences() {
        let counted = stats("Vine? Da! Extraordinar de frumos este aici, în grădina aceasta mare și veche a bunicilor mei de la țară, vara.\nUnu doi trei. Unu doi trei patru. Unu doi trei.");
        assert_eq!((counted.questions, counted.exclamations, counted.sentences), (1, 1, 6));
        assert_eq!(counted.sentences_by_length, [5, 1, 0]);
        assert_eq!((counted.longest_word.as_str(), counted.shortest_word.as_str()), ("Extraordinar", "a"));
        assert_eq!(counted.shortest_sentence.as_ref().map(|sentence| sentence.words), Some(1));
        assert_eq!(counted.top_triples.first(), Some(&Counted { text: "unu doi trei".to_owned(), count: 3 }));
        assert_eq!(counted.words_by_length.iter().sum::<usize>(), counted.words);
        assert_eq!(stats("aé").bytes, 3);
    }

    #[test]
    fn gives_the_longest_sentences_and_the_averages() {
        // A new line ends a sentence too, so the third one is kept on a line.
        let counted = stats("One. Two words here now.   Three   words.");
        assert_eq!(counted.longest_sentences.first(), Some(&Sentence { text: "Two words here now.".to_owned(), words: 4 }));
        assert!((counted.words_per_sentence - 7.0 / 3.0).abs() < 1e-9);
        assert!(counted.letters_per_word > 3.0 && counted.letters_per_word < 5.0);
    }
}
