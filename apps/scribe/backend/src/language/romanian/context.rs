//! Words that can be read in more than one way, told apart by their neighbours
//! where the neighbours are enough.

use super::lexicon::Readings;

/// What stands around a word, as typed without diacritics, in small letters.
#[derive(Debug, Default, Clone, Copy)]
pub struct Around<'a> {
    /// The word before, when nothing but spaces (or a hyphen) lies between.
    pub before: Option<&'a str>,
    /// The word after, when nothing but spaces (or a hyphen) lies between.
    pub after: Option<&'a str>,
    /// A hyphen ties the word to the one after it: să-mi, că-i.
    pub tied_to_next: bool,
}

/// After these a feminine word has no article: în casă, o casă.
const BEFORE_NO_ARTICLE: &[&str] = &["in", "la", "pe", "de", "din", "prin", "fara", "pentru", "spre", "sub", "catre", "langa", "dupa", "pana", "peste", "intr", "dintr", "printr"];
/// After these it never has one, whatever follows.
const ALWAYS_NO_ARTICLE: &[&str] = &["o", "nicio", "vreo", "orice", "fiecare", "cate"];
/// Before these it has one: casa mea, casa aceasta. (Not "sa": la piață să cumpere.)
const AFTER_ARTICLE: &[&str] = &["mea", "ta", "lui", "ei", "noastra", "voastra", "lor", "aceasta", "aceea", "asta", "aia", "cea"];
/// Words that only join what is around them: after a preposition and a feminine word, they change nothing.
const JOINING: &[&str] = &["si", "sau", "dar", "iar", "ori", "nici"];

