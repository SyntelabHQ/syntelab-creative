import { describe, expect, it } from 'vitest';
import { binderFile, binderRequest, choosePages, moveFile, removeFile, totalPages } from './binder-model';

const file = (documentId: number, pages: number) =>
  binderFile({ documentId, fileName: `${documentId}.pdf`, pageSizes: new Array<number>(pages * 2).fill(100) }, `C:/${documentId}.pdf`);
const ids = (files: readonly { documentId: number }[]) => files.map((item) => item.documentId);

describe('binder', () => {
  const files = [file(1, 3), file(2, 2), file(3, 1)];

  it('takes every page of a file that was just added', () => {
    expect(file(1, 3).chosen).toEqual([0, 1, 2]);
    expect(totalPages(files)).toBe(6);
  });

  it('moves a card before another one, or to the end', () => {
    expect(ids(moveFile(files, 2, 0))).toEqual([3, 1, 2]);
    expect(ids(moveFile(files, 0, 2))).toEqual([2, 1, 3]);
    expect(ids(moveFile(files, 0, 3))).toEqual([2, 3, 1]);
    expect(ids(moveFile(files, 1, 1))).toEqual([1, 2, 3]);
    expect(ids(moveFile(files, 9, 0))).toEqual([1, 2, 3]);
  });

  it('keeps the chosen pages in the order of the file', () => {
    const chosen = choosePages(files, 1, [2, 0, 7]);
    expect(chosen[0]?.chosen).toEqual([0, 2]);
    expect(chosen[1]?.chosen).toEqual([0, 1]);
  });

  it('writes the cards in order, each with its chosen pages', () => {
    const arranged = moveFile(choosePages(removeFile(files, 2), 1, [1]), 1, 0);
    expect(binderRequest(arranged)).toEqual([
      { documentId: 3, page: 0, rotation: 0 },
      { documentId: 1, page: 1, rotation: 0 },
    ]);
  });
});
