import type { AppEntry } from '@syntelab/shell-api';
import { describe, expect, it } from 'vitest';
import { appInk, contrast, tintFor } from './app-ink';

const DARK = '#181b21';
const app = (color: string) => ({ manifest: { brand: { color } } }) as AppEntry;

describe('tintFor', () => {
  it('lightens a dark color until it stands out', () => {
    for (const color of ['#7A1F3D', '#3949AB', '#7B1FA2', '#546E7A']) {
      const tint = tintFor(color, DARK);
      expect(tint).not.toBe(color);
      expect(contrast(tint, DARK)).toBeGreaterThanOrEqual(4);
    }
  });

  it('leaves a color that already stands out as it is', () => {
    expect(tintFor('#FFC107', DARK)).toBe('#FFC107');
  });

  it('keeps the tints of two apps apart', () => {
    expect(tintFor('#7A1F3D', DARK)).not.toBe(tintFor('#E91E63', DARK));
  });
});

describe('appInk', () => {
  it('gives the color and its tints for the dark themes', () => {
    const { style } = appInk(app('#7A1F3D')) as { style: Record<string, string> };
    expect(style['--app-color']).toBe('#7A1F3D');
    expect(contrast(style['--app-color-on-dark']!, DARK)).toBeGreaterThanOrEqual(4);
    expect(contrast(style['--app-color-on-dark-gray']!, '#363a40')).toBeGreaterThanOrEqual(4);
  });

  it('gives nothing for a color that is not #RRGGBB', () => {
    expect(appInk(app('red'))).toEqual({});
  });
});
