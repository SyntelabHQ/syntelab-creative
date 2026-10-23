/**
 * A binder: files gathered to be written as one PDF. Each file is a card; the
 * user orders the cards and, for each, chooses which pages go in.
 */
export interface BinderFile {
  /** The open document the pages are read from; also what tells two cards apart. */
  readonly documentId: number;
  readonly path: string;
  readonly fileName: string;
  /** `[width0, height0, width1, height1, …]` in PDF points. */
  readonly pageSizes: readonly number[];
  /** The pages that go in, as page numbers from 0, in the order of the file. */
  readonly chosen: readonly number[];
}

export function pageCountOf(file: BinderFile): number {
  return file.pageSizes.length / 2;
}

/** A newly added file: all of its pages go in. */
export function binderFile(opened: { documentId: number; fileName: string; pageSizes: readonly number[] }, path: string): BinderFile {
  const pageCount = opened.pageSizes.length / 2;
  return { ...opened, path, chosen: Array.from({ length: pageCount }, (_, page) => page) };
}

/** Moves the card at `from` so that it comes just before the card now at `before`. */
export function moveFile(files: readonly BinderFile[], from: number, before: number): BinderFile[] {
  const moved = files[from];
  if (!moved) return [...files];
  const rest = files.filter((_, index) => index !== from);
  const target = Math.min(Math.max(before > from ? before - 1 : before, 0), rest.length);
  return [...rest.slice(0, target), moved, ...rest.slice(target)];
}

export function removeFile(files: readonly BinderFile[], documentId: number): BinderFile[] {
  return files.filter((file) => file.documentId !== documentId);
}

/** Sets which pages of one file go in. They are kept in the order of the file. */
export function choosePages(files: readonly BinderFile[], documentId: number, pages: Iterable<number>): BinderFile[] {
  return files.map((file) => {
    if (file.documentId !== documentId) return file;
    const wanted = new Set(pages);
    return { ...file, chosen: Array.from({ length: pageCountOf(file) }, (_, page) => page).filter((page) => wanted.has(page)) };
  });
}

export function totalPages(files: readonly BinderFile[]): number {
  return files.reduce((sum, file) => sum + file.chosen.length, 0);
}

/** What the Rust side needs to write the binder as one file (`save_pages`). */
export function binderRequest(files: readonly BinderFile[]): { documentId: number; page: number; rotation: 0 }[] {
  return files.flatMap((file) => file.chosen.map((page) => ({ documentId: file.documentId, page, rotation: 0 as const })));
}
