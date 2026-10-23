//! Generators: tools that write a text instead of changing one.
//!
//! What they give is put where the cursor is. Everything is made on this
//! machine, from the randomness of the operating system.

pub mod dice;
pub mod filler;
pub mod random;
pub mod sample;
mod words;

use serde::Deserialize;

pub use dice::Dice;
pub use filler::{Filler, Unit, Vocabulary};
pub use random::Alphabet;
pub use sample::Sample;

use crate::ops::OpError;

/// The longest text a generator gives, in characters: a slip in a count does not fill the memory.
pub const MOST_CHARACTERS: usize = 50_000_000;

/// One generator with its choices, as the interface asks for it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Generator {
    /// Text that means nothing, to see how a page looks when it is full (`filler`).
    FillerText(Filler),
    /// Made-up names, addresses, dates and numbers, or lines after a pattern (`sample`).
    SampleData(Sample),
    /// Characters picked at random, on one line or on many.
    #[serde(rename_all = "camelCase")]
    RandomText {
        #[serde(default)]
        what: Alphabet,
        #[serde(default = "sixteen")]
        length: usize,
        #[serde(default = "one")]
        lines: usize,
        /// Leaves out the characters easily taken for one another: 0 and O, 1, l and I.
        #[serde(default)]
        no_lookalikes: bool,
    },
}

fn one() -> usize {
    1
}
fn sixteen() -> usize {
    16
}

/// Writes what a generator is asked for.
pub fn make(generator: &Generator, dice: &mut Dice) -> Result<String, OpError> {
    match generator {
        // With a seed the result is the same every time: for what is tried again, never for what must stay secret.
        // A seed of nothing is no seed: that is how the interface says "any".
        Generator::FillerText(filler) => match filler.seed.filter(|seed| *seed != 0) {
            Some(seed) => filler::write(filler, &mut Dice::seeded(seed)),
            None => filler::write(filler, dice),
        },
        Generator::SampleData(sample) => match sample.seed.filter(|seed| *seed != 0) {
            Some(seed) => sample::write(sample, &mut Dice::seeded(seed)),
            None => sample::write(sample, dice),
        },
        Generator::RandomText { what, length, lines, no_lookalikes } => random::write(*what, *length, *lines, *no_lookalikes, dice),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_generators_as_the_interface_writes_them() {
        let filler: Generator = serde_json::from_value(json!({ "kind": "fillerText", "words": "romanian", "unit": "sentences", "count": 2, "classicStart": true })).expect("a generator");
        assert!(matches!(filler, Generator::FillerText(Filler { words: Vocabulary::Romanian, unit: Unit::Sentences, count: 2, classic_start: true, items: 5, level: 2, .. })));
        let sample: Generator = serde_json::from_value(json!({ "kind": "sampleData", "what": "emails", "region": "english" })).expect("a generator");
        assert!(matches!(sample, Generator::SampleData(Sample { count: 10, .. })));
        // The same seed, the same text.
        let seeded: Generator = serde_json::from_value(json!({ "kind": "fillerText", "seed": 7 })).expect("a generator");
        assert_eq!(make(&seeded, &mut Dice::system()), make(&seeded, &mut Dice::system()));
        let random: Generator = serde_json::from_value(json!({ "kind": "randomText" })).expect("a generator");
        assert!(matches!(random, Generator::RandomText { what: Alphabet::Password, length: 16, lines: 1, no_lookalikes: false }));
        assert!(serde_json::from_value::<Generator>(json!({ "kind": "nothing" })).is_err());
    }
}
