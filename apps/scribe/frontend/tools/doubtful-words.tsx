import { useTranslation } from '@syntelab/i18n';
import { useState } from 'react';
import styles from './doubtful-words.module.css';

/** A word that can be written in more than one way, as the Rust side gives it (`restore_romanian`). */
export interface Doubt {
  /** Where the word is in the text that was restored, in UTF-16 units. */
  readonly from: number;
  readonly to: number;
  /** The ways it can be written, the likelier first. */
  readonly choices: readonly string[];
}

/** The doubtful words of one run of the tool. */
export interface Doubts {
  /** Where the restored text starts in the whole text: 0, or the start of the selection. */
  readonly base: number;
  /** The text as it was given back. */
  readonly text: string;
  readonly words: readonly Doubt[];
}

export interface DoubtfulWordsProps {
  readonly doubts: Doubts;
  /** Writes a choice in place of the word; false when the text is no longer what it was there. */
  readonly onChoose: (from: number, to: number, choice: string) => boolean;
  readonly disabled: boolean;
}

/** How many words are listed at once: a long text is settled a part at a time. */
const MOST_SHOWN = 150;
/** How much of the text is shown on each side of a word. */
const AROUND = 22;

const PLAIN: Readonly<Record<string, string>> = { ă: 'a', â: 'a', î: 'i', ș: 's', ş: 's', ț: 't', ţ: 't' };

/** A word as it is typed without Romanian diacritics, in small letters. */
export function withoutDiacritics(word: string): string {
  return [...word.toLowerCase()].map((letter) => PLAIN[letter] ?? letter).join('');
}

/** True when two words differ at most in their Romanian diacritics and capitals. */
export function sameWord(one: string, other: string): boolean {
  return withoutDiacritics(one) === withoutDiacritics(other);
}

/** The text around a word, cut at whole words where it can be. */
export function around(text: string, from: number, to: number): { before: string; after: string } {
  // A word cut by the edge of what is shown is left out; the ends of the text itself cut nothing.
  const before = from > AROUND ? text.slice(from - AROUND, from).replace(/^\S*\s(?=\S)/, '') : text.slice(0, from);
  const after = to + AROUND < text.length ? text.slice(to, to + AROUND).replace(/\s\S*$/, '') : text.slice(to);
  return { before: before.replace(/\n/g, ' '), after: after.replace(/\n/g, ' ') };
}

/**
 * The words the tool could not settle, each in its place in the text with
 * the ways it can be written: one click writes the right one.
 */
export function DoubtfulWords({ doubts, onChoose, disabled }: DoubtfulWordsProps) {
  const t = useTranslation();
  /** What was chosen for each word, by its place in the list. */
  const [chosen, setChosen] = useState<Readonly<Record<number, string>>>({});
  /** The text was changed by hand since: the places are no longer where the words are. */
  const [stale, setStale] = useState(false);
  const shown = doubts.words.slice(0, MOST_SHOWN);

  const choose = (index: number, doubt: Doubt, choice: string) => {
    if (onChoose(doubts.base + doubt.from, doubts.base + doubt.to, choice)) setChosen((current) => ({ ...current, [index]: choice }));
    else setStale(true);
  };

  return (
    <div className={styles.doubts}>
      <p className={styles.lead}>{t('scribe.doubts.lead', { count: doubts.words.length })}</p>
      {stale && (
        <p className={styles.stale} role="alert">
          {t('scribe.doubts.stale')}
        </p>
      )}
      <ul className={styles.list}>
        {shown.map((doubt, index) => {
          const { before, after } = around(doubts.text, doubt.from, doubt.to);
          const written = chosen[index] ?? doubts.text.slice(doubt.from, doubt.to);
          return (
            <li key={doubt.from} className={styles.word} data-settled={chosen[index] !== undefined}>
              <p className={styles.place} lang="ro">
                {before}
                <mark>{written}</mark>
                {after}
              </p>
              <div className={styles.choices}>
                {doubt.choices.map((choice) => (
                  <button key={choice} type="button" lang="ro" className={styles.choice} aria-pressed={chosen[index] === choice} disabled={disabled || stale} onClick={() => choose(index, doubt, choice)}>
                    {choice}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      {doubts.words.length > shown.length && <p className={styles.lead}>{t('scribe.doubts.more', { count: doubts.words.length - shown.length })}</p>}
    </div>
  );
}
