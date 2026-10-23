import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';
import ocrStyles from '../ocr/ocr-dialog.module.css';
import { languageName, startLanguages } from '../ocr/ocr-words';
import shapeStyles from '../organize/shape-dialog.module.css';

/** Where the languages last read in are kept: the same place the window for one document uses. */
const LANGUAGES_KEY = 'ocrLanguages';

export interface OcrOptionsProps {
  readonly host: Pick<AppHost, 'invoke' | 'loadData' | 'saveData'>;
  /** The languages chosen, by the names the engine gives them. */
  readonly languages: readonly string[];
  readonly onChange: (languages: readonly string[]) => void;
  readonly disabled: boolean;
}

/**
 * The choices of reading scanned pages in a run: the languages, of those the
 * engine on this computer has. Without the engine, it says so.
 */
export function OcrOptions({ host, languages, onChange, disabled }: OcrOptionsProps) {
  const { t, language } = useI18n();
  const { invoke } = host;
  /** The languages the engine has; null while it is asked, empty with `found` false when there is no engine. */
  const [engine, setEngine] = useState<{ found: boolean; languages: readonly string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<{ found: boolean; languages: string[] }>('ocr_engine', {})
      .then((answer) => {
        if (cancelled) return;
        const sorted = [...answer.languages].sort((one, other) => languageName(one, language).localeCompare(languageName(other, language), language));
        setEngine({ found: answer.found, languages: sorted });
        // Nothing chosen yet (not from a recipe either): start as the window for one document does.
        if (languages.length === 0) {
          const remembered = host.loadData<unknown>(LANGUAGES_KEY);
          onChange(startLanguages(answer.languages, Array.isArray(remembered) ? remembered.filter((name): name is string => typeof name === 'string') : [], language));
        }
      })
      .catch(() => !cancelled && setEngine({ found: false, languages: [] }));
    return () => {
      cancelled = true;
    };
    // Asked once, when the step is turned on.
  }, [invoke]);

  if (engine === null) return <p className={shapeStyles.lead}>{t('pdf-organizer.ocr.looking')}</p>;
  if (!engine.found) return <p className={ocrStyles.problem}>{t('pdf-organizer.batch.noOcrEngine')}</p>;
  const toggle = (name: string) => {
    const next = languages.includes(name) ? languages.filter((other) => other !== name) : [...languages, name];
    onChange(next);
    host.saveData(LANGUAGES_KEY, next);
  };
  return (
    <>
      <div className={ocrStyles.languages}>
        {engine.languages.map((name) => (
          <label key={name} className={ocrStyles.language}>
            <input type="checkbox" checked={languages.includes(name)} disabled={disabled} onChange={() => toggle(name)} />
            {languageName(name, language)}
          </label>
        ))}
      </div>
      <p className={shapeStyles.lead}>{t('pdf-organizer.batch.ocrNote')}</p>
    </>
  );
}
