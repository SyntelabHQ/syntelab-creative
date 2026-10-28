import { describe, expect, it } from 'vitest';
import type { Mark } from './mark';
import { placedMarks } from './placing';
import type { Placing } from './placing';

// Half a letter size wide per letter, a line and a quarter tall.
const fitted = (mark: Mark): Mark => ({ ...mark, width: (mark.text ?? '').length * (mark.size ?? 0) * 0.5, height: (mark.size ?? 0) * 1.25 });
let made = 0;
const newId = () => `m${(made += 1)}`;
const picture: Placing = { kind: 'picture', data: 'data:image/png;base64,AA', width: 400, height: 100 };

describe('placedMarks', () => {
  it('makes a picture as wide as the drag, keeping its shape', () => {
    const [mark] = placedMarks(picture, { x: 100, y: 100 }, { x: 300, y: 400 }, 0, fitted, newId);
    expect(mark).toMatchObject({ kind: 'picture', width: 200, height: 50, x: 100, y: 225, rotation: 0 });
  });

  it('lets the height of the drag limit it', () => {
    const [mark] = placedMarks(picture, { x: 100, y: 100 }, { x: 500, y: 120 }, 0, fitted, newId);
    expect(mark).toMatchObject({ width: 80, height: 20 });
  });

  it('puts it at a usual size where the page was clicked', () => {
    const [mark] = placedMarks(picture, { x: 200, y: 300 }, { x: 201, y: 300 }, 0, fitted, newId);
    expect(mark).toMatchObject({ width: 150, height: 37.5, x: 125, y: 281.25 });
  });

  it('stands upright for the reader on a page shown turned', () => {
    // Shown a quarter turned, a drag down the page's own grid goes across for the reader.
    const [mark] = placedMarks(picture, { x: 100, y: 100 }, { x: 130, y: 300 }, 90, fitted, newId);
    expect(mark).toMatchObject({ width: 120, rotation: 270 });
  });

  it('makes the paper clip of an attached file as large as the drag, or of the usual size from a click', () => {
    const file: Placing = { kind: 'attachment', path: 'C:/offer.docx', name: 'offer.docx', author: '' };
    const [dragged] = placedMarks(file, { x: 100, y: 100 }, { x: 132, y: 144 }, 0, fitted, newId);
    expect(dragged).toMatchObject({ kind: 'attachment', width: 32, height: 44, x: 100, y: 100 });
    const [clicked] = placedMarks(file, { x: 100, y: 100 }, { x: 101, y: 100 }, 0, fitted, newId);
    expect(clicked).toMatchObject({ width: 16, height: 22, x: 92, y: 89 });
  });

  it('sizes typed words to the drag', () => {
    const typed: Placing = { kind: 'text', text: 'Ana Pop', font: 'serif', bold: false, italic: true, color: '#102a83' };
    const [mark] = placedMarks(typed, { x: 0, y: 0 }, { x: 140, y: 30 }, 0, fitted, newId);
    // Seven letters, half a size each: 140 wide at size 40.
    expect(mark).toMatchObject({ kind: 'text', text: 'Ana Pop', size: 40, width: 140, italic: true, stroke: '#102a83' });
  });

  it('writes the date under it, from its left edge', () => {
    const [mark, date] = placedMarks({ ...picture, date: '10.10.2026' }, { x: 100, y: 100 }, { x: 300, y: 400 }, 0, fitted, newId);
    expect(date).toMatchObject({ kind: 'text', text: '10.10.2026', x: mark?.x });
    expect(date?.y).toBeGreaterThan((mark?.y ?? 0) + (mark?.height ?? 0));
  });
});
