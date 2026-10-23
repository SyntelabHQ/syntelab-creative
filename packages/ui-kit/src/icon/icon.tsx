import { SvgMaskIcon } from './svg-mask-icon';

// Interface icons are plain SVG files in assets/icons/ (Font Awesome Free; see
// the README there). The icon name is the file name without ".svg".
const files = import.meta.glob<string>('../../../../assets/icons/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * Font Awesome ships the same icons in two framings: downloads from the
 * website sit in a 640×640 box with a margin around the drawing, files from
 * the package fill a 512-high box edge to edge. Shown at the same size, the
 * second kind looks a quarter larger, so it is scaled down to match.
 */
const PADDED_VIEW_BOX = /viewBox="0 0 640 640"/;
const EDGE_TO_EDGE_SCALE = 512 / 640;

interface IconFile {
  readonly svg: string;
  readonly scale: number;
}

const icons = new Map<string, IconFile>(
  Object.entries(files).map(([path, svg]) => [
    path.slice(path.lastIndexOf('/') + 1, -'.svg'.length),
    { svg, scale: PADDED_VIEW_BOX.test(svg) ? 1 : EDGE_TO_EDGE_SCALE },
  ]),
);

/** Name of a file in `assets/icons/`, without the extension: `gear`, `house`… */
export type IconName = string;

export interface IconProps {
  readonly name: IconName;
  readonly size?: number;
}

/** Decorative, in the current text color: the control around it carries the accessible name. */
export function Icon({ name, size = 20 }: IconProps) {
  const icon = icons.get(name);
  if (!icon) {
    if (import.meta.env.DEV) console.warn(`[ui-kit] no icon file assets/icons/${name}.svg`);
    return null;
  }
  return <SvgMaskIcon svg={icon.svg} size={size} scale={icon.scale} />;
}
