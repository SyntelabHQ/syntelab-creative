import type { AppEntry } from '@syntelab/shell-api';
import { SvgMaskIcon } from '@syntelab/ui-kit';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The app's brand color, or undefined when the manifest value is not `#RRGGBB`. */
export function appColor(app: AppEntry): string | undefined {
  return HEX_COLOR.test(app.manifest.brand.color) ? app.manifest.brand.color : undefined;
}

export interface AppIconProps {
  readonly app: AppEntry;
  readonly size?: number;
}

/** The app's icon in the current text color. */
export function AppIcon({ app, size }: AppIconProps) {
  return app.iconSvg ? <SvgMaskIcon svg={app.iconSvg} size={size} /> : null;
}
