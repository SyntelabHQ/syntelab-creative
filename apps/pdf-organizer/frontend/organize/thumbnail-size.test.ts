import { describe, expect, it } from 'vitest';
import { binderCommands } from '../commands';
import type { FileCommandsInput } from '../commands';
import { DEFAULT_SETTINGS, readSettings } from '../settings/organizer-settings';
import { cellSize, scrollAfterResize } from './page-grid';
import {
  DEFAULT_BINDER_THUMBNAIL_SIZE,
  DEFAULT_ORGANIZE_THUMBNAIL_SIZE,
  MAX_THUMBNAIL_SIZE,
  MIN_THUMBNAIL_SIZE,
  sharpScale,
  snapThumbnailSize,
  stepThumbnailSize,
  wheelSteps,
} from './thumbnail-size';

describe('thumbnail size', () => {
  it('goes in steps of 16 pixels, from 64 to 320', () => {
    expect(snapThumbnailSize(130, 0)).toBe(128);
    expect(snapThumbnailSize(10, 0)).toBe(MIN_THUMBNAIL_SIZE);
    expect(snapThumbnailSize(9000, 0)).toBe(MAX_THUMBNAIL_SIZE);
    expect(snapThumbnailSize('large', 112)).toBe(112);
    expect(snapThumbnailSize(Number.NaN, 112)).toBe(112);
    expect(stepThumbnailSize(128, 1)).toBe(144);
    expect(stepThumbnailSize(128, -2)).toBe(96);
    expect(stepThumbnailSize(MAX_THUMBNAIL_SIZE, 1)).toBe(MAX_THUMBNAIL_SIZE);
    expect(stepThumbnailSize(MIN_THUMBNAIL_SIZE, -1)).toBe(MIN_THUMBNAIL_SIZE);
  });

  it('starts smaller on a binder than the cards once were, and is remembered per view', () => {
    expect(DEFAULT_BINDER_THUMBNAIL_SIZE).toBeLessThan(170);
    expect(DEFAULT_SETTINGS.binderThumbnailSize).toBe(DEFAULT_BINDER_THUMBNAIL_SIZE);
    expect(DEFAULT_SETTINGS.organizeThumbnailSize).toBe(DEFAULT_ORGANIZE_THUMBNAIL_SIZE);
    expect(readSettings({ organizeThumbnailSize: 200, binderThumbnailSize: 'x' })).toMatchObject({ organizeThumbnailSize: 208, binderThumbnailSize: DEFAULT_BINDER_THUMBNAIL_SIZE });
  });

  it('turns a notch of the wheel into a step, and adds up small movements', () => {
    expect(wheelSteps(0, -100)).toEqual({ steps: 1, rest: 0 });
    expect(wheelSteps(0, 100)).toEqual({ steps: -1, rest: 0 });
    expect(wheelSteps(0, 250)).toEqual({ steps: -2, rest: -50 });
    // A touchpad: small movements, one step once they make a notch.
    let rest = 0;
    let steps = 0;
    for (let i = 0; i < 10; i++) {
      const turned = wheelSteps(rest, -15);
      rest = turned.rest;
      steps += turned.steps;
    }
    expect(steps).toBe(1);
    expect(rest).toBe(50);
    // Turning back forgets what was gathered the other way.
    expect(wheelSteps(50, 40)).toEqual({ steps: 0, rest: -40 });
  });

  it('uses the stored thumbnail while it is sharp enough, and asks for a few sizes of sharper picture', () => {
    // An A4 page: 595 × 842 points; the thumbnail is 240 pixels wide.
    expect(sharpScale(128, 595, 842, 1)).toBeNull();
    expect(sharpScale(128, 595, 842, 2)).toBeNull();
    expect(sharpScale(320, 595, 842, 1)).toBeNull();
    const scale = sharpScale(320, 595, 842, 2);
    expect(scale).not.toBeNull();
    // At least as many pixels as shown, in steps of 64.
    expect((scale ?? 0) * 595).toBeGreaterThanOrEqual((320 * 595 * 2) / 842);
    expect(sharpScale(336, 595, 842, 2)).toBe(scale);
    // A wide page is shown wider for the same size.
    expect(sharpScale(240, 842, 595, 1.5)).not.toBeNull();
  });
});

describe('page grid', () => {
  it('makes a cell exactly as tall as the picture, the page number and the padding', () => {
    expect(cellSize(128)).toEqual({ width: 148, height: 180 });
  });

  it('keeps the page at the top in view when the rows change', () => {
    const before = { rowHeight: 180, columns: 4 };
    // The top of the fourth row (pages 13 to 16), by 10 pixels.
    const top = 20 + 3 * (180 + 12) + 10;
    // Twice as many pages a row: page 13 is in the second row.
    const after = { rowHeight: 100, columns: 8 };
    expect(scrollAfterResize(top, before, after)).toBeCloseTo(20 + 1 * (100 + 12) + (10 / 180) * 100);
    expect(scrollAfterResize(5, before, after)).toBe(5);
  });
});

describe('zoom commands', () => {
  it('change the size of the thumbnails on a binder', () => {
    const steps: number[] = [];
    const files = { onOpen: () => {} } as unknown as FileCommandsInput;
    const input = { files, onAddFiles: () => {}, onCombine: () => {}, canCombine: true, busy: false };
    const commands = binderCommands({ ...input, thumbnailZoom: { size: 128, onStep: (step) => steps.push(step) } });
    const zoomIn = commands.find((command) => command.id === 'pdf-organizer.zoomIn');
    const zoomOut = commands.find((command) => command.id === 'pdf-organizer.zoomOut');
    expect(zoomIn?.disabled).toBe(false);
    zoomIn?.run();
    zoomOut?.run();
    expect(steps).toEqual([1, -1]);
    const largest = binderCommands({ ...input, thumbnailZoom: { size: MAX_THUMBNAIL_SIZE, onStep: () => {} } });
    expect(largest.find((command) => command.id === 'pdf-organizer.zoomIn')?.disabled).toBe(true);
  });
});
