import { useTranslation } from '@syntelab/i18n';
import type { ReactNode } from 'react';
import { SHEET_GROUPS, sheetsOf } from './sheets';
import type { SheetName } from './sheets';

export interface SheetSelectProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly className?: string;
  readonly id?: string;
  /** Already translated; for a list that has no visible label of its own. */
  readonly label?: string;
  /** Choices that are not sheets (the printer's own paper, a size typed by hand), before the sheets. */
  readonly children?: ReactNode;
}

/** A list of every standard sheet, by family, each with its size. */
export function SheetSelect({ value, onChange, className, id, label, children }: SheetSelectProps) {
  const t = useTranslation();
  const size = (name: SheetName, width: number, height: number, text: string) => (
    <option key={name} value={name}>
      {text} ({t('pdf-organizer.shape.millimetres', { width, height })})
    </option>
  );
  return (
    <select id={id} className={className} value={value} aria-label={label} onChange={(event) => onChange(event.target.value)}>
      {children}
      {SHEET_GROUPS.map((group) => (
        <optgroup key={group} label={t(`pdf-organizer.sheetGroup.${group}`)}>
          {sheetsOf(group).map(([name, sheet]) => size(name, sheet.width, sheet.height, sheet.label))}
        </optgroup>
      ))}
    </select>
  );
}
