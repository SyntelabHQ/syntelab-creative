import { useTranslation } from '@syntelab/i18n';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useId, useState } from 'react';
import type { LoadedPicture } from '../document/load-picture';
import type { AppHost } from '@syntelab/shell-api';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from '../marks/mark';
import { PagePreview } from '../document/page-preview';
import { pagesOf } from '../document/page-range';
import type { PageRange, Parity } from '../document/page-range';
import { FontSelect } from '../marks/font-select';
import { useFontFamilies } from '../marks/fonts';
import { PageRangeChoice } from '../organize/page-range-choice';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './insert-dialog.module.css';
import { scaled, textSample } from './watermark-sample';
import { WATERMARK_ANGLES, WATERMARK_PLACES, watermarkOn } from './watermark-marks';
import type { WatermarkAngle, WatermarkPlace } from './watermark-marks';

export interface WatermarkDialogProps {
  readonly host: AppHost;
  /** The place (from 0) of the page in view: the one the window shows first. */
  readonly currentPage: number;
  readonly open: boolean;
  readonly onClose: () => void;
  /** The pages of the document, and which of them are the chosen ones. */
  readonly pages: readonly PlanPage[];
  readonly targets: ReadonlySet<number>;
  /** Asks the user for a picture file; null when they changed their mind. */
  readonly onPickPicture: () => Promise<LoadedPicture | null>;
  /** Puts the marks on their pages (by page key), as one step that can be undone. */
  readonly onApply: (marks: ReadonlyMap<string, Mark>) => void;
}

const ANGLES = Object.keys(WATERMARK_ANGLES) as WatermarkAngle[];
/** A picture used as a watermark keeps at most this many pixels on its longer side: it is drawn faint, and on every page. */
const LARGEST_PICTURE_SIDE = 1400;


