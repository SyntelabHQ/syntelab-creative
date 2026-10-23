import type { Command } from '@syntelab/command-registry';
import type { ImmersiveMode } from '@syntelab/shell-api';
import { MAX_THUMBNAIL_SIZE, MIN_THUMBNAIL_SIZE } from './organize/thumbnail-size';
import { DEFAULT_VIEW, MAX_ZOOM, MIN_ZOOM } from './viewer/view-settings';
import type { ViewSettings, ZoomMode } from './viewer/view-settings';
import { zoomIn, zoomOut } from './viewer/zoom';

// Menus shared with the shell and other apps…
const FILE = 'common.menu.file';
const EDIT = 'common.menu.edit';
const VIEW = 'common.menu.view';
// …and the ones only PDF Organizer has.
const ORGANIZE = 'pdf-organizer.menu.organize';
const COMBINE = 'pdf-organizer.menu.combine';
const INSERT = 'pdf-organizer.menu.insert';
const SIGN = 'pdf-organizer.menu.sign';
const TOOLS = 'pdf-organizer.menu.tools';

const group = (name: string) => `pdf-organizer.group.${name}`;
const commandId = (name: string) => `pdf-organizer.${name}`;

/** The keys of the commands that have some, the same as in other PDF programs. */
const SHORTCUTS: Readonly<Record<string, string>> = {
  open: 'Mod+O',
  save: 'Mod+S',
  saveAs: 'Mod+Shift+S',
  print: 'Mod+P',
  close: 'Mod+W',
  undo: 'Mod+Z',
  redo: 'Mod+Y',
  find: 'Mod+F',
  organizePages: 'Mod+Shift+O',
  selectAll: 'Mod+A',
};

/** Every key of PDF Organizer, by the command it runs, with the name of what it does: for the list in Settings, where they can be changed. */
export const SHORTCUT_LIST: readonly { readonly id: string; readonly labelKey: string; readonly shortcut: string }[] = [
  ...Object.entries(SHORTCUTS).map(([name, shortcut]) => ({ id: commandId(name), labelKey: name === 'open' ? 'pdf-organizer.open.button' : `pdf-organizer.command.${name}`, shortcut })),
  { id: 'pdf-organizer.zoomIn', labelKey: 'pdf-organizer.viewer.zoomIn', shortcut: 'Mod+=' },
  { id: 'pdf-organizer.zoomOut', labelKey: 'pdf-organizer.viewer.zoomOut', shortcut: 'Mod+-' },
  { id: 'pdf-organizer.zoom.fit-page', labelKey: 'pdf-organizer.view.fitPage', shortcut: 'Mod+0' },
  { id: 'pdf-organizer.zoom.actual', labelKey: 'pdf-organizer.view.actualSize', shortcut: 'Mod+1' },
  { id: 'pdf-organizer.zoom.fit-width', labelKey: 'pdf-organizer.view.fitWidth', shortcut: 'Mod+2' },
  { id: 'pdf-organizer.view.rulers', labelKey: 'pdf-organizer.view.rulers', shortcut: 'Mod+R' },
  { id: 'pdf-organizer.view.grid', labelKey: 'pdf-organizer.view.grid', shortcut: 'Mod+U' },
  { id: 'pdf-organizer.view.readMode', labelKey: 'pdf-organizer.view.readMode', shortcut: 'Mod+H' },
  { id: 'pdf-organizer.view.fullScreen', labelKey: 'pdf-organizer.view.fullScreen', shortcut: 'F11' },
];

/**
 * The commands with the keys the user chose for them (by command id; an
 * empty text takes a command's keys away). Commands not named keep their own.
 */
export function withChosenShortcuts(commands: readonly Command[], chosen: Readonly<Record<string, string>>): readonly Command[] {
  if (Object.keys(chosen).length === 0) return commands;
  return commands.map((command) => (chosen[command.id] === undefined ? command : { ...command, shortcut: chosen[command.id] || undefined }));
}

