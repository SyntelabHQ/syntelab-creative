import { useRef } from 'react';
import type { PointerEvent } from 'react';
import { clampEdges, dragHandle, edgesOfFrame, EDGE_NAMES, FRAME_HANDLES, frameOf, moveFrame } from '../organize/crop-frame';
import type { Edges, FrameHandle } from '../organize/crop-frame';
import styles from './crop-layer.module.css';

export interface CropLayerProps {
  /** How much is cut off each edge of the page as shown, in points. */
  readonly edges: Edges;
  readonly onChange: (edges: Edges) => void;
  /** The size of the page as shown, in points. */
  readonly width: number;
  readonly height: number;
  /** How many pixels a point is at the current zoom. */
  readonly pixelsPerPoint: number;
}

type Drag =
  | { readonly kind: 'draw'; readonly from: { x: number; y: number } }
  | { readonly kind: 'move'; readonly from: { x: number; y: number }; readonly edges: Edges }
  | { readonly kind: 'handle'; readonly handle: FrameHandle };

/**
 * The crop frame, over a page in the document itself: what would be cut off
 * is shaded, and the frame that is kept is drawn, moved and resized with the
 * pointer, at whatever zoom the page is shown.
 */
export function CropLayer({ edges, onChange, width, height, pixelsPerPoint }: CropLayerProps) {
  const drag = useRef<Drag | null>(null);
  // A page smaller than the one the frame was drawn on shows as much of the frame as it has room for.
  const shown = clampEdges(edges, width, height);
  const frame = frameOf(shown, width, height);
  const something = EDGE_NAMES.some((edge) => shown[edge] > 0.05);
  const pixels = pixelsPerPoint;

  const pointOf = (event: PointerEvent<HTMLElement>, layer: HTMLElement) => {
    const box = layer.getBoundingClientRect();
    return { x: Math.min(Math.max((event.clientX - box.left) / pixels, 0), width), y: Math.min(Math.max((event.clientY - box.top) / pixels, 0), height) };
  };
  const hold = (event: PointerEvent<HTMLElement>, layer: HTMLElement) => {
    try {
      layer.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be held still works while it stays over the page.
    }
  };

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    hold(event, event.currentTarget);
    const point = pointOf(event, event.currentTarget);
    const inside = something && point.x >= frame.x && point.x <= frame.x + frame.width && point.y >= frame.y && point.y <= frame.y + frame.height;
    // Inside the frame: move it. Anywhere else (or with no frame yet): draw a new one.
    drag.current = inside ? { kind: 'move', from: point, edges: shown } : { kind: 'draw', from: point };
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    const point = pointOf(event, event.currentTarget);
    if (current.kind === 'draw') {
      // A click without a drag does not wipe the frame out.
      if (Math.hypot(point.x - current.from.x, point.y - current.from.y) * pixels > 4) onChange(edgesOfFrame(current.from, point, width, height));
    } else if (current.kind === 'move') onChange(moveFrame(current.edges, point.x - current.from.x, point.y - current.from.y));
    else onChange(dragHandle(shown, current.handle, point, width, height));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div className={styles.layer} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
      {/* What would be cut off, around the frame that is kept. */}
      <span className={styles.shade} style={{ top: 0, left: 0, right: 0, height: shown.top * pixels }} />
      <span className={styles.shade} style={{ bottom: 0, left: 0, right: 0, height: shown.bottom * pixels }} />
      <span className={styles.shade} style={{ top: shown.top * pixels, bottom: shown.bottom * pixels, left: 0, width: shown.left * pixels }} />
      <span className={styles.shade} style={{ top: shown.top * pixels, bottom: shown.bottom * pixels, right: 0, width: shown.right * pixels }} />
      <div className={styles.frame} data-empty={!something} style={{ left: frame.x * pixels, top: frame.y * pixels, width: frame.width * pixels, height: frame.height * pixels }}>
        {(Object.keys(FRAME_HANDLES) as FrameHandle[]).map((handle) => (
          <span
            key={handle}
            className={styles.handle}
            data-handle={handle}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              event.preventDefault();
              const layer = event.currentTarget.closest<HTMLElement>(`.${styles.layer}`);
              if (layer) hold(event, layer);
              drag.current = { kind: 'handle', handle };
            }}
          />
        ))}
      </div>
    </div>
  );
}
