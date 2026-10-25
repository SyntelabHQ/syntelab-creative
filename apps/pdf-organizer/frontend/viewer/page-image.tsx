import { useEffect, useRef, useState } from 'react';
import styles from './page-image.module.css';

const MAX_ATTEMPTS = 4;
const RETRY_MILLISECONDS = 350;

export interface PageImageProps {
  /** URL of the picture, without the retry counter. */
  readonly src: string;
  /** A small picture of the same page (its thumbnail), shown stretched until the first picture has arrived. */
  readonly placeholder?: string;
  /** Called with `src` once that picture is on screen. */
  readonly onShown?: (src: string) => void;
  /**
   * The picture has exactly the screen's pixels of the place it fills (it was drawn for the zoom shown). It is
   * then copied pixel for pixel: otherwise the web view smooths it, by a hair at screen scales such as 125%,
   * and every letter looks soft.
   */
  readonly exact?: boolean;
}

/**
 * A page picture drawn by the Rust side. A request can be dropped there when
 * newer ones arrive (fast scrolling); a picture still on screen asks again.
 *
 * When the address changes (the same page, drawn sharper for a new zoom),
 * the picture already shown stays, stretched, until the new one has arrived:
 * the page never goes blank while zooming. It stays the very same element,
 * so it cannot blink while the new one is put next to it.
 */
export function PageImage({ src, placeholder, onShown, exact = false }: PageImageProps) {
  /** The address (without the retry counter) of the last picture that arrived. */
  const [arrived, setArrived] = useState<string | null>(null);
  const latest = useRef(src);
  latest.current = src;
  const shown = useRef(onShown);
  shown.current = onShown;

  useEffect(() => {
    if (arrived === src) shown.current?.(src);
  }, [arrived, src]);

  // The picture being replaced first, so the new one lies over it.
  const addresses = arrived !== null && arrived !== src ? [arrived, src] : [src];
  return (
    <span className={styles.stack}>
      {arrived === null && placeholder && (
        <img className={`${styles.image} ${styles.previous}`} data-loaded="true" src={placeholder} alt="" draggable={false} />
      )}
      {addresses.map((address) => (
        // Keyed by address: the picture already there keeps its element when a newer one joins it.
        <Picture
          key={address}
          src={address}
          replaced={address !== src}
          exact={exact && address === src}
          onArrived={() => address === latest.current && setArrived(address)}
        />
      ))}
    </span>
  );
}

interface PictureProps {
  readonly src: string;
  /** A picture still shown under the one that replaces it. */
  readonly replaced: boolean;
  readonly exact: boolean;
  readonly onArrived: () => void;
}

function Picture({ src, replaced, exact, onArrived }: PictureProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const told = useRef(onArrived);
  told.current = onArrived;

  useEffect(() => {
    if (!failed || attempt >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((current) => current + 1);
    }, RETRY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);

  useEffect(() => {
    if (loaded) told.current();
    // Told once, when the picture is there.
  }, [loaded]);

  if (failed) return null;
  const separator = src.includes('?') ? '&' : '?';
  const address = attempt === 0 ? src : `${src}${separator}attempt=${attempt}`;
  return (
    <img
      // A picture the web view still remembers is complete before "load" can be heard.
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) whenDecoded(image, () => setLoaded(true));
      }}
      className={replaced ? `${styles.image} ${styles.previous}` : styles.image}
      data-loaded={loaded}
      data-exact={exact}
      src={address}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={(event) => whenDecoded(event.currentTarget, () => setLoaded(true))}
      onError={() => setFailed(true)}
    />
  );
}

/**
 * Calls `then` once `image` is ready to paint. A picture that has loaded may
 * still be undecoded; shown before that, the page would be blank for a frame.
 */
export function whenDecoded(image: HTMLImageElement, then: () => void): void {
  if (typeof image.decode !== 'function') return then();
  image.decode().then(then, then);
}
