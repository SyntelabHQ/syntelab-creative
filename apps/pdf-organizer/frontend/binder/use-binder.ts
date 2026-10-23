import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { nextNewName, openDraftTab, writeDraft } from '../document/drafts';
import { openAsPages, PAGE_SOURCES, pageSourceProblem } from '../document/page-sources';
import { binderFile, binderRequest, choosePages, moveFile, removeFile, totalPages } from './binder-model';
import type { BinderFile } from './binder-model';

export interface Binder {
  readonly files: readonly BinderFile[];
  /** Files are being read, or the combined file is being written. */
  readonly busy: boolean;
  /** Translation key of a problem to show, or null. */
  readonly problem: string | null;
  dismissProblem(): void;
  /** Asks for files and adds them as cards. */
  addFiles(): Promise<void>;
  /** Adds the files at these places as cards. */
  addPaths(paths: readonly string[]): Promise<void>;
  /** Shows a problem, by its translation key. */
  report(problemKey: string): void;
  remove(documentId: number): void;
  /** Moves the card at `from` just before the card now at `before`. */
  move(from: number, before: number): void;
  choosePages(documentId: number, pages: Iterable<number>): void;
  /** Writes the cards as one PDF and opens it in a tab, as a document not saved anywhere yet. */
  combine(): Promise<void>;
}

/**
 * The files of one binder tab. Each is opened on the Rust side (to count its
 * pages and show them) and closed again with its card or with the tab.
 */
export function useBinder(host: AppHost, firstPaths: readonly string[]): Binder {
  const t = useTranslation();
  const [files, setFiles] = useState<readonly BinderFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** True once the cards, as they are now, were written to a file. */
  const [combined, setCombined] = useState(false);
  const { invoke, pickFiles, setUnsavedChanges } = host;
  const openIds = useRef(new Set<number>());

  const close = useCallback(
    (documentId: number) => {
      openIds.current.delete(documentId);
      void invoke('close_document', { documentId }).catch(() => {});
    },
    [invoke],
  );

  const add = useCallback(
    async (paths: readonly string[]) => {
      if (paths.length === 0) return;
      setBusy(true);
      setProblem(null);
      for (const path of paths) {
        try {
          const opened = await openAsPages({ invoke }, path);
          openIds.current.add(opened.documentId);
          setFiles((current) => [...current, binderFile(opened, path)]);
          setCombined(false);
        } catch (error) {
          // The files that can be read are still added.
          setProblem(pageSourceProblem(error));
        }
      }
      setBusy(false);
    },
    [invoke],
  );

  // A binder started from files begins with those files.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || firstPaths.length === 0) return;
    started.current = true;
    void add(firstPaths);
  }, [add, firstPaths]);

  useEffect(() => {
    const ids = openIds.current;
    return () => {
      for (const documentId of ids) void invoke('close_document', { documentId }).catch(() => {});
    };
  }, [invoke]);

  // Cards gathered and not written anywhere yet are work that closing would lose.
  const unsaved = files.length > 0 && !combined;
  useEffect(() => setUnsavedChanges(unsaved), [setUnsavedChanges, unsaved]);

  const change = (next: readonly BinderFile[]) => {
    setFiles(next);
    setCombined(false);
  };

  return {
    files,
    busy,
    problem,
    dismissProblem: () => setProblem(null),
    addPaths: add,
    report: setProblem,
    addFiles: async () => {
      await add(await pickFiles({ typeName: t('pdf-organizer.open.pagesType'), extensions: [...PAGE_SOURCES], multiple: true }));
    },
    remove: (documentId) => {
      change(removeFile(files, documentId));
      close(documentId);
    },
    move: (from, before) => change(moveFile(files, from, before)),
    choosePages: (documentId, pages) => change(choosePages(files, documentId, pages)),
    combine: async () => {
      const first = files[0];
      if (!first || totalPages(files) === 0) return;
      setBusy(true);
      setProblem(null);
      try {
        // The new document gets a name by itself; the user chooses its place when saving it.
        const draft = await writeDraft({ invoke }, nextNewName(host), binderRequest(files), first.documentId);
        setCombined(true);
        openDraftTab(host, draft);
      } catch {
        setProblem('pdf-organizer.error.saveFailed');
      } finally {
        setBusy(false);
      }
    },
  };
}
