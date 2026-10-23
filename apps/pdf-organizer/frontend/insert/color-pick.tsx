import { useTranslation } from '@syntelab/i18n';
import { tooltip } from '@syntelab/ui-kit';
import styles from './color-pick.module.css';

/** The colors offered at a click; any other is chosen in the system's color window. */
const COLOR_PRESETS = [
  { name: 'black', color: '#000000' },
  { name: 'grey', color: '#6b7280' },
  { name: 'red', color: '#d62828' },
  { name: 'blue', color: '#1f5ac7' },
  { name: 'green', color: '#218c3d' },
  { name: 'orange', color: '#e07a00' },
] as const;

export interface ColorPickProps {
  /** `#rrggbb`. */
  readonly color: string;
  readonly onChange: (color: string) => void;
}

/** A color: a few to pick at a click, and a box that opens the system's color window for any other. */
export function ColorPick({ color, onChange }: ColorPickProps) {
  const t = useTranslation();
  return (
    <span className={styles.colors}>
      {COLOR_PRESETS.map((preset) => (
        <button
          key={preset.name}
          type="button"
          className={styles.preset}
          style={{ background: preset.color }}
          aria-label={t(`pdf-organizer.color.${preset.name}`)}
          aria-pressed={color.toLowerCase() === preset.color}
          {...tooltip(t(`pdf-organizer.color.${preset.name}`), 'bottom')}
          onClick={() => onChange(preset.color)}
        />
      ))}
      <label className={styles.custom} {...tooltip(t('pdf-organizer.color.custom'), 'bottom')}>
        <input type="color" value={color} aria-label={t('pdf-organizer.color.custom')} onChange={(event) => onChange(event.target.value)} />
      </label>
    </span>
  );
}
