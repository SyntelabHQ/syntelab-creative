import type { AppHost } from '@syntelab/shell-api';
import { useEffect, useState } from 'react';
import type { PlanPage } from '../document/page-plan';
import type { Mark } from './mark';

/** A picture a page of the document has, as the Rust side finds it (`page_pictures`). */
export interface PagePicture {
  /** Its place among the pictures of its page: what `page_picture` asks for. */
  readonly number: number;
  /** In points, from the top-left corner of the page as it lies in its file. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const NO_PICTURES: readonly PagePicture[] = [];
/** Pictures already found, by `documentId:page`; a document's pages do not change while it is open. */
const known = new Map<string, readonly PagePicture[]>();

/**
 * Where the pictures of the pages shown are, while `wanted` (the tool that
 * edits the document's own content is in use). A page whose pictures are not
 * found yet has none.
 */
export function usePagePictures(host: Pick<AppHost, 'invoke'>, pages: readonly PlanPage[], wanted: boolean): (page: PlanPage) => readonly PagePicture[] {
  const [, setRead] = useState(0);
  const { invoke } = host;
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    for (const page of pages) {
      const key = `${page.documentId}:${page.page}`;
      if (known.has(key)) continue;
      // Marked at once, so the same page is not asked for twice.
      known.set(key, NO_PICTURES);
      void invoke<{ pictures: Omit<PagePicture, 'number'>[] }>('page_pictures', { documentId: page.documentId, page: page.page }).then(
        (answer) => {
          known.set(
            key,
            answer.pictures.map((picture, number) => ({ ...picture, number })),
          );
          if (!cancelled) setRead((count) => count + 1);
        },
        () => known.delete(key),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [invoke, pages, wanted]);
  return (page) => (wanted ? (known.get(`${page.documentId}:${page.page}`) ?? NO_PICTURES) : NO_PICTURES);
}

/**
 * What picking a picture of the document up takes: a mark that takes it out
 * of the file (shown as blank paper over it until then), and the same
 * picture as a mark in its place, to be moved, resized, turned or deleted.
 * `data` is the picture as a `data:` address.
 */
export function takePicture(picture: PagePicture, data: string, id: string): { erase: Mark; taken: Mark } {
  const { x, y, width, height } = picture;
  const base = { x, y, width, height, rotation: 0, opacity: 1, lineWidth: 1, stroke: null, fill: null };
  return { erase: { ...base, id: `${id}-erase`, kind: 'erasePicture' }, taken: { ...base, id: `${id}-picture`, kind: 'picture', data } };
}

/** True for a picture already taken out by a mark of the page: it is not offered again. */
export function isTaken(picture: PagePicture, marks: readonly Mark[]): boolean {
  const [centerX, centerY] = [picture.x + picture.width / 2, picture.y + picture.height / 2];
  return marks.some((mark) => mark.kind === 'erasePicture' && centerX >= mark.x && centerX <= mark.x + mark.width && centerY >= mark.y && centerY <= mark.y + mark.height);
}
