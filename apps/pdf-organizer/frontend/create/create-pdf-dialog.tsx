import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Dialog, Icon } from '@syntelab/ui-kit';
import { useEffect, useState } from 'react';
import type { ClipboardEvent, ReactNode } from 'react';
import { nextNewName, openDraftTab, openFilesInTabs } from '../document/drafts';
import { openBinderTab } from '../document/open-file';
import type { OpenedFiles } from '../document/open-files';
import { PAGE_SOURCES, pageSourceProblem } from '../document/page-sources';
import { POINTS_PER_MILLIMETRE } from '../document/page-shape';
import { SheetSelect } from '../document/sheet-select';
import { DEFAULT_SHEET, sheetOf } from '../document/sheets';
import { receiveFiles } from '../document/received-files';
import shapeStyles from '../organize/shape-dialog.module.css';
import styles from './create-pdf-dialog.module.css';

export interface CreatePdfDialogProps {
  readonly host: AppHost;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Hears how it went: how many files were chosen, and a problem to show. */
  readonly onDone: (opened: OpenedFiles) => void;
}

/** The ways to make a PDF. */
type Way = 'file' | 'combine' | 'each' | 'web-address' | 'web-page' | 'clipboard' | 'blank';
const WAYS: readonly { way: Way; icon: string }[] = [
  { way: 'file', icon: 'file' },
  { way: 'combine', icon: 'object-group' },
  { way: 'each', icon: 'folder-tree' },
  { way: 'web-address', icon: 'link' },
  { way: 'web-page', icon: 'globe' },
  { way: 'clipboard', icon: 'paste' },
  { way: 'blank', icon: 'file-circle-plus' },
];
const WEB_PAGES = ['html', 'htm', 'xhtml'];
const MAX_BLANK_PAGES = 500;

/** What the clipboard holds, as files: what was copied as files or pictures, or copied text as a text file. */
function clipboardFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  if (data.files.length > 0) return [...data.files];
  const text = data.getData('text/plain');
  return text.trim() === '' ? [] : [new File([text], 'pasted-text.txt', { type: 'text/plain' })];
}

/**
 * "Create a PDF": from one file, from several (combined, or one PDF each),
 * from a saved web page, from the clipboard, or as empty pages. What is made
 * opens in a tab, not saved anywhere yet.
 */