/// After these "ca" is "că": pentru că, faptul că.
const BEFORE_CA_CONJUNCTION: &[&str] = &["pentru", "faptul", "spune", "spus", "spun", "zis", "zice", "zic", "cred", "crede", "credem", "stiu", "stie", "stim", "sigur", "fie", "doar", "numai", "asa", "astfel", "dat", "inseamna", "pare", "vad", "vede", "aflat", "cum", "decat", "desi", "incat", "fiindca", "bine", "adevarat", "evident", "vazut", "auzit", "inteles", "inteleg", "intelege", "intelegem", "aflam", "stiam", "stia", "spunea", "zicea", "parea", "credeam", "credea", "sper", "speram", "banuiesc", "observat", "constatat", "aratat", "demonstrat", "mentionat", "precizat", "declarat", "anuntat", "afirmat", "consider", "presupun", "stiut", "simt", "simtit"];
/// Before these "ca" is "ca": ca să, ca și, ca un.
const AFTER_CA_COMPARISON: &[&str] = &["sa", "si", "un", "o", "pe", "la", "in", "de", "din", "niste", "atare", "urmare", "mine", "tine", "el", "ea", "noi", "voi", "ei", "ele", "nimeni", "orice", "oricare", "toti", "toate", "intotdeauna", "niciodata", "acum", "atunci", "aici", "inainte", "alta"];
/// After these "sa" is "să" although they end in a.
const BEFORE_SA_VERB: &[&str] = &["ca", "vrea", "putea", "trebuia", "incerca", "urma", "avea", "da", "va", "voia", "dorea", "stia", "fara", "inca", "pana", "asa", "doar", "sta", "astepta", "parea", "incepea", "incepuse"];
/// Before these "sa" is "să": the small words that stand between it and its verb, and the verbs most said so.
const AFTER_SA_VERB: &[&str] = &["nu", "se", "mai", "ma", "te", "il", "o", "ii", "le", "ne", "va", "fie", "fi", "aiba", "am", "ai", "avem", "aveti", "fac", "faci", "faca", "facem", "faceti", "fim", "fiu", "fii", "fiti", "stiu", "stii", "stie", "stim", "vin", "vii", "vina", "venim", "merg", "mergi", "mearga", "mergem", "pot", "poti", "poata", "putem", "dau", "dai", "dea", "dam", "iau", "iei", "ia", "luam", "spun", "spui", "spuna", "spunem", "vad", "vezi", "vada", "vedem", "cumpar", "cumperi", "cumpere", "plec", "pleci", "plece", "plecam", "stau", "stai", "stea", "zic", "zici", "zica", "cred", "crezi", "creada", "lucrez", "lucreze", "invat", "inveti", "invete", "invatam", "inteleg", "intelegi", "inteleaga", "intelegem", "scriu", "scrii", "scrie", "citesc", "citesti", "citeasca", "ajung", "ajungi", "ajunga", "ramana", "raman", "gasesc", "gaseasca", "caut", "caute", "incep", "inceapa", "incerc", "incerce", "aflu", "afle", "aduc", "aduca", "pun", "pui", "puna", "trec", "treaca", "vorbesc", "vorbeasca", "astept", "astepte", "primesc", "primeasca", "trimit", "trimita", "folosesc", "foloseasca", "devina", "existe", "para", "trebuiasca", "vrea", "vreau", "vrei", "doresc", "doreasca", "ajut", "ajute", "joc", "joace", "mananc", "manance", "beau", "bea", "dorm", "doarma", "traiesc", "traiasca", "moara", "creasca", "tina", "tin", "las", "lase", "uit", "uite", "simt", "simta", "aud", "auda", "deschid", "deschida", "inchid", "inchida", "platesc", "plateasca", "vand", "vanda"];
/// After these "va" is the "va" of the future.
const BEFORE_VA_FUTURE: &[&str] = &["nu", "se", "o", "ma", "te", "il", "ii", "le", "ne", "isi", "imi", "iti", "care", "ce", "cine", "el", "ea", "acesta", "aceasta", "cand", "daca", "cum", "unde", "ca", "si", "mai"];
/// Before these "va" is "vă": vă rog, vă mulțumesc.
const AFTER_VA_YOU: &[&str] = &["rog", "multumesc", "multumim", "rugam", "spun", "spunem", "salut", "doresc", "dorim", "invit", "invitam", "asteptam", "astept", "anuntam", "anunt", "informam", "informez", "trimit", "trimitem", "place", "pot", "puteti", "veti", "ati", "va", "rugati", "ganditi", "prezint", "prezentam", "ofer", "oferim", "recomand", "recomandam", "aduc", "amintesc", "amintiti", "uitati", "felicit", "scriu", "scriem", "contactez", "contactam", "intreb", "intrebam", "sun", "caut", "vad", "aud", "cred", "inteleg", "iubesc", "pup", "imbratisez", "las", "dau", "cer", "explic", "arat", "povestesc", "raspund", "ajut", "ajutam", "stau", "tin", "fac", "poftim"];
/// After these "tine" is "tine" (you): pe tine, cu tine.
const BEFORE_TINE_YOU: &[&str] = &["pe", "cu", "la", "de", "pentru", "despre", "langa", "fara", "dupa", "spre", "catre", "din", "in", "prin", "ca", "decat", "si", "sau", "nici"];
/// After these it is "ține" (holds, keeps).
const BEFORE_TINE_HOLDS: &[&str] = &["se", "nu", "ma", "te", "il", "o", "ii", "isi", "imi", "iti", "care", "ce", "el", "ea", "cine", "ne", "va", "le"];

