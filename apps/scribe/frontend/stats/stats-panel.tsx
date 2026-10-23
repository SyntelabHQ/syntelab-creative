import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useScribeSettings } from '../settings/scribe-settings';
import { languageName } from '../tools/tool-field';
import { against, LIMITS } from './limits';
import { easeLevel, formulaLanguage, READABILITY_LANGUAGES, readingEase } from './readability';
import { minutesAt, timeParts } from './reading-time';
import styles from './stats-panel.module.css';

interface Counted {
  readonly text: string;
  readonly count: number;
}
interface Sentence {
  readonly text: string;
  readonly words: number;
}

/** What `text_stats` answers. */
export interface TextStats {
  readonly characters: number;
  readonly charactersWithoutSpaces: number;
  readonly words: number;
  readonly differentWords: number;
  readonly sentences: number;
  readonly paragraphs: number;
  readonly lines: number;
  readonly lettersPerWord: number;
  readonly wordsPerSentence: number;
  readonly topWords: readonly Counted[];
  readonly topPairs: readonly Counted[];
  readonly topTriples: readonly Counted[];
  readonly longestSentences: readonly Sentence[];
  readonly shortestSentence: Sentence | null;
  readonly longestWord: string;
  readonly shortestWord: string;
  readonly bytes: number;
  readonly syllables: number;
  /** Words of 1–3 letters, 4–6, 7–9, 10–12, more. */
  readonly wordsByLength: readonly number[];
  /** Sentences of up to 10 words, 11–20, more. */
  readonly sentencesByLength: readonly number[];
  readonly questions: number;
  readonly exclamations: number;
}

export interface StatsPanelProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData'>;
  /** Gives what is counted right now: the selection when there is one, else the whole text. */
  readonly target: () => { readonly text: string; readonly selection: boolean };
  /** Changes whenever the text or the selection does: the counting follows it. */
  readonly version: unknown;
  /** How long the text is: a very long one is counted when asked, not at every key. */
  readonly length: number;
}

/** A moment after the last change, the text is counted again. */
const COUNT_AFTER = 500;
/** Above this many characters the counting waits to be asked for. */
const FOLLOW_UP_TO = 3_000_000;
const FOLDED_KEY = 'statsFolded';
const EASE_LANGUAGE_KEY = 'statsEaseLanguage';
const WORD_LENGTHS = ['1–3', '4–6', '7–9', '10–12', '13+'];
const SENTENCE_LENGTHS = ['short', 'medium', 'long'] as const;

/**
 * What the text is made of, beside it: counts, time, its words and its
 * sentences, how easy it is to read, what it says most, and the room it
 * leaves in the usual limits. It follows the text, and the selection when
 * there is one. Each part folds away.
 */
