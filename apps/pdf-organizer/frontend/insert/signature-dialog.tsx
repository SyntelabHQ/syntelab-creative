import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import { FontSelect } from '../marks/font-select';
import { cssFont } from '../marks/mark';
import type { Placing } from '../marks/placing';
import shapeStyles from '../organize/shape-dialog.module.css';
import { withoutPaper } from './ink-only';
import { loadSignatures, saveSignatures, withSignature } from './saved-signatures';
import { dayOf, writtenDate } from './signature-date';
import styles from './signature-dialog.module.css';
import { SignaturePad } from './signature-pad';
import toolStyles from './tools.module.css';

export interface SignatureDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Asks the user for a picture file; resolves to null when none was chosen or it cannot be read. */
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
  /** The signature to put on the page next: the user then drags on the page where it goes. */
  readonly onChoose: (signature: Placing) => void;
  /** The fonts installed on the computer. */
  readonly fonts: readonly string[];
}

/** How a signature is made. */
const SOURCES = ['draw', 'type', 'picture'] as const;
type Source = (typeof SOURCES)[number];
const SOURCE_ICONS: Record<Source, string> = { draw: 'signature', type: 'keyboard', picture: 'image' };

/** A typed signature: the words and their look. */
interface Typed {
  readonly text: string;
  readonly font: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly color: string;
}

/** Fonts that look written by hand, best first: a typed signature starts in the first one the computer has. */
const HANDWRITING = ['Segoe Script', 'Lucida Handwriting', 'Brush Script MT', 'Ink Free', 'Mistral', 'Freestyle Script', 'Gabriola', 'Segoe Print'];
const TYPED_KEY = 'typedSignature';
const INK = '#102a83';

function loadTyped(host: Pick<AppHost, 'loadData'>, fonts: readonly string[]): Typed {
  const stored = host.loadData<Partial<Typed>>(TYPED_KEY);
  const handwriting = HANDWRITING.find((family) => fonts.includes(family));
  return {
    text: typeof stored?.text === 'string' ? stored.text : '',
    font: typeof stored?.font === 'string' ? stored.font : (handwriting ?? 'serif'),
    bold: stored?.bold === true,
    // Without a font that looks written by hand, slanted letters come closest.
    italic: typeof stored?.italic === 'boolean' ? stored.italic : handwriting === undefined,
    color: typeof stored?.color === 'string' ? stored.color : INK,
  };
}

/**
 * Where a signature comes from: drawn here, typed in a font, a picture of
 * one, or one used before; with the date under it when asked. Signatures used
 * are kept on this computer only.
 */
