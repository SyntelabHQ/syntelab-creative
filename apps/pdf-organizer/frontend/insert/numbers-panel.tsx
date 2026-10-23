import { useTranslation } from '@syntelab/i18n';
import type { Translate } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useId, useState } from 'react';
import cropStyles from '../crop/crop-panel.module.css';
import { DEFAULT_NUMBERING, LARGEST_NUMBER_SIZE, NUMBER_FORMATS, NUMBER_PLACES, numberMark, numberOfPage, pageNumber, SMALLEST_NUMBER_SIZE } from '../document/page-numbers';
import type { NumberFormat, NumberWords, PageNumbering } from '../document/page-numbers';
import type { PlanPage } from '../document/page-plan';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import type { Mark } from '../marks/mark';
import { FontSelect } from '../marks/font-select';
import { fitted } from '../marks/measure-text';
import type { Unit } from '../organize/crop-frame';
import { LengthInput } from '../organize/length-input';
import { PageRangeChoice } from '../organize/page-range-choice';
import shapeStyles from '../organize/shape-dialog.module.css';
import { ColorPick } from './color-pick';
import styles from './insert-dialog.module.css';

/** Page numbers being set up: how they look, and the pages they are for. */
export interface Numbering {
  readonly settings: PageNumbering;
  readonly range: PageRange;
  readonly parity: Parity;
  /** The pages that were chosen (selected, or in view) when it started. */
  readonly chosen: ReadonlySet<number>;
}

export function startNumbering(chosen: ReadonlySet<number>, t: Translate): Numbering {
  return { settings: { ...DEFAULT_NUMBERING, custom: t('pdf-organizer.numbers.wordsPageOf') }, range: { kind: 'all' }, parity: 'both', chosen: new Set(chosen) };
}

/** A text mark at the size its text takes; a script the fonts cannot write becomes a picture of the text. */

export function numberWords(t: Translate): NumberWords {
  return { page: t('pdf-organizer.numbers.wordsPage'), pageOf: t('pdf-organizer.numbers.wordsPageOf') };
}

/** The number of the page at `index` as a mark on it, or null when that page gets none. */
export function numberMarkFor(numbering: Numbering, pages: readonly PlanPage[], index: number, words: NumberWords, id: string): Mark | null {
  const page = pages[index];
  if (!page || !pagesOf(numbering.range, numbering.parity, pages.length, numbering.chosen).includes(index)) return null;
  const text = numberOfPage(numbering.settings, index, pages.length, words);
  return text === null || text.trim() === '' ? null : numberMark(page, text, numbering.settings, fitted, id);
}

export interface NumbersPanelProps {
  readonly host: AppHost;
  readonly numbering: Numbering;
  readonly onChange: (numbering: Numbering) => void;
  readonly pages: readonly PlanPage[];
  /** The fonts installed on the computer. */
  readonly fonts: readonly string[];
  /** The unit distances are shown in at first (a setting of the app). */
  readonly unit: Unit;
  /** Puts the numbers on their pages (by page key), as one step that can be undone. */
  readonly onApply: (marks: ReadonlyMap<string, Mark>) => void;
  readonly onCancel: () => void;
}

/**
 * The settings of "Page numbers", beside the document: the numbers show on
 * the pages themselves as they are set up, at any zoom, on every page that
 * gets one. Once added they are text like any other: movable, deletable.
 */
