import type { Mark } from './mark';
import styles from './mark-layer.module.css';
import { MarkShape } from './mark-shape';

export interface MarkPreviewProps {
  readonly marks: readonly Mark[] | undefined;
  /** The page's size in its file, in points. The preview fills the box it is put in, which shows the page unturned. */
  readonly pageWidth: number;
  readonly pageHeight: number;
}

/** What is drawn on a page, shown small over a picture of it (a thumbnail): to look at, not to change. */
export function MarkPreview({ marks, pageWidth, pageHeight }: MarkPreviewProps) {
  if (!marks || marks.length === 0) return null;
  return (
    <svg className={styles.layer} viewBox={`0 0 ${pageWidth} ${pageHeight}`} preserveAspectRatio="none" aria-hidden="true">
      {marks.map((mark) => (
        <MarkShape key={mark.id} mark={mark} />
      ))}
    </svg>
  );
}
