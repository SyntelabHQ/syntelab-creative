import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import { visibleFields, withValue } from './tool-definitions';
import type { Tool, ToolValues } from './tool-definitions';
import { ToolFieldInput } from './tool-field';
import styles from './tool-fields.module.css';

export interface ToolFieldsProps {
  readonly tool: Tool;
  readonly values: ToolValues;
  readonly onChange: (values: ToolValues) => void;
  readonly disabled: boolean;
}

/**
 * The choices of a tool: those most people need first, the rest a click
 * away under "More choices", so a tool with many stays short to read. A
 * choice that only matters with another (the column, when lines are
 * compared by a column) is shown only then.
 */
export function ToolFields({ tool, values, onChange, disabled }: ToolFieldsProps) {
  const t = useTranslation();
  const shown = visibleFields(tool, values);
  const first = shown.filter((field) => !field.more);
  const more = shown.filter((field) => field.more);
  // Open by itself while one of the further choices is not as the tool ships it: nothing set is out of sight.
  const changed = more.some((field) => (values[field.name] ?? field.initial) !== field.initial);
  const [opened, setOpened] = useState(false);
  const open = opened || changed;
  const input = (field: (typeof shown)[number]) => <ToolFieldInput key={field.name} tool={tool} field={field} value={values[field.name]} disabled={disabled} onChange={(value) => onChange(withValue(tool, values, field.name, value))} />;
  return (
    <>
      {first.map(input)}
      {more.length > 0 && (
        <>
          <button type="button" className={styles.more} aria-expanded={open} disabled={changed} onClick={() => setOpened(!opened)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
            {t('scribe.tools.moreChoices')}
          </button>
          {open && <div className={styles.further}>{more.map(input)}</div>}
        </>
      )}
    </>
  );
}
