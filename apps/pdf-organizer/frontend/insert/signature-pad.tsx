import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, tooltip } from '@syntelab/ui-kit';
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import { MAX_PEN_WIDTH, MIN_PEN_WIDTH, nibWidth, PEN_PRESETS } from './signature-pens';
import type { PenPreset } from './signature-pens';
import styles from './tools.module.css';

const PAD_WIDTH = 560;
const PAD_HEIGHT = 190;
/** The pad is drawn finer than it is shown, so the signature stays smooth when enlarged. */
const FINENESS = 3;

export interface SignaturePadProps {
  /** Called with the drawn signature, cut down to the ink, or null when the pad is empty. */
  readonly onChange: (signature: LoadedPicture | null) => void;
}

/** The ink of a canvas cut out of its empty surroundings, as a see-through picture. */
function cutToInk(canvas: HTMLCanvasElement): LoadedPicture | null {
  const context = canvas.getContext('2d');
  if (!context) return null;
  const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height);
  let [left, top, right, bottom] = [width, height, -1, -1];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  const margin = 6 * FINENESS;
  left = Math.max(0, left - margin);
  top = Math.max(0, top - margin);
  right = Math.min(width - 1, right + margin);
  bottom = Math.min(height - 1, bottom + margin);
  const cut = document.createElement('canvas');
  cut.width = right - left + 1;
  cut.height = bottom - top + 1;
  cut.getContext('2d')?.drawImage(canvas, left, top, cut.width, cut.height, 0, 0, cut.width, cut.height);
  return { address: cut.toDataURL('image/png'), width: cut.width, height: cut.height };
}

/** A field to sign in, with the mouse, a pen or a finger. */
export function SignaturePad({ onChange }: SignaturePadProps) {
  const t = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number; time: number; width: number } | null>(null);
  const [pen, setPen] = useState<PenPreset>(PEN_PRESETS[0]!);
  const [color, setColor] = useState(pen.color);
  const [width, setWidth] = useState(pen.width);
  const [empty, setEmpty] = useState(true);

  const takePen = (preset: PenPreset) => {
    setPen(preset);
    setColor(preset.color);
    setWidth(preset.width);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setEmpty(true);
    onChange(null);
  };
  // Tells the owner the pad starts empty. (In braces: what onChange returns must not become the effect's clean-up, which React would call as a function.)
  useEffect(() => {
    onChange(null);
  }, []);

  const pointOf = (event: PointerEvent<HTMLCanvasElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - box.left) / box.width) * event.currentTarget.width,
      y: ((event.clientY - box.top) / box.height) * event.currentTarget.height,
    };
  };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    // Keeps the drag coming here when the pointer leaves; a pointer that cannot be held is no reason to stop.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Carry on without it.
    }
    last.current = { ...pointOf(event), time: event.timeStamp, width: width * FINENESS };
    const context = event.currentTarget.getContext('2d');
    if (!context) return;
    // A tap leaves a dot.
    context.fillStyle = color;
    context.beginPath();
    context.arc(last.current.x, last.current.y, (width * FINENESS) / 2, 0, Math.PI * 2);
    context.fill();
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const from = last.current;
    const context = event.currentTarget.getContext('2d');
    if (!from || !context) return;
    const to = pointOf(event);
    const elapsed = Math.max(event.timeStamp - from.time, 1);
    const speed = Math.hypot(to.x - from.x, to.y - from.y) / FINENESS / elapsed;
    const lineWidth = pen.nib ? nibWidth(width * FINENESS, speed, from.width) : width * FINENESS;
    context.strokeStyle = color;
    context.lineWidth = lineWidth;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    last.current = { ...to, time: event.timeStamp, width: lineWidth };
  };

  const onPointerUp = () => {
    if (!last.current) return;
    last.current = null;
    setEmpty(false);
    onChange(canvasRef.current ? cutToInk(canvasRef.current) : null);
  };

  return (
    <div className={styles.pad}>
      <canvas
        ref={canvasRef}
        className={styles.padCanvas}
        width={PAD_WIDTH * FINENESS}
        height={PAD_HEIGHT * FINENESS}
        style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}` }}
        aria-label={t('pdf-organizer.signature.pad')}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
      {empty && <span className={styles.padHint}>{t('pdf-organizer.signature.padHint')}</span>}
      <div className={styles.padTools}>
        <div role="radiogroup" aria-label={t('pdf-organizer.signature.pen')} className={styles.kinds}>
          {PEN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={pen.id === preset.id}
              className={styles.kind}
              style={{ color: preset.color }}
              {...tooltip(t(`pdf-organizer.signature.pen.${preset.id}`), 'bottom')}
              onClick={() => takePen(preset)}
            >
              <Icon name={preset.icon} size={15} />
            </button>
          ))}
        </div>
        <label className={styles.penColor} {...tooltip(t('pdf-organizer.signature.color'), 'bottom')}>
          <input type="color" value={color} aria-label={t('pdf-organizer.signature.color')} onChange={(event) => setColor(event.target.value)} />
        </label>
        <label className={styles.penWidth}>
          <span>{t('pdf-organizer.signature.width')}</span>
          <input
            type="range"
            min={MIN_PEN_WIDTH}
            max={MAX_PEN_WIDTH}
            step={0.2}
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
          />
          <span className={styles.penSample} style={{ height: width, background: color }} />
        </label>
        <Button disabled={empty} onClick={clear}>
          <Icon name="eraser" size={14} />
          {t('pdf-organizer.signature.clear')}
        </Button>
      </div>
    </div>
  );
}
