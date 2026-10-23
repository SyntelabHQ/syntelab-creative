import { useI18n } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useCallback, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { binderCommands } from '../commands';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { DropHint } from '../document/drop-hint';
import { binderStartFiles } from '../document/open-file';
import type { OpenedFiles } from '../document/open-files';
import { useFileCommands } from '../document/use-file-commands';
import { useReceivedFiles } from '../document/use-received-files';
import { useTabCommands } from '../use-tab-commands';
import { ThumbnailImage, ThumbnailZoom, useCtrlWheelSteps, useThumbnailSize } from '../organize/thumbnail-zoom';
import { pageCountOf, totalPages } from './binder-model';
import type { BinderFile } from './binder-model';
import { PageChooser } from './page-chooser';
import { useBinder } from './use-binder';
import styles from './binder-view.module.css';

/** Around the page on a card: the card's border (1) and padding (10), and the padding of the page's button (4), on each side. */
const CARD_SIDES = 2 * (1 + 10 + 4);
/** A card is never narrower than its four buttons (32 pixels each, see the CSS) and its padding. */
const MIN_CARD_WIDTH = 4 * 32 + 2 * (1 + 10);

interface DropPlace {
  readonly index: number;
  readonly before: boolean;
}

/**
 * The binder: files as cards, in the order they will be combined. A card
 * shows how many of its pages go in; opening it lets the user pick them.
 */
