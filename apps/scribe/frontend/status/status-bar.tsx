import { useI18n } from '@syntelab/i18n';
import { LINE_ENDINGS } from '../document/text-file';
import type { FileForm, LineEnding } from '../document/text-file';
import type { EditorFacts } from '@syntelab/text-editor';
import styles from './status-bar.module.css';

export interface StatusBarProps {
  readonly facts: EditorFacts;
  /** How many words the text has; null while they are being counted. */
  readonly words: number | null;
  readonly form: FileForm;
  /** The encodings a text can be saved in. */
  readonly encodings: readonly string[];
  readonly onFormChange: (change: Partial<FileForm>) => void;
  readonly disabled: boolean;
}

/** UTF-8 and UTF-16 can start with a byte order mark; it is offered as a choice of its own. */
const MARKED = ' BOM';
const canBeMarked = (encoding: string) => /^utf-(8|16)/i.test(encoding);

/**
 * The line under the text: where the cursor is, how much is selected, how
 * long the text is, and how it is kept in its file (the encoding and the line
 * endings, which can be changed here; the change counts at the next save).
 */
export function StatusBar({ facts, words, form, encodings, onFormChange, disabled }: StatusBarProps) {
  const { t, language } = useI18n();
  const number = new Intl.NumberFormat(language);
  // An encoding the file came in but the list does not offer is still shown.
  const offered = encodings.includes(form.encoding) ? encodings : [form.encoding, ...encodings];
  const chosen = `${form.encoding}${form.mark && canBeMarked(form.encoding) ? MARKED : ''}`;

  return (
    <footer className={styles.bar}>
      <span>{t('scribe.status.place', { line: number.format(facts.line), column: number.format(facts.column) })}</span>
      {facts.selected > 0 && <span>{t('scribe.status.selected', { count: facts.selected })}</span>}
      <span className={styles.spring} />
      <span>{t('scribe.status.lines', { count: facts.lines })}</span>
      <span>{words === null ? t('scribe.status.counting') : t('scribe.status.words', { count: words })}</span>
      <span>{t('scribe.status.characters', { count: facts.length })}</span>
      <select
        className={styles.choice}
        value={chosen}
        disabled={disabled}
        aria-label={t('scribe.status.encoding')}
        data-tooltip={t('scribe.status.encodingHint')}
        data-tooltip-side="top"
        onChange={(event) => {
          const mark = event.target.value.endsWith(MARKED);
          onFormChange({ encoding: mark ? event.target.value.slice(0, -MARKED.length) : event.target.value, mark });
        }}
      >
        {offered.flatMap((encoding) =>
          canBeMarked(encoding)
            ? [
                <option key={encoding} value={encoding}>
                  {encoding}
                </option>,
                <option key={`${encoding}${MARKED}`} value={`${encoding}${MARKED}`}>
                  {t('scribe.status.withMark', { encoding })}
                </option>,
              ]
            : [
                <option key={encoding} value={encoding}>
                  {encoding}
                </option>,
              ],
        )}
      </select>
      <select
        className={styles.choice}
        value={form.lineEnding}
        disabled={disabled}
        aria-label={t('scribe.status.lineEnding')}
        data-tooltip={t('scribe.status.lineEndingHint')}
        data-tooltip-side="top"
        onChange={(event) => onFormChange({ lineEnding: event.target.value as LineEnding })}
      >
        {LINE_ENDINGS.map((ending) => (
          <option key={ending} value={ending}>
            {t(`scribe.status.lineEnding.${ending}`)}
          </option>
        ))}
      </select>
    </footer>
  );
}