async function smallEnough(picture: LoadedPicture): Promise<LoadedPicture> {
  const shrink = LARGEST_PICTURE_SIDE / Math.max(picture.width, picture.height);
  if (shrink >= 1) return picture;
  const image = new Image();
  image.src = picture.address;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(picture.width * shrink);
  canvas.height = Math.round(picture.height * shrink);
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { address: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
}

/**
 * Asks what the watermark is (words or a picture), how it lies and where,
 * and puts it on the pages. There it is a mark like any other: it can still
 * be moved, resized and turned on each page with the drawing tools.
 */
export function WatermarkDialog({ host, currentPage, open, onClose, pages, targets, onPickPicture, onApply }: WatermarkDialogProps) {
  const t = useTranslation();
  const [source, setSource] = useState<'text' | 'picture'>('text');
  const [text, setText] = useState('');
  const [color, setColor] = useState('#c62828');
  const [picture, setPicture] = useState<LoadedPicture | null>(null);
  const [place, setPlace] = useState<WatermarkPlace>({ across: 0, down: 0 });
  const [angle, setAngle] = useState<WatermarkAngle>('rising');
  const [share, setShare] = useState(70);
  const [opacity, setOpacity] = useState(25);
  const [range, setRange] = useState<PageRange>({ kind: 'all' });
  const [parity, setParity] = useState<Parity>('both');
  const [font, setFont] = useState('sans');
  const [shown, setShown] = useState(0);
  const families = useFontFamilies(host);
  const marked = pagesOf(range, parity, pages.length, targets);
  const textId = useId();
  const sourceName = useId();

  // The first time it opens, it suggests a word in the user's language.
  const suggestion = t('pdf-organizer.watermark.suggestion');
  useEffect(() => {
    if (!open) return;
    setText((current) => (current === '' ? suggestion : current));
    setShown(currentPage);
  }, [open, suggestion]);

  const choosePicture = async () => {
    const picked = await onPickPicture();
    if (picked) setPicture(await smallEnough(picked));
  };

  const sample: Mark | null =
    source === 'text'
      ? text.trim() === ''
        ? null
        : textSample(text.trim(), color, font)
      : picture && { id: 'sample', kind: 'picture', x: 0, y: 0, width: picture.width, height: picture.height, rotation: 0, stroke: null, fill: null, opacity: 1, lineWidth: 1, data: picture.address };
  const options = { place, angle, share: share / 100, opacity: opacity / 100 };

  // The page itself shows how it will lie; the wheel goes through the pages.
  const shownPage = pages[shown];
  const preview = open && sample && shownPage && marked.includes(shown) ? watermarkOn(shownPage, sample, options, scaled, 'preview') : null;

  const apply = () => {
    if (!sample) return;
    const marks = new Map<string, Mark>();
    pages.forEach((page, index) => {
      if (marked.includes(index)) marks.set(page.key, watermarkOn(page, sample, options, scaled, `watermark-${Date.now().toString(36)}-${index}`));
    });
    onApply(marks);
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.command.watermark')} closeLabel={t('common.action.close')} wide>
      <form
        className={shapeStyles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <div className={styles.columns}>
          {open && <PagePreview host={host} pages={pages} index={shown} onIndexChange={setShown} marks={preview ? [preview] : []} width={260} height={360} />}
          <div className={styles.fields}>
            <div className={styles.sources}>
              <label className={shapeStyles.choice}>
                <input type="radio" name={sourceName} checked={source === 'text'} onChange={() => setSource('text')} />
                {t('pdf-organizer.watermark.fromText')}
              </label>
              <label className={shapeStyles.choice}>
                <input type="radio" name={sourceName} checked={source === 'picture'} onChange={() => setSource('picture')} />
                {t('pdf-organizer.watermark.fromPicture')}
              </label>
            </div>
            {source === 'text' ? (
              <div className={styles.textRow}>
                <input id={textId} type="text" className={styles.text} dir="auto" maxLength={80} value={text} aria-label={t('pdf-organizer.watermark.text')} onChange={(event) => setText(event.target.value)} />
                <input type="color" className={styles.colorBox} value={color} aria-label={t('pdf-organizer.watermark.color')} onChange={(event) => setColor(event.target.value)} />
              </div>
            ) : null}
            {source === 'text' ? (
              <label className={styles.row}>
                <span>{t('pdf-organizer.marks.font')}</span>
                <FontSelect className={shapeStyles.select} value={font} onChange={setFont} families={families} />
              </label>
            ) : (
              <Button onClick={() => void choosePicture()}>
                <Icon name="image" size={14} />
                {t(picture ? 'pdf-organizer.watermark.otherPicture' : 'pdf-organizer.watermark.choosePicture')}
              </Button>
            )}

            <label className={styles.slider}>
              <span>{t('pdf-organizer.watermark.size')}</span>
              <input type="range" min={10} max={100} step={5} value={share} onChange={(event) => setShare(Number(event.target.value))} />
              <span className={styles.amount}>{share}%</span>
            </label>
            <label className={styles.slider}>
              <span>{t('pdf-organizer.marks.opacity')}</span>
              <input type="range" min={5} max={100} step={5} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} />
              <span className={styles.amount}>{opacity}%</span>
            </label>
            <label className={styles.row}>
              <span>{t('pdf-organizer.watermark.angle')}</span>
              <select className={shapeStyles.select} value={angle} onChange={(event) => setAngle(event.target.value as WatermarkAngle)}>
                {ANGLES.map((option) => (
                  <option key={option} value={option}>
                    {t(`pdf-organizer.watermark.angle.${option}`)}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.placeRow}>
              <span>{t('pdf-organizer.watermark.place')}</span>
              <div role="radiogroup" aria-label={t('pdf-organizer.watermark.place')} className={styles.placeGrid}>
                {WATERMARK_PLACES.map((option) => (
                  <button
                    key={`${option.across}:${option.down}`}
                    type="button"
                    role="radio"
                    aria-checked={option.across === place.across && option.down === place.down}
                    aria-label={t(`pdf-organizer.watermark.place.${option.down}.${option.across}`)}
                    className={styles.placeCell}
                    onClick={() => setPlace(option)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className={shapeStyles.lead}>{t('pdf-organizer.watermark.movable')}</p>
        <PageRangeChoice range={range} onRangeChange={setRange} parity={parity} onParityChange={setParity} chosen={targets} pageCount={pages.length} />
        <div className={shapeStyles.actions}>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" variant="primary" disabled={!sample || marked.length === 0}>
            {t('pdf-organizer.watermark.apply')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
