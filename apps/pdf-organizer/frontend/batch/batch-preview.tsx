import { useTranslation } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { PagePreview } from '../document/page-preview';
import { planFromDocument } from '../document/page-plan';
import type { PlanPage } from '../document/page-plan';
import { openAsPages, pageSourceProblem } from '../document/page-sources';
import { has, pagesAfter } from './batch-actions';
import type { BatchJob, PageTools } from './batch-actions';
import type { LoadedPicture } from '../document/load-picture';
import { signatureLook } from '../sign/signature-look';
import { signaturePlaces, signedPages, withSignatureShown } from './sign-settings';
import type { SignSettings, SignSpot } from './sign-settings';
import { SpotEditor } from './spot-picker';
import styles from './batch-view.module.css';

/** The sheet shown before there are files: A4 standing, in points. */
const BLANK = { width: 595, height: 842 };

export interface BatchPreviewProps {
  readonly host: AppHost;
  readonly files: readonly string[];
  /** The place in `files` of the file shown. */
  readonly index: number;
  readonly onIndexChange: (index: number) => void;
  readonly job: BatchJob;
  readonly tools: Omit<PageTools, 'file'>;
  /** How the signature shows, with its picture and lines; null when the files are not signed. */
  readonly signature: { readonly settings: SignSettings; readonly picture: LoadedPicture | null; readonly lines: readonly string[] } | null;
  /** Given: the box of the signature is moved on the page shown, where it shows on that page. */
  readonly onSpotChange?: (spot: SignSpot) => void;
  readonly disabled?: boolean;
  /** The page is shown as large as fits in this, in pixels. */
  readonly width?: number;
  readonly height?: number;
}

/**
 * One of the files as the run will leave it: its pages with what is written
 * on them and the signature where it shows. The arrows go from one file to
 * the next; the wheel and the arrows under the page go through its pages.
 */
export function BatchPreview({ host, files, index, onIndexChange, job, tools, signature, onSpotChange, disabled = false, width = 240, height = 300 }: BatchPreviewProps) {
  const t = useTranslation();
  const { invoke } = host;
  const path = files[index];
  /** The pages of the file shown, as it is in its file; null while it opens. */
  const [plan, setPlan] = useState<PlanPage[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  // The file shown is opened for as long as it is shown.
  useEffect(() => {
    setPlan(null);
    setProblem(null);
    if (path === undefined) return;
    let cancelled = false;
    let documentId: number | null = null;
    openAsPages({ invoke }, path).then(
      (opened) => {
        documentId = opened.documentId;
        if (cancelled) return void invoke('close_document', { documentId }).catch(() => {});
        setPlan(planFromDocument(opened.documentId, opened.pageSizes));
      },
      (error: unknown) => !cancelled && setProblem(pageSourceProblem(error)),
    );
    return () => {
      cancelled = true;
      if (documentId !== null) void invoke('close_document', { documentId }).catch(() => {});
    };
  }, [path, invoke]);

  // A new file opens on the page that shows the signature, when there is one; on its first page otherwise.
  const signedPage = plan && signature && has(job, 'sign') ? (signedPages(signature.settings.pages, plan.length)[0] ?? 0) : 0;
  useEffect(() => setPage(signedPage), [plan, signedPage]);

  if (path === undefined) {
    if (!signature || !onSpotChange) return null;
    // No files yet: the place is chosen on a blank sheet (A4, standing).
    const scale = Math.min(width / BLANK.width, height / BLANK.height);
    return (
      <section className={styles.preview} aria-label={t('pdf-organizer.batch.preview')}>
        <div className={styles.blank} dir="ltr" style={{ width: BLANK.width * scale, height: BLANK.height * scale }}>
          <SpotEditor
            pageWidth={BLANK.width}
            pageHeight={BLANK.height}
            spot={signature.settings.spot}
            onChange={onSpotChange}
            lookOf={(box) => signatureLook(box, 0, signature.picture, signature.lines, tools.fitted, 'spot')}
            disabled={disabled}
          />
        </div>
        <p className={styles.said}>{t('pdf-organizer.batch.previewNoFiles')}</p>
      </section>
    );
  }
  let pages: PlanPage[] = [];
  const shownPage = Math.max(0, Math.min(page, (plan?.length ?? 1) - 1));
  /** The page shown, when the box of the signature can be moved on it: a page it shows on, standing upright. */
  let editable: PlanPage | null = null;
  if (plan) {
    pages = pagesAfter(job, plan, { ...tools, file: fileName(path) });
    if (signature && has(job, 'sign')) {
      const places = signaturePlaces(signature.settings, pages, signature.picture, signature.lines, tools.fitted);
      const here = pages[shownPage];
      if (onSpotChange && here && here.rotation === 0 && places.some((place) => place.page === shownPage)) editable = here;
      // On the page where the box is moved, the box itself shows the signature.
      pages = withSignatureShown(pages, editable ? places.filter((place) => place.page !== shownPage) : places);
    }
  }

  return (
    <section className={styles.preview} aria-label={t('pdf-organizer.batch.preview')}>
      <div className={styles.previewHead}>
        <IconButton variant="ghost" aria-label={t('pdf-organizer.batch.previousFile')} disabled={index <= 0} onClick={() => onIndexChange(index - 1)}>
          <Icon name="chevron-left" size={14} />
        </IconButton>
        <span className={styles.previewName}>
          <bdi title={path}>{fileName(path)}</bdi>
          <span className={styles.count}>{t('pdf-organizer.batch.fileOf', { file: index + 1, count: files.length })}</span>
        </span>
        <IconButton variant="ghost" aria-label={t('pdf-organizer.batch.nextFile')} disabled={index >= files.length - 1} onClick={() => onIndexChange(index + 1)}>
          <Icon name="chevron-right" size={14} />
        </IconButton>
      </div>
      {problem ? (
        <p className={styles.said}>{t(problem)}</p>
      ) : plan === null ? (
        <p className={styles.said}>{t('pdf-organizer.batch.previewOpening')}</p>
      ) : (
        <PagePreview
          host={host}
          pages={pages}
          index={shownPage}
          onIndexChange={setPage}
          width={width}
          height={height}
          overlay={
            editable && signature && onSpotChange ? (
              <SpotEditor
                pageWidth={editable.width}
                pageHeight={editable.height}
                spot={signature.settings.spot}
                onChange={onSpotChange}
                lookOf={(box) => signatureLook(box, 0, signature.picture, signature.lines, tools.fitted, 'spot')}
                disabled={disabled}
              />
            ) : undefined
          }
        />
      )}
    </section>
  );
}
