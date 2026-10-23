/** A word: letters and digits, with the apostrophes and hyphens inside it ("don't", "well-known", "l'été"). */
const WORD = /[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu;

/** Scripts written without spaces between words: there, the rules of the language find the words. */
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * How many words a text has. Counted here for the line under the text, which
 * follows every key; the statistics panel asks the Rust side for the full
 * account. Texts in scripts without spaces are counted with the system's own
 * rules for words, where it has them.
 */
export function countWords(text: string, language?: string): number {
  if (UNSPACED.test(text) && typeof Intl.Segmenter === 'function') {
    let count = 0;
    for (const part of new Intl.Segmenter(language, { granularity: 'word' }).segment(text)) if (part.isWordLike) count += 1;
    return count;
  }
  return text.match(WORD)?.length ?? 0;
}
