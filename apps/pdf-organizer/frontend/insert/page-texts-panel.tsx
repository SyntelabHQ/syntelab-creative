import { useI18n } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useState } from 'react';
import cropStyles from '../crop/crop-panel.module.css';
import { LARGEST_NUMBER_SIZE, NUMBER_PLACES, SMALLEST_NUMBER_SIZE } from '../document/page-numbers';
import type { PlanPage } from '../document/page-plan';
import type { Place } from '../document/page-shape';
import { FontSelect } from '../marks/font-select';
import type { Mark } from '../marks/mark';
import { fitted } from '../marks/measure-text';
import type { Unit } from '../organize/crop-frame';
import { LengthInput } from '../organize/length-input';
import { PageRangeChoice } from '../organize/page-range-choice';
import shapeStyles from '../organize/shape-dialog.module.css';
import { ColorPick } from './color-pick';
import styles from './insert-dialog.module.css';
import { batesNumber, MOST_BATES_DIGITS, pagesWithTexts, pageTextMarks } from './page-texts';
import type { Bates, PageTexts } from './page-texts';
import { dayOf, writtenDate } from './signature-date';

/** A text mark at the size its text takes; a script the fonts cannot write becomes a picture of the text. */

/** Today as the language of the program writes dates: what `{date}` stands for. */
export function todayWritten(language: string): string {
  return writtenDate(dayOf(new Date()), language);
}

/** The texts the page at `index` would get, as marks, while they are set up. */
export function pageTextsPreview(settings: PageTexts, pages: readonly PlanPage[], index: number, today: string, file: string): Mark[] {
  return pageTextMarks(settings, pages, index, today, file, fitted, `page-text-preview-${pages[index]?.key ?? index}`);
}

export interface PageTextsPanelProps {
  readonly settings: PageTexts;
  readonly onChange: (settings: PageTexts) => void;
  readonly pages: readonly PlanPage[];
  /** The name of the document: what `{file}` stands for. */
  readonly fileName: string;
  /** The fonts installed on the computer. */
  readonly fonts: readonly string[];
  /** The unit distances are shown in at first (a setting of the app). */
  readonly unit: Unit;
  /** Puts the texts on their pages (by page key), as one step that can be undone. */
  readonly onApply: (marks: ReadonlyMap<string, readonly Mark[]>) => void;
  readonly onCancel: () => void;
}

const ROWS: readonly { readonly name: 'header' | 'footer'; readonly places: readonly Place[] }[] = [
  { name: 'header', places: ['top-left', 'top-center', 'top-right'] },
  { name: 'footer', places: ['bottom-left', 'bottom-center', 'bottom-right'] },
];

/**
 * The settings of "Header and footer" and of "Bates numbering", beside the
 * document: the texts show on the pages themselves as they are set up. Once
 * added they are text like any other: movable, deletable.
 */