/** What is done with keys and the mouse together, or with keys that are not commands: `[translation key of the keys, of what they do]`. */
export const OTHER_KEYS: readonly (readonly [string, string])[] = [
  ['pdf-organizer.keys.ctrlWheel', 'pdf-organizer.keys.ctrlWheelDoes'],
  ['pdf-organizer.keys.pageKeys', 'pdf-organizer.keys.pageKeysDoes'],
  ['pdf-organizer.keys.paste', 'pdf-organizer.keys.pasteDoes'],
  ['pdf-organizer.keys.delete', 'pdf-organizer.keys.deleteDoes'],
  ['pdf-organizer.keys.arrows', 'pdf-organizer.keys.arrowsDoes'],
  ['pdf-organizer.keys.escape', 'pdf-organizer.keys.escapeDoes'],
];

/**
 * A command that is planned but not written yet. It is shown, greyed out, so
 * the menus already have their final shape (apps/pdf-organizer/PLAN.md).
 * Writing the feature means passing a real command for the same name to
 * `viewerCommands` (see `working` there).
 */
function planned(name: string, menuKey: string, groupName: string, icon: string, primary = false): Command {
  return {
    id: commandId(name),
    shortcut: SHORTCUTS[name],
    labelKey: name === 'open' ? 'pdf-organizer.open.button' : `pdf-organizer.command.${name}`,
    // What it does is said also while it cannot be used.
    hintKey: `pdf-organizer.hint.${name}`,
    menuKey,
    groupKey: group(groupName),
    icon,
    primary,
    disabled: true,
    run: () => {},
  };
}

/** The menus before View, in order. */
const BEFORE_VIEW: readonly Command[] = [
  planned('open', FILE, 'document', 'folder-open', true),
  planned('openSeveral', FILE, 'document', 'folder-tree'),
  planned('createPdf', FILE, 'document', 'wand-magic-sparkles'),
  planned('save', FILE, 'document', 'floppy-disk', true),
  planned('saveAs', FILE, 'document', 'file-arrow-down', true),
  planned('exportAs', FILE, 'document', 'file-export'),
  planned('print', FILE, 'document', 'print', true),
  planned('share', FILE, 'document', 'share-nodes'),
  planned('properties', FILE, 'document', 'circle-info'),
  planned('close', FILE, 'document', 'xmark'),
  planned('settings', FILE, 'document', 'gear'),

  planned('undo', EDIT, 'history', 'arrow-rotate-left', true),
  planned('redo', EDIT, 'history', 'arrow-rotate-right', true),
  planned('find', EDIT, 'find', 'magnifying-glass', true),
  planned('addText', EDIT, 'content', 'font'),
  planned('addImage', EDIT, 'content', 'image'),
  planned('addShape', EDIT, 'content', 'shapes'),
  planned('highlight', EDIT, 'content', 'highlighter'),
  planned('watermark', EDIT, 'content', 'stamp'),
  planned('pageNumbers', EDIT, 'content', 'list-ol'),
  planned('cropPages', EDIT, 'pageSize', 'crop-simple'),
  planned('resizePages', EDIT, 'pageSize', 'up-right-and-down-left-from-center'),
];

