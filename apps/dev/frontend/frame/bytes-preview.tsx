import { useI18n } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import { closeLook, fileAsBase64, lookAt, problemKey } from '../api/dev-api';
import type { Look } from '../api/dev-api';
import styles from './bytes-preview.module.css';
import { formatBytes } from './format';
import { COPIED_MOST, hexLines } from './result-file';
import frame from './tool-frame.module.css';

export interface BytesPreviewProps {
  readonly host: Pick<AppHost, 'invoke' | 'resourceUrl'>;
  /** The file shown: one the user opened, or a result of the program's own. */
  readonly path: string;
}

/** The bytes of a picture, as a PNG: what the clipboard takes. Another kind is drawn once and written again. */
async function pictureAsPng(base64: string, mime: string): Promise<Blob> {
  if (mime === 'image/png') return new Blob([Uint8Array.from(atob(base64), (letter) => letter.charCodeAt(0))], { type: 'image/png' });
  const picture = new Image();
  picture.src = `data:${mime};base64,${base64}`;
  await picture.decode();
  const canvas = document.createElement('canvas');
  // A drawing that does not say how large it is (an SVG without its size) is drawn at the size browsers give it.
  canvas.width = picture.naturalWidth || 300;
  canvas.height = picture.naturalHeight || 150;
  canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('not drawn'))), 'image/png'));
}

/**
 * What a file of bytes looks like: a picture is shown as it is; anything else
 * is told by its kind (guessed from how it starts) and its size, with its
 * first bytes. A PDF is told of the same way: the window of the program does
 * not let a page show one.
 */
export function BytesPreview({ host, path }: BytesPreviewProps) {
  const { t, language } = useI18n();
  const [look, setLook] = useState<Look | null>(null);
  /** The picture could not be drawn (a kind the window does not know after all): it is told of as other bytes. */
  const [undrawn, setUndrawn] = useState(false);
  const [told, setTold] = useState<{ readonly key: string; readonly problem: boolean } | null>(null);

  useEffect(() => {
    let shown = true;
    let number: number | null = null;
    setLook(null);
    setUndrawn(false);
    setTold(null);
    lookAt(host, path).then(
      (found) => {
        number = found.look;
        if (shown) setLook(found);
        else closeLook(host, found.look);
      },
      (error: unknown) => shown && setTold({ key: problemKey(error), problem: true }),
    );
    return () => {
      shown = false;
      if (number !== null) closeLook(host, number);
    };
  }, [host.invoke, path]);

  const copyPicture = async () => {
    if (!look) return;
    try {
      const png = await pictureAsPng(await fileAsBase64(host, path), look.mime);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setTold({ key: 'dev.preview.pictureCopied', problem: false });
    } catch {
      setTold({ key: 'dev.problem.clipboard', problem: true });
    }
  };

  if (!look) return <div className={frame.blank}>{told ? t(told.key) : ''}</div>;
  const picture = look.view === 'picture' && !undrawn;
  const kind = look.view === 'pdf' ? t('dev.preview.pdf') : look.view === 'text' ? t('dev.preview.text') : look.format !== null ? t('dev.preview.format', { format: look.format }) : t('dev.preview.unknown');
  const canCopyPicture = picture && look.size <= COPIED_MOST && typeof ClipboardItem !== 'undefined';

  return (
    <div className={styles.preview}>
      <div className={styles.facts}>
        <Icon name={picture ? 'image' : 'file'} size={14} />
        <span>{`${kind} · ${formatBytes(look.size, language)}`}</span>
        <span className={frame.spring} />
        {told && <span data-problem={told.problem}>{t(told.key)}</span>}
        {canCopyPicture && (
          <button type="button" className={frame.action} onClick={() => void copyPicture()}>
            <Icon name="copy" size={13} />
            {t('dev.preview.copyPicture')}
          </button>
        )}
      </div>
      {picture ? (
        <div className={styles.picture}>
          <img src={host.resourceUrl(`look/${look.look}`)} alt={kind} onError={() => setUndrawn(true)} />
        </div>
      ) : look.view === 'pdf' ? (
        // The window's own PDF reader shows the document, with its pages, zoom and find.
        <iframe className={styles.document} src={host.resourceUrl(`look/${look.look}`)} title={kind} />
      ) : (
        <div className={styles.bytes}>
          {look.view === 'picture' && <p className={styles.note}>{t('dev.preview.undrawn')}</p>}
          {look.size > 0 && (
            <>
              <span className={styles.heading}>{t('dev.preview.start')}</span>
              <pre className={styles.start} dir="ltr">
                {hexLines(look.start).join('\n')}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
