import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import { clampEdges, EDGE_NAMES, frameOf, fromUnit, NO_EDGES, shownEdges, toUnit, UNIT_NAMES } from '../organize/crop-frame';
import type { EdgeName, Edges, Unit } from '../organize/crop-frame';
import { PageRangeChoice } from '../organize/page-range-choice';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './crop-panel.module.css';

/** Cropping in progress: the frame, and the pages it is for. */
export interface Cropping {
  readonly edges: Edges;
  readonly range: PageRange;
  readonly parity: Parity;
  /** The pages that were chosen (selected, or in view) when cropping started. */
  readonly chosen: ReadonlySet<number>;
}

export function startCropping(chosen: ReadonlySet<number>): Cropping {
  return { edges: NO_EDGES, range: { kind: 'chosen' }, parity: 'both', chosen: new Set(chosen) };
}

/** The places (from 0) of the pages a crop in progress is for. */
export function croppedPages(cropping: Cropping, pageCount: number): number[] {
  return pagesOf(cropping.range, cropping.parity, pageCount, cropping.chosen);
}

export interface CropPanelProps {
  readonly host: AppHost;
  readonly cropping: Cropping;
  readonly onChange: (cropping: Cropping) => void;
  /** The page the frame is measured on: the page in view. */
  readonly page: PlanPage | undefined;
  readonly pageCount: number;
  readonly busy: boolean;
  /** The unit the margins are shown in at first (a setting of the app). */
  readonly unit: Unit;
  /** Crops the pages of the range. */
  readonly onApply: () => void;
  readonly onCancel: () => void;
  /** Leaves cropping for the window that puts pages on another sheet size. */
  readonly onChangePageSize: () => void;
}

/**
 * The settings of "Crop pages", beside the document: the frame itself is
 * drawn on the page, at any zoom; here are its margins in numbers, the pages
 * it is for, and the buttons. Nothing is removed from the file: the pages
 * only show, and print, less.
 */
export function CropPanel({ host, cropping, onChange, page, pageCount, busy, unit: startUnit, onApply, onCancel, onChangePageSize }: CropPanelProps) {
  const t = useTranslation();
  const [unit, setUnit] = useState<Unit>(startUnit);
  const [together, setTogether] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const { invoke } = host;

  const sideways = (page?.rotation ?? 0) % 180 !== 0;
  const width = (sideways ? page?.height : page?.width) ?? 1;
  const height = (sideways ? page?.width : page?.height) ?? 1;
  const edges = clampEdges(cropping.edges, width, height);
  const frame = frameOf(edges, width, height);
  const something = EDGE_NAMES.some((edge) => cropping.edges[edge] > 0.05);
  const pages = croppedPages(cropping, pageCount);
  const setEdges = (next: Edges) => onChange({ ...cropping, edges: clampEdges(next, width, height) });

  const typeEdge = (edge: EdgeName, value: number) => {
    const points = fromUnit(value, unit);
    setEdges(together ? { left: points, top: points, right: points, bottom: points } : { ...edges, [edge]: points });
  };

  const removeWhite = async () => {
    if (!page) return;
    setMeasuring(true);
    try {
      const { margins } = await invoke<{ margins: [number, number, number, number] }>('white_margins', { documentId: page.documentId, page: page.page });
      setEdges(shownEdges(margins, page.rotation));
    } catch {
      // A page that cannot be measured keeps the margins it has.
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <aside className={styles.panel} aria-label={t('pdf-organizer.command.cropPages')}>
      <div className={styles.head}>
        <h2 className={styles.title}>{t('pdf-organizer.command.cropPages')}</h2>
        <IconButton variant="ghost" aria-label={t('common.action.close')} tooltipSide="bottom-end" onClick={onCancel}>
          <Icon name="xmark" size={14} />
        </IconButton>
      </div>
      <div className={styles.body}>
        <p className={shapeStyles.lead}>{t('pdf-organizer.crop.onPage')}</p>
        <fieldset className={styles.group}>
          <legend className={shapeStyles.legend}>{t('pdf-organizer.crop.margins')}</legend>
          <label className={styles.row}>
            <span>{t('pdf-organizer.crop.units')}</span>
            <select className={shapeStyles.select} value={unit} onChange={(event) => setUnit(event.target.value as Unit)}>
              {UNIT_NAMES.map((option) => (
                <option key={option} value={option}>
                  {t(`pdf-organizer.unit.${option}Name`)}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.edges}>
            {EDGE_NAMES.map((edge) => (
              <label key={edge} className={styles.edge}>
                <span>{t(`pdf-organizer.crop.${edge}`)}</span>
                <input type="number" className={shapeStyles.number} min={0} step="any" value={toUnit(edges[edge], unit)} onChange={(event) => typeEdge(edge, event.target.valueAsNumber)} />
              </label>
            ))}
          </div>
          <label className={shapeStyles.choice}>
            <input type="checkbox" checked={together} onChange={(event) => setTogether(event.target.checked)} />
            {t('pdf-organizer.crop.together')}
          </label>
          <div className={styles.buttons}>
            <Button disabled={measuring || !page} onClick={() => void removeWhite()}>
              <Icon name="crop-simple" size={14} />
              {t('pdf-organizer.crop.removeWhite')}
            </Button>
            <Button disabled={!something} onClick={() => onChange({ ...cropping, edges: NO_EDGES })}>
              {t('pdf-organizer.crop.setToZero')}
            </Button>
          </div>
          <p className={styles.size}>{t('pdf-organizer.crop.result', { width: toUnit(frame.width, unit), height: toUnit(frame.height, unit), unit: t(`pdf-organizer.unit.${unit}`) })}</p>
        </fieldset>

        <PageRangeChoice
          range={cropping.range}
          onRangeChange={(range) => onChange({ ...cropping, range })}
          parity={cropping.parity}
          onParityChange={(parity) => onChange({ ...cropping, parity })}
          chosen={cropping.chosen}
          pageCount={pageCount}
          countKey="pdf-organizer.crop.pagesCount"
        />

        <Button variant="ghost" onClick={onChangePageSize}>
          <Icon name="up-right-and-down-left-from-center" size={14} />
          {t('pdf-organizer.crop.changePageSize')}
        </Button>
      </div>
      <div className={styles.actions}>
        <Button onClick={onCancel}>{t('common.action.cancel')}</Button>
        <Button variant="primary" disabled={!something || pages.length === 0 || busy} onClick={onApply}>
          {t('pdf-organizer.crop.apply')}
        </Button>
      </div>
    </aside>
  );
}