/** The menus after View, in order. */
const AFTER_VIEW: readonly Command[] = [
  planned('organizePages', ORGANIZE, 'pages', 'table-cells', true),
  planned('rotateLeft', ORGANIZE, 'turnSelected', 'rotate-left'),
  planned('rotateRight', ORGANIZE, 'turnSelected', 'rotate-right'),
  planned('rotateAllLeft', ORGANIZE, 'turnAll', 'rotate-all-left'),
  planned('rotateAllRight', ORGANIZE, 'turnAll', 'rotate-all-right'),
  planned('deletePages', ORGANIZE, 'pages', 'trash-can'),
  planned('extractPages', ORGANIZE, 'pages', 'file-export'),
  planned('insertPages', ORGANIZE, 'pages', 'file-circle-plus'),
  planned('replacePages', ORGANIZE, 'pages', 'right-left'),
  planned('splitDocument', ORGANIZE, 'pages', 'scissors'),
  planned('copyPages', ORGANIZE, 'clipboard', 'copy'),
  planned('cutPages', ORGANIZE, 'clipboard', 'scissors'),
  planned('pastePages', ORGANIZE, 'clipboard', 'paste'),
  planned('selectAll', ORGANIZE, 'selection', 'check-double'),
  planned('selectNone', ORGANIZE, 'selection', 'square'),
  planned('selectOdd', ORGANIZE, 'selection', 'file'),
  planned('selectEven', ORGANIZE, 'selection', 'book-open'),
  planned('moveEarlier', ORGANIZE, 'order', 'arrow-left'),
  planned('moveLater', ORGANIZE, 'order', 'arrow-right'),

  planned('newBinder', COMBINE, 'binder', 'layer-group', true),
  planned('combineFiles', COMBINE, 'binder', 'object-group'),
  planned('addFiles', COMBINE, 'binder', 'folder-plus'),

  planned('insertBlankPage', INSERT, 'pages', 'file-circle-plus', true),
  planned('headerFooter', INSERT, 'onPages', 'table-columns'),
  planned('batesNumbers', INSERT, 'onPages', 'list-ol'),
  planned('addLink', INSERT, 'links', 'link', true),
  planned('addBookmark', INSERT, 'links', 'bookmark'),
  planned('bookmarks', INSERT, 'links', 'book-open'),
  planned('attachFile', INSERT, 'links', 'file-circle-check'),
  planned('attachedFiles', INSERT, 'links', 'folder-open'),
  planned('addTextField', INSERT, 'forms', 'i-cursor'),
  planned('addCheckBox', INSERT, 'forms', 'square-check'),
  planned('addRadioButton', INSERT, 'forms', 'circle'),
  planned('addChoiceField', INSERT, 'forms', 'rectangle-list'),
  planned('addSignatureField', INSERT, 'forms', 'file-signature'),
  planned('fillForm', INSERT, 'forms', 'pen-to-square'),

  planned('signVisual', SIGN, 'sign', 'signature', true),
  planned('signCertificate', SIGN, 'sign', 'file-signature'),
  planned('signBatch', SIGN, 'sign', 'layer-group'),
  planned('timestamp', SIGN, 'sign', 'clock'),
  planned('verifySignatures', SIGN, 'verify', 'circle-check'),

  planned('ocr', TOOLS, 'more', 'eye'),
  planned('redact', TOOLS, 'more', 'eraser'),
  planned('compress', TOOLS, 'more', 'compress'),
  planned('compare', TOOLS, 'more', 'code-compare'),
  planned('batch', TOOLS, 'more', 'list-check'),
];

/** What makes a planned command work: everything about it that is not fixed by the menu. */
type Working = Pick<Command, 'run'> & Partial<Pick<Command, 'disabled' | 'kind' | 'checked' | 'hintKey' | 'labelKey'>>;

/** Replaces placeholders by working commands, keeping their place, name and icon. */
function withWorking(commands: readonly Command[], working: Readonly<Record<string, Working>>): Command[] {
  return commands.map((command) => {
    const name = command.id.slice(commandId('').length);
    const real = working[name];
    return real ? { ...command, disabled: false, ...real } : command;
  });
}

/** What every kind of tab can do about files: open one, open several, make a new PDF. */
export interface FileCommandsInput {
  readonly onOpen: () => void;
  readonly onOpenSeveral: () => void;
  readonly onCreatePdf: () => void;
  /** Opens the window that does one thing to many files. */
  readonly onBatch: () => void;
  /** Opens batch processing with signing chosen: many files signed with a certificate at once. */
  readonly onSignBatch: () => void;
  /** Opens the settings of PDF Organizer. */
  readonly onSettings: () => void;
}

const fileWorking = (input: FileCommandsInput): Record<string, Working> => ({
  open: { run: input.onOpen, labelKey: 'pdf-organizer.open.button', hintKey: 'pdf-organizer.hint.open' },
  openSeveral: { run: input.onOpenSeveral, hintKey: 'pdf-organizer.hint.openSeveral' },
  createPdf: { run: input.onCreatePdf, hintKey: 'pdf-organizer.hint.createPdf' },
  batch: { run: input.onBatch, hintKey: 'pdf-organizer.hint.batch' },
  signBatch: { run: input.onSignBatch, hintKey: 'pdf-organizer.hint.signBatch' },
  settings: { run: input.onSettings, hintKey: 'pdf-organizer.hint.settings' },
});

