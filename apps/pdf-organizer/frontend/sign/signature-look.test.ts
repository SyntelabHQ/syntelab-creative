import { describe, expect, it } from 'vitest';
import type { Mark } from '../marks/mark';
import { signatureLook } from './signature-look';

// Half a letter size wide per letter of the longest line, a line and a quarter tall per line.
const fitted = (mark: Mark): Mark => {
  const lines = (mark.text ?? '').split('\n');
  return { ...mark, width: Math.max(...lines.map((line) => line.length)) * (mark.size ?? 0) * 0.5, height: lines.length * (mark.size ?? 0) * 1.25 };
};
const box = { width: 200, height: 60 };
const stamp = { address: 'data:image/png;base64,AA', width: 300, height: 300 };

describe('signatureLook', () => {
  it('writes the lines alone across the whole box, from its left', () => {
    const [text, ...rest] = signatureLook(box, 0, null, ['Signed by', 'Ana Popescu'], fitted, 's');
    expect(rest).toHaveLength(0);
    expect(text).toMatchObject({ kind: 'text', text: 'Signed by\nAna Popescu', rotation: 0 });
    expect(text?.x).toBeGreaterThanOrEqual(0);
    expect((text?.x ?? 0) + (text?.width ?? 0)).toBeLessThanOrEqual(200);
    expect((text?.y ?? 0) + (text?.height ?? 0) / 2).toBeCloseTo(30);
  });

  it('puts a picture at the left and the lines at the right', () => {
    const [picture, text] = signatureLook(box, 0, stamp, ['Ana Popescu'], fitted, 's');
    // The picture keeps its shape, inside the left half.
    expect(picture).toMatchObject({ kind: 'picture', data: stamp.address });
    expect(picture?.width).toBeCloseTo(picture?.height ?? 0);
    expect((picture?.x ?? 0) + (picture?.width ?? 0)).toBeLessThanOrEqual(100);
    expect(text?.x).toBeGreaterThanOrEqual((picture?.x ?? 0) + (picture?.width ?? 0));
    expect((text?.x ?? 0) + (text?.width ?? 0)).toBeLessThanOrEqual(200);
  });

  it('gives the text the room a picture does not need', () => {
    // A square stamp in a box 200 × 60 needs about 60 across, not half the box.
    const [picture, text] = signatureLook(box, 0, stamp, ['Ana Popescu'], fitted, 's');
    expect((picture?.x ?? 0) + (picture?.width ?? 0)).toBeLessThan(70);
    expect(text?.x).toBeLessThan(80);
  });

  it('breaks a long line in two when that makes the letters larger', () => {
    const [text] = signatureLook(box, 0, null, ['Digitally signed by Ana Maria Popescu Ionescu'], fitted, 's');
    const [whole] = signatureLook({ width: 2000, height: 60 }, 0, null, ['Digitally signed by Ana Maria Popescu Ionescu'], fitted, 's');
    expect(text?.text?.split('\n').length).toBeGreaterThan(1);
    expect(whole?.text).toBe('Digitally signed by Ana Maria Popescu Ionescu');
  });

  it('lets a picture alone fill the box', () => {
    const [picture, ...rest] = signatureLook(box, 0, { ...stamp, width: 600 }, [], fitted, 's');
    expect(rest).toHaveLength(0);
    expect((picture?.x ?? 0) + (picture?.width ?? 0) / 2).toBeCloseTo(100);
    expect(picture?.width).toBeGreaterThan(100);
  });

  it('makes the letters smaller for a long line', () => {
    const [short] = signatureLook(box, 0, null, ['Ana'], fitted, 's');
    const [long] = signatureLook(box, 0, null, ['A very long name that would not fit in the box as it is'], fitted, 's');
    expect(long?.size).toBeLessThan(short?.size ?? 0);
    expect(long?.width).toBeLessThanOrEqual(200);
  });

  it('stands upright for the reader on a page shown turned', () => {
    const [text] = signatureLook(box, 90, null, ['Ana Popescu'], fitted, 's');
    expect(text?.rotation).toBe(270);
    // The reader sees a room 60 wide: the line must fit that.
    expect(text?.width).toBeLessThanOrEqual(60);
    // Still inside the box, whose own grid lies turned under what the reader sees.
    const middle = { x: (text?.x ?? 0) + (text?.width ?? 0) / 2, y: (text?.y ?? 0) + (text?.height ?? 0) / 2 };
    expect(middle.x).toBeGreaterThan(0);
    expect(middle.x).toBeLessThan(200);
    expect(middle.y).toBeGreaterThan(0);
    expect(middle.y).toBeLessThan(60);
  });

  it('shows nothing when there is nothing to show', () => {
    expect(signatureLook(box, 0, null, ['', ' '], fitted, 's')).toHaveLength(0);
  });
});
