import { useTranslation } from '@syntelab/i18n';
import type { MessageValues } from '@syntelab/i18n';
import { AppInvokeError } from '@syntelab/shell-api';
import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pushHistory, redo, startHistory, undo } from '../document/history';
import type { History } from '../document/history';
import { openDraftTab, writeDraft } from '../document/drafts';
import { extractedEachName, extractedName, withoutExtension } from '../document/names';
import { openFileInTab } from '../document/open-file';
import { hasChanges, NO_CHANGES, withBookmarkEdit, withDetached } from '../document/document-changes';
import type { DocumentChanges } from '../document/document-changes';
import { openAsPages, PAGE_SOURCES, pageSourceProblem } from '../document/page-sources';
import { copyPages, pagesForAnother, useCopiedPages } from './page-clipboard';
import {
  deletePages,
  everySecondPage,
  insertPages,
  movePages,
  planFromDocument,
  planRequest,
  replacePages,
  rotatePages,
  samePlan,
  swapPages,
  withDocumentId,
  withMarks,
} from '../document/page-plan';
import type { PlanPage } from '../document/page-plan';
import type { Reshape } from '../document/page-shape';
import { printOptions, printPages } from '../document/print-pages';
import { partNumber } from '../document/split';
import type { OpenedDocument, PdfDocument } from '../document/use-document';
import { exportRequest } from '../export/export-formats';
import type { ExportChoice } from '../export/export-formats';
import type { Mark } from '../marks/mark';
import { loadSettings } from '../settings/organizer-settings';
import type { ExtractOptions } from './extract-dialog';

const NO_PAGES: readonly PlanPage[] = [];
const NONE: ReadonlySet<number> = new Set();

/** The page plan and its selection travel through undo and redo together. */
interface Step {
  readonly plan: readonly PlanPage[];
  readonly selected: ReadonlySet<number>;
}

/** Something that went well, to tell the user: a translation key and its values. */
export interface Notice {
  readonly key: string;
  readonly values?: MessageValues;
}

