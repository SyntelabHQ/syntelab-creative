import { useI18n } from '@syntelab/i18n';
import { fileName } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { COMPARE, CONVERT, DRAWING_TOOLS, emptyTabCommands, ORGANIZE, viewerCommands } from '../commands';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { planIndexOf } from '../document/document-facts';
import type { PlanPage } from '../document/page-plan';
import { DropHint } from '../document/drop-hint';
import { openBinderTab, openCompareTab } from '../document/open-file';
import type { OpenedFiles } from '../document/open-files';
import { useFileCommands } from '../document/use-file-commands';
import { useReceivedFiles } from '../document/use-received-files';
import { loadPicture } from '../document/load-picture';
import type { LoadedPicture } from '../document/load-picture';
import { PICTURE_TYPES } from '../document/page-sources';
import { PropertiesDialog } from '../document/properties-dialog';
import { useDocument } from '../document/use-document';
import { useDocumentFacts } from '../document/use-document-facts';
import { useFileCounts } from '../document/use-file-counts';
import type { Bookmark } from '../document/document-facts';
import { FindBar } from '../find/find-bar';
import { useFind } from '../find/use-find';
import { FormLayer } from '../forms/form-layer';
import { LinkLayer } from '../links/link-layer';
import { signatureWords } from '../sign/look-picker';
import { SignAreaHint } from '../sign/sign-area-hint';
import { SignDialog } from '../sign/sign-dialog';
import { SignedSaveDialog } from '../sign/signed-save-dialog';
import type { SigningChoice } from '../sign/sign-dialog';
import { signatureLook } from '../sign/signature-look';
import { presetLines } from '../sign/signature-presets';
import { SignaturesBanner } from '../sign/signatures-banner';
import { SignaturesDialog } from '../sign/signatures-dialog';
import { TimeStampDialog } from '../sign/time-stamp-dialog';
import { usePageLinks } from '../links/page-links';
import { useForm } from '../forms/use-form';
import { AttachmentsDialog } from '../insert/attachments-dialog';
import { InsertTools } from '../insert/insert-tools';
import { isField, markRequest, restyle, styleOf } from '../marks/mark';
import type { Mark, MarkStyle } from '../marks/mark';
import { MarkPanel } from '../marks/mark-panel';
import { penHintKey } from '../marks/pen-hint';
import { placedOnPage } from '../marks/place-on-page';
import type { Placing } from '../marks/placing';
import { MarkLayer } from '../marks/mark-layer';
import type { MarkTool } from '../marks/mark-layer';
import { fitted, fitText } from '../marks/measure-text';
import { useMarking } from '../marks/use-marking';
import type { InsertTool } from '../insert/insert-tools';
import { numberMarkFor, NumbersPanel, numberWords, startNumbering } from '../insert/numbers-panel';
import type { Numbering } from '../insert/numbers-panel';
import { pagesOf } from '../document/page-range';
import type { PageRange } from '../document/page-range';
import { pagesOfGroup, repeatedOn, withGroupsFollowing } from '../marks/mark-groups';
import { takePicture, usePagePictures } from '../marks/page-pictures';
import type { PagePicture } from '../marks/page-pictures';
import { useTextLines } from '../marks/text-lines';
import { WatermarkDialog } from '../insert/watermark-dialog';
import { startPageTexts } from '../insert/page-texts';
import type { PageTexts } from '../insert/page-texts';
import { PageTextsPanel, pageTextsPreview, todayWritten } from '../insert/page-texts-panel';
import { COMPRESS_LEVELS, CompressDialog } from '../organize/compress-dialog';
import { CropLayer } from '../crop/crop-layer';
import { CropPanel, croppedPages, startCropping } from '../crop/crop-panel';
import type { Cropping } from '../crop/crop-panel';
import { useFontFamilies } from '../marks/fonts';
import { UNITS } from '../organize/crop-frame';
import { ExtractDialog } from '../organize/extract-dialog';
import { ExportDialog } from '../export/export-dialog';
import { OcrDialog } from '../ocr/ocr-dialog';
import { OrganizeBar } from '../organize/organize-bar';
import { BookmarkList } from '../outline/bookmark-list';
import { PageGrid } from '../organize/page-grid';
import { ResizeDialog } from '../organize/resize-dialog';
import { SplitDialog } from '../organize/split-dialog';
import { useThumbnailSize } from '../organize/thumbnail-zoom';
import { canNudge, useOrganizer } from '../organize/use-organizer';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, SIDE_WIDTHS, useOrganizerSettings } from '../settings/organizer-settings';
import { TipLine } from '../tools/tip-line';
import { useTabCommands } from '../use-tab-commands';
import styles from './document-view.module.css';
import { PageList } from './page-list';
import type { PageListHandle } from './page-list';
import { rowOfPage } from './page-rows';
import { DocRail } from './doc-rail';
import { SideHandle } from './side-handle';
import { SideStrip } from './side-strip';
import type { SideView } from './side-strip';
import { ThumbnailList } from './thumbnail-list';
import { DEFAULT_VIEW, rotateClockwise } from './view-settings';
import type { ViewSettings } from './view-settings';

const NO_SELECTION: ReadonlySet<number> = new Set();

/** Where a signature made with a certificate shows: a page, and a box on it in the page's own grid. */
interface SignArea {
  readonly page: PlanPage;
  readonly box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
}

export interface DocumentViewProps {
  readonly host: AppHost;
  /** The file this tab shows. */
  readonly path: string;
  /** The file is one of the program's own: a document not saved anywhere yet. */
  readonly unsaved?: boolean;
}

/** Pens that draw nothing with a look of its own to choose: the panel beside the pages waits for something selected. */
const PLAIN_PENS: readonly MarkTool[] = ['select', 'edit', 'link', 'bookmark', 'redact', 'textField', 'checkBox', 'radioButton', 'choiceField', 'signatureField'];

/**
 * One open PDF. Normally: view bar, thumbnails on the side, pages in the
 * middle. While organizing: every page in a grid, to select, move and turn.
 */
