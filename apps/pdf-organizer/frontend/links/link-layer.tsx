import { useTranslation } from '@syntelab/i18n';
import { tooltip } from '@syntelab/ui-kit';
import type { QuarterTurns } from '../document/page-plan';
import { turnBox } from '../find/find-hits';
import styles from './link-layer.module.css';
import { canBeFollowed } from './page-links';
import type { PageLink } from './page-links';

export interface LinkLayerProps {
  /** The links of this page. */
  readonly links: readonly PageLink[];
  /** The page's size in the file, in points, and how far it is turned as shown. */
  readonly pageWidth: number;
  readonly pageHeight: number;
  readonly turn: QuarterTurns;
  /** How many pixels a point is at the current zoom. */
  readonly pixelsPerPoint: number;
  /** Where a page of the file is in the document now; undefined when it was removed. */
  readonly placeOf: (page: number) => number | undefined;
  readonly onGoToPage: (place: number) => void;
  /** Hands an address to the system: its browser, its mail program. */
  readonly onOpen: (url: string) => void;
  /** Shows what a check of a signature of the file says (by its place in `signatures`). */
  readonly onSignature: (signature: number) => void;
}

/**
 * The links of one page, over its picture: a click goes to the page, or opens the address in the browser. A signature
 * shown on the page is clicked the same way, to see what a check of it says.
 */
export function LinkLayer({ links, pageWidth, pageHeight, turn, pixelsPerPoint, placeOf, onGoToPage, onOpen, onSignature }: LinkLayerProps) {
  const t = useTranslation();
  return (
    <>
      {links.map((link, index) => {
        if (link.signature !== null) {
          const box = turnBox(link, pageWidth, pageHeight, turn);
          const says = t('pdf-organizer.links.signature');
          const signature = link.signature;
          return (
            <button
              key={index}
              type="button"
              className={styles.link}
              style={{ left: box.x * pixelsPerPoint, top: box.y * pixelsPerPoint, width: box.width * pixelsPerPoint, height: box.height * pixelsPerPoint }}
              aria-label={says}
              {...tooltip(says, 'bottom')}
              onClick={() => onSignature(signature)}
            />
          );
        }
        const place = link.page === null ? undefined : placeOf(link.page);
        const url = link.url !== null && canBeFollowed(link.url) ? link.url : null;
        // A link that leads to a page that is gone, or to something that is not opened, is not offered.
        if (place === undefined && url === null) return null;
        const box = turnBox(link, pageWidth, pageHeight, turn);
        const says = place !== undefined ? t('pdf-organizer.links.toPage', { number: place + 1 }) : (url ?? '');
        return (
          <button
            key={index}
            type="button"
            className={styles.link}
            style={{ left: box.x * pixelsPerPoint, top: box.y * pixelsPerPoint, width: box.width * pixelsPerPoint, height: box.height * pixelsPerPoint }}
            aria-label={says}
            // Where it leads is said before it is followed.
            {...tooltip(says, 'bottom')}
            onClick={() => (place !== undefined ? onGoToPage(place) : url !== null && onOpen(url))}
          />
        );
      })}
    </>
  );
}
