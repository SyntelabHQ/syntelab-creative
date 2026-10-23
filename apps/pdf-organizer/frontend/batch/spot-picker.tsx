import { useTranslation } from '@syntelab/i18n';
import { useId, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { PLACES } from '../document/page-shape';
import type { Mark } from '../marks/mark';
import { MarkShape } from '../marks/mark-shape';
import shapeStyles from '../organize/shape-dialog.module.css';
import { placeOf, SIGNATURE_BOX, spotAt, spotBox, spotOfBox } from './sign-settings';
import type { SignSpot } from './sign-settings';
import styles from './batch-view.module.css';

/** The least a drawn box can be; a click (or a box smaller than this) puts one of the usual size. */
const SMALLEST = { width: 40, height: 16 };

type Box = { x: number; y: number; width: number; height: number };
type Drag = { kind: 'move'; from: { x: number; y: number }; start: Box } | { kind: 'size'; start: Box } | { kind: 'draw'; from: { x: number; y: number } };

export interface SpotEditorProps {
  /** The page it lies over, in points: the box is placed on it. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly spot: SignSpot;
  readonly onChange: (spot: SignSpot) => void;
  /** What shows in a box of a size, from its top-left corner: the signature as it will look. */
  readonly lookOf: (box: Box) => readonly Mark[];
  readonly disabled: boolean;
}

/**
 * The box of the signature over a page: dragged into place, drawn anew, or
 * made larger from its corner. The same place is used on every page it
 * shows on.
 */
export function SpotEditor({ pageWidth, pageHeight, spot, onChange, lookOf, disabled }: SpotEditorProps) {
  const t = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  const clipId = useId();
  const [drag, setDrag] = useState<Drag | null>(null);
  /** The box while it is being dragged; the spot's own box otherwise. */
  const [moving, setMoving] = useState<Box | null>(null);
  const box = moving ?? spotBox(pageWidth, pageHeight, spot);
  // The handle is the same size on the screen whatever the size of the page.
  const handle = Math.max(pageWidth, pageHeight) / 80;

  /** A place of the pointer on the page, in points. */
  const pointOf = (event: PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return { x: ((event.clientX - rect.left) / rect.width) * pageWidth, y: ((event.clientY - rect.top) / rect.height) * pageHeight };
  };
  const inside = (next: Box): Box => {
    const width = Math.min(Math.max(next.width, SMALLEST.width), pageWidth);
    const height = Math.min(Math.max(next.height, SMALLEST.height), pageHeight);
    return { width, height, x: Math.min(Math.max(next.x, 0), pageWidth - width), y: Math.min(Math.max(next.y, 0), pageHeight - height) };
  };

  const begin = (event: PointerEvent, next: Drag) => {
    if (disabled) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Carry on without it.
    }
    setDrag(next);
    setMoving(box);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!drag) return;
    const at = pointOf(event);
    if (drag.kind === 'move') setMoving(inside({ ...drag.start, x: drag.start.x + at.x - drag.from.x, y: drag.start.y + at.y - drag.from.y }));
    else if (drag.kind === 'size') setMoving(inside({ ...drag.start, width: at.x - drag.start.x, height: at.y - drag.start.y }));
    else setMoving({ x: Math.min(drag.from.x, at.x), y: Math.min(drag.from.y, at.y), width: Math.abs(at.x - drag.from.x), height: Math.abs(at.y - drag.from.y) });
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!drag) return;
    let ended = moving ?? box;
    if (drag.kind === 'draw' && (ended.width < SMALLEST.width || ended.height < SMALLEST.height)) {
      // A click: a box of the usual size, with its middle where the click was.
      const at = pointOf(event);
      ended = { x: at.x - SIGNATURE_BOX.width / 2, y: at.y - SIGNATURE_BOX.height / 2, width: SIGNATURE_BOX.width, height: SIGNATURE_BOX.height };
    }
    setDrag(null);
    setMoving(null);
    onChange(spotOfBox(pageWidth, pageHeight, inside(ended)));
  };

  return (
    <svg
      ref={svgRef}
      className={styles.spotOver}
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={t('pdf-organizer.batch.signSpot')}
      data-disabled={disabled}
      onPointerDown={(event) => begin(event, { kind: 'draw', from: pointOf(event) })}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <g onPointerDown={(event) => begin(event, { kind: 'move', from: pointOf(event), start: box })} className={styles.spotBox}>
        <rect x={box.x} y={box.y} width={box.width} height={box.height} className={styles.spotFrame} vectorEffect="non-scaling-stroke" />
        {/* Cut to the box, as the PDF does: nothing of the signature shows outside it. */}
        <clipPath id={clipId}>
          <rect x={0} y={0} width={box.width} height={box.height} />
        </clipPath>
        <g transform={`translate(${box.x} ${box.y})`} clipPath={`url(#${clipId})`}>
          {lookOf(box).map((mark) => (
            <MarkShape key={mark.id} mark={mark} />
          ))}
        </g>
      </g>
      <rect
        x={box.x + box.width - handle / 2}
        y={box.y + box.height - handle / 2}
        width={handle}
        height={handle}
        className={styles.spotHandle}
        onPointerDown={(event) => begin(event, { kind: 'size', start: box })}
      />
    </svg>
  );
}

export interface SpotPlacesProps {
  readonly spot: SignSpot;
  readonly onChange: (spot: SignSpot) => void;
  readonly disabled: boolean;
}

/** The usual places of a signature, in a list; and what dragging on the page does. */
export function SpotPlaces({ spot, onChange, disabled }: SpotPlacesProps) {
  const t = useTranslation();
  const usual = placeOf(spot);
  return (
    <>
      <label className={styles.row}>
        <span>{t('pdf-organizer.numbers.place')}</span>
        <select className={shapeStyles.select} value={usual ?? ''} disabled={disabled} onChange={(event) => event.target.value !== '' && onChange(spotAt(event.target.value as (typeof PLACES)[number]))}>
          {usual === null && <option value="">{t('pdf-organizer.batch.signSpotOwn')}</option>}
          {PLACES.map((place) => (
            <option key={place} value={place}>
              {t(`pdf-organizer.numbers.${place}`)}
            </option>
          ))}
        </select>
      </label>
      <p className={shapeStyles.lead}>{t('pdf-organizer.batch.signSpotNote')}</p>
    </>
  );
}