export interface Organizer {
  /** The pages as arranged now. */
  readonly plan: readonly PlanPage[];
  /** True when the plan differs from the file on disk. */
  readonly modified: boolean;
  /** True while the grid of pages is shown instead of the document. */
  readonly organizing: boolean;
  setOrganizing(organizing: boolean): void;
  readonly selected: ReadonlySet<number>;
  setSelected(selected: ReadonlySet<number>): void;
  /** The pages a command acts on: the selected ones while organizing, else the page in view. */
  readonly targets: ReadonlySet<number>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** A save or an insert is running. */
  readonly busy: boolean;
  /** Translation key of a problem to show, or null. */
  readonly problem: string | null;
  /** Good news to show (files were written…), or null. */
  readonly notice: Notice | null;
  /** Clears the problem and the notice. */
  dismissProblem(): void;
  undo(): void;
  redo(): void;
  rotate(degrees: 90 | -90): void;
  /** Turns every page of the document. */
  rotateAll(degrees: 90 | -90): void;
  remove(): void;
  /** Turns, or takes out, the pages at these places, whatever is selected. */
  rotateAt(indexes: readonly number[], degrees: 90 | -90): void;
  removeAt(indexes: readonly number[]): void;
  /** Remembers the target pages, to paste copies of them (in this document). `cut` also takes them out. */
  copy(): void;
  cut(): void;
  /** Puts copies of the remembered pages after the targets (or at the end); they may come from another open document. */
  paste(): void;
  /**
   * Asks where to save, writes `pages` (the plan, with what shows of the
   * signature drawn on its page) and signs the file with a certificate. The
   * signed file then takes this tab's place. Resolves to true when it was signed.
   * With `timeStamp`, the signature gets a time stamp from the authority at that
   * address; with `timeStampOnly` too, the document gets one of its own instead
   * of a signature, and no certificate is used.
   */
  signWith(
    pages: readonly PlanPage[] | null,
    signing: {
      certificate: unknown;
      place: { page: number; x: number; y: number; width: number; height: number } | null;
      reason: string;
      location: string;
      look: readonly unknown[];
      lock: boolean;
      timeStamp?: string | null;
      timeStampOnly?: boolean;
    },
  ): Promise<boolean>;
  /** Tells the user something went well, by its translation key. */
  note(key: string, values?: MessageValues): void;
  /** What is changed beside the pages when the document is saved: bookmarks renamed or removed, attached files taken out. */
  readonly changes: DocumentChanges;
  editBookmark(path: readonly number[], edit: { title?: string; remove?: boolean }): void;
  detachFile(name: string, detached: boolean): void;
  /** True when there are pages to paste. */
  readonly canPaste: boolean;
  /** Moves the selected pages just before the page now at `before`. */
  moveBefore(before: number): void;
  /** Moves the selected pages one place earlier (-1) or later (1). */
  nudge(direction: 1 | -1): void;
  select(which: 'all' | 'none' | 'odd' | 'even'): void;
  /** Asks for a PDF and adds its pages after the targets (or at the end). */
  insertFromFile(): Promise<void>;
  /** Adds an empty page after the targets (or at the end), the size of the page it comes after. */
  insertBlank(): Promise<void>;
  /** Asks for a PDF and puts its pages in place of the targets. */
  replaceFromFile(): Promise<void>;
  /** Asks for a folder and writes each part there as its own file. True when the files were written. */
  split(parts: readonly (readonly PlanPage[])[]): Promise<boolean>;
  /**
   * Changes pages on the Rust side (edges cut off, another sheet size, page
   * numbers, a watermark): the targets, or every page. A change that differs
   * from page to page is given as a function of the pages it is for. The
   * pages can also be named by their places in the document. Text the PDF's
   * own font cannot write is tried again as `whenLettersMissing` gives it (a
   * picture of the text). True when it was done.
   */
  reshape(
    change: Reshape | ((indexes: readonly number[]) => Reshape),
    scope: 'targets' | 'all' | readonly number[],
    options?: { readonly whenLettersMissing?: () => Reshape | null },
  ): Promise<boolean>;
  /** Shows a problem to the user, by its translation key. */
  report(problemKey: string): void;
  /**
   * Replaces what is drawn on one page (a step that can be undone). Changes
   * that follow each other closely under the same `coalesce` name (a slider
   * being dragged) count as one step.
   */
  setMarks(pageKey: string, marks: readonly Mark[], coalesce?: string): void;
  /** Replaces what is drawn on several pages at once (by page key), as one step that can be undone. */
  setMarksOnPages(marks: ReadonlyMap<string, readonly Mark[]>, coalesce?: string): void;
  /** Adds one mark to each of several pages (by page key), as one step that can be undone: a watermark. */
  addMarks(marks: ReadonlyMap<string, Mark>): void;
  /**
   * Asks where, then writes the document as a new, smaller file: its
   * photographs keep at most `longestSide` pixels (roughly) and are saved as
   * JPEG of that `quality`. `originalSize` is the size of the open file, to
   * tell the user what was gained. True when the file was written.
   */
  compress(shrink: { longestSide: number; quality: number }, originalSize: number): Promise<boolean>;
  /**
   * Asks where, then writes the document as it is now in another format
   * (pictures, text, a word processor document). True when it was written.
   */
  exportAs(choice: ExportChoice): Promise<boolean>;
  /** Prints the pages as arranged now. */
  print(): Promise<void>;
  /**
   * Offers the document to the system's share window: the file at `path`
   * when nothing was changed, else a copy with the changes in it (what was
   * redacted must never leave unredacted).
   */
  share(path: string): Promise<void>;
  /** Writes the plan over the document's own file. A document that has none yet is asked a place for, like "Save as". */
  save(): Promise<void>;
  /** Asks where, then writes the whole plan as a new file and opens it. */
  saveAs(): Promise<void>;
  /**
   * Takes the target pages out into a new tab, as a document that is not
   * saved anywhere yet (or each page into a tab of its own). They can leave
   * this document at the same time. True when it was done.
   */
  extract(options: ExtractOptions): Promise<boolean>;
}

function problemKey(error: unknown, fallback: string): string {
  if (error instanceof AppInvokeError && error.code === 'destination-in-use') {
    return 'pdf-organizer.error.destinationInUse';
  }
  if (error instanceof AppInvokeError && error.code === 'destination-exists') {
    return 'pdf-organizer.error.splitFilesExist';
  }
  return fallback;
}

/**
 * Everything "Organize pages" does. The user's changes live in a page plan
 * (order, turns, removed and added pages), with undo and redo; the file on
 * disk is never changed. Saving writes a new file from the plan.
 */
