import type { Command } from '@syntelab/command-registry';
import type { ImmersiveMode } from '@syntelab/shell-api';
import { MAX_THUMBNAIL_SIZE, MIN_THUMBNAIL_SIZE } from './organize/thumbnail-size';
import { DEFAULT_VIEW, MAX_ZOOM, MIN_ZOOM } from './viewer/view-settings';
import type { ViewSettings, ZoomMode } from './viewer/view-settings';
import { zoomIn, zoomOut } from './viewer/zoom';
import type { MarkTool } from './marks/mark-layer';
import { penHintKey } from './marks/pen-hint';

// Menus shared with the shell and other apps…
const FILE = 'common.menu.file';
const EDIT = 'common.menu.edit';
const VIEW = 'common.menu.view';
// …and the tools of PDF Organizer, named by what the user wants to do (`tools` in app.json gives their order).
export const CREATE = 'pdf-organizer.menu.create';
export const ORGANIZE = 'pdf-organizer.menu.organize';
export const EDIT_TOOL = 'pdf-organizer.menu.editTool';
export const COMMENT = 'pdf-organizer.menu.comment';
export const SIGN = 'pdf-organizer.menu.sign';
export const FORM = 'pdf-organizer.menu.form';
export const PROTECT = 'pdf-organizer.menu.protect';
const COMBINE = 'pdf-organizer.menu.combine';
export const CONVERT = 'pdf-organizer.menu.convert';
const OPTIMIZE = 'pdf-organizer.menu.optimize';
export const COMPARE = 'pdf-organizer.menu.compare';
const BATCH = 'pdf-organizer.menu.batch';

/**
 * The tools that draw or write on the page, with the pen each starts with:
 * opening one of them shows the document with that pen in hand.
 */
export const DRAWING_TOOLS: Readonly<Record<string, MarkTool>> = {
  [EDIT_TOOL]: 'edit',
  [COMMENT]: 'highlight',
  [SIGN]: 'select',
  [FORM]: 'textField',
  [PROTECT]: 'redact',
};

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

/**
 * A pen of one of the tools that draw on the page (`pdf-organizer.<tool>.<pen>`):
 * a choice among the pens of its bar, the one in hand checked.
 */
function pen(tool: string, menuKey: string, groupName: string, kind: MarkTool, icon: string, labelKey = `pdf-organizer.marks.tool.${kind}`): Command {
  return {
    id: `pdf-organizer.${tool}.${kind}`,
    labelKey,
    hintKey: penHintKey(kind),
    menuKey,
    groupKey: group(groupName),
    icon,
    kind: 'choice',
    disabled: true,
    run: () => {},
  };
}

/** The menus before View, in order. */
const BEFORE_VIEW: readonly Command[] = [
  planned('open', FILE, 'document', 'folder-open'),
  planned('openSeveral', FILE, 'document', 'folder-tree'),
  planned('save', FILE, 'document', 'floppy-disk', true),
  planned('saveAs', FILE, 'document', 'file-arrow-down'),
  planned('print', FILE, 'document', 'print', true),
  planned('share', FILE, 'document', 'share-nodes'),
  planned('properties', FILE, 'document', 'circle-info'),
  planned('close', FILE, 'document', 'xmark'),
  planned('settings', FILE, 'document', 'gear'),

  planned('undo', EDIT, 'history', 'arrow-rotate-left', true),
  planned('redo', EDIT, 'history', 'arrow-rotate-right', true),
  planned('find', EDIT, 'find', 'magnifying-glass', true),
];

