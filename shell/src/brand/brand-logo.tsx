import { SvgMaskIcon } from '@syntelab/ui-kit';
import logo from '../../../assets/brand/icon.svg?raw';
import styles from './brand-logo.module.css';

export interface BrandLogoProps {
  /** Side of the square tile, in pixels. */
  readonly size?: number;
}

/**
 * The program logo: `assets/brand/icon.svg` in white on a rounded square in
 * the brand color. Same drawing as the window icon (tools/generate-icons.mjs).
 */
export function BrandLogo({ size = 64 }: BrandLogoProps) {
  return (
    <span className={styles.logo} style={{ width: size, height: size }}>
      <SvgMaskIcon svg={logo} size={Math.round(size * 0.8)} />
    </span>
  );
}
