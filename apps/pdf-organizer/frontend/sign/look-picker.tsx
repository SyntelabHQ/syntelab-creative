import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button } from '@syntelab/ui-kit';
import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LoadedPicture } from '../document/load-picture';
import shapeStyles from '../organize/shape-dialog.module.css';
import { PresetDialog } from './preset-dialog';
import { lastPresetId, loadPresets, rememberPreset, savePresets, STANDARD_ID, STANDARD_PRESET, withPreset } from './signature-presets';
import type { SignatureFacts, SignaturePreset, SignatureWords } from './signature-presets';
import { SignaturePreview } from './signature-preview';
import styles from './signing.module.css';

/** The words the lines of a signature start with, in the language of the program. */
export function signatureWords(t: (key: string) => string): SignatureWords {
  return { signedBy: t('pdf-organizer.sign.look.signedBy'), date: t('pdf-organizer.sign.look.date'), reason: t('pdf-organizer.sign.look.reason'), location: t('pdf-organizer.sign.look.location') };
}

/** The looks a signature can have, and the one chosen. */
export interface LookChoice {
  /** The one that is always there, then those the user made. */
  readonly all: readonly SignaturePreset[];
  readonly preset: SignaturePreset;
  readonly choose: (id: string) => void;
  /** Keeps a look the user made or changed, and chooses it. */
  readonly keep: (preset: SignaturePreset) => void;
  /** Forgets the chosen look. */
  readonly forget: () => void;
  /** Makes the chosen look the one offered first next time. */
  readonly remember: () => void;
}

type Storage = Pick<AppHost, 'loadData' | 'saveData'>;

/** The looks kept on this computer, read anew each time `active` becomes true. */
export function useSignatureLooks(host: Storage, active: boolean): LookChoice {
  const t = useTranslation();
  const [presets, setPresets] = useState<readonly SignaturePreset[]>([]);
  const [presetId, setPresetId] = useState(STANDARD_ID);

  useEffect(() => {
    if (!active) return;
    setPresets(loadPresets(host));
    setPresetId(lastPresetId(host));
    // `host` changes when the tab moves to the back; where it keeps data does not.
  }, [active, host.loadData]);

  const standard: SignaturePreset = { ...STANDARD_PRESET, name: t('pdf-organizer.sign.preset.standard') };
  const preset = presets.find((known) => known.id === presetId) ?? standard;
  const store = (next: readonly SignaturePreset[]) => {
    setPresets(next);
    savePresets(host, next);
  };
  return {
    all: [standard, ...presets],
    preset,
    choose: setPresetId,
    keep: (saved) => {
      store(withPreset(presets, saved));
      setPresetId(saved.id);
    },
    forget: () => {
      store(presets.filter((known) => known.id !== preset.id));
      setPresetId(STANDARD_ID);
    },
    remember: () => rememberPreset(host, preset.id),
  };
}

export interface LookPickerProps {
  readonly looks: LookChoice;
  /** What the lines are shown with: the signature that is about to be made, as far as it is known. */
  readonly facts: SignatureFacts;
  /** Asks the user for a picture file; resolves to null when none was chosen or it cannot be read. */
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
  readonly disabled?: boolean;
}

/** How the signature looks where it shows: one of the kept looks, shown as it will be, with the making and changing of them. */
export function LookPicker({ looks, facts, onPickPicture, disabled = false }: LookPickerProps) {
  const t = useTranslation();
  const id = useId();
  /** The look being made or changed: `new`, the id of one, or null when the editor is closed. */
  const [editing, setEditing] = useState<string | null>(null);
  const words = signatureWords(t);
  const { preset } = looks;
  const own = preset.id !== STANDARD_ID;
  // While a look is set up, every line it can write has something to show.
  const sampleFacts = { ...facts, reason: facts.reason || t('pdf-organizer.sign.look.aReason'), location: facts.location || t('pdf-organizer.sign.look.aPlace') };

  return (
    <section className={shapeStyles.field}>
      <div className={styles.fileRow}>
        <label className={shapeStyles.legend} htmlFor={id}>
          {t('pdf-organizer.sign.preset')}
        </label>
        <select id={id} className={shapeStyles.select} value={preset.id} disabled={disabled} onChange={(event) => looks.choose(event.target.value)}>
          {looks.all.map((known) => (
            <option key={known.id} value={known.id}>
              {known.name}
            </option>
          ))}
        </select>
        <Button disabled={disabled} onClick={() => setEditing('new')}>
          {t('pdf-organizer.sign.preset.new')}
        </Button>
        <Button disabled={disabled || !own} onClick={() => setEditing(preset.id)}>
          {t('pdf-organizer.sign.preset.change')}
        </Button>
        <Button disabled={disabled || !own} onClick={looks.forget}>
          {t('pdf-organizer.sign.preset.delete')}
        </Button>
      </div>
      <SignaturePreview preset={preset} facts={facts} words={words} />
      {/* Outside whatever form this is part of: it has a form of its own. */}
      {createPortal(
      <PresetDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        preset={editing === null || editing === 'new' ? null : preset}
        facts={sampleFacts}
        words={words}
        onPickPicture={onPickPicture}
        onSave={(saved) => {
          looks.keep(saved);
          setEditing(null);
        }}
      />,
        document.body,
      )}
    </section>
  );
}
