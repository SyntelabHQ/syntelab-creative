import { useTranslation } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { HeadFormat } from '../settings/units-settings';
import styles from './table-bar.module.css';

/** The kinds of file a table is read from and written to. */
export type ImportKind = 'excel' | 'csv' | 'tsv' | 'auto';
export type ExportKind = 'excel' | 'csv' | 'tsv' | 'json';

export interface TableBarProps {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly hasSelection: boolean;
  readonly hasValues: boolean;
  readonly headFormat: HeadFormat;
  readonly withTitles: boolean;
  readonly withRowNumbers: boolean;
  /** Some column was given a width of its own: there is something to put back. */
  readonly canFit: boolean;
  /** Puts every column back to sharing the room of the table. */
  readonly onFit: () => void;
  readonly onSettings: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  /** `transposed`: rows become columns and columns rows. */
  readonly onCopy: (what: 'all' | 'selected', transposed: boolean) => void;
  readonly onPaste: (transposed: boolean) => void;
  readonly onImport: (kind: ImportKind, transposed: boolean) => void;
  readonly onExport: (kind: ExportKind, transposed: boolean) => void;
  readonly onClearSelected: () => void;
  readonly onClearAll: () => void;
  readonly onHeadFormat: (format: HeadFormat) => void;
  readonly onWithTitles: () => void;
  readonly onWithRowNumbers: () => void;
  readonly onReset: () => void;
  /** Makes the columns of the table those every table of this converter starts with. */
  readonly onStartWith: () => void;
}

interface Item {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly disabled?: boolean;
  /** A choice or a switch that is on. */
  readonly checked?: boolean;
  readonly danger?: boolean;
  /** Stays open after it is chosen: a switch can be flipped again. */
  readonly stays?: boolean;
  readonly run: () => void;
}

interface Section {
  readonly id: string;
  readonly title?: string;
  readonly icon?: string;
  readonly items: readonly Item[];
}

/**
 * The bar of the table: always over its head, whatever the layout of the
 * program. Undo and redo at one end; copy, paste, import, export, the two
 * ways of emptying, and the options at the other.
 */