export function BinderView({ host }: AppViewProps) {
  const { t, direction } = useI18n();
  const startFiles = useMemo(() => binderStartFiles(host.params), [host.params]);
  const binder = useBinder(host, startFiles);
  const { files } = binder;
  const [opened, setOpened] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  // The card last clicked or dragged, by document id; it stays marked after a move.
  const [selected, setSelected] = useState<number | null>(null);
  const [drop, setDrop] = useState<DropPlace | null>(null);
  const pages = totalPages(files);
  const canCombine = pages > 0 && !binder.busy;
  const thumbnails = useThumbnailSize(host, 'binderThumbnailSize');
  // Anywhere on the binder, the cards may not be there yet.
  const viewRef = useRef<HTMLDivElement>(null);
  useCtrlWheelSteps(viewRef, thumbnails.onStep);

  const { addFiles, addPaths, combine, busy, report } = binder;
  const onFilesOpened = useCallback((opened: OpenedFiles) => opened.problem && report(opened.problem), [report]);
  const fileCommands = useFileCommands(host, onFilesOpened);
  // Files dropped on the binder or pasted become cards of it.
  const filesOver = useReceivedFiles(host, (received) => {
    void addPaths(received.paths);
    if (received.skipped > 0) report('pdf-organizer.error.someFilesSkipped');
  });
  const commands = useMemo(
    () =>
      binderCommands({
        files: fileCommands.commands,
        onAddFiles: () => void addFiles(),
        onCombine: () => void combine(),
        canCombine,
        busy,
        thumbnailZoom: { size: thumbnails.size, onStep: thumbnails.onStep },
      }),
    // The binder's functions are rebuilt with its files; listing the files is enough.
    [fileCommands, files, canCombine, busy, thumbnails.size, thumbnails.onStep],
  );
  useTabCommands(host, commands);

  const onDragOver = (index: number, event: DragEvent) => {
    if (dragged === null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const box = event.currentTarget.getBoundingClientRect();
    const firstHalf = event.clientX < box.left + box.width / 2;
    // "Before" is the left half when reading left to right, the right half otherwise.
    const before = direction === 'rtl' ? !firstHalf : firstHalf;
    setDrop((current) => (current?.index === index && current.before === before ? current : { index, before }));
  };
  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };

  const pagesText = (file: BinderFile) =>
    file.chosen.length === pageCountOf(file)
      ? t('common.page.count', { count: file.chosen.length })
      : t('pdf-organizer.binder.pagesOf', { chosen: file.chosen.length, count: pageCountOf(file) });

  return (
    <div ref={viewRef} className={styles.view}>
      <DropHint shown={filesOver} textKey="pdf-organizer.drop.intoBinder" />
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={onFilesOpened} />
      <div className={styles.bar}>
        <span className={styles.summary} aria-live="polite">
          {files.length > 0 ? t('pdf-organizer.binder.summary', { files: files.length, pages }) : t('pdf-organizer.binder.title')}
        </span>
        {files.length > 0 && <ThumbnailZoom size={thumbnails.size} onSizeChange={thumbnails.onSizeChange} />}
        <Button disabled={binder.busy} onClick={() => void binder.addFiles()}>
          <Icon name="folder-plus" size={16} />
          {t('pdf-organizer.binder.addFiles')}
        </Button>
        <Button variant="primary" disabled={!canCombine} onClick={() => void binder.combine()}>
          <Icon name="object-group" size={16} />
          {t('pdf-organizer.binder.combine')}
        </Button>
      </div>

      {binder.problem && (
        <div className={styles.problem} role="alert">
          <span className={styles.warning}>
            <Icon name="triangle-exclamation" size={18} />
          </span>
          <span className={styles.problemText}>{t(binder.problem)}</span>
          <IconButton variant="ghost" aria-label={t('pdf-organizer.notice.dismiss')} tooltipSide="bottom-end" onClick={binder.dismissProblem}>
            <Icon name="xmark" size={14} />
          </IconButton>
        </div>
      )}

      {files.length === 0 ? (
        <div className={styles.empty}>
          <h1 className={styles.title}>{t('pdf-organizer.binder.emptyTitle')}</h1>
          <p className={styles.hint}>{t('pdf-organizer.binder.emptyHint')}</p>
          <Button variant="primary" disabled={binder.busy} onClick={() => void binder.addFiles()}>
            <Icon name="folder-plus" size={18} />
            {t('pdf-organizer.binder.addFiles')}
          </Button>
        </div>
      ) : (
        <ol
          className={styles.cards}
          aria-label={t('pdf-organizer.binder.title')}
          onClick={(event) => event.target === event.currentTarget && setSelected(null)}
          // Past the cards the line stays where it was shown; letting go there moves the card to it.
          onDragOver={(event) => {
            if (dragged === null || !drop) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
          }}
          onDrop={(event) => {
            if (dragged === null || !drop) return;
            event.preventDefault();
            binder.move(dragged, drop.before ? drop.index : drop.index + 1);
            endDrag();
          }}
        >
          {files.map((file, index) => {
            const firstPage = file.chosen[0] ?? 0;
            const width = file.pageSizes[firstPage * 2] ?? 1;
            const height = file.pageSizes[firstPage * 2 + 1] ?? 1;
            // The page fits a square as large as the size chosen for the thumbnails.
            const scale = thumbnails.size / Math.max(width, height, 1);
            return (
              <li
                key={file.documentId}
                className={styles.card}
                style={{ width: Math.max(thumbnails.size + CARD_SIDES, MIN_CARD_WIDTH) }}
                draggable
                data-dragged={dragged === index}
                data-selected={selected === file.documentId}
                onClick={() => setSelected(file.documentId)}
                data-drop={drop?.index === index ? (drop.before ? 'before' : 'after') : undefined}
                onDragStart={(event) => {
                  setDragged(index);
                  setSelected(file.documentId);
                  event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', file.fileName);
                }}
                onDragOver={(event) => onDragOver(index, event)}
                onDragEnd={endDrag}
              >
                <span className={styles.position}>{index + 1}</span>
                <button
                  type="button"
                  className={styles.open}
                  aria-label={t('pdf-organizer.binder.choosePagesOf', { name: file.fileName })}
                  style={{ height: thumbnails.size + 8 }}
                  onClick={() => setOpened(file.documentId)}
                >
                  <span className={styles.picture} style={{ width: width * scale, height: height * scale }}>
                    <ThumbnailImage host={host} documentId={file.documentId} page={firstPage} width={width} height={height} drawnSize={thumbnails.drawnSize} />
                  </span>
                </button>
                <bdi className={styles.name} title={file.path}>
                  {file.fileName}
                </bdi>
                <span className={styles.pages}>{pagesText(file)}</span>
                <span className={styles.tools}>
                  <IconButton
                    variant="ghost"
                    aria-label={t('pdf-organizer.command.moveEarlier')}
                    disabled={index === 0}
                    onClick={() => binder.move(index, index - 1)}
                  >
                    <Icon name="arrow-left" size={14} />
                  </IconButton>
                  <IconButton variant="ghost" aria-label={t('pdf-organizer.binder.choosePages')} onClick={() => setOpened(file.documentId)}>
                    <Icon name="list-check" size={14} />
                  </IconButton>
                  <IconButton variant="ghost" aria-label={t('pdf-organizer.binder.remove')} onClick={() => binder.remove(file.documentId)}>
                    <Icon name="trash-can" size={14} />
                  </IconButton>
                  <IconButton
                    variant="ghost"
                    aria-label={t('pdf-organizer.command.moveLater')}
                    disabled={index === files.length - 1}
                    onClick={() => binder.move(index, index + 2)}
                  >
                    <Icon name="arrow-right" size={14} />
                  </IconButton>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <PageChooser
        host={host}
        file={files.find((file) => file.documentId === opened) ?? null}
        onClose={() => setOpened(null)}
        onChoose={(chosen) => opened !== null && binder.choosePages(opened, chosen)}
      />
    </div>
  );
}
