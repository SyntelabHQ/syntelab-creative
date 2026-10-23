import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import { withoutPaper } from '../insert/ink-only';
import { SignaturePad } from '../insert/signature-pad';
import shapeStyles from '../organize/shape-dialog.module.css';
import type { SignatureFacts, SignaturePreset, SignatureWords } from './signature-presets';
import { SignaturePreview } from './signature-preview';
import styles from './signing.module.css';

export interface PresetDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The look to change; null to make a new one. */
  readonly preset: SignaturePreset | null;
  /** What the lines are shown with while the look is set up. */
  readonly facts: SignatureFacts;
  readonly words: SignatureWords;
  /** Asks the user for a picture file; resolves to null when none was chosen or it cannot be read. */
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
  readonly onSave: (preset: SignaturePreset) => void;
}

/** Where the picture of a look comes from. */
const SOURCES = ['none', 'image', 'draw'] as const;
type Source = (typeof SOURCES)[number];
const SOURCE_ICONS: Record<Source, string> = { none: 'ban', image: 'image', draw: 'signature' };
const LINES = ['showName', 'showDate', 'showReason', 'showLocation', 'labels'] as const;

const fresh = (): SignaturePreset => ({ id: `preset-${Date.now().toString(36)}`, name: '', picture: null, showName: true, showDate: true, showReason: false, showLocation: false, labels: true, extra: '' });

/**
 * Makes or changes a look for signatures: a picture (a stamp, a handwritten
 * signature, drawn here or from a file) or none, the lines of text, lines of
 * one's own (a role, a company), and the name it is kept under.
 */
export function PresetDialog({ open, onClose, preset, facts, words, onPickPicture, onSave }: PresetDialogProps) {
  const t = useTranslation();
  const [edited, setEdited] = useState<SignaturePreset>(fresh);
  const [source, setSource] = useState<Source>('none');
  const [removePaper, setRemovePaper] = useState(false);

  useEffect(() => {
    if (!open) return;
    setEdited(preset ?? fresh());
    setSource(preset?.picture ? 'image' : 'none');
  }, [open, preset]);

  const change = (part: Partial<SignaturePreset>) => setEdited((current) => ({ ...current, ...part }));
  const choosePicture = async () => {
    const chosen = await onPickPicture();
    if (!chosen) return;
    // A photo of a signed sheet: keep the pen strokes, drop the sheet. A stamp is kept as it is.
    change({ picture: removePaper ? await withoutPaper(chosen).catch(() => chosen) : chosen });
  };
  const shown = { ...edited, picture: source === 'none' ? null : edited.picture };
  const something = shown.picture !== null || shown.showName || shown.showDate || shown.showReason || shown.showLocation || shown.extra.trim() !== '';

  return (
    <Dialog open={open} onClose={onClose} title={t(preset ? 'pdf-organizer.sign.preset.edit' : 'pdf-organizer.sign.preset.create')} closeLabel={t('common.action.close')}>
      <form
        className={shapeStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (something && edited.name.trim() !== '') onSave({ ...shown, name: edited.name.trim() });
        }}
      >
        <div role="radiogroup" aria-label={t('pdf-organizer.sign.preset.picture')} className={styles.sources}>
          {SOURCES.map((option) => (
            <button key={option} type="button" role="radio" aria-checked={source === option} className={styles.source} onClick={() => setSource(option)}>
              <Icon name={SOURCE_ICONS[option]} size={14} />
              {t(`pdf-organizer.sign.preset.picture.${option}`)}
            </button>
          ))}
        </div>

        {source === 'draw' && open && <SignaturePad onChange={(drawn) => {
            if (drawn) change({ picture: drawn });
          }} />}
        {source === 'image' && (
          <div className={styles.fileRow}>
            <Button onClick={() => void choosePicture()}>
              <Icon name="image" size={14} />
              {t('pdf-organizer.signature.fromPicture')}
            </Button>
            {edited.picture && <Button onClick={() => change({ picture: null })}>{t('pdf-organizer.sign.preset.clearPicture')}</Button>}
            <label className={shapeStyles.choice}>
              <input type="checkbox" checked={removePaper} onChange={(event) => setRemovePaper(event.target.checked)} />
              {t('pdf-organizer.signature.removePaper')}
            </label>
          </div>
        )}

        <SignaturePreview preset={shown} facts={facts} words={words} />

        <fieldset className={styles.lines}>
          <legend className={shapeStyles.legend}>{t('pdf-organizer.sign.preset.lines')}</legend>
          {LINES.map((line) => (
            <label key={line} className={shapeStyles.choice}>
              <input type="checkbox" checked={edited[line]} onChange={(event) => change({ [line]: event.target.checked })} />
              {t(`pdf-organizer.sign.preset.${line}`)}
            </label>
          ))}
        </fieldset>
        <label className={styles.stacked}>
          <span>{t('pdf-organizer.sign.preset.extra')}</span>
          <textarea className={styles.field} dir="auto" rows={2} maxLength={300} value={edited.extra} placeholder={t('pdf-organizer.sign.preset.extraHint')} onChange={(event) => change({ extra: event.target.value })} />
        </label>
        <label className={styles.stacked}>
          <span>{t('pdf-organizer.sign.preset.name')}</span>
          <input type="text" className={styles.field} dir="auto" maxLength={60} required value={edited.name} placeholder={t('pdf-organizer.sign.preset.nameHint')} onChange={(event) => change({ name: event.target.value })} />
        </label>

        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!something || edited.name.trim() === ''}>
            {t('common.action.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