export function CreatePdfDialog({ host, open, onClose, onDone }: CreatePdfDialogProps) {
  const t = useTranslation();
  const [way, setWay] = useState<Way>('file');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<string>(DEFAULT_SHEET);
  const [landscape, setLandscape] = useState(false);
  const [count, setCount] = useState(1);
  const [address, setAddress] = useState('');
  const { invoke, pickFiles, saveWebPage } = host;

  useEffect(() => {
    if (open) setNote(null);
  }, [open, way]);

  const finish = (opened: OpenedFiles) => {
    onDone(opened);
    if (opened.chosen > 0) onClose();
  };

  /** Each file becomes a PDF in a tab of its own (a PDF opens as it is). */
  const eachInItsTab = async (paths: readonly string[]) => {
    const failed = await openFilesInTabs(host, paths);
    finish({ chosen: paths.length, problem: failed[0] ? pageSourceProblem(failed[0].error) : null });
  };

  const fromPaths = async (paths: readonly string[], combine: boolean) => {
    if (paths.length === 0) return;
    // Several files to combine are laid out in a binder, to be ordered first.
    if (combine && paths.length > 1) {
      openBinderTab(host, t('pdf-organizer.binder.title'), paths);
      return finish({ chosen: paths.length, problem: null });
    }
    await eachInItsTab(paths);
  };

  const pick = async (several: boolean, extensions: readonly string[], combine: boolean) => {
    const paths = await pickFiles({ typeName: t('pdf-organizer.open.pagesType'), extensions: [...extensions], multiple: several });
    if (paths.length === 0) return;
    setBusy(true);
    try {
      await fromPaths(paths, combine);
    } finally {
      setBusy(false);
    }
  };

  const fromClipboard = async (files: File[]) => {
    if (files.length === 0) return setNote('pdf-organizer.create.clipboardEmpty');
    setBusy(true);
    try {
      const received = await receiveFiles({ invoke }, files);
      if (received.paths.length === 0) return setNote('pdf-organizer.create.clipboardNothingUsable');
      await fromPaths(received.paths, true);
    } finally {
      setBusy(false);
    }
  };

  /** Asks the system for what was copied; where that is not allowed, Ctrl+V in this window does the same. */
  const readClipboard = async () => {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const picture = item.types.find((type) => type.startsWith('image/'));
        if (picture) files.push(new File([await item.getType(picture)], `pasted-${files.length + 1}.${picture.slice(6).replace('jpeg', 'jpg')}`, { type: picture }));
        else if (item.types.includes('text/plain')) {
          const text = await (await item.getType('text/plain')).text();
          if (text.trim() !== '') files.push(new File([text], 'pasted-text.txt', { type: 'text/plain' }));
        }
      }
      await fromClipboard(files);
    } catch {
      setNote('pdf-organizer.create.clipboardUseKeys');
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Text typed into a field of this window is not a document to make.
    if ((event.target as HTMLElement).closest('input, textarea')) return;
    event.preventDefault();
    // The tab behind listens for pasted files too; this paste is for this window.
    event.nativeEvent.stopImmediatePropagation();
    setWay('clipboard');
    void fromClipboard(clipboardFiles(event.clipboardData));
  };

  const fromAddress = async () => {
    const typed = address.trim();
    if (typed === '') return;
    setBusy(true);
    setNote(null);
    try {
      // Named after the site: "example.com.pdf".
      const site = typed.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0]?.replace(/[^\w.-]+/g, '_') || 'web-page';
      const { path } = await invoke<{ path: string }>('draft_place', { name: `${site}.pdf` });
      await saveWebPage(typed, path);
      openDraftTab(host, path);
      finish({ chosen: 1, problem: null });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setNote(code === 'not-an-address' ? 'pdf-organizer.create.notAnAddress' : code === 'no-browser' ? 'pdf-organizer.create.noBrowser' : 'pdf-organizer.create.pageFailed');
    } finally {
      setBusy(false);
    }
  };

  const blank = async () => {
    const size = sheetOf(sheet);
    const [width, height] = landscape ? [size.height, size.width] : [size.width, size.height];
    setBusy(true);
    try {
      const { path } = await invoke<{ path: string }>('new_blank_draft', {
        name: nextNewName(host),
        width: width * POINTS_PER_MILLIMETRE,
        height: height * POINTS_PER_MILLIMETRE,
        pages: Math.min(Math.max(Math.round(count) || 1, 1), MAX_BLANK_PAGES),
      });
      openDraftTab(host, path);
      finish({ chosen: 1, problem: null });
    } catch {
      setNote('pdf-organizer.error.saveFailed');
    } finally {
      setBusy(false);
    }
  };

  const action = (labelKey: string, icon: string, run: () => void): ReactNode => (
    <Button variant="primary" disabled={busy} onClick={run}>
      <Icon name={icon} size={16} />
      {t(busy ? 'pdf-organizer.create.working' : labelKey)}
    </Button>
  );

  const detail: Record<Way, ReactNode> = {
    file: action('pdf-organizer.create.chooseFile', 'folder-open', () => void pick(false, PAGE_SOURCES, false)),
    combine: action('pdf-organizer.create.chooseFiles', 'folder-open', () => void pick(true, PAGE_SOURCES, true)),
    each: action('pdf-organizer.create.chooseFiles', 'folder-open', () => void pick(true, PAGE_SOURCES, false)),
    'web-address': (
      <form
        className={styles.address}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void fromAddress();
        }}
      >
        <input
          type="text"
          inputMode="url"
          className={styles.addressField}
          dir="ltr"
          placeholder="https://"
          value={address}
          aria-label={t('pdf-organizer.create.address')}
          spellCheck={false}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || address.trim() === ''}>
          <Icon name="link" size={16} />
          {t(busy ? 'pdf-organizer.create.fetching' : 'pdf-organizer.create.makeFromAddress')}
        </Button>
      </form>
    ),
    'web-page': action('pdf-organizer.create.chooseWebPage', 'folder-open', () => void pick(false, WEB_PAGES, false)),
    clipboard: action('pdf-organizer.create.paste', 'paste', () => void readClipboard()),
    blank: (
      <div className={styles.blank}>
        <label className={styles.field}>
          <span>{t('pdf-organizer.create.sheet')}</span>
          <SheetSelect className={shapeStyles.select} value={sheet} onChange={setSheet} />
        </label>
        <label className={styles.field}>
          <span>{t('pdf-organizer.create.orientation')}</span>
          <select className={shapeStyles.select} value={landscape ? 'landscape' : 'portrait'} onChange={(event) => setLandscape(event.target.value === 'landscape')}>
            <option value="portrait">{t('pdf-organizer.create.portrait')}</option>
            <option value="landscape">{t('pdf-organizer.create.landscape')}</option>
          </select>
        </label>
        <label className={styles.field}>
          <span>{t('pdf-organizer.create.pages')}</span>
          <input type="number" className={shapeStyles.number} min={1} max={MAX_BLANK_PAGES} value={count} onChange={(event) => setCount(event.target.valueAsNumber)} />
        </label>
        {action('pdf-organizer.create.makeBlank', 'file-circle-plus', () => void blank())}
      </div>
    ),
  };

  return (
    <Dialog open={open} onClose={onClose} title={t('pdf-organizer.create.title')} closeLabel={t('common.action.close')} wide>
      <div className={styles.window} onPaste={onPaste}>
        <div role="tablist" aria-orientation="vertical" aria-label={t('pdf-organizer.create.title')} className={styles.ways}>
          {WAYS.map((option) => (
            <button key={option.way} type="button" role="tab" aria-selected={way === option.way} className={styles.way} onClick={() => setWay(option.way)}>
              <Icon name={option.icon} size={18} />
              {t(`pdf-organizer.create.way.${option.way}`)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.detail}>
          <h3 className={styles.heading}>{t(`pdf-organizer.create.way.${way}`)}</h3>
          <p className={styles.about}>{t(`pdf-organizer.create.about.${way}`)}</p>
          {detail[way]}
          {note && (
            <p className={styles.note} role="status">
              {t(note)}
            </p>
          )}
          <p className={styles.unsaved}>{t('pdf-organizer.create.unsaved')}</p>
        </div>
      </div>
    </Dialog>
  );
}