export function PageTextsPanel({ settings, onChange, pages, fileName, fonts, unit: startUnit, onApply, onCancel }: PageTextsPanelProps) {
  const { t, language } = useI18n();
  const [sizeUnit, setSizeUnit] = useState<Unit>('pt');
  const [marginUnit, setMarginUnit] = useState<Unit>(startUnit);
  const change = (part: Partial<PageTexts>) => onChange({ ...settings, ...part });
  const changeBates = (part: Partial<Bates>) => change({ bates: { ...settings.bates, ...part } });
  const title = t(settings.mode === 'bates' ? 'pdf-organizer.command.batesNumbers' : 'pdf-organizer.command.headerFooter');
  const stamped = pagesWithTexts(settings, pages.length);
  const today = todayWritten(language);
  const something = settings.mode === 'bates' || Object.values(settings.texts).some((text) => text.trim() !== '');
  const whole = (value: number, fallback: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback);

  const apply = () => {
    const marks = new Map<string, readonly Mark[]>();
    const stamp = Date.now().toString(36);
    for (const index of stamped) {
      const page = pages[index];
      const added = pageTextMarks(settings, pages, index, today, fileName, fitted, `page-text-${stamp}-${index}`);
      if (page && added.length > 0) marks.set(page.key, [...(page.marks ?? []), ...added]);
    }
    onApply(marks);
  };

  return (
    <aside className={cropStyles.panel} aria-label={title}>
      <div className={cropStyles.head}>
        <h2 className={cropStyles.title}>{title}</h2>
        <IconButton variant="ghost" aria-label={t('common.action.close')} tooltipSide="bottom-end" onClick={onCancel}>
          <Icon name="xmark" size={14} />
        </IconButton>
      </div>
      <div className={cropStyles.body}>
        <p className={shapeStyles.lead}>{t(settings.mode === 'bates' ? 'pdf-organizer.bates.lead' : 'pdf-organizer.headerFooter.lead')}</p>

        {settings.mode === 'header-footer' &&
          ROWS.map((row) => (
            <fieldset key={row.name} className={cropStyles.group}>
              <legend className={shapeStyles.legend}>{t(`pdf-organizer.headerFooter.${row.name}`)}</legend>
              {row.places.map((place) => (
                <input
                  key={place}
                  type="text"
                  className={styles.text}
                  dir="auto"
                  maxLength={200}
                  value={settings.texts[place]}
                  placeholder={t(`pdf-organizer.headerFooter.${place.split('-')[1]}`)}
                  aria-label={t(`pdf-organizer.numbers.${place}`)}
                  onChange={(event) => change({ texts: { ...settings.texts, [place]: event.target.value } })}
                />
              ))}
            </fieldset>
          ))}
        {settings.mode === 'header-footer' && <p className={shapeStyles.lead}>{t('pdf-organizer.headerFooter.words')}</p>}

        {settings.mode === 'bates' && (
          <fieldset className={cropStyles.group}>
            <legend className={shapeStyles.legend}>{t('pdf-organizer.bates.number')}</legend>
            <label className={styles.pair}>
              <span>{t('pdf-organizer.bates.prefix')}</span>
              <input type="text" className={shapeStyles.number} dir="auto" maxLength={40} value={settings.bates.prefix} onChange={(event) => changeBates({ prefix: event.target.value })} />
            </label>
            <label className={styles.pair}>
              <span>{t('pdf-organizer.bates.start')}</span>
              <input type="number" className={shapeStyles.number} min={0} value={settings.bates.start} onChange={(event) => changeBates({ start: whole(event.target.valueAsNumber, 1) })} />
            </label>
            <label className={styles.pair}>
              <span>{t('pdf-organizer.bates.digits')}</span>
              <input
                type="number"
                className={shapeStyles.number}
                min={1}
                max={MOST_BATES_DIGITS}
                value={settings.bates.digits}
                onChange={(event) => changeBates({ digits: Math.min(Math.max(whole(event.target.valueAsNumber, 6), 1), MOST_BATES_DIGITS) })}
              />
            </label>
            <label className={styles.pair}>
              <span>{t('pdf-organizer.bates.suffix')}</span>
              <input type="text" className={shapeStyles.number} dir="auto" maxLength={40} value={settings.bates.suffix} onChange={(event) => changeBates({ suffix: event.target.value })} />
            </label>
            <div className={styles.pair}>
              <span>{t('pdf-organizer.numbers.place')}</span>
              {/* The six places a number can go. Left is left in every language. */}
              <div role="radiogroup" aria-label={t('pdf-organizer.numbers.place')} className={styles.numberPlaces} dir="ltr">
                {NUMBER_PLACES.map((place) => (
                  <button key={place} type="button" role="radio" aria-checked={settings.bates.place === place} aria-label={t(`pdf-organizer.numbers.${place}`)} className={styles.placeCell} onClick={() => changeBates({ place })} />
                ))}
              </div>
            </div>
            <p className={shapeStyles.lead} dir="auto">
              {t('pdf-organizer.bates.sample', { first: batesNumber(settings.bates, 0), last: batesNumber(settings.bates, Math.max(stamped.length - 1, 0)) })}
            </p>
          </fieldset>
        )}

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
          range={settings.range}
          onRangeChange={(range) => change({ range })}
          parity={settings.parity}
          onParityChange={(parity) => change({ parity })}
          chosen={settings.chosen}
          pageCount={pages.length}
        />
        <p className={shapeStyles.lead}>{t('pdf-organizer.numbers.movable')}</p>
      </div>
      <div className={cropStyles.actions}>
        <Button onClick={onCancel}>{t('common.action.cancel')}</Button>
        <Button variant="primary" disabled={stamped.length === 0 || !something} onClick={apply}>
          {t('pdf-organizer.pageTexts.apply')}
        </Button>
      </div>
    </aside>
  );
}
