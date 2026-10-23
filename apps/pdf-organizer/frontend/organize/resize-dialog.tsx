import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useId, useState } from 'react';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import { POINTS_PER_MILLIMETRE } from '../document/page-shape';
import type { Reshape } from '../document/page-shape';
import { SheetSelect } from '../document/sheet-select';
import { DEFAULT_SHEET, sheetOf } from '../document/sheets';
import type { Unit } from './crop-frame';
import { LengthInput } from './length-input';
import { PageRangeChoice } from './page-range-choice';
import styles from './shape-dialog.module.css';

/** The choice in the list of sheets that is not a sheet: a size typed by hand. */
const CUSTOM = 'custom';
/** The sizes a page may be given, in points: from a stamp to a wall poster. */
const SMALLEST_SIDE = 20;
const LARGEST_SIDE = 14_400;

export interface ResizeDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** The places (from 0) of the chosen pages: the selection, or the page in view. */
  readonly targets: ReadonlySet<number>;
  readonly pageCount: number;
  readonly busy: boolean;
  /** The unit a size typed by hand is shown in at first (a setting of the app). */
  readonly unit: Unit;
  /** Resolves to true when the pages have their new size. */
  readonly onApply: (change: Reshape, pages: readonly number[]) => Promise<boolean>;
}

/** Asks which sheet to put the pages on: a standard one, or a size typed by hand. The content is scaled to fit, never cut. */
export function ResizeDialog({ open, onClose, targets, pageCount, busy, unit: startUnit, onApply }: ResizeDialogProps) {
  const t = useTranslation();
  const [sheet, setSheet] = useState<string>(DEFAULT_SHEET);
  const [custom, setCustom] = useState({ width: 210 * POINTS_PER_MILLIMETRE, height: 297 * POINTS_PER_MILLIMETRE });
  const [unit, setUnit] = useState<Unit>(startUnit);
  const [matchOrientation, setMatchOrientation] = useState(true);
  const [keepSize, setKeepSize] = useState(false);
  /** Where the page lies on the sheet: across and down, each 0, 0.5 or 1. */
  const [place, setPlace] = useState<readonly [number, number]>([0.5, 0.5]);
  const [range, setRange] = useState<PageRange>({ kind: 'all' });
  const [parity, setParity] = useState<Parity>('both');
  const sheetId = useId();

  useEffect(() => {
    if (open) setUnit(startUnit);
  }, [open]);

  const pages = pagesOf(range, parity, pageCount, targets);
  const size = sheet === CUSTOM ? custom : { width: sheetOf(sheet).width * POINTS_PER_MILLIMETRE, height: sheetOf(sheet).height * POINTS_PER_MILLIMETRE };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.resizePages')} closeLabel={t('common.action.close')}>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || pages.length === 0) return;
          void onApply({ fit: { ...size, matchOrientation, keepSize, place } }, pages).then((done) => done && onClose());
        }}
      >
        <p className={styles.lead}>{t('pdf-organizer.resize.lead')}</p>
        <label className={styles.field} htmlFor={sheetId}>
          <span className={styles.legend}>{t('pdf-organizer.resize.sheet')}</span>
          <SheetSelect id={sheetId} className={styles.select} value={sheet} onChange={setSheet}>
            <option value={CUSTOM}>{t('pdf-organizer.resize.custom')}</option>
          </SheetSelect>
        </label>
        {sheet === CUSTOM && (
          <div className={styles.customSize}>
            <span>{t('pdf-organizer.resize.width')}</span>
            <LengthInput label={t('pdf-organizer.resize.width')} points={custom.width} onChange={(width) => setCustom({ ...custom, width })} unit={unit} onUnitChange={setUnit} min={SMALLEST_SIDE} max={LARGEST_SIDE} />
            <span>{t('pdf-organizer.resize.height')}</span>
            <LengthInput label={t('pdf-organizer.resize.height')} points={custom.height} onChange={(height) => setCustom({ ...custom, height })} unit={unit} onUnitChange={setUnit} min={SMALLEST_SIDE} max={LARGEST_SIDE} />
          </div>
        )}
        <label className={styles.choice}>
          <input type="checkbox" checked={matchOrientation} onChange={(event) => setMatchOrientation(event.target.checked)} />
          {t('pdf-organizer.resize.matchOrientation')}
        </label>
        <label className={styles.choice}>
          <input type="checkbox" checked={keepSize} onChange={(event) => setKeepSize(event.target.checked)} />
          {t('pdf-organizer.resize.keepSize')}
        </label>
        <div className={styles.placeRow}>
          <span>{t('pdf-organizer.resize.place')}</span>
          {/* The nine places on the sheet. Left is left in every language. */}
          <div role="radiogroup" aria-label={t('pdf-organizer.resize.place')} className={styles.placeGrid} dir="ltr">
            {[0, 0.5, 1].flatMap((down) =>
              [0, 0.5, 1].map((across) => (
                <button
                  key={`${across}-${down}`}
                  type="button"
                  role="radio"
                  aria-checked={place[0] === across && place[1] === down}
                  aria-label={t(`pdf-organizer.resize.place.${down}-${across}`)}
                  className={styles.placeCell}
                  onClick={() => setPlace([across, down])}
                />
              )),
            )}
          </div>
          <span className={styles.placeNote}>{t('pdf-organizer.resize.placeNote')}</span>
        </div>
        <PageRangeChoice range={range} onRangeChange={setRange} parity={parity} onParityChange={setParity} chosen={targets} pageCount={pageCount} />
        <div className={styles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={busy || pages.length === 0}>
            {t('pdf-organizer.resize.apply')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