export function StatsPanel({ host, target, version, length }: StatsPanelProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const settings = useScribeSettings(host);
  const [stats, setStats] = useState<TextStats | null>(null);
  const [ofSelection, setOfSelection] = useState(false);
  const [stale, setStale] = useState(false);
  const [folded, setFolded] = useState<readonly string[]>(() => {
    const stored = host.loadData<unknown>(FOLDED_KEY);
    // The parts fewer people look at start folded.
    return Array.isArray(stored) ? stored.filter((part): part is string => typeof part === 'string') : ['phrases', 'limits'];
  });
  /** The language the ease of reading is worked out for: the program's when it has a formula, until the user chooses. */
  const [easeLanguage, setEaseLanguage] = useState<string>(() => {
    const stored = host.loadData<unknown>(EASE_LANGUAGE_KEY);
    return typeof stored === 'string' && READABILITY_LANGUAGES.includes(stored) ? stored : (formulaLanguage(language) ?? '');
  });
  const number = new Intl.NumberFormat(language);
  const decimal = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat(language, { style: 'percent', maximumFractionDigits: 1 });
  const follows = length <= FOLLOW_UP_TO;

  const count = async () => {
    const counted = target();
    const answer = await invoke<TextStats>('text_stats', { text: counted.text }).catch(() => null);
    setStats(answer);
    setOfSelection(counted.selection);
    setStale(false);
  };

  useEffect(() => {
    if (!follows) return setStale(true);
    let cancelled = false;
    const wait = setTimeout(() => {
      const counted = target();
      invoke<TextStats>('text_stats', { text: counted.text }).then(
        (answer) => {
          if (cancelled) return;
          setStats(answer);
          setOfSelection(counted.selection);
          setStale(false);
        },
        () => !cancelled && setStats(null),
      );
    }, COUNT_AFTER);
    return () => {
      cancelled = true;
      clearTimeout(wait);
    };
  }, [version, follows, invoke]);

  const time = (minutes: number) => {
    const { hours, minutes: left, seconds } = timeParts(minutes);
    if (hours > 0) return t('scribe.stats.hoursMinutes', { hours, minutes: left });
    return left > 0 ? t('scribe.stats.minutesSeconds', { minutes: left, seconds }) : t('scribe.stats.seconds', { seconds });
  };

  /** A part of the panel: its name on a band, and what it holds while it is open. */
  const part = (id: string, children: ReactNode) => {
    const open = !folded.includes(id);
    return (
      <section className={styles.section}>
        <button
          type="button"
          className={styles.heading}
          aria-expanded={open}
          onClick={() => {
            const next = open ? [...folded, id] : folded.filter((known) => known !== id);
            setFolded(next);
            host.saveData(FOLDED_KEY, next);
          }}
        >
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
          {t(`scribe.stats.part.${id}`)}
        </button>
        {open && children}
      </section>
    );
  };
  const row = (name: string, value: ReactNode) => (
    <div>
      <dt>{t(`scribe.stats.${name}`)}</dt>
      <dd>{value}</dd>
    </div>
  );
  /** Counts shown as bars, each as long as its share of the largest. */
  const bars = (items: readonly { readonly label: string; readonly count: number }[], of: number) => {
    const most = Math.max(...items.map((item) => item.count), 1);
    return (
      <ol className={styles.bars}>
        {items.map((item) => (
          <li key={item.label}>
            <span className={styles.bar} style={{ inlineSize: `${Math.max((item.count / most) * 100, item.count > 0 ? 4 : 0)}%` }} />
            <bdi className={styles.word}>{item.label}</bdi>
            <span className={styles.times}>
              {number.format(item.count)}
              {of > 0 && ` · ${percent.format(item.count / of)}`}
            </span>
          </li>
        ))}
      </ol>
    );
  };

  const ease = stats && easeLanguage ? readingEase(stats, easeLanguage) : null;
  const statements = stats ? Math.max(stats.sentences - stats.questions - stats.exclamations, 0) : 0;

  return (
    <div className={styles.stats}>
      <p className={styles.scope}>{t(ofSelection ? 'scribe.stats.ofSelection' : 'scribe.stats.ofAll')}</p>
      {!follows && (
        <p className={styles.scope}>
          {t('scribe.stats.long')} <Button onClick={() => void count()}>{t('scribe.stats.countNow')}</Button>
        </p>
      )}
      {stats && (
        <div className={styles.body} data-stale={stale}>
          <dl className={styles.counts}>
            {(['words', 'characters', 'charactersWithoutSpaces', 'sentences', 'paragraphs', 'lines'] as const).map((name) => (
              <div key={name} className={styles.count}>
                <dt>{t(`scribe.stats.${name}`)}</dt>
                <dd>{number.format(stats[name])}</dd>
              </div>
            ))}
            <div className={styles.count}>
              <dt>{t('scribe.stats.pages')}</dt>
              <dd>{decimal.format(stats.words / settings.wordsPerPage)}</dd>
            </div>
            <div className={styles.count}>
              <dt>{t('scribe.stats.bytes')}</dt>
              <dd>{number.format(stats.bytes)}</dd>
            </div>
          </dl>

          {part(
            'time',
            <>
              <dl className={styles.rows}>
                {row('reading', time(minutesAt(stats.words, settings.readingSpeed)))}
                {row('speaking', time(minutesAt(stats.words, settings.speakingSpeed)))}
                {row('typing', time(minutesAt(stats.words, settings.typingSpeed)))}
                {row('handwriting', time(minutesAt(stats.words, settings.handwritingSpeed)))}
              </dl>
              <p className={styles.note}>{t('scribe.stats.timeNote', { reading: settings.readingSpeed, speaking: settings.speakingSpeed, typing: settings.typingSpeed, handwriting: settings.handwritingSpeed })}</p>
            </>,
          )}

          {part(
            'words',
            <>
              <dl className={styles.rows}>
                {row('differentWords', `${number.format(stats.differentWords)}${stats.words > 0 ? ` · ${percent.format(stats.differentWords / stats.words)}` : ''}`)}
                {row('lettersPerWord', decimal.format(stats.lettersPerWord))}
                {row('syllables', number.format(stats.syllables))}
                {stats.longestWord && row('longestWord', <bdi>{stats.longestWord}</bdi>)}
                {stats.shortestWord && row('shortestWord', <bdi>{stats.shortestWord}</bdi>)}
              </dl>
              <h4 className={styles.sub}>{t('scribe.stats.wordsByLength')}</h4>
              {bars(
                stats.wordsByLength.map((count, index) => ({ label: t('scribe.stats.letters', { range: WORD_LENGTHS[index] ?? '' }), count })),
                stats.words,
              )}
            </>,
          )}

          {part(
            'sentences',
            <>
              <dl className={styles.rows}>{row('wordsPerSentence', decimal.format(stats.wordsPerSentence))}</dl>
              <h4 className={styles.sub}>{t('scribe.stats.sentencesByLength')}</h4>
              {bars(
                stats.sentencesByLength.map((count, index) => ({ label: t(`scribe.stats.sentence.${SENTENCE_LENGTHS[index] ?? 'long'}`), count })),
                stats.sentences,
              )}
              <h4 className={styles.sub}>{t('scribe.stats.sentenceKinds')}</h4>
              {bars(
                [
                  { label: t('scribe.stats.statements'), count: statements },
                  { label: t('scribe.stats.questions'), count: stats.questions },
                  { label: t('scribe.stats.exclamations'), count: stats.exclamations },
                ],
                stats.sentences,
              )}
              {stats.longestSentences.length > 0 && (
                <>
                  <h4 className={styles.sub}>{t('scribe.stats.longestSentences')}</h4>
                  <ol className={styles.sentences}>
                    {stats.longestSentences.map((sentence, index) => (
                      <li key={index}>
                        <span className={styles.times}>{t('scribe.status.words', { count: sentence.words })}</span>
                        <bdi className={styles.sentence}>{sentence.text}</bdi>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {stats.shortestSentence && stats.sentences > 1 && (
                <>
                  <h4 className={styles.sub}>{t('scribe.stats.shortestSentence')}</h4>
                  <ol className={styles.sentences}>
                    <li>
                      <span className={styles.times}>{t('scribe.status.words', { count: stats.shortestSentence.words })}</span>
                      <bdi className={styles.sentence}>{stats.shortestSentence.text}</bdi>
                    </li>
                  </ol>
                </>
              )}
            </>,
          )}

          {part(
            'ease',
            <>
              <label className={styles.choice}>
                <span>{t('scribe.stats.easeLanguage')}</span>
                <select
                  className={styles.control}
                  value={easeLanguage}
                  onChange={(event) => {
                    setEaseLanguage(event.target.value);
                    host.saveData(EASE_LANGUAGE_KEY, event.target.value);
                  }}
                >
                  <option value="">{t('scribe.stats.easeNoLanguage')}</option>
                  {READABILITY_LANGUAGES.map((code) => (
                    <option key={code} value={code}>
                      {languageName(code, language)}
                    </option>
                  ))}
                </select>
              </label>
              {ease !== null && (
                <div className={styles.ease}>
                  <span className={styles.easeScore}>{number.format(Math.round(ease))}</span>
                  <span className={styles.easeWords}>
                    <strong>{t(`scribe.stats.ease.${easeLevel(ease)}`)}</strong>
                    <span className={styles.meter}>
                      <span style={{ inlineSize: `${ease}%` }} />
                    </span>
                  </span>
                </div>
              )}
              <p className={styles.note}>{t(easeLanguage ? 'scribe.stats.easeNote' : formulaLanguage(language) ? 'scribe.stats.easeChoose' : 'scribe.stats.easeNone', { language: languageName(language, language) })}</p>
            </>,
          )}

          {part(
            'phrases',
            <>
              {stats.topWords.length > 0 && (
                <>
                  <h4 className={styles.sub}>{t('scribe.stats.topWords')}</h4>
                  {bars(
                    stats.topWords.map((word) => ({ label: word.text, count: word.count })),
                    stats.words,
                  )}
                  <p className={styles.note}>{t('scribe.stats.topWordsNote')}</p>
                </>
              )}
              {stats.topPairs.length > 0 && (
                <>
                  <h4 className={styles.sub}>{t('scribe.stats.topPairs')}</h4>
                  {bars(
                    stats.topPairs.map((pair) => ({ label: pair.text, count: pair.count })),
                    0,
                  )}
                </>
              )}
              {stats.topTriples.length > 0 && (
                <>
                  <h4 className={styles.sub}>{t('scribe.stats.topTriples')}</h4>
                  {bars(
                    stats.topTriples.map((triple) => ({ label: triple.text, count: triple.count })),
                    0,
                  )}
                </>
              )}
              {stats.topWords.length === 0 && <p className={styles.note}>{t('scribe.stats.nothingYet')}</p>}
            </>,
          )}

          {part(
            'limits',
            <>
              <ul className={styles.limits}>
                {LIMITS.map((limit) => {
                  const stands = against(stats.characters, limit.characters);
                  return (
                    <li key={limit.id} data-state={stands.state}>
                      <span className={styles.limitName}>{t(`scribe.stats.limit.${limit.id}`)}</span>
                      <span className={styles.times}>{t(stands.left < 0 ? 'scribe.stats.over' : 'scribe.stats.left', { count: number.format(Math.abs(stands.left)), limit: number.format(limit.characters) })}</span>
                      <span className={styles.meter}>
                        <span style={{ inlineSize: `${stands.full * 100}%` }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className={styles.note}>{t('scribe.stats.limitsNote')}</p>
            </>,
          )}
        </div>
      )}
    </div>
  );
}
