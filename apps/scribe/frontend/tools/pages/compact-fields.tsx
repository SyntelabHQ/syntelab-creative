import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { PROGRAM_LANGUAGE, visibleFields, withValue } from '../tool-definitions';
import type { Tool, ToolField, ToolValues } from '../tool-definitions';
import { languageName } from '../tool-field';
import styles from './compact-fields.module.css';

export interface CompactFieldsProps {
  readonly tool: Tool;
  readonly values: ToolValues;
  readonly onChange: (values: ToolValues) => void;
  readonly disabled: boolean;
}

/** A name this short stands beside its control; a longer one stands over it. */
const SHORT_NAME = 24;
/** A choice of a few short options is laid out as buttons side by side: up to this many, of this many letters in all. */
const FEW_OPTIONS = 3;
const SHORT_OPTIONS = 34;
/** A switch whose name is longer than this takes the whole width instead of half. */
const LONG_SWITCH = 30;

/**
 * The choices of a tool, laid out to take little height: a name beside its
 * control where both fit on a line, switches two to a line, a choice of a few
 * as buttons side by side. The rest is as in `tool-fields.tsx`: the choices
 * fewer people need are under "More choices", and one that only matters with
 * another is shown only then.
 */
export function CompactFields({ tool, values, onChange, disabled }: CompactFieldsProps) {
  const { t, has, language } = useI18n();
  const shown = visibleFields(tool, values);
  const first = shown.filter((field) => !field.more);
  const more = shown.filter((field) => field.more);
  const changed = more.some((field) => (values[field.name] ?? field.initial) !== field.initial);
  const [opened, setOpened] = useState(false);
  const open = opened || changed;

  const nameOf = (field: ToolField) => {
    const own = `scribe.field.${tool.id}.${field.name}`;
    return t(has(own) ? own : `scribe.field.${field.name}`);
  };
  const optionName = (field: ToolField, option: string) => {
    const own = `scribe.option.${tool.id}.${field.name}.${option}`;
    return t(has(own) ? own : `scribe.option.${field.name}.${option}`);
  };
  const set = (field: ToolField, value: string | number | boolean) => onChange(withValue(tool, values, field.name, value));

  /** A name with its control: side by side when the name is short, the name on top when it is not. */
  const row = (field: ToolField, name: string, control: ReactNode, beside = name.length <= SHORT_NAME) => (
    <label key={field.name} className={styles.row} data-beside={beside}>
      <span className={styles.name}>{name}</span>
      {control}
    </label>
  );

  const buttons = (field: Extract<ToolField, { kind: 'choice' }>, name: string) => (
    <div key={field.name} className={styles.group} role="radiogroup" aria-label={name}>
      <span className={styles.name}>{name}</span>
      <div className={styles.options} data-many={field.options.length > FEW_OPTIONS}>
        {field.options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={(values[field.name] ?? field.initial) === option} className={styles.option} disabled={disabled} onClick={() => set(field, option)}>
            {optionName(field, option)}
          </button>
        ))}
      </div>
    </div>
  );

  const one = (field: ToolField): ReactNode => {
    const name = nameOf(field);
    const value = values[field.name];
    if (field.kind === 'choice') {
      const few = field.options.length <= FEW_OPTIONS && field.options.reduce((letters, option) => letters + optionName(field, option).length, 0) <= SHORT_OPTIONS;
      if (field.spread || few) return buttons(field, name);
      return row(
        field,
        name,
        <select className={styles.control} value={String(value ?? field.initial)} disabled={disabled} onChange={(event) => set(field, event.target.value)}>
          {field.options.map((option) => (
            <option key={option} value={option}>
              {optionName(field, option)}
            </option>
          ))}
        </select>,
      );
    }
    if (field.kind === 'language') {
      const named = field.options.map((code) => ({ code, name: languageName(code, language) })).sort((left, right) => left.name.localeCompare(right.name, language));
      return row(
        field,
        name,
        <select className={styles.control} value={String(value ?? field.initial)} disabled={disabled} onChange={(event) => set(field, event.target.value)}>
          <option value={PROGRAM_LANGUAGE}>{t('scribe.option.language.auto', { language: languageName(language, language) })}</option>
          {named.map((known) => (
            <option key={known.code} value={known.code}>
              {known.name}
            </option>
          ))}
        </select>,
      );
    }
    if (field.kind === 'lines') return row(field, name, <textarea className={styles.lines} dir="auto" spellCheck={false} rows={4} value={String(value ?? '')} disabled={disabled} onChange={(event) => set(field, event.target.value)} />, false);
    // A number is short whatever it is called: it always stands at the end of the line of its name.
    if (field.kind === 'number') return row(field, name, <input type="number" className={styles.number} min={field.min} max={field.max} value={Number(value ?? field.initial)} disabled={disabled} onChange={(event) => set(field, event.target.valueAsNumber)} />, true);
    if (field.kind === 'text') return row(field, name, <input type="text" className={styles.control} dir="auto" spellCheck={false} value={String(value ?? '')} disabled={disabled} onChange={(event) => set(field, event.target.value)} />);
    return null;
  };

  /** The fields in their order, with the switches that follow each other gathered two to a line. */
  const laidOut = (fields: readonly ToolField[]): ReactNode[] => {
    const out: ReactNode[] = [];
    let switches: Extract<ToolField, { kind: 'flag' }>[] = [];
    const flush = () => {
      if (switches.length === 0) return;
      out.push(
        <div key={`switches-${switches[0]?.name}`} className={styles.switches}>
          {switches.map((field) => {
            const name = nameOf(field);
            return (
              <label key={field.name} className={styles.switch} data-wide={name.length > LONG_SWITCH}>
                <input type="checkbox" checked={(values[field.name] ?? field.initial) === true} disabled={disabled} onChange={(event) => set(field, event.target.checked)} />
                <span>{name}</span>
              </label>
            );
          })}
        </div>,
      );
      switches = [];
    };
    for (const field of fields) {
      if (field.kind === 'flag') switches.push(field);
      else {
        flush();
        out.push(one(field));
      }
    }
    flush();
    return out;
  };

  return (
    <>
      {laidOut(first)}
      {more.length > 0 && (
        <>
          <button type="button" className={styles.more} aria-expanded={open} disabled={changed} onClick={() => setOpened(!opened)}>
            <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
            {t('scribe.tools.moreChoices')}
          </button>
          {open && <div className={styles.further}>{laidOut(more)}</div>}
        </>
      )}
    </>
  );
}