/** What the Organize menu needs to know and do. All of it acts on the page plan, not on the file. */
export interface OrganizeCommandsInput {
  /** True while the grid of pages is shown instead of the document. */
  readonly organizing: boolean;
  readonly onOrganizingChange: (organizing: boolean) => void;
  readonly pageCount: number;
  /** How many pages the commands would act on: the selected ones, or the page in view. */
  readonly targetCount: number;
  readonly selectedCount: number;
  readonly canMoveEarlier: boolean;
  readonly canMoveLater: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** A save or an insert is running. */
  readonly busy: boolean;
  /** The pages were rearranged and not saved yet. */
  readonly modified: boolean;
  readonly onSave: () => void;
  readonly onPrint: () => void;
  readonly onShare: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onRotate: (degrees: 90 | -90) => void;
  readonly onRotateAll: (degrees: 90 | -90) => void;
  readonly onCopy: () => void;
  readonly onCut: () => void;
  readonly onPaste: () => void;
  readonly canPaste: boolean;
  readonly onDelete: () => void;
  readonly onExtract: () => void;
  readonly onInsert: () => void;
  /** Adds an empty page after the targets. */
  readonly onInsertBlank: () => void;
  readonly onReplace: () => void;
  readonly onSplit: () => void;
  readonly onCrop: () => void;
  readonly onResize: () => void;
  readonly onPageNumbers: () => void;
  readonly onWatermark: () => void;
  readonly onCompress: () => void;
  readonly onSaveAs: () => void;
  readonly onExport: () => void;
  readonly onSelect: (which: 'all' | 'none' | 'odd' | 'even') => void;
  readonly onMove: (direction: 1 | -1) => void;
}

/** The size of the thumbnails where pages are shown as thumbnails (Organize, a binder): what Zoom in and Zoom out change there. */
export interface ThumbnailZoomInput {
  readonly size: number;
  /** A step larger (1) or smaller (-1). */
  readonly onStep: (steps: number) => void;
}

/** Zoom in and Zoom out made to change the size of the thumbnails. */
function zoomingThumbnails(commands: readonly Command[], thumbnails: ThumbnailZoomInput): Command[] {
  const steps: Record<string, { readonly by: 1 | -1; readonly disabled: boolean }> = {
    'pdf-organizer.zoomOut': { by: -1, disabled: thumbnails.size <= MIN_THUMBNAIL_SIZE },
    'pdf-organizer.zoomIn': { by: 1, disabled: thumbnails.size >= MAX_THUMBNAIL_SIZE },
  };
  return commands.map((command) => {
    const step = steps[command.id];
    return step ? { ...command, disabled: step.disabled, run: () => thumbnails.onStep(step.by) } : command;
  });
}

export interface ViewerCommandsInput {
  readonly view: ViewSettings;
  readonly onViewChange: (view: ViewSettings) => void;
  /** The zoom in use right now (a "fit" mode resolves to a number). */
  readonly zoom: number;
  readonly thumbnailsShown: boolean;
  readonly onThumbnailsShownChange: (shown: boolean) => void;
  /** True while the side strip shows the table of contents. */
  readonly bookmarksShown: boolean;
  readonly onBookmarksShownChange: (shown: boolean) => void;
  readonly onProperties: () => void;
  /** Asks for another PDF and compares this document with it. */
  readonly onCompare: () => void;
  /** The document has a form; and whether its fields are shown to be filled in. */
  readonly hasForm: boolean;
  readonly formShown: boolean;
  readonly onFormShownChange: (shown: boolean) => void;
  /** Opens one of the tools that put something on the page in view. */
  readonly onInsert: (tool: 'image' | 'signature') => void;
  /** Starts drawing on the page with a tool: a shape, text, a highlight. */
  readonly onMark: (tool: 'rectangle' | 'text' | 'highlight' | 'redact' | 'link' | 'bookmark' | 'textField' | 'checkBox' | 'signatureField' | 'radioButton' | 'choiceField') => void;
  /** Asks for a file and attaches it to the document. */
  readonly onAttach: () => void;
  /** Reads the text of scanned pages (OCR). */
  readonly onOcr: () => void;
  /** Signs the document with a certificate. */
  readonly onSignCertificate: () => void;
  /** Adds a time stamp of the whole document, from a time-stamping authority. */
  readonly onTimeStamp: () => void;
  /** Shows the signatures of the document, each checked. */
  readonly onVerifySignatures: () => void;
  /** Shows the files the document has attached. */
  readonly onAttachedFiles: () => void;
  /** Sets up a header and footer, or Bates numbers, beside the document. */
  readonly onPageTexts: (mode: 'header-footer' | 'bates') => void;
  /** True while the page is being drawn on. */
  readonly marking: boolean;
  readonly immersive: ImmersiveMode;
  readonly onImmersiveChange: (mode: ImmersiveMode) => void;
  readonly files: FileCommandsInput;
  readonly onClose: () => void;
  readonly onFind: () => void;
  /** Starts a binder with this document as its first card. */
  readonly onNewBinder: () => void;
  readonly organize: OrganizeCommandsInput;
  /** Given while organizing: Zoom in and Zoom out change the size of the pages in the grid. */
  readonly thumbnailZoom?: ThumbnailZoomInput;
}