/** The tools, after View, in the order of `tools` in app.json. */
const AFTER_VIEW: readonly Command[] = [
  planned('createPdf', CREATE, 'create', 'file-circle-plus'),

  planned('rotateLeft', ORGANIZE, 'turnSelected', 'rotate-left'),
  planned('rotateRight', ORGANIZE, 'turnSelected', 'rotate-right'),
  planned('moveEarlier', ORGANIZE, 'order', 'arrow-left'),
  planned('moveLater', ORGANIZE, 'order', 'arrow-right'),
  planned('insertBlankPage', ORGANIZE, 'pages', 'file-circle-plus'),
  planned('insertPages', ORGANIZE, 'pages', 'folder-plus'),
  planned('replacePages', ORGANIZE, 'pages', 'right-left'),
  planned('extractPages', ORGANIZE, 'pages', 'file-export'),
  planned('splitDocument', ORGANIZE, 'pages', 'scissors'),
  planned('resizePages', ORGANIZE, 'pages', 'up-right-and-down-left-from-center'),
  planned('deletePages', ORGANIZE, 'pages', 'trash-can'),
  planned('copyPages', ORGANIZE, 'clipboard', 'copy'),
  planned('cutPages', ORGANIZE, 'clipboard', 'scissors'),
  planned('pastePages', ORGANIZE, 'clipboard', 'paste'),
  planned('rotateAllLeft', ORGANIZE, 'turnAll', 'rotate-all-left'),
  planned('rotateAllRight', ORGANIZE, 'turnAll', 'rotate-all-right'),
  planned('selectAll', ORGANIZE, 'selection', 'check-double'),
  planned('selectNone', ORGANIZE, 'selection', 'square'),
  planned('selectOdd', ORGANIZE, 'selection', 'file'),
  planned('selectEven', ORGANIZE, 'selection', 'book-open'),

  pen('edit', EDIT_TOOL, 'pens', 'select', 'arrow-pointer', 'pdf-organizer.command.select'),
  pen('edit', EDIT_TOOL, 'pens', 'edit', 'i-cursor', 'pdf-organizer.command.editText'),
  pen('edit', EDIT_TOOL, 'pens', 'text', 'font', 'pdf-organizer.command.addText'),
  planned('addImage', EDIT_TOOL, 'add', 'image'),
  pen('edit', EDIT_TOOL, 'add', 'link', 'link'),
  pen('edit', EDIT_TOOL, 'shapes', 'rectangle', 'vector-square'),
  pen('edit', EDIT_TOOL, 'shapes', 'ellipse', 'circle'),
  pen('edit', EDIT_TOOL, 'shapes', 'line', 'minus'),
  pen('edit', EDIT_TOOL, 'shapes', 'arrow', 'arrow-right-long'),
  planned('watermark', EDIT_TOOL, 'onPages', 'stamp'),
  planned('pageNumbers', EDIT_TOOL, 'onPages', 'list-ol'),
  planned('headerFooter', EDIT_TOOL, 'onPages', 'table-columns'),
  planned('batesNumbers', EDIT_TOOL, 'onPages', 'hashtag'),
  planned('cropPages', EDIT_TOOL, 'pageSize', 'crop-simple'),

  pen('comment', COMMENT, 'pens', 'select', 'arrow-pointer', 'pdf-organizer.command.select'),
  pen('comment', COMMENT, 'pens', 'highlight', 'highlighter'),
  pen('comment', COMMENT, 'pens', 'text', 'font', 'pdf-organizer.command.note'),
  pen('comment', COMMENT, 'pens', 'arrow', 'arrow-right-long'),
  pen('comment', COMMENT, 'pens', 'ellipse', 'circle'),
  pen('comment', COMMENT, 'more', 'bookmark', 'bookmark', 'pdf-organizer.command.addBookmark'),
  planned('attachFile', COMMENT, 'more', 'file-circle-check'),

  pen('sign', SIGN, 'fill', 'select', 'arrow-pointer', 'pdf-organizer.command.select'),
  pen('sign', SIGN, 'fill', 'text', 'font'),
  pen('sign', SIGN, 'fill', 'check', 'check'),
  pen('sign', SIGN, 'fill', 'cross', 'xmark'),
  pen('sign', SIGN, 'fill', 'dot', 'circle'),
  planned('fillForm', SIGN, 'fill', 'pen-to-square'),
  planned('signVisual', SIGN, 'sign', 'signature'),
  planned('signCertificate', SIGN, 'sign', 'certificate'),
  planned('timestamp', SIGN, 'sign', 'clock'),
  planned('verifySignatures', SIGN, 'verify', 'circle-check'),
  planned('signBatch', SIGN, 'verify', 'layer-group'),

  pen('form', FORM, 'pens', 'select', 'arrow-pointer', 'pdf-organizer.command.select'),
  pen('form', FORM, 'fields', 'textField', 'i-cursor'),
  pen('form', FORM, 'fields', 'checkBox', 'square-check'),
  pen('form', FORM, 'fields', 'radioButton', 'circle'),
  pen('form', FORM, 'fields', 'choiceField', 'rectangle-list'),
  pen('form', FORM, 'fields', 'signatureField', 'file-signature'),

  pen('protect', PROTECT, 'pens', 'select', 'arrow-pointer', 'pdf-organizer.command.select'),
  pen('protect', PROTECT, 'pens', 'redact', 'eraser', 'pdf-organizer.command.redact'),

  planned('newBinder', COMBINE, 'binder', 'layer-group'),
  planned('addFiles', COMBINE, 'binder', 'folder-plus'),
  planned('combineFiles', COMBINE, 'binder', 'object-group'),

  planned('exportAs', CONVERT, 'convert', 'right-left'),

  planned('ocr', OPTIMIZE, 'optimize', 'eye'),
  planned('compress', OPTIMIZE, 'optimize', 'compress'),

  planned('compare', COMPARE, 'compare', 'code-compare'),

  planned('batch', BATCH, 'batch', 'list-check'),

  // Panels beside the pages, at the end of View.
  planned('bookmarks', VIEW, 'window', 'bookmark'),
  planned('attachedFiles', VIEW, 'window', 'file-circle-check'),
];

/** What makes a planned command work: everything about it that is not fixed by the menu. */
type Working = Pick<Command, 'run'> & Partial<Pick<Command, 'disabled' | 'kind' | 'checked' | 'hintKey' | 'labelKey'>>;

/** Replaces placeholders by working commands, keeping their place, name and icon. */
function withWorking(commands: readonly Command[], working: Readonly<Record<string, Working>>): Command[] {
  return commands.map((command) => {
    const name = command.id.slice(commandId('').length);
    // A pen of a tool is named by its tool and its kind (`edit.text`).
    const real = working[name];
    return real ? { ...command, disabled: false, ...real } : command;
  });
}

/** The pens of the tools that draw on the page, each working: a pen is named `<tool>.<kind>`. */
function penWorking(markTool: MarkTool | null, onMark: (tool: MarkTool) => void, organizing: boolean): Record<string, Working> {
  const working: Record<string, Working> = {};
  for (const command of AFTER_VIEW) {
    const name = command.id.slice(commandId('').length);
    const match = /^(edit|comment|sign|form|protect)\.(\w+)$/.exec(name);
    if (!match) continue;
    const kind = match[2] as MarkTool;
    working[name] = { run: () => onMark(kind), checked: markTool === kind, disabled: organizing };
  }
  return working;
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
  readonly onMark: (tool: MarkTool) => void;
  /** The pen in hand, while the page is drawn on. */
  readonly markTool: MarkTool | null;
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
    addImage: { run: () => input.onInsert('image'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.addImage' },
    signVisual: { run: () => input.onInsert('signature'), disabled: organize.busy, hintKey: 'pdf-organizer.hint.signVisual' },
    ...penWorking(input.markTool, input.onMark, organize.organizing),
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
