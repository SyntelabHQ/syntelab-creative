import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import type { Mark } from '../marks/mark';
import { PageRangeChoice } from '../organize/page-range-choice';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './ocr-dialog.module.css';
import { hasText, hiddenTextMark, languageName, startLanguages } from './ocr-words';
import type { ReadWord } from './ocr-words';

export interface OcrDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly pages: readonly PlanPage[];
  /** The places (from 0) of the chosen pages: the selection, or the page in view. */
  readonly targets: ReadonlySet<number>;
  /** Puts what was read on its pages (by page key), as one step that can be undone. `read` and `skipped` count pages. */
  readonly onDone: (marks: ReadonlyMap<string, Mark>, read: number, skipped: number) => void;
}

/** What the engine says of itself (`ocr_engine`). */
interface Engine {
  readonly found: boolean;
  readonly languages: readonly string[];
}

const LANGUAGES_KEY = 'ocrLanguages';
/** What installs the engine on Windows, for the user to run. */
const INSTALL_COMMAND = 'winget install --id UB-Mannheim.TesseractOCR -e --source winget';

/**
 * Text recognition (OCR): reads the words of scanned pages and writes them
 * into the pages unseen, so the document can be searched and its text
 * copied. What the pages look like does not change.
 */
export function OcrDialog({ host, open, onClose, pages, targets, onDone }: OcrDialogProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  const [engine, setEngine] = useState<Engine | null>(null);
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [range, setRange] = useState<PageRange>({ kind: 'all' });
  const [parity, setParity] = useState<Parity>('both');
  const [skipText, setSkipText] = useState(true);
  /** While reading: how many pages are done, of how many. */
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const stopping = useRef(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setEngine(null);
    setProblem(null);
    invoke<Engine>('ocr_engine', {})
      .then((answer) => {
        if (cancelled) return;
        // By the names the reader sees, in the order of their own language.
        const sorted = [...answer.languages].sort((one, other) => languageName(one, language).localeCompare(languageName(other, language), language));
        setEngine({ ...answer, languages: sorted });
        const remembered = host.loadData<unknown>(LANGUAGES_KEY);
        setChosen(startLanguages(answer.languages, Array.isArray(remembered) ? remembered.filter((name): name is string => typeof name === 'string') : [], language));
      })
      .catch(() => !cancelled && setEngine({ found: false, languages: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, invoke]);

  const wanted = pagesOf(range, parity, pages.length, targets);
  const toggle = (name: string) => setChosen((current) => (current.includes(name) ? current.filter((other) => other !== name) : [...current, name]));

  const read = async () => {
    stopping.current = false;
    setProblem(null);
    host.saveData(LANGUAGES_KEY, chosen);
    const marks = new Map<string, Mark>();
    let skipped = 0;
    setProgress({ done: 0, of: wanted.length });
    try {
      for (const [done, index] of wanted.entries()) {
        if (stopping.current) break;
        const page = pages[index];
        if (!page) continue;
        setProgress({ done, of: wanted.length });
        // A page that was read before in this document is not read twice.
        const readBefore = (page.marks ?? []).some((mark) => mark.kind === 'hiddenText');
        const ownText = skipText ? await invoke<{ texts: string[] }>('page_texts', { documentId: page.documentId, fromPage: page.page, pageCount: 1 }).then((answer) => answer.texts[0] ?? '', () => '') : '';
        if (readBefore || hasText(ownText)) {
          skipped += 1;
          continue;
        }
        const { words } = await invoke<{ words: ReadWord[] }>('ocr_page', { documentId: page.documentId, page: page.page, rotation: page.rotation, languages: chosen });
        if (words.length > 0) marks.set(page.key, hiddenTextMark(page, words, `read-${Date.now().toString(36)}-${index}`));
      }
      onDone(marks, marks.size, skipped);
      onClose();
    } catch {
      // What was read so far is kept; the rest can be tried again.
      if (marks.size > 0) onDone(marks, marks.size, skipped);
      setProblem('pdf-organizer.ocr.failed');
    } finally {
      setProgress(null);
    }
  };

  const reading = progress !== null;
  return (
    <Dialog open={open} onClose={() => !reading && onClose()} title={t('pdf-organizer.command.ocr')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.ocr.lead')}</p>
        {engine === null && <p className={shapeStyles.lead}>{t('pdf-organizer.ocr.looking')}</p>}

        {engine && !engine.found && (
          <>
            <p>{t('pdf-organizer.ocr.noEngine')}</p>
            <code className={styles.command} dir="ltr">
              {INSTALL_COMMAND}
            </code>
            <p className={shapeStyles.lead}>{t('pdf-organizer.ocr.noEngineNote')}</p>
          </>
        )}

        {engine?.found && (
          <>
            <section className={shapeStyles.field}>
              <h3 className={shapeStyles.legend}>{t('pdf-organizer.ocr.languages')}</h3>
              {engine.languages.length === 0 ? (
                <p className={styles.problem}>{t('pdf-organizer.ocr.noLanguages')}</p>
              ) : (
                <div className={styles.languages}>
                  {engine.languages.map((name) => (
                    <label key={name} className={styles.language}>
                      <input type="checkbox" checked={chosen.includes(name)} disabled={reading} onChange={() => toggle(name)} />
                      {languageName(name, language)}
                    </label>
                  ))}
                </div>
              )}
              <p className={shapeStyles.lead}>{t('pdf-organizer.ocr.languagesNote')}</p>
            </section>
            <PageRangeChoice range={range} onRangeChange={setRange} parity={parity} onParityChange={setParity} chosen={targets} pageCount={pages.length} />
            <label className={shapeStyles.choice}>
              <input type="checkbox" checked={skipText} disabled={reading} onChange={(event) => setSkipText(event.target.checked)} />
              {t('pdf-organizer.ocr.skipText')}
            </label>
          </>
        )}

        {reading && (
          <>
            <progress className={styles.progress} max={progress.of} value={progress.done} aria-label={t('pdf-organizer.ocr.reading', { page: progress.done + 1, count: progress.of })} />
            <p className={shapeStyles.lead} role="status">
              {t('pdf-organizer.ocr.reading', { page: Math.min(progress.done + 1, progress.of), count: progress.of })}
            </p>
          </>
        )}
        {problem && (
          <p className={styles.problem} role="alert">
            {t(problem)}
          </p>
        )}

        <div className={shapeStyles.actions}>
          {reading ? <Button onClick={() => (stopping.current = true)}>{t('pdf-organizer.ocr.stop')}</Button> : <Button onClick={onClose}>{t(engine?.found ? 'common.action.cancel' : 'common.action.close')}</Button>}
          {engine?.found && (
            <Button variant="primary" disabled={reading || chosen.length === 0 || wanted.length === 0} onClick={() => void read()}>
              <Icon name="eye" size={14} />
              {t('pdf-organizer.ocr.start')}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