export function TableBar(props: TableBarProps) {
  const t = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const away = (event: PointerEvent) => event.target instanceof Node && !bar.current?.contains(event.target) && setOpen(null);
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(null);
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const usual = t('units.bar.usual');
  const transposed = t('units.bar.transposed');

  const menu = (id: string, label: string, icon: string, sections: readonly Section[], more: { readonly disabled?: boolean; readonly iconOnly?: boolean } = {}): ReactNode => (
    <div className={styles.holder}>
      <button type="button" className={styles.button} data-icon-only={more.iconOnly === true} aria-haspopup="menu" aria-expanded={open === id} aria-label={more.iconOnly ? label : undefined} data-tooltip={more.iconOnly && open !== id ? label : undefined} disabled={more.disabled} onClick={() => setOpen(open === id ? null : id)}>
        <Icon name={icon} size={14} />
        {!more.iconOnly && (
          <>
            <span>{label}</span>
            <Icon name="chevron-down" size={10} />
          </>
        )}
      </button>
      {open === id && (
        <div className={styles.menu} role="menu" aria-label={label}>
          {sections.map((section) => (
            <div key={section.id} className={styles.section} role="group" aria-label={section.title}>
              {section.title && (
                <div className={styles.sectionTitle}>
                  {section.icon && <Icon name={section.icon} size={12} />}
                  {section.title}
                </div>
              )}
              {section.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                  aria-checked={item.checked}
                  className={styles.item}
                  data-danger={item.danger === true}
                  data-titled={section.title !== undefined}
                  disabled={item.disabled}
                  onClick={() => {
                    item.run();
                    if (!item.stays) setOpen(null);
                  }}
                >
                  <Icon name={item.icon} size={13} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const copy = (isTransposed: boolean): Section => ({
    id: isTransposed ? 'transposed' : 'usual',
    title: isTransposed ? transposed : usual,
    icon: isTransposed ? 'right-left' : 'copy',
    items: [
      { id: 'all', label: t('units.bar.copyAll'), icon: isTransposed ? 'right-left' : 'copy', disabled: !props.hasValues, run: () => props.onCopy('all', isTransposed) },
      { id: 'selected', label: t('units.bar.copySelected'), icon: isTransposed ? 'right-left' : 'copy', disabled: !props.hasSelection, run: () => props.onCopy('selected', isTransposed) },
    ],
  });

  const paste = (isTransposed: boolean): Section => ({
    id: isTransposed ? 'transposed' : 'usual',
    title: isTransposed ? transposed : usual,
    icon: isTransposed ? 'right-left' : 'paste',
    items: [{ id: 'paste', label: t(isTransposed ? 'units.bar.pasteTransposed' : 'units.bar.paste'), icon: isTransposed ? 'right-left' : 'paste', run: () => props.onPaste(isTransposed) }],
  });

  const imported = (isTransposed: boolean): Section => ({
    id: isTransposed ? 'transposed' : 'usual',
    title: isTransposed ? transposed : usual,
    icon: isTransposed ? 'right-left' : 'file-arrow-down',
    items: [
      { id: 'excel', label: t('units.bar.importExcel'), icon: 'table-cells', run: () => props.onImport('excel', isTransposed) },
      { id: 'csv', label: t('units.bar.importCsv'), icon: 'file', run: () => props.onImport('csv', isTransposed) },
      { id: 'tsv', label: t('units.bar.importTsv'), icon: 'file', run: () => props.onImport('tsv', isTransposed) },
      // The kind found by itself: offered once, as the model does.
      ...(isTransposed ? [] : [{ id: 'auto', label: t('units.bar.importAuto'), icon: 'wand-magic-sparkles', run: () => props.onImport('auto', false) }]),
    ],
  });

  const exported = (isTransposed: boolean): Section => ({
    id: isTransposed ? 'transposed' : 'usual',
    title: isTransposed ? transposed : usual,
    icon: isTransposed ? 'right-left' : 'file-export',
    items: [
      { id: 'excel', label: t('units.bar.exportExcel'), icon: 'table-cells', run: () => props.onExport('excel', isTransposed) },
      { id: 'csv', label: t('units.bar.exportCsv'), icon: 'file', run: () => props.onExport('csv', isTransposed) },
      { id: 'tsv', label: t('units.bar.exportTsv'), icon: 'file', run: () => props.onExport('tsv', isTransposed) },
      { id: 'json', label: t('units.bar.exportJson'), icon: 'file', run: () => props.onExport('json', isTransposed) },
    ],
  });

  const format = (id: HeadFormat, icon: string): Item => ({ id, label: t(`units.bar.title.${id}`), icon: props.headFormat === id ? 'check' : icon, checked: props.headFormat === id, stays: true, run: () => props.onHeadFormat(id) });
  const flag = (id: string, on: boolean, run: () => void): Item => ({ id, label: t(`units.bar.${id}`), icon: on ? 'square-check' : 'square', checked: on, stays: true, run });
  const options: Section[] = [
    { id: 'title', title: t('units.bar.titleFormat'), icon: 'font', items: [format('both', 'font'), format('name', 'font'), format('symbol', 'font')] },
    { id: 'copied', title: t('units.bar.copyOptions'), icon: 'rectangle-list', items: [flag('withTitles', props.withTitles, props.onWithTitles), flag('withRowNumbers', props.withRowNumbers, props.onWithRowNumbers)] },
    { id: 'start', items: [{ id: 'startWith', label: t('units.bar.startWith'), icon: 'table-columns', run: props.onStartWith }] },
    { id: 'settings', items: [{ id: 'settings', label: t('units.command.settings'), icon: 'gear', run: props.onSettings }] },
    { id: 'reset', items: [{ id: 'reset', label: t('units.bar.reset'), icon: 'rotate-left', danger: true, run: props.onReset }] },
  ];

  return (
    <div ref={bar} className={styles.bar} role="toolbar" aria-label={t('units.bar.title')}>
      <button type="button" className={styles.button} data-icon-only="true" aria-label={t('units.bar.undo')} data-tooltip={t('units.bar.undo')} disabled={!props.canUndo} onClick={props.onUndo}>
        <Icon name="arrow-rotate-left" size={14} />
      </button>
      <button type="button" className={styles.button} data-icon-only="true" aria-label={t('units.bar.redo')} data-tooltip={t('units.bar.redo')} disabled={!props.canRedo} onClick={props.onRedo}>
        <Icon name="arrow-rotate-right" size={14} />
      </button>
      <button type="button" className={styles.button} data-icon-only="true" aria-label={t('units.bar.fit')} data-tooltip={t('units.bar.fitHint')} disabled={!props.canFit} onClick={props.onFit}>
        <Icon name="arrows-left-right" size={14} />
      </button>
      <span className={styles.spring} />
      {menu('copy', t('units.bar.copy'), 'copy', [copy(false), copy(true)])}
      {menu('paste', t('units.bar.paste'), 'paste', [paste(false), paste(true)])}
      {menu('import', t('units.bar.import'), 'file-arrow-down', [imported(false), imported(true)])}
      {menu('export', t('units.bar.export'), 'file-export', [exported(false), exported(true)], { disabled: !props.hasValues })}
      <button type="button" className={styles.button} data-icon-only="true" aria-label={t('units.bar.clearSelection')} data-tooltip={t('units.bar.clearSelection')} disabled={!props.hasSelection || !props.hasValues} onClick={props.onClearSelected}>
        <Icon name="eraser" size={14} />
      </button>
      <button type="button" className={styles.button} data-icon-only="true" data-danger="true" aria-label={t('units.bar.clearAll')} data-tooltip={t('units.bar.clearAll')} disabled={!props.hasValues} onClick={props.onClearAll}>
        <Icon name="trash-can" size={14} />
      </button>
      {menu('options', t('units.bar.options'), 'gear', options, { iconOnly: true })}
    </div>
  );
}