export function SignatureDialog({ host, open, onClose, onPickPicture, onChoose, fonts }: SignatureDialogProps) {
  const { t, language } = useI18n();
  const [source, setSource] = useState<Source>('draw');
  const [drawn, setDrawn] = useState<LoadedPicture | null>(null);
  const [picture, setPicture] = useState<LoadedPicture | null>(null);
  const [typed, setTyped] = useState<Typed>(() => loadTyped(host, fonts));
  const [saved, setSaved] = useState<readonly LoadedPicture[]>([]);
  const [keep, setKeep] = useState(true);
  const [removePaper, setRemovePaper] = useState(true);
  const [dated, setDated] = useState(false);
  const [day, setDay] = useState(() => dayOf(new Date()));

  useEffect(() => {
    if (!open) return;
    setSaved(loadSignatures(host));
    setDrawn(null);
    setPicture(null);
    setTyped(loadTyped(host, fonts));
    // Today, unless the user chooses another day.
    setDay(dayOf(new Date()));
    // The fonts arrive once; a window that is open is not started over for them.
  }, [open, host]);

  const date = dated ? writtenDate(day, language) : '';
  const withDate = (placing: Placing): Placing => (date ? { ...placing, date } : placing);
  const asPlacing = (signature: LoadedPicture): Placing => ({ kind: 'picture', data: signature.address, width: signature.width, height: signature.height });

  const usePicture = (signature: LoadedPicture, remember: boolean) => {
    if (remember) saveSignatures(host, withSignature(saved, signature));
    onChoose(withDate(asPlacing(signature)));
  };

  const forget = (signature: LoadedPicture) => {
    const rest = saved.filter((known) => known.address !== signature.address);
    setSaved(rest);
    saveSignatures(host, rest);
  };

  const choosePicture = async () => {
    const chosen = await onPickPicture();
    if (!chosen) return;
    // A photo of a signed sheet: keep the pen strokes, drop the sheet.
    setPicture(removePaper ? await withoutPaper(chosen).catch(() => chosen) : chosen);
  };

  const name = typed.text.trim();
  const ready = source === 'draw' ? drawn !== null : source === 'type' ? name !== '' : picture !== null;
  const confirm = () => {
    if (source === 'draw' && drawn) usePicture(drawn, keep);
    else if (source === 'picture' && picture) usePicture(picture, keep);
    else if (source === 'type' && name !== '') {
      host.saveData(TYPED_KEY, { ...typed, text: name });
      onChoose(withDate({ kind: 'text', text: name, font: typed.font, bold: typed.bold, italic: typed.italic, color: typed.color }));
    }
  };
  const typedFont = cssFont({ font: typed.font, bold: typed.bold, italic: typed.italic, size: 44 });

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.signVisual')} closeLabel={t('common.action.close')}>
      <div className={shapeStyles.form}>
        {saved.length > 0 && (
          <section className={toolStyles.saved} aria-label={t('pdf-organizer.signature.saved')}>
            <h3 className={shapeStyles.legend}>{t('pdf-organizer.signature.saved')}</h3>
            <ul className={toolStyles.savedList}>
              {saved.map((signature) => (
                <li key={signature.address} className={toolStyles.savedItem}>
                  <button type="button" className={toolStyles.savedUse} aria-label={t('pdf-organizer.signature.useSaved')} onClick={() => usePicture(signature, false)}>
                    <img src={signature.address} alt="" />
                  </button>
                  <IconButton variant="ghost" aria-label={t('pdf-organizer.signature.forget')} onClick={() => forget(signature)}>
                    <Icon name="trash-can" size={13} />
                  </IconButton>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div role="radiogroup" aria-label={t('pdf-organizer.signature.source')} className={styles.sources}>
          {SOURCES.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={source === option} className={styles.source} onClick={() => setSource(option)}>
              <Icon name={SOURCE_ICONS[option]} size={14} />
              {t(`pdf-organizer.signature.source.${option}`)}
            </button>
          ))}
        </div>

        {source === 'draw' && open && <SignaturePad onChange={setDrawn} />}

        {source === 'type' && (
          <div className={styles.typed}>
            <input
              type="text"
              className={styles.name}
              autoFocus
              value={typed.text}
              placeholder={t('pdf-organizer.signature.typeHint')}
              aria-label={t('pdf-organizer.signature.typeHint')}
              onChange={(event) => setTyped({ ...typed, text: event.target.value })}
            />
            <div className={styles.row}>
              <FontSelect className={shapeStyles.select} value={typed.font} onChange={(font) => setTyped({ ...typed, font })} families={fonts} />
              <IconButton variant={typed.bold ? 'primary' : 'ghost'} aria-label={t('pdf-organizer.marks.bold')} aria-pressed={typed.bold} onClick={() => setTyped({ ...typed, bold: !typed.bold })}>
                <Icon name="bold" size={14} />
              </IconButton>
              <IconButton variant={typed.italic ? 'primary' : 'ghost'} aria-label={t('pdf-organizer.marks.italic')} aria-pressed={typed.italic} onClick={() => setTyped({ ...typed, italic: !typed.italic })}>
                <Icon name="italic" size={14} />
              </IconButton>
              <input type="color" className={styles.color} value={typed.color} aria-label={t('pdf-organizer.signature.color')} onChange={(event) => setTyped({ ...typed, color: event.target.value })} />
            </div>
            <div className={styles.sample} style={{ fontFamily: typedFont.family, fontWeight: typedFont.weight, fontStyle: typedFont.style, color: typed.color }}>
              {name === '' ? <span className={styles.sampleEmpty}>{t('pdf-organizer.signature.typeSample')}</span> : name}
            </div>
          </div>
        )}

        {source === 'picture' && (
          <div className={styles.typed}>
            <div className={styles.sample}>{picture ? <img src={picture.address} alt="" /> : <span className={styles.sampleEmpty}>{t('pdf-organizer.signature.pictureSample')}</span>}</div>
            <div className={styles.row}>
              <Button onClick={() => void choosePicture()}>
                <Icon name="image" size={14} />
                {t('pdf-organizer.signature.fromPicture')}
              </Button>
              <label className={shapeStyles.choice}>
                <input type="checkbox" checked={removePaper} onChange={(event) => setRemovePaper(event.target.checked)} />
                {t('pdf-organizer.signature.removePaper')}
              </label>
            </div>
          </div>
        )}

        <div className={styles.date}>
          <label className={shapeStyles.choice}>
            <input type="checkbox" checked={dated} onChange={(event) => setDated(event.target.checked)} />
            {t('pdf-organizer.signature.withDate')}
          </label>
          {dated && (
            <>
              <input type="date" value={day} aria-label={t('pdf-organizer.signature.date')} onChange={(event) => setDay(event.target.value)} />
              <Button disabled={day === dayOf(new Date())} onClick={() => setDay(dayOf(new Date()))}>
                {t('pdf-organizer.signature.today')}
              </Button>
              <span className={styles.dateShown}>{date}</span>
            </>
          )}
        </div>
        {dated && <p className={shapeStyles.lead}>{t('pdf-organizer.signature.dateNote')}</p>}

        {source !== 'type' && (
          <label className={shapeStyles.choice}>
            <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
            {t('pdf-organizer.signature.keep')}
          </label>
        )}
        <p className={shapeStyles.lead}>{t('pdf-organizer.signature.note')}</p>

        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button variant="primary" disabled={!ready} onClick={confirm}>
            {t('pdf-organizer.signature.place')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
