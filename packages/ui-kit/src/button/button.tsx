import type { ButtonHTMLAttributes } from 'react';
import { tooltip } from '../tooltip/tooltip';
import type { TooltipSide } from '../tooltip/tooltip';
import styles from './button.module.css';

export type ButtonVariant = 'primary' | 'outline' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
}

export function Button({ variant = 'outline', className, type = 'button', ...rest }: ButtonProps) {
  const classes = [styles.button, styles[variant], className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}

export interface IconButtonProps extends ButtonProps {
  /** An icon-only button has no visible text, so the name is required. It is also its tooltip. */
  readonly 'aria-label': string;
  readonly tooltipSide?: TooltipSide;
}

export function IconButton({ className, tooltipSide, ...rest }: IconButtonProps) {
  const classes = [styles.square, className].filter(Boolean).join(' ');
  return <Button className={classes} {...tooltip(rest['aria-label'], tooltipSide)} {...rest} />;
}