/** The View menu of an open document. */
function viewCommands(input: ViewerCommandsInput): Command[] {
  const { view, onViewChange, zoom, immersive, onImmersiveChange } = input;
  const twoPages = view.pageLayout === 'two-page';
  const smaller = Math.max(zoomOut(zoom), MIN_ZOOM);
  const larger = Math.min(zoomIn(zoom), MAX_ZOOM);
  const setZoom = (customZoom: number) => onViewChange({ ...view, zoomMode: 'custom', customZoom });

  const fit = (mode: Exclude<ZoomMode, 'custom'>, name: string, icon: string, shortcut?: string): Command => ({
    id: `pdf-organizer.zoom.${mode}`,
    shortcut,
    labelKey: `pdf-organizer.view.${name}`,
    hintKey: `pdf-organizer.hint.${name}`,
    menuKey: VIEW,
    groupKey: group('zoom'),
    icon,
    kind: 'choice',
    checked: view.zoomMode === mode,
    run: () => onViewChange({ ...view, zoomMode: mode }),
  });

  return [
    {
      id: 'pdf-organizer.zoomOut',
      shortcut: 'Mod+-',
      labelKey: 'pdf-organizer.viewer.zoomOut',
      hintKey: 'pdf-organizer.hint.zoom',
      menuKey: VIEW,
      groupKey: group('zoom'),
      icon: 'magnifying-glass-minus',
      primary: true,
      disabled: smaller >= zoom,
      run: () => setZoom(smaller),
    },
    {
      id: 'pdf-organizer.zoomIn',
      shortcut: 'Mod+=',
      labelKey: 'pdf-organizer.viewer.zoomIn',
      hintKey: 'pdf-organizer.hint.zoom',
      menuKey: VIEW,
      groupKey: group('zoom'),
      icon: 'magnifying-glass-plus',
      primary: true,
      disabled: larger <= zoom,
      run: () => setZoom(larger),
    },
    fit('actual', 'actualSize', 'ruler', 'Mod+1'),
    fit('fit-page', 'fitPage', 'maximize', 'Mod+0'),
    fit('fit-width', 'fitWidth', 'arrows-left-right', 'Mod+2'),
    fit('fit-height', 'fitHeight', 'arrows-up-down'),
    {
      id: 'pdf-organizer.view.singlePage',
      labelKey: 'pdf-organizer.view.singlePage',
      menuKey: VIEW,
      groupKey: group('pageDisplay'),
      icon: 'file',
      kind: 'choice',
      checked: !twoPages,
      run: () => onViewChange({ ...view, pageLayout: 'single' }),
    },
    {
      id: 'pdf-organizer.view.twoPage',
      labelKey: 'pdf-organizer.view.twoPage',
      menuKey: VIEW,
      groupKey: group('pageDisplay'),
      icon: 'book-open',
      kind: 'choice',
      checked: twoPages,
      run: () => onViewChange({ ...view, pageLayout: 'two-page' }),
    },
    {
      id: 'pdf-organizer.view.coverPage',
      labelKey: 'pdf-organizer.view.coverPage',
      hintKey: 'pdf-organizer.hint.coverPage',
      menuKey: VIEW,
      groupKey: group('pageDisplay'),
      icon: 'book',
      kind: 'toggle',
      checked: twoPages && view.coverPage,
      disabled: !twoPages,
      run: () => onViewChange({ ...view, coverPage: !view.coverPage }),
    },
    {
      id: 'pdf-organizer.view.scrolling',
      labelKey: 'pdf-organizer.view.scrolling',
      hintKey: 'pdf-organizer.hint.scrolling',
      menuKey: VIEW,
      groupKey: group('pageDisplay'),
      icon: 'scroll',
      kind: 'toggle',
      checked: view.scrolling,
      run: () => onViewChange({ ...view, scrolling: !view.scrolling }),
    },
    {
      id: 'pdf-organizer.view.rulers',
      shortcut: 'Mod+R',
      labelKey: 'pdf-organizer.view.rulers',
      hintKey: 'pdf-organizer.hint.rulers',
      menuKey: VIEW,
      groupKey: group('guides'),
      icon: 'ruler-combined',
      kind: 'toggle',
      checked: view.rulers,
      run: () => onViewChange({ ...view, rulers: !view.rulers }),
    },
    {
      id: 'pdf-organizer.view.grid',
      shortcut: 'Mod+U',
      labelKey: 'pdf-organizer.view.grid',
      hintKey: 'pdf-organizer.hint.grid',
      menuKey: VIEW,
      groupKey: group('guides'),
      icon: 'border-all',
      kind: 'toggle',
      checked: view.grid,
      run: () => onViewChange({ ...view, grid: !view.grid }),
    },
    {
      id: 'pdf-organizer.view.thumbnails',
      labelKey: 'pdf-organizer.view.thumbnails',
      menuKey: VIEW,
      groupKey: group('window'),
      icon: 'images',
      kind: 'toggle',
      checked: input.thumbnailsShown,
      run: () => input.onThumbnailsShownChange(!input.thumbnailsShown),
    },
    {
      id: 'pdf-organizer.view.readMode',
      shortcut: 'Mod+H',
      labelKey: 'pdf-organizer.view.readMode',
      hintKey: 'pdf-organizer.hint.readMode',
      menuKey: VIEW,
      groupKey: group('window'),
      icon: 'glasses',
      kind: 'toggle',
      checked: immersive === 'read',
      run: () => onImmersiveChange(immersive === 'read' ? 'none' : 'read'),
    },
    {
      id: 'pdf-organizer.view.fullScreen',
      shortcut: 'F11',
      labelKey: 'pdf-organizer.view.fullScreen',
      hintKey: 'pdf-organizer.hint.fullScreen',
      menuKey: VIEW,
      groupKey: group('window'),
      icon: 'expand',
      kind: 'toggle',
      checked: immersive === 'full-screen',
      run: () => onImmersiveChange(immersive === 'full-screen' ? 'none' : 'full-screen'),
    },
  ];
}

