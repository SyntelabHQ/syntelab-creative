import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { PageImage } from '../viewer/page-image';
import { pageCountOf } from './binder-model';
import type { BinderFile } from './binder-model';
import styles from './page-chooser.module.css';

/** Width of a page in the chooser; its height follows the page's own shape. */
const PICTURE_WIDTH = 96;

export interface PageChooserProps {
  readonly host: AppHost;
  /** The card whose pages are being chosen, or null while the window is closed. */
  readonly file: BinderFile | null;
  readonly onClose: () => void;
  readonly onChoose: (pages: ReadonlySet<number>) => void;
}

/** A card opened: every page of the file, to tick the ones that go into the binder. */
export function PageChooser({ host, file, onClose, onChoose }: PageChooserProps) {
  const t = useTranslation();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const pageCount = file ? pageCountOf(file) : 0;

  // Each time a card is opened, start from what that card has now.
  useEffect(() => {
    if (file) setChosen(new Set(file.chosen));
  }, [file]);

  const toggle = (page: number) =>
    setChosen((current) => {
      const next = new Set(current);
      if (!next.delete(page)) next.add(page);
      return next;
    });

  return (
    <Dialog open={file !== null} onClose={onClose} title={file?.fileName ?? ''} closeLabel={t('common.action.close')}>
      {file && (
        <div className={styles.chooser}>
          <div className={styles.head}>
            <span className={styles.count} aria-live="polite">
              {t('pdf-organizer.binder.pagesOf', { chosen: chosen.size, count: pageCount })}
            </span>
            <Button onClick={() => setChosen(new Set(Array.from({ length: pageCount }, (_, page) => page)))}>
              {t('pdf-organizer.command.selectAll')}
            </Button>
            <Button onClick={() => setChosen(new Set())}>{t('pdf-organizer.command.selectNone')}</Button>
          </div>
          <div role="group" aria-label={t('pdf-organizer.organize.grid')} className={styles.pages}>
            {Array.from({ length: pageCount }, (_, page) => {
              const width = file.pageSizes[page * 2] ?? 1;
              const height = file.pageSizes[page * 2 + 1] ?? 1;
              return (
                <button
                  key={page}
                  type="button"
                  className={styles.page}
                  aria-pressed={chosen.has(page)}
                  aria-label={t('pdf-organizer.viewer.page', { page: page + 1 })}
                  onClick={() => toggle(page)}
                >
                  <span className={styles.picture} style={{ width: PICTURE_WIDTH, height: (PICTURE_WIDTH * height) / width }}>
                    <PageImage src={host.resourceUrl(`thumbnail/${file.documentId}/${page}`)} />
                  </span>
                  <span>{page + 1}</span>
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <Button onClick={onClose}>{t('common.action.cancel')}</Button>
            <Button
              variant="primary"
              // A card with no pages would be an empty card: remove the card instead.
              disabled={chosen.size === 0}
              onClick={() => {
                onChoose(chosen);
                onClose();
              }}
            >
              {t('pdf-organizer.binder.usePages')}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
