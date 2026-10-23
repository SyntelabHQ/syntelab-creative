import { useTranslation } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useMemo, useState } from 'react';
import { emptyTabCommands } from '../commands';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { openBinderTab } from '../document/open-file';
import { useFileCommands } from '../document/use-file-commands';
import { useTabCommands } from '../use-tab-commands';
import { PageImage } from '../viewer/page-image';
import { nextDifference } from './compare-pages';
import type { PageComparison } from './compare-pages';
import { useComparison } from './use-comparison';
import type { ComparedDocument } from './use-comparison';
import styles from './compare-view.module.css';

/** The widest a compared page is drawn, in pixels. */
const PAGE_WIDTH = 460;
/** The most differing lines listed for one page and one side. */
const MAX_LINES = 60;

const STATUS_ICONS: Record<PageComparison['status'], string> = {
  same: 'check',
  different: 'right-left',
  'only-first': 'file',
  'only-second': 'file-circle-plus',
};

const NOTHING_TO_DO = () => {};

/**
 * Two documents side by side, compared page by page by their text: which
 * pages differ, and which lines each has alone.
 */
export function CompareView({ host }: AppViewProps) {
  const t = useTranslation();
  const comparison = useComparison(host, host.params.first ?? '', host.params.second ?? '');
  const [page, setPage] = useState(0);

  const fileCommands = useFileCommands(host, NOTHING_TO_DO);
  const files = fileCommands.commands;
  const commands = useMemo(
    () => emptyTabCommands(files, () => openBinderTab(host, t('pdf-organizer.binder.title'))),
    [files, host, t],
  );
  useTabCommands(host, commands);

  const pages = comparison.status === 'ready' ? comparison.pages : [];
  const differing = pages.filter((compared) => compared.status !== 'same').length;
  // Start at the first page that differs.
  useEffect(() => {
    const first = pages.findIndex((compared) => compared.status !== 'same');
    setPage(first < 0 ? 0 : first);
  }, [pages]);

  if (comparison.status === 'loading') {
    return (
      <div className={styles.message} role="status">
        {t('pdf-organizer.compare.loading')}
      </div>
    );
  }
  if (comparison.status === 'error') {
    return (
      <div className={styles.message} role="alert">
        <span className={styles.warning}>
          <Icon name="triangle-exclamation" size={32} />
        </span>
        <p>{t('pdf-organizer.compare.failed')}</p>
      </div>
    );
  }

  const current = pages[page];
  const step = (direction: 1 | -1) => {
    const next = nextDifference(pages, page, direction);
    if (next !== null) setPage(next);
  };
  const picture = (document: ComparedDocument) => {
    const width = document.pageSizes[page * 2];
    const height = document.pageSizes[page * 2 + 1];
    if (width === undefined || height === undefined) {
      return <div className={styles.noPage}>{t('pdf-organizer.compare.noPage')}</div>;
    }
    const shown = Math.min(PAGE_WIDTH, (PAGE_WIDTH * 1.2 * width) / Math.max(width, height));
    return (
      // PDF content is never mirrored.
      <div className={styles.paper} dir="ltr" style={{ width: shown, aspectRatio: `${width} / ${height}` }}>
        <PageImage
          src={host.resourceUrl(`page/${document.documentId}/${page}`, { scale: Math.min(3, (shown / width) * window.devicePixelRatio), rotate: 0 })}
        />
      </div>
    );
  };
  const lines = (list: readonly string[], kind: 'removed' | 'added') =>
    list.length > 0 && (
      <ul className={styles.lines} data-kind={kind}>
        {list.slice(0, MAX_LINES).map((line, index) => (
          <li key={index}>
            <bdi>{line}</bdi>
          </li>
        ))}
        {list.length > MAX_LINES && <li className={styles.more}>{t('pdf-organizer.compare.moreLines', { count: list.length - MAX_LINES })}</li>}
      </ul>
    );

  return (
    <div className={styles.view}>
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={NOTHING_TO_DO} />
      <div className={styles.bar}>
        <span className={styles.summary} role="status">
          {differing === 0 ? t('pdf-organizer.compare.same') : t('pdf-organizer.compare.summary', { count: differing, total: pages.length })}
        </span>
        <IconButton variant="ghost" aria-label={t('pdf-organizer.compare.previous')} disabled={differing === 0} onClick={() => step(-1)}>
          <Icon name="chevron-up" size={14} />
        </IconButton>
        <IconButton variant="ghost" aria-label={t('pdf-organizer.compare.next')} disabled={differing === 0} tooltipSide="bottom-end" onClick={() => step(1)}>
          <Icon name="chevron-down" size={14} />
        </IconButton>
      </div>
      <div className={styles.body}>
        <nav aria-label={t('pdf-organizer.viewer.pages')} className={styles.pages}>
          {pages.map((compared) => (
            <button
              key={compared.page}
              type="button"
              className={styles.pageButton}
              data-status={compared.status}
              aria-current={compared.page === page ? 'page' : undefined}
              onClick={() => setPage(compared.page)}
            >
              <Icon name={STATUS_ICONS[compared.status]} size={12} />
              <span>{t('pdf-organizer.viewer.page', { page: compared.page + 1 })}</span>
              <span className={styles.status}>{t(`pdf-organizer.compare.status.${compared.status}`)}</span>
            </button>
          ))}
        </nav>
        <div className={styles.sides}>
          {[comparison.first, comparison.second].map((document, side) => (
            <section key={document.documentId} className={styles.side}>
              <h2 className={styles.name}>
                <bdi>{document.fileName}</bdi>
              </h2>
              {picture(document)}
              {current && lines(side === 0 ? current.removed : current.added, side === 0 ? 'removed' : 'added')}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
