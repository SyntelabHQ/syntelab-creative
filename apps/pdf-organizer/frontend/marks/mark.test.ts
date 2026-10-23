import { describe, expect, it } from 'vitest';
import { arrowHead, canBeWrittenAsText, centerOf, colorParts, DEFAULT_STYLE, drawMark, fitTextBox, markRequest, resizeMark, restyle, turnPoint } from './mark';
import type { Mark } from './mark';

const box = (over: Partial<Mark> = {}): Mark => ({
  id: 'a',
  kind: 'rectangle',
  x: 100,
  y: 100,
  width: 80,
  height: 40,
  rotation: 0,
  stroke: '#000000',
  fill: null,
  opacity: 1,
  lineWidth: 1,
  ...over,
});
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 4);

describe('drawMark', () => {
  it('makes a box from a drag in any direction', () => {
    const mark = drawMark('rectangle', DEFAULT_STYLE, { x: 50, y: 80 }, { x: 20, y: 30 });
    expect([mark.x, mark.y, mark.width, mark.height]).toEqual([20, 30, 30, 50]);
    // A line and no filling, unless asked otherwise.
    expect(mark.stroke).toBe(DEFAULT_STYLE.stroke);
    expect(mark.fill).toBeNull();
  });

  it('keeps the direction of a line', () => {
    const mark = drawMark('arrow', DEFAULT_STYLE, { x: 50, y: 80 }, { x: 20, y: 30 });
    expect([mark.x, mark.y, mark.width, mark.height]).toEqual([50, 80, -30, -50]);
  });

  it('gives a click a usable size, around the place clicked', () => {
    const tick = drawMark('check', DEFAULT_STYLE, { x: 50, y: 50 }, { x: 50, y: 50 });
    expect([tick.x, tick.y, tick.width, tick.height]).toEqual([42, 42, 16, 16]);
  });

  it('never makes a shape that cannot be seen', () => {
    const none = { ...DEFAULT_STYLE, stroke: null, fill: null };
    expect(drawMark('rectangle', none, { x: 0, y: 0 }, { x: 9, y: 9 }).stroke).toBe('#000000');
    expect(restyle(box({ fill: '#ff0000' }), { stroke: null }).stroke).toBeNull();
    expect(restyle(box(), { stroke: null }).stroke).toBe('#000000');
  });

  it('highlights see-through, in the highlight color', () => {
    const mark = drawMark('highlight', DEFAULT_STYLE, { x: 0, y: 0 }, { x: 60, y: 12 });
    expect(mark.fill).toBe('#ffeb00');
    expect(mark.stroke).toBeNull();
    expect(mark.opacity).toBeLessThan(0.5);
  });
});

describe('resizeMark', () => {
  it('pulls a corner and keeps the opposite one', () => {
    const resized = resizeMark(box(), 'se', { x: 200, y: 170 });
    expect([resized.x, resized.y, resized.width, resized.height]).toEqual([100, 100, 100, 70]);
    const other = resizeMark(box(), 'nw', { x: 90, y: 80 });
    expect([other.x, other.y, other.width, other.height]).toEqual([90, 80, 90, 60]);
  });

  it('pulls a side without changing the other dimension', () => {
    const resized = resizeMark(box(), 'e', { x: 220, y: 5 });
    expect([resized.x, resized.y, resized.width, resized.height]).toEqual([100, 100, 120, 40]);
  });

  it('keeps the opposite corner of a turned box where it is', () => {
    const turned = box({ rotation: 30 });
    const before = turnPoint({ x: turned.x, y: turned.y }, centerOf(turned), 30);
    const resized = resizeMark(turned, 'se', { x: 230, y: 190 });
    const after = turnPoint({ x: resized.x, y: resized.y }, centerOf(resized), 30);
    close(after.x, before.x);
    close(after.y, before.y);
    // And the dragged corner is under the pointer.
    const corner = turnPoint({ x: resized.x + resized.width, y: resized.y + resized.height }, centerOf(resized), 30);
    close(corner.x, 230);
    close(corner.y, 190);
  });

  it('moves one end of a line', () => {
    const line = box({ kind: 'line', x: 10, y: 10, width: 50, height: 0 });
    expect(resizeMark(line, 'end', { x: 30, y: 40 })).toMatchObject({ x: 10, y: 10, width: 20, height: 30 });
    expect(resizeMark(line, 'start', { x: 0, y: 5 })).toMatchObject({ x: 0, y: 5, width: 60, height: 5 });
  });

  it('turns toward the pointer and settles on round angles', () => {
    expect(resizeMark(box(), 'turn', { x: 300, y: 120 }).rotation).toBe(90);
    expect(resizeMark(box(), 'turn', { x: 140, y: 400 }).rotation).toBe(180);
    expect(resizeMark(box(), 'turn', { x: 142, y: 0 }).rotation).toBe(0);
  });
});

describe('what the Rust side gets', () => {
  it('colors from 0 to 1', () => {
    expect(colorParts('#ff0080')).toEqual([1, 0, 0.502]);
    expect(colorParts('nonsense')).toEqual([0, 0, 0]);
  });

  it('a mark with what its kind needs', () => {
    expect(markRequest(box({ fill: '#0000ff', rotation: 15 }))).toMatchObject({ kind: 'rectangle', stroke: [0, 0, 0], fill: [0, 0, 1], rotation: 15 });
    const text = markRequest(box({ kind: 'text', text: 'Hi', font: 'serif', bold: true, size: 20 }));
    expect(text).toMatchObject({ text: 'Hi', font: 'serif', bold: true, italic: false, size: 20 });
    expect(markRequest(box({ kind: 'picture', data: 'data:image/png;base64,QUJD' })).data).toBe('QUJD');
  });

  it('the same arrow head as it draws', () => {
    expect(arrowHead(1, 100)).toEqual({ length: 8, halfWidth: 8 * 0.38 });
    expect(arrowHead(5, 6).length).toBe(6);
  });
});

describe('text', () => {
  it('fits its box to its lines', () => {
    const fitted = fitTextBox(box({ kind: 'text', text: 'one\nlonger line', size: 10 }), (line) => line.length * 5);
    expect(fitted.width).toBe(55);
    expect(fitted.height).toBe(25);
  });

  it('knows what the fonts can write', () => {
    expect(canBeWrittenAsText('Ștampilă, 100 € — „da”')).toBe(true);
    expect(canBeWrittenAsText('Привет, Ελλάδα')).toBe(true);
    expect(canBeWrittenAsText('مرحبا')).toBe(false);
    expect(canBeWrittenAsText('日本語')).toBe(false);
  });
});