export function DocumentView({ host, path, unsaved = false }: DocumentViewProps) {
  const { t, language } = useI18n();
  const { state, replace } = useDocument(host, path, !unsaved);
  const settings = useOrganizerSettings(host);
  /** The width of a panel beside the pages while its edge is dragged; the settings keep it once let go. */
  const [dragged, setDragged] = useState<{ readonly key: 'stripWidth' | 'panelWidth'; readonly width: number } | null>(null);
  const sideWidth = (key: 'stripWidth' | 'panelWidth') => (dragged?.key === key ? dragged.width : settings[key]);
  const sideHandle = (key: 'stripWidth' | 'panelWidth') => (
    <SideHandle
      width={sideWidth(key)}
      min={SIDE_WIDTHS[key].min}
      max={SIDE_WIDTHS[key].max}
      defaultWidth={DEFAULT_SETTINGS[key]}
      onResize={(width) => setDragged({ key, width })}
      onResized={(width) => {
        setDragged(null);
        saveSettings(host, { ...loadSettings(host), [key]: width });
      }}
    />
  );
  // How a document opens is a setting; what the user changes afterwards belongs to this tab.
  const [view, setView] = useState<ViewSettings>(() => ({
    ...DEFAULT_VIEW,
    zoomMode: settings.openZoom,
    scrolling: settings.openScrolling,
    rulers: settings.showRulers,
    grid: settings.showGrid,
  }));
  const [zoom, setZoom] = useState(1);
  const [currentPage, setCurrentPage] = useState(0);
  const [thumbnailsShown, setThumbnailsShown] = useState(settings.openThumbnails);
  const [sideView, setSideView] = useState<SideView>('thumbnails');
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [insertTool, setInsertTool] = useState<InsertTool | null>(null);
  /** Something chosen (a signature, an image) that waits for the user to drag on a page where it goes. */
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [extractOpen, setExtractOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  const [signOpen, setSignOpen] = useState<'hint' | 'sign' | 'verify' | 'timeStamp' | null>(null);
  // The signature clicked on a page, which the list of signatures opens at; null when it was opened from the menu.
  const [shownSignature, setShownSignature] = useState<number | null>(null);
  const [ocrOpen, setOcrOpen] = useState(false);
  /** The area of a signature with a certificate is being dragged on a page. */
  const [signingArea, setSigningArea] = useState(false);
  /** Where the signature with a certificate shows, once dragged; null: nowhere, it is in the file only. */
  const [signArea, setSignArea] = useState<SignArea | null>(null);
  /** Cropping in progress: the frame is drawn on the pages themselves, its settings beside them. */
  const [cropping, setCropping] = useState<Cropping | null>(null);
  const fonts = useFontFamilies(host);
  const [shapeOpen, setShapeOpen] = useState<'resize' | 'watermark' | 'compress' | null>(null);
  /** Page numbers being set up: they show on the pages themselves, their settings beside them. */
  const [numbering, setNumbering] = useState<Numbering | null>(null);

  /** A header and footer, or Bates numbers, being set up: shown on the pages, their settings beside them. */
  const [pageTexts, setPageTexts] = useState<PageTexts | null>(null);

  const pages = useRef<PageListHandle>(null);
  const document = state.status === 'ready' ? state.document : null;
  const form = useForm(host, document?.id);
  const [formShown, setFormShown] = useState(true);
  const organizer = useOrganizer(host, document, currentPage, replace, form.answersFor, unsaved, path);
  const pageCount = organizer.plan.length;
  const { showTool } = host;
  /** Back from the grid of pages to the document: the bar of Organize closes too. */
  const stopOrganizing = () => {
    organizer.setOrganizing(false);
    if (host.tool === ORGANIZE) showTool(null);
  };
  // Drawing on the page: the tool in use, the look of the next mark, the mark that is selected.
  const marking = useMarking();
  const markedPage = marking.selection ? organizer.plan.find((page) => page.key === marking.selection?.pageKey) : undefined;
  const selectedMark = markedPage?.marks?.find((mark) => mark.id === marking.selection?.markId) ?? null;
  // One panel beside the pages at a time: the look of what the pen draws (or of what is selected), the texts or
  // numbers put on pages, the cropping; or the small pages and the bookmarks. A tool's panel that opens closes
  // the small pages; the small pages asked for while a tool's panel is open come in its place.
  const markPanelWanted = marking.tool !== null && (placing !== null || selectedMark !== null || !PLAIN_PENS.includes(marking.tool));
  const toolPanelWanted = markPanelWanted || pageTexts !== null || numbering !== null || cropping !== null;
  const [stripOnTop, setStripOnTop] = useState(false);
  const toolPanelKey = toolPanelWanted ? [markPanelWanted ? marking.tool : '', selectedMark?.id ?? '', pageTexts !== null, numbering !== null, cropping !== null].join('|') : '';
  useEffect(() => {
    setStripOnTop(false);
    if (toolPanelKey !== '') setThumbnailsShown(false);
  }, [toolPanelKey]);
  const stripShown = thumbnailsShown && (!toolPanelWanted || stripOnTop);
  /** Shows or hides the small pages (or the bookmarks); shown, they come in place of a tool's panel. */
  const showStrip = useCallback((shown: boolean) => {
    setThumbnailsShown(shown);
    setStripOnTop(shown);
  }, []);
  const pendingAttachments = organizer.plan.reduce((sum, page) => sum + (page.marks ?? []).filter((mark) => mark.kind === 'attachment').length, 0);
  const { setMarksOnPages } = organizer;
  /** What is drawn on one page changes; marks that are on several pages as one (a signature) follow on the others. */
  const setMarks = (pageKey: string, marks: readonly Mark[], step?: string) => setMarksOnPages(withGroupsFollowing(organizer.plan, pageKey, marks), step);
  /** A field or a bookmark just drawn gets a name: "Text 3", "Page 5". A field's name is its own in the whole document. */
  const named = (pageKey: string, marks: readonly Mark[]): readonly Mark[] => {
    const lacks = (mark: Mark) => (mark.kind === 'radioButton' ? (mark.name ?? '') === '' || (mark.value ?? '') === '' : (mark.name ?? '') === '' && (isField(mark.kind) || mark.kind === 'bookmark'));
    if (!marks.some(lacks)) return marks;
    const all = organizer.plan.flatMap((page) => page.marks ?? []);
    const taken = new Set(all.map((mark) => mark.name ?? ''));
    return marks.map((mark) => {
      if (mark.kind === 'radioButton' && lacks(mark)) {
        // A new button joins the group of the one drawn before it; its answer is the next in that group.
        // The marks of this page are in the plan too, as they were before this change: each is counted once.
        const buttons = [...all.filter((other) => !marks.some((here) => here.id === other.id)), ...marks].filter((other) => other.kind === 'radioButton' && other !== mark && (other.name ?? '') !== '');
        const group = (mark.name ?? '') !== '' ? (mark.name as string) : (buttons[buttons.length - 1]?.name ?? t('pdf-organizer.marks.field.radioButton', { number: 1 }));
        const inGroup = buttons.filter((other) => other.name === group).length;
        return { ...mark, name: group, value: (mark.value ?? '') !== '' ? mark.value : t('pdf-organizer.marks.field.option', { number: inGroup + 1 }) };
      }
      if ((mark.name ?? '') !== '') return mark;
      if (mark.kind === 'bookmark') return { ...mark, name: t('pdf-organizer.marks.bookmark.default', { number: organizer.plan.findIndex((page) => page.key === pageKey) + 1 }) };
      if (!isField(mark.kind)) return mark;
      let number = 1;
      const name = () => t(`pdf-organizer.marks.field.${mark.kind}`, { number });
      while (taken.has(name())) number += 1;
      taken.add(name());
      return { ...mark, name: name() };
    });
  };
  // The links of the pages near the one in view: followed with a click while nothing is being drawn.
  const nearPages = useMemo(() => organizer.plan.slice(Math.max(currentPage - 2, 0), currentPage + 3), [organizer.plan, currentPage]);
  const linksOf = usePageLinks(host, nearPages);
  const linesOf = useTextLines(host, organizer.plan.slice(Math.max(currentPage - 2, 0), currentPage + 3), marking.tool === 'edit');
  const picturesOf = usePagePictures(host, nearPages, marking.tool === 'edit');
  /** Picks a picture of the document up: it is taken out of the file where it was, and put there anew as something that can be moved. */
  const pickUpPicture = async (page: PlanPage, picture: PagePicture) => {
    try {
      const { data, type } = await host.invoke<{ data: string; type: string }>('page_picture', { documentId: page.documentId, page: page.page, picture: picture.number });
      const { erase, taken } = takePicture(picture, `data:${type};base64,${data}`, `picture-${Date.now().toString(36)}`);
      const now = organizer.plan.find((known) => known.key === page.key);
      setMarks(page.key, [...(now?.marks ?? []), erase, taken]);
      marking.select({ pageKey: page.key, markId: taken.id });
    } catch {
      organizer.report('pdf-organizer.error.pictureNotPickedUp');
    }
  };
  /** Puts the selected mark on other pages too (or takes it off them): the same thing on each, moved as one. */
  const repeatSelectedMark = (range: PageRange) => {
    if (!markedPage || !selectedMark) return;
    const here = new Set([organizer.plan.indexOf(markedPage)]);
    const chosen = organizer.selected.size > 0 ? organizer.selected : here;
    const indexes = pagesOf(range, 'both', organizer.plan.length, chosen);
    setMarksOnPages(repeatedOn(organizer.plan, markedPage.key, selectedMark.id, indexes, () => `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`));
  };
  /** Changes the selected mark; closely following changes of the same `step` undo as one. */
  const changeSelectedMark = (change: (mark: NonNullable<typeof selectedMark>) => NonNullable<typeof selectedMark> | null, step?: string) => {
    if (!markedPage || !selectedMark) return;
    const changed = change(selectedMark);
    const marks = (markedPage.marks ?? []).flatMap((mark) => (mark.id !== selectedMark.id ? [mark] : changed ? [changed] : []));
    setMarks(markedPage.key, marks, step);
    if (!changed) marking.select(null);
  };
  /** The mark that was copied, for pasting: on this page or on another. */
  const copiedMark = useRef<Mark | null>(null);
  /** Puts a copy of `mark` on the page in view (or on the page of the selected mark), a little aside, and selects it. */
  const pasteMark = (mark: Mark | null) => {
    const page = markedPage ?? organizer.plan[currentPage];
    if (!mark || !page) return;
    const copy: Mark = {
      ...mark,
      id: `mark-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      x: mark.x + 12,
      y: mark.y + 12,
      // A copy is a thing of its own: on this page only, and a field gets a name of its own.
      group: undefined,
      // A button stays in its group and gets the next answer there.
      name: isField(mark.kind) && mark.kind !== 'radioButton' ? '' : mark.name,
      value: mark.kind === 'radioButton' ? '' : mark.value,
    };
    setMarks(page.key, named(page.key, [...(page.marks ?? []), copy]));
    if (marking.tool === null) marking.setTool('select');
    marking.select({ pageKey: page.key, markId: copy.id });
    // The next paste steps aside again.
    if (copiedMark.current === mark) copiedMark.current = copy;
  };
  const changeMarkStyle = (change: Partial<MarkStyle>) => {
    marking.setStyle(change);
    // Letters of another size or font take another amount of room.
    changeSelectedMark((mark) => (mark.kind === 'text' ? fitText(restyle(mark, change)) : restyle(mark, change)), `style:${Object.keys(change).join()}`);
  };
  const facts = useDocumentFacts(host, document?.id);
  // Counted again when their dialogs close: what was attached or signed there shows at once.
  const fileCounts = useFileCounts(host, document?.id, `${attachmentsOpen}:${signOpen}`);
  /** The document whose line about its signatures was closed. */
  const [signaturesSeen, setSignaturesSeen] = useState<number | null>(null);
  const bookmarksShown = stripShown && sideView === 'bookmarks';
  /** Shows the table of contents in the side strip, or goes back to the small pages. */
  const showBookmarks = useCallback(
    (shown: boolean) => {
      setSideView(shown ? 'bookmarks' : 'thumbnails');
      if (shown) showStrip(true);
    },
    [showStrip],
  );
  const find = useFind(host, organizer.plan);
  const [findFocus, setFindFocus] = useState(0);
  const showFind = find.show;
  const openFind = useCallback(() => {
    showFind();
    setFindFocus((count) => count + 1);
  }, [showFind]);
  const { immersive, setImmersive, closeTab } = host;

  const reportProblem = organizer.report;
  const onFilesOpened = useCallback((opened: OpenedFiles) => opened.problem && reportProblem(opened.problem), [reportProblem]);
  const fileCommands = useFileCommands(host, onFilesOpened);
  const files = fileCommands.commands;
  const open = files.onOpen;
  const newBinder = useCallback(() => openBinderTab(host, t('pdf-organizer.binder.title'), [path]), [host, t, path]);
  // Files dropped on the document or pasted are gathered in a binder of their own.
  const filesOver = useReceivedFiles(host, (received) => {
    if (received.paths.length > 0) openBinderTab(host, t('pdf-organizer.binder.title'), received.paths);
    if (received.skipped > 0) reportProblem('pdf-organizer.error.someFilesSkipped');
  });
  const compare = useCallback(async () => {
    const [other] = await host.pickFiles({ typeName: t('pdf-organizer.open.fileType'), extensions: ['pdf'] });
    if (other) openCompareTab(host, t('pdf-organizer.compare.title'), path, other);
  }, [host, t, path]);
  const emptyBinder = useCallback(() => openBinderTab(host, t('pdf-organizer.binder.title')), [host, t]);

  // While the pages are rearranged and not saved, closing the tab asks first.
  const { setUnsavedChanges } = host;
  // Pages rearranged or changed, a form filled in, or a document that has no file of its own yet: all work to save.
  const modified = organizer.modified || form.dirty || unsaved;
  useEffect(() => setUnsavedChanges(modified), [setUnsavedChanges, modified]);

  /** How many signatures the file has, while the user is asked whether to write over it; none otherwise. */
  const [signedSave, setSignedSave] = useState(0);
  /** "Save": a file signed with a certificate is not written over without asking, since its signatures go. */
  const save = async () => {
    if (document && !unsaved && loadSettings(host).warnSignedSave) {
      const found = await host.invoke<{ signatures: unknown[] }>('signatures', { documentId: document.id }).catch(() => ({ signatures: [] }));
      if (found.signatures.length > 0) return setSignedSave(found.signatures.length);
    }
    await organizer.save();
  };
  // The commands are built once in a while; what they call is always this, as it is now.
  const latestSave = useRef(save);
  latestSave.current = save;

  /** Asks for a picture file and reads it; null when none was chosen or it is not a picture. */
  const pickPicture = async (): Promise<LoadedPicture | null> => {
    const [chosen] = await host.pickFiles({ typeName: t('pdf-organizer.place.pictureType'), extensions: [...PICTURE_TYPES] });
    if (!chosen) return null;
    try {
      return await loadPicture(host, chosen);
    } catch {
      organizer.report('pdf-organizer.error.notAPicture');
      return null;
    }
  };

  /** What starts the placing of something chosen: nothing is put anywhere yet, the user drags on a page where it goes. */
  const startPlacing = (chosen: Placing) => {
    setPlacing(chosen);
    setCropping(null);
    setNumbering(null);
    setPageTexts(null);
    stopOrganizing();
    marking.setTool('select');
    marking.select(null);
  };
  /** The first step of signing with a certificate: the user drags on a page where the signature shows. */
  const dragSignArea = () => {
    setSignArea(null);
    setSigningArea(true);
    startPlacing({ kind: 'box' });
  };
  /** Signing without anything on the pages: straight to the choice of certificate. */
  const signInvisibly = () => {
    setPlacing(null);
    setSigningArea(false);
    setSignArea(null);
    setSignOpen('sign');
  };
  /** Signs with a certificate: with a place, the signature shows there the way its look says. */
  const signDocument = (choice: SigningChoice, at: SignArea | null) => {
    const { certificate, reason, location, lock, timeStamp } = choice;
    // With nothing changed, the file is signed as it is, by adding to its end: the signatures it has stay good.
    const pages = modified ? organizer.plan : null;
    if (!at) return void organizer.signWith(pages, { certificate, place: null, reason, location, look: [], lock, timeStamp });
    const moment = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
    const lines = presetLines(choice.preset, { signer: choice.signer, moment, reason, location }, signatureWords(t));
    const look = signatureLook(at.box, at.page.rotation, choice.preset.picture, lines, fitted, `signature-${Date.now().toString(36)}`);
    void organizer.signWith(pages, { certificate, place: { page: organizer.plan.indexOf(at.page), ...at.box }, reason, location, look: look.map(markRequest), lock, timeStamp });
  };

  /** Asks for a file to attach; a paper clip is then put where the user clicks. */
  const attachFile = async () => {
    const [chosen] = await host.pickFiles({ typeName: t('pdf-organizer.attach.fileType'), extensions: ['*'] });
    if (chosen) startPlacing({ kind: 'attachment', path: chosen, name: fileName(chosen), author: loadSettings(host).attachAuthor });
  };

  // The keys of drawing on the page: Delete removes the selected mark, the arrows nudge it, Escape steps back out.
  const marksActive = (marking.tool !== null || placing !== null) && host.active;
  useEffect(() => {
    if (!marksActive) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Typing into a field is not for the page; nor are the keys of a window that is open over it.
      // (A window that was closed may still hold the focus: that one does not count.)
      if (target?.closest('textarea, [contenteditable], dialog[open]')) return;
      const field = target?.closest('input, select');
      if (field instanceof HTMLInputElement && !['range', 'color', 'checkbox', 'radio', 'button'].includes(field.type)) return;
      // In a list or on a slider the arrows choose; Delete means nothing there and stays with the page.
      if (field && event.key.startsWith('Arrow')) return;
      const step = event.shiftKey ? 10 : 1;
      const nudges: Record<string, readonly [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const nudge = nudges[event.key];
      const letter = (event.ctrlKey || event.metaKey) && !event.altKey ? event.key.toLowerCase() : '';
      // Copy, cut, paste and duplicate, for whatever was put on a page.
      if (letter === 'c' && selectedMark) copiedMark.current = selectedMark;
      else if (letter === 'x' && selectedMark) {
        copiedMark.current = selectedMark;
        changeSelectedMark(() => null);
      } else if (letter === 'v' && copiedMark.current) pasteMark(copiedMark.current);
      else if (letter === 'd' && selectedMark) pasteMark(selectedMark);
      else if (letter !== '') return;
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedMark) changeSelectedMark(() => null);
      else if (nudge && selectedMark) changeSelectedMark((mark) => ({ ...mark, x: mark.x + nudge[0], y: mark.y + nudge[1] }), 'nudge');
      else if (event.key === 'Escape') {
        if (placing) {
          setPlacing(null);
          setSigningArea(false);
        }
        else if (marking.selection) marking.select(null);
        else if (marking.tool !== 'select') marking.setTool('select');
        else {
          // Putting the pen away closes the bar of its tool too.
          marking.setTool(null);
          if (host.tool && DRAWING_TOOLS[host.tool]) showTool(null);
        }
      } else return;
      event.preventDefault();
      event.stopPropagation();
    };
    // Before the page list sees the key: the arrows would turn the page.
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  });

  // The tool opened on the bar decides what the tab shows: the grid of pages, or the document with a pen in hand.
  const openTool = host.tool;
  const lastTool = useRef<string | null>(null);
  useEffect(() => {
    const before = lastTool.current;
    lastTool.current = openTool;
    if (before === openTool) return;
    organizer.setOrganizing(openTool === ORGANIZE);
    const pen = openTool ? DRAWING_TOOLS[openTool] : undefined;
    if (pen) {
      setCropping(null);
      setNumbering(null);
      setPageTexts(null);
      marking.setTool(pen);
    } else if (before && DRAWING_TOOLS[before]) {
      setPlacing(null);
      setSigningArea(false);
      marking.setTool(null);
    }
    // Only a change of the tool matters here.
  }, [openTool]);
  // A tool asked for before the file was open (a card of the start page): shown as soon as the document is.
  const askedTool = host.params.tool;
  const ready = document !== null;
  // With a document to read, the tools used most stand over it while no tool is open.
  const { setIdleBar } = host;
  useEffect(() => {
    setIdleBar(ready);
    return () => setIdleBar(false);
  }, [ready, setIdleBar]);
  const askedOnce = useRef(false);
  useEffect(() => {
    if (!ready || !askedTool || askedOnce.current) return;
    askedOnce.current = true;
    // The tools of one step do it now; the others open their bar.
    if (askedTool === CONVERT) setExportOpen(true);
    else if (askedTool === COMPARE) void compare();
    else showTool(askedTool);
    // Once, when the document is there.
  }, [ready]);

  // Removing pages can leave the current page past the end.
  useEffect(() => {
    if (pageCount > 0 && currentPage > pageCount - 1) setCurrentPage(pageCount - 1);
  }, [pageCount, currentPage]);

  // The commands of this tab, for the menus, tools and search.
  const nudge = canNudge(organizer);
  const thumbnails = useThumbnailSize(host, 'organizeThumbnailSize');
  const commands = useMemo(
    () =>
      document
        ? viewerCommands({
            view,
            onViewChange: setView,
            zoom,
            thumbnailsShown: stripShown,
            onThumbnailsShownChange: showStrip,
            bookmarksShown,
            onBookmarksShownChange: showBookmarks,
            onProperties: () => setPropertiesOpen(true),
            onCompare: () => void compare(),
            hasForm: form.fields.length > 0,
            formShown,
            onFormShownChange: setFormShown,
            onInsert: setInsertTool,
            onMark: (tool) => {
              setPlacing(null);
              setCropping(null);
              setNumbering(null);
              setPageTexts(null);
              marking.setTool(tool);
            },
            onAttach: () => void attachFile(),
            onAttachedFiles: () => setAttachmentsOpen(true),
            onOcr: () => setOcrOpen(true),
            onSignCertificate: () => (loadSettings(host).signAreaHint ? setSignOpen('hint') : dragSignArea()),
            onTimeStamp: () => setSignOpen('timeStamp'),
            onVerifySignatures: () => {
              setShownSignature(null);
              setSignOpen('verify');
            },
            onPageTexts: (mode) => {
              // Set up beside the document, shown on the pages themselves.
              setPageTexts(startPageTexts(mode, organizer.targets));
              setCropping(null);
              setNumbering(null);
              setPlacing(null);
              marking.setTool(null);
              stopOrganizing();
            },
            marking: marking.tool !== null,
            markTool: marking.tool,
            immersive,
            onImmersiveChange: setImmersive,
            files,
            onClose: closeTab,
            onFind: openFind,
            onNewBinder: newBinder,
            organize: {
              organizing: organizer.organizing,
              onOrganizingChange: (organizing) => showTool(organizing ? ORGANIZE : null),
              pageCount,
              targetCount: organizer.targets.size,
              selectedCount: organizer.selected.size,
              canMoveEarlier: nudge.earlier,
              canMoveLater: nudge.later,
              canUndo: organizer.canUndo,
              canRedo: organizer.canRedo,
              busy: organizer.busy,
              modified,
              onSave: () => void latestSave.current(),
              onPrint: () => void organizer.print(),
              onShare: () => void organizer.share(path),
              onUndo: organizer.undo,
              onRedo: organizer.redo,
              onRotate: organizer.rotate,
              onRotateAll: organizer.rotateAll,
              onDelete: organizer.remove,
              onExtract: () => setExtractOpen(true),
              onInsert: () => void organizer.insertFromFile(),
              onInsertBlank: () => void organizer.insertBlank(),
              onReplace: () => void organizer.replaceFromFile(),
              onSplit: () => setSplitOpen(true),
              onCrop: () => {
                // The frame is drawn on the page itself: the tools for drawing and the grid of pages step aside.
                setCropping(startCropping(organizer.targets));
                setNumbering(null);
                setPageTexts(null);
                setPlacing(null);
                marking.setTool(null);
                stopOrganizing();
              },
              onCopy: organizer.copy,
              onCut: organizer.cut,
              onPaste: organizer.paste,
              canPaste: organizer.canPaste,
              onResize: () => setShapeOpen('resize'),
              onPageNumbers: () => {
                // Set up beside the document, shown on the pages themselves.
                setNumbering(startNumbering(organizer.targets, t));
                setCropping(null);
                setPageTexts(null);
                setPlacing(null);
                marking.setTool(null);
                stopOrganizing();
              },
              onWatermark: () => setShapeOpen('watermark'),
              onCompress: () => setShapeOpen('compress'),
              onSaveAs: () => void organizer.saveAs(),
              onExport: () => setExportOpen(true),
              onSelect: organizer.select,
              onMove: organizer.nudge,
            },
            thumbnailZoom: organizer.organizing ? { size: thumbnails.size, onStep: thumbnails.onStep } : undefined,
          })
        : emptyTabCommands(files, emptyBinder),
    // The organizer's functions are rebuilt with its state; listing the state is enough.
    [
      document,
      path,
      view,
      zoom,
      stripShown,
      showStrip,
      bookmarksShown,
      showBookmarks,
      immersive,
      setImmersive,
      marking.tool,
      marking.setTool,
      files,
      closeTab,
      openFind,
      newBinder,
      emptyBinder,
      compare,
      pageCount,
      organizer.organizing,
      organizer.plan,
      organizer.selected,
      organizer.targets,
      organizer.canUndo,
      organizer.canRedo,
      organizer.canPaste,
      organizer.changes,
      organizer.busy,
      modified,
      form.fields,
      form.answersFor,
      formShown,
      nudge.earlier,
      nudge.later,
      thumbnails.size,
      thumbnails.onStep,
    ],
  );
  useTabCommands(host, commands);

  const setCustomZoom = useCallback(
    (customZoom: number) => setView((current) => ({ ...current, zoomMode: 'custom', customZoom })),
    [],
  );

  const goToPage = useCallback(
    (page: number) => {
      const target = Math.min(Math.max(page, 0), Math.max(pageCount - 1, 0));
      setCurrentPage(target);
      // With scrolling on, the list moves there and reports the page itself.
      pages.current?.scrollToPage(target);
    },
    [pageCount],
  );

  /** To the next or previous row: one page, or a pair in two-page view. */
  const step = useCallback(
    (direction: 1 | -1) => {
      const { pageLayout, coverPage } = view;
      const rowOf = (page: number) => rowOfPage(page, pageLayout, coverPage);
      const row = rowOf(currentPage);
      let page = currentPage + direction;
      while (page >= 0 && page < pageCount && rowOf(page) === row) page += direction;
      // Going back lands on the first page of the previous row.
      while (direction === -1 && page > 0 && rowOf(page - 1) === rowOf(page)) page -= 1;
      goToPage(page);
    },
    [view, currentPage, pageCount, goToPage],
  );

  /** To the next or previous place where the text was found. */
  const stepFind = (direction: 1 | -1) => {
    const hit = find.step(direction, currentPage);
    if (hit) goToPage(hit.page);
  };

  if (state.status === 'loading') {
    return (
      <div className={styles.message} role="status">
        {t('pdf-organizer.viewer.loading')}
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className={styles.message} role="alert">
        <span className={styles.warning}>
          <Icon name="triangle-exclamation" size={32} />
        </span>
        <p>{t(state.messageKey)}</p>
        <Button onClick={open}>{t('pdf-organizer.open.button')}</Button>
      </div>
    );
  }

  const splitDialog = (
    <SplitDialog
      open={splitOpen}
      onClose={() => setSplitOpen(false)}
      plan={organizer.plan}
      selected={organizer.organizing ? organizer.selected : NO_SELECTION}
      busy={organizer.busy}
      onSplit={organizer.split}
    />
  );

  const extractDialog = (
    <>
      <DropHint shown={filesOver} textKey="pdf-organizer.drop.toBinder" />
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={onFilesOpened} />
      <AttachmentsDialog
        host={host}
        open={attachmentsOpen}
        onClose={() => setAttachmentsOpen(false)}
        documentId={document?.id}
        pages={organizer.plan}
        onShow={(pageKey, markId) => {
          setAttachmentsOpen(false);
          stopOrganizing();
          goToPage(organizer.plan.findIndex((page) => page.key === pageKey));
          marking.setTool('select');
          marking.select({ pageKey, markId });
        }}
        onAdd={() => {
          setAttachmentsOpen(false);
          void attachFile();
        }}
        detached={organizer.changes.detach}
        onDetach={organizer.detachFile}
      />
      <OcrDialog
        host={host}
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        pages={organizer.plan}
        targets={organizer.targets}
        onDone={(marks, read, skipped) => {
          organizer.addMarks(marks);
          organizer.note(read > 0 ? 'pdf-organizer.ocr.done' : 'pdf-organizer.ocr.nothing', { read, skipped });
        }}
      />
      <SignAreaHint
        open={signOpen === 'hint'}
        onClose={() => setSignOpen(null)}
        onDrag={dragSignArea}
        onInvisible={signInvisibly}
        onStopShowing={() => saveSettings(host, { ...loadSettings(host), signAreaHint: false })}
      />
      <SignDialog
        host={host}
        open={signOpen === 'sign'}
        onClose={() => {
          setSignOpen(null);
          setSignArea(null);
        }}
        visible={signArea !== null}
        documentId={document?.id}
        modified={modified}
        onPickPicture={pickPicture}
        onChoose={(choice) => {
          setSignOpen(null);
          setSignArea(null);
          signDocument(choice, signArea);
        }}
      />
      <SignedSaveDialog
        signatures={signedSave}
        onClose={() => setSignedSave(0)}
        onSaveAs={() => void organizer.saveAs()}
        onSave={() => void organizer.save()}
        onStopAsking={() => saveSettings(host, { ...loadSettings(host), warnSignedSave: false })}
      />
      <TimeStampDialog
        open={signOpen === 'timeStamp'}
        onClose={() => setSignOpen(null)}
        server={loadSettings(host).timeStampServer}
        modified={modified}
        onStamp={() => void organizer.signWith(modified ? organizer.plan : null, { certificate: null, place: null, reason: '', location: '', look: [], lock: false, timeStamp: loadSettings(host).timeStampServer, timeStampOnly: true })}
      />
      <SignaturesDialog
        host={host}
        open={signOpen === 'verify'}
        onClose={() => setSignOpen(null)}
        documentId={document?.id}
        modified={modified}
        shown={shownSignature}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} pageCount={pageCount} busy={organizer.busy} onExport={organizer.exportAs} />
      <ExtractDialog
        open={extractOpen}
        onClose={() => setExtractOpen(false)}
        targetCount={organizer.targets.size}
        pageCount={pageCount}
        busy={organizer.busy}
        onExtract={organizer.extract}
      />
    </>
  );

  const croppedIndexes = cropping ? croppedPages(cropping, pageCount) : [];
  const words = numberWords(t);
  const today = todayWritten(language);
  /** What is being set up beside the document, as the page would get it: its number, or its header and footer. */
  const previewNumber = (page: PlanPage): Mark[] => {
    const index = organizer.plan.indexOf(page);
    if (pageTexts) return pageTextsPreview(pageTexts, organizer.plan, index, today, document?.fileName ?? '');
    const mark = numbering && numberMarkFor(numbering, organizer.plan, index, words, `number-preview-${page.key}`);
    return mark ? [mark] : [];
  };
  const shapeDialogs = (
    <>
      <ResizeDialog
        open={shapeOpen === 'resize'}
        onClose={() => setShapeOpen(null)}
        targets={organizer.targets}
        pageCount={pageCount}
        busy={organizer.busy}
        unit={settings.unit}
        onApply={organizer.reshape}
      />
      <CompressDialog
        open={shapeOpen === 'compress'}
        onClose={() => setShapeOpen(null)}
        busy={organizer.busy}
        onCompress={(level) => organizer.compress(COMPRESS_LEVELS[level], facts?.fileSize ?? 0)}
      />
      <WatermarkDialog
        host={host}
        currentPage={currentPage}
        open={shapeOpen === 'watermark'}
        onClose={() => setShapeOpen(null)}
        pages={organizer.plan}
        targets={organizer.targets}
        onPickPicture={pickPicture}
        onApply={(marks) => {
          organizer.addMarks(marks);
          // With the tools out, the watermark can be moved, resized and turned right away.
          if (!organizer.organizing) marking.setTool('select');
        }}
      />
    </>
  );

  const insertTools = (
    <InsertTools
      host={host}
      tool={insertTool}
      onClose={() => setInsertTool(null)}
      fonts={fonts}
      onPlace={startPlacing}
      onProblem={organizer.report}
    />
  );

  const propertiesDialog = (
    <PropertiesDialog
      open={propertiesOpen}
      onClose={() => setPropertiesOpen(false)}
      fileName={document?.fileName ?? ''}
      facts={facts}
      pageCount={pageCount}
    />
  );

  // A problem, or good news (files were written); a problem comes first.
  const problem = (organizer.problem || organizer.notice) && (
    <div className={styles.problem} role={organizer.problem ? 'alert' : 'status'} data-tone={organizer.problem ? 'problem' : 'done'}>
      <span className={organizer.problem ? styles.warning : styles.done}>
        <Icon name={organizer.problem ? 'triangle-exclamation' : 'circle-check'} size={18} />
      </span>
      <span className={styles.problemText}>
        {organizer.problem ? t(organizer.problem) : organizer.notice && t(organizer.notice.key, organizer.notice.values)}
      </span>
      <IconButton
        variant="ghost"
        aria-label={t('pdf-organizer.notice.dismiss')}
        tooltipSide="bottom-end"
        onClick={organizer.dismissProblem}
      >
        <Icon name="xmark" size={14} />
      </IconButton>
    </div>
  );

  if (organizer.organizing) {
    return (
      <div className={styles.view}>
        <OrganizeBar
          selectedCount={organizer.selected.size}
          
          thumbnailSize={thumbnails.size}
          onThumbnailSizeChange={thumbnails.onSizeChange}
        />
        {problem}
        {splitDialog}
        {extractDialog}
        {shapeDialogs}
        {propertiesDialog}
        {insertTools}
        <PageGrid
          host={host}
          pages={organizer.plan}
          viewRotation={view.rotation}
          selected={organizer.selected}
          onSelectedChange={organizer.setSelected}
          onMove={organizer.moveBefore}
          onDelete={organizer.remove}
          onRotatePage={(index, degrees) => organizer.rotateAt([index], degrees)}
          onDeletePage={(index) => organizer.removeAt([index])}
          onCopy={organizer.copy}
          onCut={organizer.cut}
          onPaste={organizer.paste}
          onOpenPage={(page) => {
            setCurrentPage(page);
            stopOrganizing();
          }}
          pictureBox={thumbnails.size}
          drawnSize={thumbnails.drawnSize}
          onSizeStep={thumbnails.onStep}
        />
      </div>
    );
  }

  return (
    <div className={styles.view}>
      {/* With a pen in hand, what it does, in a sentence (the bar of the tool is the shell's, over this). */}
      {marking.tool !== null && host.tool && DRAWING_TOOLS[host.tool] && !placing && <TipLine>{t(penHintKey(marking.tool))}</TipLine>}
      {/* With the bars hidden (read mode, full screen), this is the visible way back; Escape works too. */}
      {immersive !== 'none' && (
        <div className={styles.immersive}>
          <Button variant="outline" onClick={() => setImmersive('none')}>
            <Icon name="xmark" size={14} />
            {t(immersive === 'read' ? 'pdf-organizer.view.leaveReadMode' : 'pdf-organizer.view.leaveFullScreen')}
          </Button>
        </div>
      )}
      {find.open && <FindBar find={find} onStep={stepFind} focusRequest={findFocus} />}
      {problem}
      {/* What the signatures say, checked on this computer when the document opened. */}
      {immersive === 'none' && fileCounts.verdict && document && signaturesSeen !== document.id && (
        <SignaturesBanner
          verdict={fileCounts.verdict}
          onShow={() => {
            setShownSignature(null);
            setSignOpen('verify');
          }}
          onDismiss={() => setSignaturesSeen(document.id)}
        />
      )}
      {splitDialog}
      {extractDialog}
      {shapeDialogs}
      {propertiesDialog}
      {insertTools}
      <div className={styles.body} style={{ '--strip-width': `${sideWidth('stripWidth')}px`, '--panel-width': `${sideWidth('panelWidth')}px` } as CSSProperties}>
        <PageList
          ref={pages}
          host={host}
          pages={organizer.plan}
          view={view}
          currentPage={currentPage}
          onCurrentPageChange={setCurrentPage}
          onZoomChange={setZoom}
          onZoomTo={setCustomZoom}
          guides={{
            rulers: view.rulers,
            grid: view.grid,
            unitPoints: UNITS[settings.unit].points,
            unitName: t(`pdf-organizer.unit.${settings.unit}`),
            gridPoints: settings.gridSpacing,
          }}
          onStep={step}
          hits={find.open ? find.hits : undefined}
          renderOver={(page, turn, pixelsPerPoint) => (
            <>
              {/* Fields sit where the file has them: only on pages still as they are in the file. */}
              {formShown && form.fields.length > 0 && document && page.documentId === document.id && !page.origin && (
                <FormLayer
                  fields={form.fieldsOnPage(page.page)}
                  answers={form.answers}
                  onFill={form.fill}
                  pageWidth={page.width}
                  pageHeight={page.height}
                  turn={turn}
                  pixelsPerPoint={pixelsPerPoint}
                />
              )}
              {marking.tool === null && !placing && !cropping && document && linksOf(page).length > 0 && (
                <LinkLayer
                  links={linksOf(page)}
                  pageWidth={page.width}
                  pageHeight={page.height}
                  turn={turn}
                  pixelsPerPoint={pixelsPerPoint}
                  placeOf={(target) => planIndexOf(organizer.plan, page.documentId, target)}
                  onGoToPage={goToPage}
                  onOpen={(url) => void host.openLink(url).catch(() => organizer.report('pdf-organizer.error.linkNotOpened'))}
                  onSignature={(signature) => {
                    setShownSignature(signature);
                    setSignOpen('verify');
                  }}
                />
              )}
              {cropping && croppedIndexes.includes(organizer.plan.indexOf(page)) && (
                <CropLayer
                  edges={cropping.edges}
                  onChange={(edges) => setCropping({ ...cropping, edges })}
                  width={turn % 180 === 0 ? page.width : page.height}
                  height={turn % 180 === 0 ? page.height : page.width}
                  pixelsPerPoint={pixelsPerPoint}
                />
              )}
              {(marking.tool !== null || placing !== null || numbering !== null || pageTexts !== null || (page.marks?.length ?? 0) > 0) && (
                <MarkLayer
                  // While page numbers are set up, each page shows the number it would get.
                  marks={numbering || pageTexts ? [...(page.marks ?? []), ...previewNumber(page)] : (page.marks ?? [])}
                  lines={linesOf(page)}
                  pictures={picturesOf(page)}
                  onTakePicture={(picture) => void pickUpPicture(page, picture)}
                  pageWidth={page.width}
                  pageHeight={page.height}
                  turn={turn}
                  pixelsPerPoint={pixelsPerPoint}
                  tool={marking.tool}
                  style={marking.style}
                  selectedId={marking.selection?.pageKey === page.key ? marking.selection.markId : null}
                  onSelect={(markId) => marking.select(markId ? { pageKey: page.key, markId } : null)}
                  onChange={(marks) => {
                    // The box of a signature with a certificate is not kept as a field: the certificate and the look are chosen next, and the document is signed there.
                    const box = signingArea && placing?.kind === 'box' ? marks.find((mark) => mark.kind === 'signatureField' && !(page.marks ?? []).some((known) => known.id === mark.id)) : undefined;
                    if (box) {
                      setSigningArea(false);
                      setSignArea({ page, box: { x: box.x, y: box.y, width: box.width, height: box.height } });
                      setSignOpen('sign');
                    } else setMarks(page.key, named(page.key, marks));
                  }}
                  placing={placing}
                  onOpenMark={(markId) => {
                    marking.setTool('select');
                    marking.select({ pageKey: page.key, markId });
                  }}
                  onPlaced={(markId) => {
                    const signed = placing?.kind === 'box';
                    setPlacing(null);
                    // After a signature the tools are put away: the document is on its way to being saved.
                    marking.setTool(signed ? null : 'select');
                    if (!signed) marking.select({ pageKey: page.key, markId });
                  }}
                />
              )}
            </>
          )}
          activeHit={find.hits[find.active] ?? null}
        />
        {/* The look of what the pen draws, or of what is selected: only while there is something to show. */}
        {markPanelWanted && !stripOnTop && (
          <>
            {sideHandle('panelWidth')}
            <MarkPanel
            tool={marking.tool}
            style={selectedMark ? styleOf(selectedMark, marking.style) : marking.style}
            onStyleChange={changeMarkStyle}
            selectedKind={selectedMark?.kind ?? null}
            selected={selectedMark}
            onSelectedChange={(change) => {
              changeSelectedMark((mark) => ({ ...mark, ...change }), `facts:${Object.keys(change).join()}`);
              // Who attaches files is remembered for the next one.
              if (change.author !== undefined) saveSettings(host, { ...loadSettings(host), attachAuthor: change.author });
            }}
            onDuplicate={() => pasteMark(selectedMark)}
            pageKeys={organizer.plan.map((page) => page.key)}
            onDelete={() => changeSelectedMark(() => null)}
            onPlaceOnPage={(across, down) => markedPage && changeSelectedMark((mark) => placedOnPage(mark, markedPage, across, down))}
            onDone={() => {
              setPlacing(null);
              marking.setTool(null);
              if (host.tool && DRAWING_TOOLS[host.tool]) showTool(null);
            }}
            fonts={fonts}
            repeated={selectedMark && selectedMark.kind !== 'erase' ? { pages: Math.max(pagesOfGroup(organizer.plan, selectedMark.group).length, 1), of: pageCount } : null}
            onRepeat={repeatSelectedMark}
            placing={placing !== null}
            placingText={signingArea ? t('pdf-organizer.sign.dragArea') : undefined}
            onPlaceNowhere={signingArea ? signInvisibly : undefined}
            onCancelPlacing={() => {
              setPlacing(null);
              setSigningArea(false);
            }}
          />
          </>
        )}
        {pageTexts && !stripOnTop && (
          <>
            {sideHandle('panelWidth')}
            <PageTextsPanel
            settings={pageTexts}
            onChange={setPageTexts}
            pages={organizer.plan}
            fileName={document?.fileName ?? ''}
            fonts={fonts}
            unit={settings.unit}
            onApply={(marks) => {
              setMarksOnPages(marks);
              setPageTexts(null);
            }}
            onCancel={() => setPageTexts(null)}
          />
          </>
        )}
        {numbering && !stripOnTop && (
          <>
            {sideHandle('panelWidth')}
            <NumbersPanel
            host={host}
            numbering={numbering}
            onChange={setNumbering}
            pages={organizer.plan}
            fonts={fonts}
            unit={settings.unit}
            onApply={(marks) => {
              organizer.addMarks(marks);
              setNumbering(null);
            }}
            onCancel={() => setNumbering(null)}
          />
          </>
        )}
        {cropping && !stripOnTop && (
          <>
            {sideHandle('panelWidth')}
            <CropPanel
            host={host}
            cropping={cropping}
            onChange={setCropping}
            page={organizer.plan[currentPage]}
            pageCount={pageCount}
            busy={organizer.busy}
            unit={settings.unit}
            onApply={() => void organizer.reshape({ crop: cropping.edges }, croppedIndexes).then((done) => done && setCropping(null))}
            onCancel={() => setCropping(null)}
            onChangePageSize={() => {
              setCropping(null);
              setShapeOpen('resize');
            }}
          />
          </>
        )}
        {/* Read mode and full screen leave the whole window to the pages. */}
        {immersive === 'none' && stripShown && sideHandle('stripWidth')}
        {immersive === 'none' && stripShown && (
          <SideStrip view={sideView} onClose={() => showStrip(false)}>
            {sideView === 'thumbnails' ? (
              <ThumbnailList
                host={host}
                pages={organizer.plan}
                rotation={view.rotation}
                currentPage={currentPage}
                onSelect={goToPage}
              />
            ) : (
              <BookmarkList
                bookmarks={facts?.bookmarks ?? []}
                placeOf={(page) => (document ? planIndexOf(organizer.plan, document.id, page) : undefined)}
                currentPage={currentPage}
                onGoToPage={goToPage}
                changes={organizer.changes}
                onEdit={organizer.editBookmark}
              />
            )}
          </SideStrip>
        )}
        {immersive === 'none' && (
          <DocRail
            panel={stripShown ? sideView : null}
            onPanelChange={(panel) => {
              if (panel) setSideView(panel);
              showStrip(panel !== null);
            }}
            counts={{ bookmarks: countBookmarks(facts?.bookmarks ?? []), attached: fileCounts.attached + pendingAttachments, signatures: fileCounts.signatures }}
            onAttachedFiles={() => setAttachmentsOpen(true)}
            onSignatures={() => {
              setShownSignature(null);
              setSignOpen('verify');
            }}
            currentPage={currentPage}
            pageCount={pageCount}
            onPageChange={goToPage}
            onStep={step}
            onRotate={() => setView((current) => ({ ...current, rotation: rotateClockwise(current.rotation) }))}
            commands={commands}
            zoom={zoom}
            onZoomChange={setCustomZoom}
          />
        )}
      </div>
    </div>
  );
}

/** How many entries a table of contents has, those inside others too. */
function countBookmarks(bookmarks: readonly Bookmark[]): number {
  return bookmarks.reduce((sum, bookmark) => sum + 1 + countBookmarks(bookmark.children), 0);
}
