import { useTranslation } from '@syntelab/i18n';
import { BUILT_IN_FONTS } from './mark';

export interface FontSelectProps {
  /** A built-in font (`sans`, `serif`, `mono`) or the name of a font of the computer. */
  readonly value: string;
  readonly onChange: (font: string) => void;
  /** The fonts installed on the computer (see `fonts.ts`). */
  readonly families: readonly string[];
  readonly className?: string;
}

/** A list of fonts: the three every PDF reader has, then the fonts of this computer, each shown in itself. */
export function FontSelect({ value, onChange, families, className }: FontSelectProps) {
  const t = useTranslation();
  const known = (BUILT_IN_FONTS as readonly string[]).includes(value) || families.includes(value);
  return (
    <select className={className} value={value} aria-label={t('pdf-organizer.marks.font')} onChange={(event) => onChange(event.target.value)}>
      <optgroup label={t('pdf-organizer.marks.fontsBuiltIn')}>
        {BUILT_IN_FONTS.map((family) => (
          <option key={family} value={family}>
            {t(`pdf-organizer.marks.font.${family}`)}
          </option>
        ))}
      </optgroup>
      {(families.length > 0 || !known) && (
        <optgroup label={t('pdf-organizer.marks.fontsInstalled')}>
          {/* A font named by a document made on another computer stays listed, so it is not lost by looking. */}
          {!known && <option value={value}>{value}</option>}
          {families.map((family) => (
            <option key={family} value={family} style={{ fontFamily: `"${family.replace(/"/g, '')}"` }}>
              {family}
            </option>
          ))}
        </optgroup>
      )}
    </select>
  );
}
