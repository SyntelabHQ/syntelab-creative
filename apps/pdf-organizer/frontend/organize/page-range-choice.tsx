import { useTranslation } from '@syntelab/i18n';
import { useId } from 'react';
import { pagesOf, parsePageList } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import styles from './page-range-choice.module.css';
import shapeStyles from './shape-dialog.module.css';

export interface PageRangeChoiceProps {
  readonly range: PageRange;
  readonly onRangeChange: (range: PageRange) => void;
  readonly parity: Parity;
  readonly onParityChange: (parity: Parity) => void;
  /** The places (from 0) of the chosen pages: the selection, or the page in view. */
  readonly chosen: ReadonlySet<number>;
  readonly pageCount: number;
  /** Translation key of the sentence that says how many pages it comes to (`{count}`). */
  readonly countKey?: string;
  /** How many pages it comes to, when the owner leaves some of the range out (a first page without a number). */
  readonly count?: number;
}

/**
 * Which pages a change is for: the chosen ones, the whole document, a
 * stretch, or a list typed by hand; and of those, all, the odd or the even.
 */
export function PageRangeChoice({ range, onRangeChange, parity, onParityChange, chosen, pageCount, countKey = 'pdf-organizer.range.count', count }: PageRangeChoiceProps) {
  const t = useTranslation();
  const name = useId();
  const pages = pagesOf(range, parity, pageCount, chosen);
  const unreadable = range.kind === 'custom' && range.list.trim() !== '' && parsePageList(range.list, pageCount) === null;

  return (
    <fieldset className={styles.range}>
      <legend className={shapeStyles.legend}>{t('pdf-organizer.range.title')}</legend>
      <label className={shapeStyles.choice}>
        <input type="radio" name={name} checked={range.kind === 'chosen'} onChange={() => onRangeChange({ kind: 'chosen' })} />
        {t('pdf-organizer.shape.chosenPages', { count: chosen.size })}
      </label>
      <label className={shapeStyles.choice}>
        <input type="radio" name={name} checked={range.kind === 'all'} onChange={() => onRangeChange({ kind: 'all' })} />
        {t('pdf-organizer.shape.allPages', { count: pageCount })}
      </label>
      <div className={styles.fromTo}>
        <label className={shapeStyles.choice}>
          <input type="radio" name={name} checked={range.kind === 'from-to'} onChange={() => onRangeChange({ kind: 'from-to', from: 1, to: pageCount })} />
          {t('pdf-organizer.range.from')}
        </label>
        <input
          type="number"
          className={shapeStyles.number}
          min={1}
          max={pageCount}
          aria-label={t('pdf-organizer.range.from')}
          value={range.kind === 'from-to' ? range.from : 1}
          onChange={(event) => onRangeChange({ kind: 'from-to', from: event.target.valueAsNumber || 1, to: range.kind === 'from-to' ? range.to : pageCount })}
        />
        <span>{t('pdf-organizer.range.to')}</span>
        <input
          type="number"
          className={shapeStyles.number}
          min={1}
          max={pageCount}
          aria-label={t('pdf-organizer.range.to')}
          value={range.kind === 'from-to' ? range.to : pageCount}
          onChange={(event) => onRangeChange({ kind: 'from-to', from: range.kind === 'from-to' ? range.from : 1, to: event.target.valueAsNumber || pageCount })}
        />
      </div>
      <div className={styles.custom}>
        <label className={shapeStyles.choice}>
          <input type="radio" name={name} checked={range.kind === 'custom'} onChange={() => onRangeChange({ kind: 'custom', list: '' })} />
          {t('pdf-organizer.range.custom')}
        </label>
        <input
          type="text"
          className={styles.list}
          dir="ltr"
          placeholder="1, 3, 5-8"
          aria-label={t('pdf-organizer.range.custom')}
          aria-invalid={unreadable}
          value={range.kind === 'custom' ? range.list : ''}
          onFocus={() => range.kind !== 'custom' && onRangeChange({ kind: 'custom', list: '' })}
          onChange={(event) => onRangeChange({ kind: 'custom', list: event.target.value })}
        />
      </div>
      <label className={styles.parity}>
        <span>{t('pdf-organizer.range.parity')}</span>
        <select className={shapeStyles.select} value={parity} onChange={(event) => onParityChange(event.target.value as Parity)}>
          {(['both', 'odd', 'even'] as const).map((option) => (
            <option key={option} value={option}>
              {t(`pdf-organizer.range.parity.${option}`)}
            </option>
          ))}
        </select>
      </label>
      <p className={styles.count} aria-live="polite" data-problem={unreadable}>
        {unreadable ? t('pdf-organizer.range.unreadable') : t(countKey, { count: count ?? pages.length })}
      </p>
    </fieldset>
  );
}