/// The reading the neighbours settle, as its place in `readings.forms`; None when they do not.
pub fn settle(typed: &str, readings: &Readings, around: Around<'_>) -> Option<usize> {
    let is = |list: &[&str], word: Option<&str>| word.is_some_and(|word| list.contains(&word));
    let place = |form: &str| readings.forms.iter().position(|known| known == form);
    match typed {
        "sa" => {
            // "sa" (hers, his) follows a word with its article, and those end in a.
            let after_article = around.before.is_some_and(|before| before.ends_with('a') && !BEFORE_SA_VERB.contains(&before));
            if around.tied_to_next || !after_article || is(AFTER_SA_VERB, around.after) {
                return place("să");
            }
            // casa sa. — the end of what is said.
            if around.after.is_none() {
                return place("sa");
            }
            None
        }
        "ca" => {
            if around.tied_to_next || is(BEFORE_CA_CONJUNCTION, around.before) && !is(&["sa", "si"], around.after) {
                return place("că");
            }
            if is(AFTER_CA_COMPARISON, around.after) {
                return place("ca");
            }
            None
        }
        "va" => {
            if is(AFTER_VA_YOU, around.after) {
                return place("vă");
            }
            if is(BEFORE_VA_FUTURE, around.before) {
                return place("va");
            }
            None
        }
        "tine" => {
            if is(BEFORE_TINE_YOU, around.before) {
                return place("tine");
            }
            if is(BEFORE_TINE_HOLDS, around.before) {
                return place("ține");
            }
            None
        }
        // o pană (a feather, a breakdown); anywhere else it is "până" (until), said far more often.
        "pana" => place(if is(ALWAYS_NO_ARTICLE, around.before) { "pană" } else { "până" }),
        // bună ziua, bună seara.
        "buna" if is(&["ziua", "seara", "dimineata"], around.after) => place("bună"),
        _ => {
            let (with, without) = readings.with_and_without_article()?;
            // Only when these two are all the readings there are: fata, fată, față is not settled so.
            if readings.forms.len() != 2 {
                return None;
            }
            if is(AFTER_ARTICLE, around.after) {
                return Some(with);
            }
            if is(ALWAYS_NO_ARTICLE, around.before) {
                return Some(without);
            }
            // cu mașina, toată țara.
            if is(&["cu", "toata", "intreaga"], around.before) {
                return Some(with);
            }
            // în casă. — but: în casa veche, în casa de la munte.
            if is(BEFORE_NO_ARTICLE, around.before) && (around.after.is_none() || is(JOINING, around.after)) && !around.tied_to_next {
                return Some(without);
            }
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::lexicon::lexicon;
    use super::*;

    fn settled(typed: &str, before: Option<&str>, after: Option<&str>) -> Option<&'static str> {
        let readings = &lexicon()[typed];
        settle(typed, readings, Around { before, after, tied_to_next: false }).map(|place| readings.forms[place].as_str())
    }

    #[test]
    fn tells_the_small_words_apart() {
        assert_eq!(settled("pana", Some("o"), Some("alba")), Some("pană"));
        assert_eq!(settled("pana", Some("vine"), Some("maine")), Some("până"));
        assert_eq!(settled("sa", Some("vreau"), Some("plec")), Some("să"));
        assert_eq!(settled("sa", None, Some("fie")), Some("să"));
        assert_eq!(settled("sa", Some("vrea"), Some("plece")), Some("să"));
        assert_eq!(settled("sa", Some("casa"), Some("veche")), None, "casa sa veche, or: lasa sa … — not known from here");
        assert_eq!(settled("sa", Some("casa"), None), Some("sa"));
        assert_eq!(settled("sa", Some("piata"), Some("cumpere")), Some("să"));
        assert_eq!(settled("ca", Some("pentru"), Some("ploua")), Some("că"));
        assert_eq!(settled("ca", Some("pentru"), Some("sa")), Some("ca"));
        assert_eq!(settled("ca", Some("alb"), Some("o")), Some("ca"));
        assert_eq!(settled("ca", Some("vine"), Some("ploaia")), None);
        assert_eq!(settled("va", None, Some("rog")), Some("vă"));
        assert_eq!(settled("va", Some("nu"), Some("veni")), Some("va"));
        assert_eq!(settled("va", Some("ploaia"), Some("veni")), None);
        assert_eq!(settled("tine", Some("pentru"), None), Some("tine"));
        assert_eq!(settled("tine", Some("se"), Some("bine")), Some("ține"));
    }

    #[test]
    fn tells_a_word_with_its_article_from_one_without() {
        assert_eq!(settled("casa", Some("o"), Some("mare")), Some("casă"));
        assert_eq!(settled("casa", Some("in"), None), Some("casă"));
        assert_eq!(settled("casa", Some("in"), Some("si")), Some("casă"));
        assert_eq!(settled("casa", Some("in"), Some("mea")), Some("casa"));
        assert_eq!(settled("casa", Some("in"), Some("veche")), None);
        assert_eq!(settled("casa", None, Some("este")), None);
        assert_eq!(settled("tara", Some("o"), None), Some("țară"));
        // More than two readings: the neighbours are not enough.
        assert_eq!(settled("fata", Some("o"), None), None);
    }
}
