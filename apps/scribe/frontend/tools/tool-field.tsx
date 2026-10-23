import { useI18n } from '@syntelab/i18n';
import { PROGRAM_LANGUAGE } from './tool-definitions';
import type { Tool, ToolField } from './tool-definitions';
import styles from './tool-field.module.css';

export interface ToolFieldInputProps {
  readonly tool: Tool;
  readonly field: ToolField;
  readonly value: string | number | boolean | undefined;
  readonly onChange: (value: string | number | boolean) => void;
  readonly disabled: boolean;
}

/** The name of a language in the language of the program; its code when the name is not known. */
export function languageName(code: string, shownIn: string): string {
  try {
    return new Intl.DisplayNames([shownIn], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** One choice of a tool, as the control that sets it: a switch, a list, a number or a text. */
export function ToolFieldInput({ tool, field, value, onChange, disabled }: ToolFieldInputProps) {
  const { t, has, language } = useI18n();
  const own = `scribe.field.${tool.id}.${field.name}`;
  const label = t(has(own) ? own : `scribe.field.${field.name}`);
  if (field.kind === 'flag') {
    return (
      <label className={styles.flag}>
        <input type="checkbox" checked={value === true} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        {label}
      </label>
    );
  }
  if (field.kind === 'choice' && field.spread) {
    const option = (name: string) => t(has(`scribe.option.${tool.id}.${field.name}.${name}`) ? `scribe.option.${tool.id}.${field.name}.${name}` : `scribe.option.${field.name}.${name}`);
    return (
      <div className={styles.field} role="radiogroup" aria-label={label}>
        <span>{label}</span>
        <div className={styles.spread}>
          {field.options.map((name) => (
            <button key={name} type="button" role="radio" aria-checked={(value ?? field.initial) === name} className={styles.option} disabled={disabled} onClick={() => onChange(name)}>
              {option(name)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (field.kind === 'choice') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.control} value={String(value ?? field.initial)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {t(has(`scribe.option.${tool.id}.${field.name}.${option}`) ? `scribe.option.${tool.id}.${field.name}.${option}` : `scribe.option.${field.name}.${option}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.kind === 'language') {
    const named = field.options.map((code) => ({ code, name: languageName(code, language) })).sort((one, other) => one.name.localeCompare(other.name, language));
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <select className={styles.control} value={String(value ?? field.initial)} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
          <option value={PROGRAM_LANGUAGE}>{t('scribe.option.language.auto', { language: languageName(language, language) })}</option>
          {named.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (field.kind === 'lines') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <textarea className={styles.lines} dir="auto" spellCheck={false} rows={5} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
      </label>
    );
  }
  if (field.kind === 'number') {
    return (
      <label className={styles.field}>
        <span>{label}</span>
        <input type="number" className={styles.control} min={field.min} max={field.max} value={Number(value ?? field.initial)} disabled={disabled} onChange={(event) => onChange(event.target.valueAsNumber)} />
      </label>
    );
  }
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input type="text" className={styles.control} dir="auto" spellCheck={false} value={String(value ?? '')} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}
