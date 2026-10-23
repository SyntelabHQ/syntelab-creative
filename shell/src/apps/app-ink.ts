import type { AppEntry } from '@syntelab/shell-api';
import type { CSSProperties } from 'react';
import { appColor } from './app-icon';

/** `--sc-surface` of the dark themes (ui-kit `tokens.css`): what a tint has to stand out from. */
const DARK_SURFACE = '#181b21';
const DARK_GRAY_SURFACE = '#363a40';

/** The least contrast a small icon keeps against the surface. */
const MIN_CONTRAST = 4;

type Rgb = readonly [number, number, number];

function toRgb(color: string): Rgb {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function toHex(rgb: Rgb): string {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

/** Relative luminance, as WCAG defines it. */
function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((channel) => {
    const part = channel / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast of two `#RRGGBB` colors, from 1 to 21. */
export function contrast(first: string, second: string): number {
  const [low, high] = [luminance(toRgb(first)), luminance(toRgb(second))].sort((a, b) => a - b) as [number, number];
  return (high + 0.05) / (low + 0.05);
}

/**
 * `color` (`#RRGGBB`) with as little white mixed in as it takes to reach
 * `minContrast` against a dark `background`; unchanged when it already does.
 */
export function tintFor(color: string, background: string, minContrast = MIN_CONTRAST): string {
  const base = toRgb(color);
  for (let white = 0; white <= 100; white += 2) {
    const tint = toHex(base.map((channel) => channel + ((255 - channel) * white) / 100) as unknown as Rgb);
    if (contrast(tint, background) >= minContrast) return white === 0 ? color : tint;
  }
  return '#ffffff';
}

export interface AppInkProps {
  readonly 'data-app-ink'?: '';
  readonly style?: CSSProperties;
}

/**
 * Props for an element that draws with the app's color (an icon, a border):
 * `--app-color` and its lighter tints for the dark themes. The element and
 * its children then use `var(--app-ink)`, which ui-kit `base.css` picks by
 * theme. Empty when the manifest color is not `#RRGGBB`.
 */
export function appInk(app: AppEntry): AppInkProps {
  const color = appColor(app);
  if (!color) return {};
  return {
    'data-app-ink': '',
    style: {
      '--app-color': color,
      '--app-color-on-dark': tintFor(color, DARK_SURFACE),
      '--app-color-on-dark-gray': tintFor(color, DARK_GRAY_SURFACE),
    } as CSSProperties,
  };
}
