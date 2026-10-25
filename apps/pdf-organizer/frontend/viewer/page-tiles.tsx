import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { whenDecoded } from './page-image';
import styles from './page-tiles.module.css';
import { tilesInView } from './zoom';
import type { TileRect } from './zoom';

/** How long scrolling must pause before the pieces now in view are asked for. */
const MEASURE_AFTER_MILLISECONDS = 100;
const MAX_ATTEMPTS = 4;
const RETRY_MILLISECONDS = 400;

/** The part of the page in view, as fractions of its width and height (they may go past 0 and 1). */
interface Seen {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The pieces drawn at one sharpness. */
interface Layer {
  /** What tells this sharpness apart (the address of the whole picture). */
  readonly id: string;
  readonly picture: { readonly width: number; readonly height: number };
  readonly tiles: readonly TileRect[];
  readonly urlOf: (tile: TileRect) => string;
}

export interface PageTilesProps {
  /** The size of the page's picture at this sharpness, in its pixels. */
  readonly picture: { readonly width: number; readonly height: number };
  /** Changes whenever the sharpness or the turn changes. */
  readonly id: string;
  /** The address of one piece. */
  readonly urlOf: (tile: TileRect) => string;
  /** The element that scrolls the pages. */
  readonly scrollRef: RefObject<HTMLElement | null>;
  /** The pieces are drawn for the zoom shown: copied pixel for pixel (see `PageImage`). */
  readonly exact?: boolean;
}

/**
 * A page drawn very sharp, in pieces: only those in view (and one more all
 * around) are drawn, so any zoom costs about the same. Lies over the whole
 * page drawn less sharp, which shows until the pieces come.
 *
 * When the sharpness changes, the pieces already there stay (stretched)
 * until the new ones in view have all arrived.
 */
export function PageTiles({ picture, id, urlOf, scrollRef, exact = false }: PageTilesProps) {
  const own = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState<Seen | null>(null);

  useLayoutEffect(() => {
    const element = own.current;
    const scroller = scrollRef.current;
    if (!element || !scroller) return;
    const measure = () => {
      const [box, area] = [element.getBoundingClientRect(), scroller.getBoundingClientRect()];
      if (box.width <= 0 || box.height <= 0) return;
      const next = {
        left: (area.left - box.left) / box.width,
        top: (area.top - box.top) / box.height,
        right: (area.right - box.left) / box.width,
        bottom: (area.bottom - box.top) / box.height,
      };
      setSeen((current) =>
        current &&
        Math.abs(current.left - next.left) < 1e-4 &&
        Math.abs(current.top - next.top) < 1e-4 &&
        Math.abs(current.right - next.right) < 1e-4 &&
        Math.abs(current.bottom - next.bottom) < 1e-4
          ? current
          : next,
      );
    };
    measure();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(measure, MEASURE_AFTER_MILLISECONDS);
    };
    scroller.addEventListener('scroll', later, { passive: true });
    const observer = new ResizeObserver(later);
    observer.observe(element);
    observer.observe(scroller);
    return () => {
      clearTimeout(timer);
      scroller.removeEventListener('scroll', later);
      observer.disconnect();
    };
  }, [scrollRef]);

  const tiles = useMemo(
    () =>
      seen
        ? tilesInView(picture, {
            left: seen.left * picture.width,
            top: seen.top * picture.height,
            right: seen.right * picture.width,
            bottom: seen.bottom * picture.height,
          })
        : [],
    [seen, picture.width, picture.height],
  );
  const current: Layer = { id, picture, tiles, urlOf };

  /** The pieces of the last sharpness that arrived, kept until the new ones are all there. */
  const [kept, setKept] = useState<{ id: string; previous: Layer | null }>({ id, previous: null });
  const [arrived, setArrived] = useState<ReadonlySet<string>>(() => new Set());
  /** The layer on screen now. */
  const shownLayer = useRef<Layer>(current);
  if (kept.id !== id) {
    // Worked out while drawing, not after: the pieces already on screen must stay in the very same elements.
    const before = shownLayer.current;
    const ready = before.tiles.filter((tile) => arrived.has(keyOf(before.id, tile)));
    setKept({ id, previous: ready.length > 0 ? { ...before, tiles: ready } : kept.previous });
  }
  const previous = kept.id === id ? kept.previous : null;
  useEffect(() => {
    shownLayer.current = current;
  });

  const allArrived = tiles.length > 0 && tiles.every((tile) => arrived.has(keyOf(id, tile)));
  useEffect(() => {
    if (allArrived) setKept((now) => (now.previous ? { ...now, previous: null } : now));
  }, [allArrived]);
  // Forget the pieces of sharpnesses no longer shown.
  useEffect(() => {
    setArrived((known) => {
      const keep = [...known].filter((key) => key.startsWith(`${id}|`) || (previous && key.startsWith(`${previous.id}|`)));
      return keep.length === known.size ? known : new Set(keep);
    });
  }, [id, previous]);

  const onArrived = (key: string) =>
    setArrived((known) => (known.has(key) ? known : new Set(known).add(key)));

  return (
    <span ref={own} className={styles.tiles} aria-hidden="true">
      {/* One list, keyed by piece: a piece that goes from the current sharpness to the last keeps its element. */}
      {[...(previous && previous.id !== id ? pieces(previous) : []), ...pieces(current, onArrived, exact)]}
    </span>
  );
}

function keyOf(id: string, tile: TileRect): string {
  return `${id}|${tile.x},${tile.y},${tile.width},${tile.height}`;
}

function pieces(layer: Layer, onArrived?: (key: string) => void, exact = false) {
  return layer.tiles.map((tile) => {
    const key = keyOf(layer.id, tile);
    return (
      <Piece
        key={key}
        src={layer.urlOf(tile)}
        style={{
          left: `${(tile.x / layer.picture.width) * 100}%`,
          top: `${(tile.y / layer.picture.height) * 100}%`,
          width: `${(tile.width / layer.picture.width) * 100}%`,
          height: `${(tile.height / layer.picture.height) * 100}%`,
        }}
        onArrived={onArrived && (() => onArrived(key))}
        exact={exact}
      />
    );
  });
}

interface PieceProps {
  readonly src: string;
  readonly style: { left: string; top: string; width: string; height: string };
  readonly onArrived?: () => void;
  readonly exact?: boolean;
}

/** One piece. The Rust side may drop a request when many newer ones come; a piece still wanted asks again. */
function Piece({ src, style, onArrived, exact = false }: PieceProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const told = useRef(onArrived);
  told.current = onArrived;

  useEffect(() => {
    if (!failed || attempt >= MAX_ATTEMPTS - 1) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((count) => count + 1);
    }, RETRY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);

  useEffect(() => {
    if (loaded) told.current?.();
  }, [loaded]);

  if (failed) return null;
  const address = attempt === 0 ? src : `${src}${src.includes('?') ? '&' : '?'}attempt=${attempt}`;
  return (
    <img
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) whenDecoded(image, () => setLoaded(true));
      }}
      className={styles.piece}
      data-loaded={loaded}
      data-exact={exact}
      src={address}
      style={style}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={(event) => whenDecoded(event.currentTarget, () => setLoaded(true))}
      onError={() => setFailed(true)}
    />
  );
}