export function useOrganizer(
  host: AppHost,
  document: PdfDocument | null,
  currentPage: number,
  /** Called when the Rust side reopened the file under a new id (after saving over it). */
  onDocumentReopened: (opened: OpenedDocument) => PdfDocument,
  /** The form answers that go with a page when it is written; none when the document has no form. */
  answersFor?: (page: PlanPage) => readonly { id: number; value: string }[],
  /** The document is one of the program's own, not saved anywhere yet. */
  unsaved = false,
  /** Where the document's file is: pages copied here can then be pasted into another document. */
  path = '',
): Organizer {
  const t = useTranslation();
  const original = useMemo(
    () => (document ? planFromDocument(document.id, document.pageSizes) : NO_PAGES),
    [document],
  );
  const [history, setHistory] = useState<History<Step>>(() => startHistory({ plan: original, selected: NONE }));
  const [organizing, setOrganizing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  /** Documents opened only to take pages from; closed with the tab. */
  const borrowed = useRef<number[]>([]);
  const { invoke, pickFiles, pickFolder, pickSavePath, printImages, resourceUrl, shareFile } = host;

  /** The pages copied or cut, to be pasted; and how many copies were made, to tell them apart. */
  const copied = useCopiedPages();
  const setCopied = (pages: readonly PlanPage[]) => document && copyPages({ pages, documentId: document.id, path });
  const [changes, setChanges] = useState<DocumentChanges>(NO_CHANGES);
  const copyCount = useRef(0);

  /** The last change of marks that may still take in the next one: what it was, and when. */
  const lastMarkStep = useRef<{ key: string; at: number } | null>(null);

  /** A plan to carry over to the document that is about to be reopened. */
  const carried = useRef<readonly PlanPage[] | null>(null);

  // A (re)opened document starts with a clean plan, unless one was carried over to it.
  useEffect(() => {
    setHistory(startHistory({ plan: carried.current ?? original, selected: NONE }));
    // A file that was written has its changes in it; one that could not be keeps them waiting.
    if (!carried.current) setChanges(NO_CHANGES);
    carried.current = null;
  }, [original]);

  useEffect(
    () => () => {
      for (const documentId of borrowed.current) void invoke('close_document', { documentId }).catch(() => {});
    },
    [invoke],
  );

  const { plan, selected } = history.present;
  const targets = useMemo<ReadonlySet<number>>(() => {
    if (organizing) return selected;
    return plan.length > 0 ? new Set([Math.min(currentPage, plan.length - 1)]) : NONE;
  }, [organizing, selected, currentPage, plan.length]);

  const apply = useCallback(
    (next: readonly PlanPage[], nextSelected: ReadonlySet<number>) =>
      setHistory((current) => pushHistory(current, { plan: next, selected: nextSelected })),
    [],
  );

  // A new selection is not a step to undo: it replaces the present one.
  const setSelected = useCallback(
    (next: ReadonlySet<number>) => setHistory((current) => ({ ...current, present: { ...current.present, selected: next } })),
    [],
  );

  const moveBefore = useCallback(
    (before: number) => {
      if (selected.size === 0) return;
      const moved = movePages(plan, selected, before);
      if (!samePlan(moved.plan, plan)) apply(moved.plan, moved.chosen);
    },
    [plan, selected, apply],
  );

  /** Asks for a PDF, opens it to take pages from, and returns those pages; null when cancelled or unreadable. */
  const borrowPages = useCallback(async (): Promise<PlanPage[] | null> => {
    const [path] = await pickFiles({ typeName: t('pdf-organizer.open.pagesType'), extensions: [...PAGE_SOURCES] });
    if (!path) return null;
    setBusy(true);
    setProblem(null);
    try {
      const opened = await openAsPages({ invoke }, path);
      borrowed.current.push(opened.documentId);
      return planFromDocument(opened.documentId, opened.pageSizes);
    } catch (error) {
      setProblem(pageSourceProblem(error));
      return null;
    } finally {
      setBusy(false);
    }
  }, [invoke, pickFiles, t]);

  const first = selected.size > 0 ? Math.min(...selected) : 0;
  const last = selected.size > 0 ? Math.max(...selected) : 0;

  const write = useCallback(
    async (pages: readonly PlanPage[], suggestedKey: string): Promise<string | null> => {
      if (!document || pages.length === 0) return null;
      const destination = await pickSavePath({
        typeName: t('pdf-organizer.open.fileType'),
        extension: 'pdf',
        // A document that was never saved keeps the name it was given.
        suggestedName: unsaved ? document.fileName : `${t(suggestedKey, { name: withoutExtension(document.fileName) })}.pdf`,
      });
      if (destination === null) return null;
      setBusy(true);
      setProblem(null);
      try {
        // Changes beside the pages go with the whole document, not with a few pages taken out of it.
        await invoke('save_pages', { destination, baseDocumentId: document.id, pages: planRequest(pages, answersFor), ...(pages === plan ? { changes } : {}) });
        return destination;
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.saveFailed'));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [document, invoke, pickSavePath, t, unsaved, plan, changes],
  );

  const saveAs = async () => {
    const destination = await write(plan, 'pdf-organizer.save.suggestedCopy');
    if (destination === null) return;
    // The saved file takes this tab's place: it is now the document.
    openFileInTab(host, destination);
    host.closeTab({ discardChanges: true });
  };

  return {
    plan,
    modified: !samePlan(plan, original) || hasChanges(changes),
    changes,
    editBookmark: (bookmarkPath, edit) => setChanges((current) => withBookmarkEdit(current, bookmarkPath, edit)),
    detachFile: (name, detached) => setChanges((current) => withDetached(current, name, detached)),
    organizing,
    setOrganizing,
    selected,
    setSelected,
    targets,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    busy,
    problem,
    notice,
    dismissProblem: () => {
      setProblem(null);
      setNotice(null);
    },
    undo: () => setHistory(undo),
    redo: () => setHistory(redo),
    rotate: (degrees) => {
      if (targets.size > 0) apply(rotatePages(plan, targets, degrees), selected);
    },
    rotateAll: (degrees) => {
      if (plan.length > 0) apply(rotatePages(plan, new Set(plan.map((_, index) => index)), degrees), selected);
    },
    remove: () => {
      const next = deletePages(plan, targets);
      if (next.length !== plan.length) apply(next, NONE);
    },
    rotateAt: (indexes, degrees) => {
      if (indexes.length > 0) apply(rotatePages(plan, new Set(indexes), degrees), selected);
    },
    removeAt: (indexes) => {
      const next = deletePages(plan, new Set(indexes));
      if (next.length !== plan.length) apply(next, NONE);
    },
    signWith: async (pages, signing) => {
      if (!document) return false;
      const destination = await pickSavePath({
        typeName: t('pdf-organizer.open.fileType'),
        extension: 'pdf',
        suggestedName: `${t(signing.timeStampOnly ? 'pdf-organizer.timestamp.suggestedName' : 'pdf-organizer.sign.suggestedName', { name: withoutExtension(document.fileName) })}.pdf`,
      });
      if (destination === null) return false;
      setBusy(true);
      setProblem(null);
      setNotice(null);
      try {
        // Without pages, the file is signed as it is: the signature is added to its end.
        await invoke('sign_document', { destination, baseDocumentId: document.id, ...(pages ? { pages: planRequest(pages, answersFor), changes } : {}), ...signing });
      } catch (error) {
        const code = error instanceof AppInvokeError ? error.code : '';
        // Turning the PIN window away is no problem to report.
        if (code !== 'sign-cancelled') {
          const known: Record<string, string> = {
            'wrong-password': 'pdf-organizer.sign.wrongPassword',
            'no-certificate': 'pdf-organizer.sign.noCertificate',
            'document-locked': 'pdf-organizer.sign.locked',
            'certificates-unsupported': 'pdf-organizer.sign.unsupported',
            'time-stamp-failed': 'pdf-organizer.timestamp.failed',
            'time-stamp-address': 'pdf-organizer.timestamp.wrongAddress',
          };
          setProblem(known[code ?? ''] ?? problemKey(error, 'pdf-organizer.sign.failed'));
        }
        return false;
      } finally {
        setBusy(false);
      }
      // The signed file takes this tab's place: any change from here on would break the signature.
      openFileInTab(host, destination);
      host.closeTab({ discardChanges: true });
      return true;
    },
    copy: () => setCopied(plan.filter((_, index) => targets.has(index))),
    cut: () => {
      const next = deletePages(plan, targets);
      // A document keeps at least one page: all of them cannot be cut.
      if (next.length === plan.length) return;
      setCopied(plan.filter((_, index) => targets.has(index)));
      apply(next, NONE);
    },
    paste: () => {
      if (!copied || !document) return;
      const at = targets.size > 0 ? Math.max(...targets) + 1 : plan.length;
      // Each copy is a page of its own: it moves, turns and is drawn on apart from the one it was made from.
      const put = (pages: readonly PlanPage[]) => {
        const copies = pages.map((page) => ({ ...page, key: `${page.key}~${(copyCount.current += 1)}` }));
        if (copies.length > 0) apply(insertPages(plan, at, copies), new Set(copies.map((_, offset) => at + offset)));
      };
      if (copied.documentId === document.id) return put(copied.pages);
      // Copied in another document: its file is opened here too, to take the pages from.
      setBusy(true);
      setProblem(null);
      void openAsPages({ invoke }, copied.path)
        .then((opened) => {
          borrowed.current.push(opened.documentId);
          put(pagesForAnother(copied, opened.documentId));
        })
        .catch((error: unknown) => setProblem(pageSourceProblem(error)))
        .finally(() => setBusy(false));
    },
    canPaste: copied !== null && (copied.documentId === document?.id || copied.path !== ''),
    moveBefore,
    // One place earlier: before the page ahead of the first. One later: after the page behind the last.
    nudge: (direction) => moveBefore(direction === -1 ? first - 1 : last + 2),
    select: (which) => {
      if (which === 'all') setSelected(new Set(plan.map((_, index) => index)));
      else if (which === 'none') setSelected(NONE);
      else setSelected(everySecondPage(plan.length, which));
    },
    insertFromFile: async () => {
      const added = await borrowPages();
      if (!added) return;
      const at = targets.size > 0 ? Math.max(...targets) + 1 : plan.length;
      apply(insertPages(plan, at, added), new Set(added.map((_, offset) => at + offset)));
    },
    insertBlank: async () => {
      const after = targets.size > 0 ? Math.max(...targets) : plan.length - 1;
      const like = plan[after];
      if (!like) return;
      setBusy(true);
      setProblem(null);
      try {
        // A sheet like the page it comes after, lying as the reader sees that one.
        const sideways = like.rotation % 180 !== 0;
        const [width, height] = sideways ? [like.height, like.width] : [like.width, like.height];
        const { path } = await invoke<{ path: string }>('new_blank_draft', { name: 'blank-page.pdf', width, height, pages: 1 });
        const opened = await openAsPages({ invoke }, path);
        borrowed.current.push(opened.documentId);
        const added = planFromDocument(opened.documentId, opened.pageSizes);
        apply(insertPages(plan, after + 1, added), new Set(added.map((_, offset) => after + 1 + offset)));
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.saveFailed'));
      } finally {
        setBusy(false);
      }
    },
    replaceFromFile: async () => {
      if (targets.size === 0) return;
      const added = await borrowPages();
      if (!added) return;
      const replaced = replacePages(plan, targets, added);
      apply(replaced.plan, replaced.chosen);
    },
    split: async (parts) => {
      if (!document || parts.length < 2) return false;
      const folder = await pickFolder();
      if (folder === null) return false;
      setBusy(true);
      setProblem(null);
      setNotice(null);
      try {
        const name = withoutExtension(document.fileName);
        await invoke('split_document', {
          folder,
          baseDocumentId: document.id,
          parts: parts.map((pages, index) => ({
            fileName: `${t('pdf-organizer.split.fileName', { name, number: partNumber(index, parts.length) })}.pdf`,
            pages: planRequest(pages, answersFor),
          })),
        });
        setNotice({ key: 'pdf-organizer.split.done', values: { count: parts.length, folder } });
        return true;
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.saveFailed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    report: setProblem,
    note: (key, values) => {
      setProblem(null);
      setNotice({ key, values });
    },
    addMarks: (marks) => {
      if (marks.size === 0) return;
      const next = plan.map((page) => {
        const added = marks.get(page.key);
        return added ? { ...page, marks: [...(page.marks ?? []), added] } : page;
      });
      apply(next, selected);
    },
    setMarksOnPages: (marks, coalesce) => {
      if (marks.size === 0) return;
      let next = plan as PlanPage[];
      for (const [pageKey, ofPage] of marks) next = withMarks(next, pageKey, ofPage);
      const key = `several:${coalesce}`;
      const now = Date.now();
      const sameStep = coalesce !== undefined && lastMarkStep.current?.key === key && now - lastMarkStep.current.at < 1000;
      lastMarkStep.current = coalesce !== undefined ? { key, at: now } : null;
      if (sameStep) setHistory((current) => ({ ...current, present: { plan: next, selected } }));
      else apply(next, selected);
    },
    setMarks: (pageKey, marks, coalesce) => {
      const next = withMarks(plan, pageKey, marks);
      const key = `${pageKey}:${coalesce}`;
      const now = Date.now();
      const sameStep = coalesce !== undefined && lastMarkStep.current?.key === key && now - lastMarkStep.current.at < 1000;
      lastMarkStep.current = coalesce !== undefined ? { key, at: now } : null;
      if (sameStep) setHistory((current) => ({ ...current, present: { plan: next, selected } }));
      else apply(next, selected);
    },
    reshape: async (change, scope, options) => {
      const wanted = (index: number) => (scope === 'all' ? true : scope === 'targets' ? targets.has(index) : scope.includes(index));
      const indexes = plan.map((_, index) => index).filter(wanted);
      if (indexes.length === 0) return false;
      setBusy(true);
      setProblem(null);
      try {
        // The pages come back as a document of their own, shown in their place until the user saves.
        const pages = planRequest(
          indexes.map((index) => plan[index]).filter((page): page is PlanPage => page !== undefined),
          answersFor,
        );
        const ask = (request: Reshape) =>
          invoke<{ documentId: number; pageSizes: readonly number[] }>('reshape_pages', { pages, ...request });
        const reshaped = await ask(typeof change === 'function' ? change(indexes) : change).catch((error: unknown) => {
          const drawn =
            error instanceof AppInvokeError && error.code === 'letters-missing' ? options?.whenLettersMissing?.() : null;
          if (!drawn) throw error;
          return ask(drawn);
        });
        borrowed.current.push(reshaped.documentId);
        apply(swapPages(plan, indexes, planFromDocument(reshaped.documentId, reshaped.pageSizes)), selected);
        return true;
      } catch {
        setProblem('pdf-organizer.error.reshapeFailed');
        return false;
      } finally {
        setBusy(false);
      }
    },
    compress: async (shrinkPictures, originalSize) => {
      if (!document || plan.length === 0) return false;
      const destination = await pickSavePath({
        typeName: t('pdf-organizer.open.fileType'),
        extension: 'pdf',
        suggestedName: `${t('pdf-organizer.compress.suggestedName', { name: withoutExtension(document.fileName) })}.pdf`,
      });
      if (destination === null) return false;
      setBusy(true);
      setProblem(null);
      setNotice(null);
      try {
        const written = await invoke<{ fileSize: number }>('save_pages', {
          destination,
          baseDocumentId: document.id,
          pages: planRequest(plan, answersFor),
          shrinkPictures,
        });
        const megabytes = (bytes: number) => Math.max(bytes / (1024 * 1024), 0.01);
        const smaller = originalSize > 0 && written.fileSize < originalSize;
        setNotice({
          key: smaller ? 'pdf-organizer.compress.done' : 'pdf-organizer.compress.doneNoGain',
          values: {
            before: megabytes(originalSize),
            after: megabytes(written.fileSize),
            percent: originalSize > 0 ? Math.round((1 - written.fileSize / originalSize) * 100) : 0,
          },
        });
        return true;
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.saveFailed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
    exportAs: async (choice) => {
      if (!document || plan.length === 0) return false;
      const destination = await pickSavePath({
        typeName: t(`pdf-organizer.export.format.${choice.format}`),
        extension: choice.format,
        suggestedName: `${withoutExtension(document.fileName)}.${choice.format}`,
      });
      if (destination === null) return false;
      setBusy(true);
      setProblem(null);
      setNotice(null);
      try {
        const { files } = await invoke<{ files: string[] }>('export_document', {
          destination,
          baseDocumentId: document.id,
          pages: planRequest(plan, answersFor),
          ...exportRequest(choice),
        });
        const folder = destination.slice(0, Math.max(destination.lastIndexOf('/'), destination.lastIndexOf('\\')));
        setNotice({ key: 'pdf-organizer.export.done', values: { count: files.length, folder } });
        return true;
      } catch (error) {
        const exists = error instanceof AppInvokeError && error.code === 'destination-exists';
        setProblem(exists ? 'pdf-organizer.error.exportFilesExist' : 'pdf-organizer.error.exportFailed');
        return false;
      } finally {
        setBusy(false);
      }
    },
    print: async () => {
      if (plan.length === 0) return;
      setBusy(true);
      setProblem(null);
      let copy: number | null = null;
      try {
        let pages = plan;
        // Answers typed into a form and what was drawn on pages are not in any file yet: print a copy that has them.
        const requested = planRequest(plan, answersFor);
        if (document && requested.some((page) => page.answers || page.marks)) {
          const made = await invoke<{ documentId: number; pageSizes: readonly number[] }>('working_copy', {
            baseDocumentId: document.id,
            pages: requested,
          });
          copy = made.documentId;
          pages = planFromDocument(made.documentId, made.pageSizes);
        }
        await printImages(printPages({ resourceUrl }, pages), printOptions(loadSettings(host)));
      } catch {
        setProblem('pdf-organizer.error.printFailed');
      } finally {
        if (copy !== null) void invoke('close_document', { documentId: copy }).catch(() => {});
        setBusy(false);
      }
    },
    share: async (path) => {
      setProblem(null);
      try {
        const requested = planRequest(plan, answersFor);
        const changed = !samePlan(plan, original) || requested.some((page) => page.answers);
        // What is shared is the document as it is now, not the file as it was last saved.
        const shared = document && changed ? await writeDraft({ invoke }, document.fileName, requested, document.id) : path;
        await shareFile(shared);
      } catch {
        setProblem('pdf-organizer.error.shareFailed');
      }
    },
    save: async () => {
      if (!document) return;
      if (unsaved) return saveAs();
      setBusy(true);
      setProblem(null);
      try {
        const answer = await invoke<OpenedDocument & { saved: boolean }>('save_document', {
          documentId: document.id,
          pages: planRequest(plan, answersFor),
          changes,
        });
        if (!answer.saved) {
          // The file is as it was; keep the user's arrangement on the reopened document.
          carried.current = withDocumentId(plan, document.id, answer.documentId);
          setProblem('pdf-organizer.error.fileBusy');
        }
        onDocumentReopened(answer);
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.saveFailed'));
      } finally {
        setBusy(false);
      }
    },
    saveAs,
    extract: async ({ removeFromSource, separate }) => {
      const pages = plan.filter((_, index) => targets.has(index));
      if (!document || pages.length === 0) return false;
      setBusy(true);
      setProblem(null);
      try {
        const settings = loadSettings(host);
        const parts = separate ? pages.map((page) => [page]) : [pages];
        const drafts: string[] = [];
        for (const [index, part] of parts.entries()) {
          const name = separate
            ? extractedEachName(settings.extractEachName, document.fileName, index + 1)
            : extractedName(settings.extractName, document.fileName);
          drafts.push(await writeDraft({ invoke }, name, planRequest(part, answersFor), document.id));
        }
        // All written: only now do tabs open and pages leave.
        for (const draft of drafts) openDraftTab(host, draft);
        if (removeFromSource && pages.length < plan.length) apply(deletePages(plan, targets), NONE);
        return true;
      } catch (error) {
        setProblem(problemKey(error, 'pdf-organizer.error.extractFailed'));
        return false;
      } finally {
        setBusy(false);
      }
    },
  };
}

/** Whether the selection can still move one place earlier or later. */
export function canNudge(organizer: Organizer): { earlier: boolean; later: boolean } {
  const { selected, plan, organizing } = organizer;
  if (!organizing || selected.size === 0) return { earlier: false, later: false };
  // A block already at an end, with no gaps, has nowhere to go.
  const sorted = [...selected].sort((a, b) => a - b);
  const contiguous = sorted.every((index, offset) => index === (sorted[0] ?? 0) + offset);
  return {
    earlier: !contiguous || (sorted[0] ?? 0) > 0,
    later: !contiguous || (sorted[sorted.length - 1] ?? 0) < plan.length - 1,
  };
}