export function NumbersPanel({ numbering, onChange, pages, fonts, unit: startUnit, onApply, onCancel }: NumbersPanelProps) {
  const t = useTranslation();
  const [sizeUnit, setSizeUnit] = useState<Unit>('pt');
  const [marginUnit, setMarginUnit] = useState<Unit>(startUnit);
  const formatId = useId();
  const { settings } = numbering;
  const change = (part: Partial<PageNumbering>) => onChange({ ...numbering, settings: { ...settings, ...part } });
  const words = numberWords(t);
  const numbered = pagesOf(numbering.range, numbering.parity, pages.length, numbering.chosen).filter((index) => !(settings.skipFirst && index === 0));

  const apply = () => {
    const marks = new Map<string, Mark>();
    for (const index of numbered) {
      const [page, mark] = [pages[index], numberMarkFor(numbering, pages, index, words, `number-${Date.now().toString(36)}-${index}`)];
      if (page && mark) marks.set(page.key, mark);
    }
    onApply(marks);
  };

  return (
    <aside className={cropStyles.panel} aria-label={t('pdf-organizer.command.pageNumbers')}>
      <div className={cropStyles.head}>
        <h2 className={cropStyles.title}>{t('pdf-organizer.command.pageNumbers')}</h2>
        <IconButton variant="ghost" aria-label={t('common.action.close')} tooltipSide="bottom-end" onClick={onCancel}>
          <Icon name="xmark" size={14} />
        </IconButton>
      </div>
      <div className={cropStyles.body}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.numbers.live')}</p>
        <div className={styles.pair}>
          <span>{t('pdf-organizer.numbers.place')}</span>
          {/* The six places a number can go. Left is left in every language. */}
          <div role="radiogroup" aria-label={t('pdf-organizer.numbers.place')} className={styles.numberPlaces} dir="ltr">
            {NUMBER_PLACES.map((place) => (
              <button key={place} type="button" role="radio" aria-checked={settings.place === place} aria-label={t(`pdf-organizer.numbers.${place}`)} className={styles.placeCell} onClick={() => change({ place })} />
            ))}
          </div>
        </div>
        <label className={styles.pair} htmlFor={formatId}>
          <span>{t('pdf-organizer.numbers.format')}</span>
          <select id={formatId} className={shapeStyles.select} value={settings.format} onChange={(event) => change({ format: event.target.value as NumberFormat })}>
            {NUMBER_FORMATS.map((format) => (
              <option key={format} value={format}>
                {format === 'custom' ? t('pdf-organizer.numbers.custom') : pageNumber(format, 1, pages.length, words)}
              </option>
            ))}
          </select>
        </label>
        {settings.format === 'custom' && (
          <label className={styles.customFormat}>
            <input type="text" className={styles.text} dir="auto" maxLength={120} value={settings.custom} aria-label={t('pdf-organizer.numbers.custom')} onChange={(event) => change({ custom: event.target.value })} />
            <span>{t('pdf-organizer.numbers.customHint')}</span>
          </label>
        )}
        <label className={styles.pair}>
          <span>{t('pdf-organizer.numbers.start')}</span>
          <input
            type="number"
            className={shapeStyles.number}
            min={0}
            value={settings.start}
            onChange={(event) => change({ start: Math.max(0, Math.floor(Number.isFinite(event.target.valueAsNumber) ? event.target.valueAsNumber : 1)) })}
          />
        </label>
        <label className={shapeStyles.choice}>
          <input type="checkbox" checked={settings.skipFirst} onChange={(event) => change({ skipFirst: event.target.checked })} />
          {t('pdf-organizer.numbers.skipFirst')}
        </label>

        <div className={styles.pair}>
          <span>{t('pdf-organizer.marks.font')}</span>
          <span className={styles.fontRow}>
            <FontSelect className={shapeStyles.select} value={settings.font} onChange={(font) => change({ font })} families={fonts} />
            <IconButton variant="ghost" aria-label={t('pdf-organizer.marks.bold')} aria-pressed={settings.bold} onClick={() => change({ bold: !settings.bold })}>
              <Icon name="bold" size={14} />
            </IconButton>
            <IconButton variant="ghost" aria-label={t('pdf-organizer.marks.italic')} aria-pressed={settings.italic} onClick={() => change({ italic: !settings.italic })}>
              <Icon name="italic" size={14} />
            </IconButton>
          </span>
        </div>
        <div className={styles.pair}>
          <span>{t('pdf-organizer.numbers.size')}</span>
          <LengthInput label={t('pdf-organizer.numbers.size')} points={settings.size} onChange={(size) => change({ size })} unit={sizeUnit} onUnitChange={setSizeUnit} min={SMALLEST_NUMBER_SIZE} max={LARGEST_NUMBER_SIZE} />
        </div>
        <div className={styles.pair}>
          <span>{t('pdf-organizer.numbers.margin')}</span>
          <LengthInput label={t('pdf-organizer.numbers.margin')} points={settings.margin} onChange={(margin) => change({ margin })} unit={marginUnit} onUnitChange={setMarginUnit} max={720} />
        </div>
        <div className={styles.pair}>
          <span>{t('pdf-organizer.signature.color')}</span>
          <ColorPick color={settings.color} onChange={(color) => change({ color })} />
        </div>

        <PageRangeChoice
          range={numbering.range}
          onRangeChange={(range) => onChange({ ...numbering, range })}
          parity={numbering.parity}
          onParityChange={(parity) => onChange({ ...numbering, parity })}
          chosen={numbering.chosen}
          pageCount={pages.length}
          countKey="pdf-organizer.numbers.count"
          count={numbered.length}
        />
        <p className={shapeStyles.lead}>{t('pdf-organizer.numbers.movable')}</p>
      </div>
      <div className={cropStyles.actions}>
        <Button onClick={onCancel}>{t('common.action.cancel')}</Button>
        <Button variant="primary" disabled={numbered.length === 0} onClick={apply}>
          {t('pdf-organizer.numbers.apply')}
        </Button>
      </div>
    </aside>
  );
}
