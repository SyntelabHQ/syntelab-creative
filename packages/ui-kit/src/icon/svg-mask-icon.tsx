import type { CSSProperties } from 'react';

export interface SvgMaskIconProps {
  /** SVG source, for example an app's `assets/icon.svg`. */
  readonly svg: string;
  readonly size?: number;
  /** Part of the box the drawing fills, 0–1. Default: all of it. */
  readonly scale?: number;
}

/**
 * Shows an SVG in the current text color. The SVG is used as a CSS mask, so
 * its markup never enters the page and cannot run scripts.
 */
export function SvgMaskIcon({ svg, size = 22, scale = 1 }: SvgMaskIconProps) {
  const percent = `${Math.round(scale * 100)}%`;
  const mask = `url("data:image/svg+xml,${encodeURIComponent(svg)}") center / ${percent} ${percent} no-repeat`;
  const style: CSSProperties = {
    display: 'inline-block',
    flex: 'none',
    width: size,
    height: size,
    backgroundColor: 'currentColor',
    mask,
    WebkitMask: mask,
  };
  return <span aria-hidden="true" style={style} />;
}