/** The commands of the document in the front tab, in the order the menus show them. */
export function viewerCommands(input: ViewerCommandsInput): Command[] {
  const organize = input.organize;
  const noTarget = organize.targetCount === 0;
  const selecting = organize.organizing;

  const working: Record<string, Working> = {
    ...fileWorking(input.files),
    close: { run: input.onClose },
    newBinder: { run: input.onNewBinder, hintKey: 'pdf-organizer.hint.newBinder' },
    properties: { run: input.onProperties, hintKey: 'pdf-organizer.hint.properties' },
    compare: { run: input.onCompare, hintKey: organize.modified ? 'pdf-organizer.hint.compareUnsaved' : 'pdf-organizer.hint.compare' },
    // A document without a form: the button starts one, with the tool that draws a text field.
    fillForm: input.hasForm
      ? { run: () => input.onFormShownChange(!input.formShown), kind: 'toggle', checked: input.formShown, hintKey: 'pdf-organizer.hint.fillForm' }
      : { run: () => input.onMark('textField'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.noForm' },
    addText: { run: () => input.onMark('text'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addText' },
    addImage: { run: () => input.onInsert('image'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.addImage' },
    addShape: { run: () => input.onMark('rectangle'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addShape' },
    highlight: { run: () => input.onMark('highlight'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.highlight' },
    signVisual: { run: () => input.onInsert('signature'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.signVisual' },
    redact: { run: () => input.onMark('redact'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.redact' },
    addLink: { run: () => input.onMark('link'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addLink' },
    addBookmark: { run: () => input.onMark('bookmark'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addBookmark' },
    addTextField: { run: () => input.onMark('textField'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addTextField' },
    addCheckBox: { run: () => input.onMark('checkBox'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addCheckBox' },
    addRadioButton: { run: () => input.onMark('radioButton'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addRadioButton' },
    addChoiceField: { run: () => input.onMark('choiceField'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addChoiceField' },
    addSignatureField: { run: () => input.onMark('signatureField'), disabled: organize.organizing, hintKey: 'pdf-organizer.hint.addSignatureField' },
    attachFile: { run: input.onAttach, disabled: organize.busy, hintKey: 'pdf-organizer.hint.attachFile' },
    ocr: { run: input.onOcr, disabled: organize.busy, hintKey: 'pdf-organizer.hint.ocr' },
    signCertificate: { run: input.onSignCertificate, disabled: organize.busy, hintKey: 'pdf-organizer.hint.signCertificate' },
    timestamp: { run: input.onTimeStamp, disabled: organize.busy, hintKey: 'pdf-organizer.hint.timestamp' },
    verifySignatures: { run: input.onVerifySignatures, hintKey: 'pdf-organizer.hint.verifySignatures' },
    attachedFiles: { run: input.onAttachedFiles, hintKey: 'pdf-organizer.hint.attachedFiles' },
    headerFooter: { run: () => input.onPageTexts('header-footer'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.headerFooter' },
    batesNumbers: { run: () => input.onPageTexts('bates'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.batesNumbers' },
    bookmarks: {
      run: () => input.onBookmarksShownChange(!input.bookmarksShown),
      kind: 'toggle',
      checked: input.bookmarksShown,
      disabled: organize.organizing,
      hintKey: 'pdf-organizer.hint.bookmarks',
    },
    // Text is looked for in the document, not in the grid of small pages.
    find: { run: input.onFind, disabled: organize.organizing, hintKey: 'pdf-organizer.hint.find' },
    // Nothing to save until something changed.
    save: { run: organize.onSave, disabled: organize.busy || !organize.modified, hintKey: 'pdf-organizer.hint.save' },
    saveAs: { run: organize.onSaveAs, disabled: organize.busy, hintKey: 'pdf-organizer.hint.saveAs' },
    exportAs: { run: organize.onExport, disabled: organize.busy, hintKey: 'pdf-organizer.hint.exportAs' },
    print: { run: organize.onPrint, disabled: organize.busy, hintKey: 'pdf-organizer.hint.print' },
    // What is shared is the file on disk: with unsaved changes, say so.
    share: {
      run: organize.onShare,
      disabled: organize.busy,
      hintKey: organize.modified ? 'pdf-organizer.hint.shareUnsaved' : 'pdf-organizer.hint.share',
    },
    undo: { run: organize.onUndo, disabled: !organize.canUndo },
    redo: { run: organize.onRedo, disabled: !organize.canRedo },
    organizePages: {
      run: () => organize.onOrganizingChange(!organize.organizing),
      kind: 'toggle',
      checked: organize.organizing,
      hintKey: 'pdf-organizer.hint.organizePages',
    },
    rotateLeft: { run: () => organize.onRotate(-90), disabled: noTarget },
    rotateRight: { run: () => organize.onRotate(90), disabled: noTarget },
    copyPages: { run: organize.onCopy, disabled: noTarget, hintKey: 'pdf-organizer.hint.copyPages' },
    cutPages: { run: organize.onCut, disabled: noTarget || organize.targetCount >= organize.pageCount, hintKey: 'pdf-organizer.hint.cutPages' },
    pastePages: { run: organize.onPaste, disabled: !organize.canPaste, hintKey: 'pdf-organizer.hint.pastePages' },
    rotateAllLeft: { run: () => organize.onRotateAll(-90), hintKey: 'pdf-organizer.hint.rotateAll' },
    rotateAllRight: { run: () => organize.onRotateAll(90), hintKey: 'pdf-organizer.hint.rotateAll' },
    deletePages: {
      run: organize.onDelete,
      // A document keeps at least one page.
      disabled: noTarget || organize.targetCount >= organize.pageCount,
      hintKey: 'pdf-organizer.hint.deletePages',
    },
    extractPages: {
      run: organize.onExtract,
      disabled: noTarget || organize.busy,
      hintKey: 'pdf-organizer.hint.extractPages',
    },
    insertPages: { run: organize.onInsert, disabled: organize.busy, hintKey: 'pdf-organizer.hint.insertPages' },
    insertBlankPage: { run: organize.onInsertBlank, disabled: organize.busy, hintKey: 'pdf-organizer.hint.insertBlankPage' },
    replacePages: {
      run: organize.onReplace,
      disabled: noTarget || organize.busy,
      hintKey: 'pdf-organizer.hint.replacePages',
    },
    splitDocument: {
      run: organize.onSplit,
      // One page cannot be cut into two files.
      disabled: organize.pageCount < 2 || organize.busy,
      hintKey: 'pdf-organizer.hint.splitDocument',
    },
    cropPages: { run: organize.onCrop, disabled: organize.busy, hintKey: 'pdf-organizer.hint.cropPages' },
    resizePages: { run: organize.onResize, disabled: organize.busy, hintKey: 'pdf-organizer.hint.resizePages' },
    pageNumbers: { run: organize.onPageNumbers, disabled: organize.busy, hintKey: 'pdf-organizer.hint.pageNumbers' },
    watermark: { run: organize.onWatermark, disabled: organize.busy, hintKey: 'pdf-organizer.hint.watermark' },
    compress: { run: organize.onCompress, disabled: organize.busy, hintKey: 'pdf-organizer.hint.compress' },
    // Selecting only makes sense where the selection can be seen.
    selectAll: { run: () => organize.onSelect('all'), disabled: !selecting },
    selectNone: { run: () => organize.onSelect('none'), disabled: !selecting || organize.selectedCount === 0 },
    selectOdd: { run: () => organize.onSelect('odd'), disabled: !selecting },
    selectEven: { run: () => organize.onSelect('even'), disabled: !selecting || organize.pageCount < 2 },
    moveEarlier: { run: () => organize.onMove(-1), disabled: !organize.canMoveEarlier },
    moveLater: { run: () => organize.onMove(1), disabled: !organize.canMoveLater },
  };

  const view = input.thumbnailZoom ? zoomingThumbnails(viewCommands(input), input.thumbnailZoom) : viewCommands(input);
  return [...withWorking(BEFORE_VIEW, working), ...view, ...withWorking(AFTER_VIEW, working)];
}

/**
 * The View menu as it is with a document, every command greyed out: a tab
 * without a document shows the menus in their full shape, with nothing to use.
 */
const VIEW_WITHOUT_A_DOCUMENT: readonly Command[] = viewCommands({
  view: DEFAULT_VIEW,
  onViewChange: () => {},
  zoom: 1,
  thumbnailsShown: true,
  onThumbnailsShownChange: () => {},
  immersive: 'none',
  onImmersiveChange: () => {},
} as unknown as ViewerCommandsInput).map((command) => ({ ...command, disabled: true, checked: false, run: () => {} }));

/** The commands of a tab without a document: opening a file and starting a binder work; the rest shows what is to come. */
export function emptyTabCommands(files: FileCommandsInput, newBinder: () => void): Command[] {
  return withWorking([...BEFORE_VIEW, ...VIEW_WITHOUT_A_DOCUMENT, ...AFTER_VIEW], {
    ...fileWorking(files),
    newBinder: { run: newBinder, hintKey: 'pdf-organizer.hint.newBinder' },
  });
}

export interface BinderCommandsInput {
  readonly files: FileCommandsInput;
  readonly onAddFiles: () => void;
  readonly onCombine: () => void;
  /** There is at least one page to write, and nothing is being read or written. */
  readonly canCombine: boolean;
  readonly busy: boolean;
  /** Zoom in and Zoom out change the size of the cards' pages. */
  readonly thumbnailZoom: ThumbnailZoomInput;
}

/** The commands of a binder tab. */
export function binderCommands(input: BinderCommandsInput): Command[] {
  return withWorking([...BEFORE_VIEW, ...zoomingThumbnails(VIEW_WITHOUT_A_DOCUMENT, input.thumbnailZoom), ...AFTER_VIEW], {
    ...fileWorking(input.files),
    addFiles: { run: input.onAddFiles, disabled: input.busy, hintKey: 'pdf-organizer.hint.addFiles' },
    combineFiles: { run: input.onCombine, disabled: !input.canCombine, hintKey: 'pdf-organizer.hint.combineFiles' },
  });
}
