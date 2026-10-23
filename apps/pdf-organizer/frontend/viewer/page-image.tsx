import { useEffect, useRef, useState } from 'react';
import styles from './page-image.module.css';

const MAX_ATTEMPTS = 4;
const RETRY_MILLISECONDS = 350;

export interface PageImageProps {
  /** URL of the picture, without the retry counter. */
  readonly src: string;
}

/**
 * A page picture drawn by the Rust side. A request can be dropped there when
 * newer ones arrive (fast scrolling); a picture still on screen asks again.
 *
 * When the address changes (the same page, drawn sharper for a new zoom),
 * the picture already shown stays, stretched, until the new one has arrived:
 * the page never goes blank while zooming.
 */
export function PageImage({ src }: PageImageProps) {
  /** The address of the last picture that arrived. */
  const [arrived, setArrived] = useState<string | null>(null);
  const latest = useRef(src);
  latest.current = src;

  return (
    <span className={styles.stack}>
      {arrived !== null && arrived !== src && <img className={`${styles.image} ${styles.previous}`} data-loaded="true" src={arrived} alt="" draggable={false} />}
      {/* A new address is a new picture: start again, with nothing loaded or failed. */}
      <Picture key={src} src={src} onArrived={(address) => address.startsWith(latest.current) && setArrived(address)} />
    </span>
  );
}

interface PictureProps extends PageImageProps {
  /** Called with the address the picture was loaded from. */
  readonly onArrived: (address: string) => void;
}

function Picture({ src, onArrived }: PictureProps) {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!failed || attempt >= MAX_ATTEMPTS) return;
    const timer = setTimeout(() => {
      setFailed(false);
      setAttempt((current) => current + 1);
    }, RETRY_MILLISECONDS);
    return () => clearTimeout(timer);
  }, [failed, attempt]);

  const separator = src.includes('?') ? '&' : '?';
  const address = attempt === 0 ? src : `${src}${separator}attempt=${attempt}`;
  useEffect(() => {
    if (loaded) onArrived(address);
    // Told once, when the picture is there.
  }, [loaded]);

  if (failed) return null;
  return (
    <img
      // A picture the web view still remembers is complete before "load" can be heard.
      ref={(image) => {
        if (image?.complete && image.naturalWidth > 0) setLoaded(true);
      }}
      className={styles.image}
      data-loaded={loaded}
      src={address}
      alt=""
      draggable={false}
      decoding="async"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
    />
  );
}
