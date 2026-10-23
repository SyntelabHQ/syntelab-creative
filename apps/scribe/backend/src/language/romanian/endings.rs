//! Romanian endings that are written with diacritics whatever the word:
//! what is known of a word the list does not have.

/// Words that end like the ones below and are written without diacritics all the same.
const AS_THEY_ARE: &[&str] = &[
    "cutie", "cutia", "cutii", "cutiei", "cutiile", "cutiilor", "partie", "hartie", "bestie", "chestie", "modestie", "amnistie", "dinastie", "poveste", "neveste", "aceste", "proteste", "modeste", "manifeste", "celeste",
    "funeste", "oneste", "contraste", "comand", "recomand", "brand", "stand", "grand", "demand", "command", "husband", "island", "england", "expand", "thousand", "understand", "diamant", "amant", "adamant",
];

/// An ending as it is typed and as it is written; it counts only after one of the letters of `after`.
struct Ending {
    typed: &'static str,
    written: &'static str,
    /// The letters one of which stands before the ending; empty when any does.
    after: &'static str,
    /// The shortest word the ending is trusted in.
    shortest: usize,
}

const fn ending(typed: &'static str, written: &'static str, after: &'static str, shortest: usize) -> Ending {
    Ending { typed, written, after, shortest }
}

/// Longer endings first: the first that fits is the one used.
const ENDINGS: &[Ending] = &[
    // națiune, opțiunea, acțiunilor (not chestiune: s before t).
    ending("tiunilor", "țiunilor", "aeioucnp", 10),
    ending("tiunile", "țiunile", "aeioucnp", 9),
    ending("tiunii", "țiunii", "aeioucnp", 8),
    ending("tiunea", "țiunea", "aeioucnp", 8),
    ending("tiuni", "țiuni", "aeioucnp", 7),
    ending("tiune", "țiune", "aeioucnp", 7),
    // calitățile, activităților, universității.
    ending("itatilor", "ităților", "", 10),
    ending("itatile", "itățile", "", 9),
    ending("itatii", "ității", "", 8),
    ending("itati", "ități", "", 10),
    // informație, poziția, soluțiilor (not simpatie: p before a; not chestie, hârtie).
    ending("tiilor", "țiilor", "aeioucnp", 8),
    ending("tiile", "țiile", "aeioucnp", 7),
    ending("tiei", "ției", "aeioucnp", 6),
    ending("tie", "ție", "aeioucnp", 5),
    ending("tia", "ția", "aeioucnp", 5),
    ending("tii", "ții", "aeioucnp", 6),
    // învățământ, zăcământ (the rest of the word is left as it is typed).
    ending("amantului", "ământului", "", 11),
    ending("amantul", "ământul", "", 9),
    ending("amant", "ământ", "", 7),
    // citește, vorbești, românește.
    ending("este", "ește", "", 7),
    ending("esti", "ești", "", 6),
    // mergând, lucrând.
    ending("and", "ând", "", 6),
];

/// The word with its ending written as Romanian writes it; None when no ending of these fits.
/// `typed` is in small letters, without diacritics.
pub fn with_ending(typed: &str) -> Option<String> {
    if AS_THEY_ARE.contains(&typed) || typed.ends_with("patie") || typed.ends_with("patia") || typed.ends_with("patii") || typed.ends_with("patiei") {
        return None;
    }
    let length = typed.chars().count();
    ENDINGS.iter().find_map(|ending| {
        let stem = typed.strip_suffix(ending.typed)?;
        let fits = length >= ending.shortest && (ending.after.is_empty() || stem.chars().last().is_some_and(|before| ending.after.contains(before)));
        fits.then(|| format!("{stem}{}", ending.written))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_endings_romanian_always_writes_so() {
        for (typed, written) in [
            ("natiune", "națiune"),
            ("optiunea", "opțiunea"),
            ("actiunilor", "acțiunilor"),
            ("informatie", "informație"),
            ("pozitia", "poziția"),
            ("solutiilor", "soluțiilor"),
            ("conditii", "condiții"),
            ("functiei", "funcției"),
            ("calitatile", "calitățile"),
            ("universitatii", "universității"),
            ("posibilitati", "posibilități"),
            ("zacamant", "zacământ"),
            ("porneste", "pornește"),
            ("omenesti", "omenești"),
            ("lucrand", "lucrând"),
            ("sotia", "soția"),
            ("natie", "nație"),
        ] {
            assert_eq!(with_ending(typed).as_deref(), Some(written), "{typed}");
        }
    }

    #[test]
    fn leaves_the_words_that_only_look_so() {
        for typed in ["chestiune", "cutie", "simpatie", "antipatia", "hartie", "modestie", "poveste", "aceste", "brand", "comand", "diamant", "este", "veste", "peste", "tie", "and", "casa", "meditati", "citii"] {
            assert_eq!(with_ending(typed), None, "{typed}");
        }
    }
}
