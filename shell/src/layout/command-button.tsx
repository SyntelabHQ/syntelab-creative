import type { Command } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import type { TooltipSide } from '@syntelab/ui-kit';
import styles from './command-button.module.css';
import { commandTooltip, runCommand } from './use-menus';

export interface CommandButtonProps {
  readonly command: Command;
  /**
   * `icon`: only the icon, the name as tooltip (toolbar, collapsed panel).
   * `tile`: icon above the name (ribbon). `row`: icon beside the name (panel).
   * `small`: icon beside the name, as low and narrow as they allow (a ribbon short of room).
   */
  readonly shape: 'icon' | 'tile' | 'row' | 'small';
  /** What the command is for is written beside the button: no tooltip needed. */
  readonly hideTooltip?: boolean;
  readonly tooltipSide?: TooltipSide;
}

/** A command as a button. Toggles and choices show whether they are on. */
export function CommandButton({ command, shape, tooltipSide, hideTooltip = false }: CommandButtonProps) {
  const t = useTranslation();
  const label = t(command.labelKey);
  const stateful = command.kind === 'toggle' || command.kind === 'choice';
  const checked = stateful && command.checked === true;
  // An icon alone needs its name; a button with its name shows what it does, if there is more to say.
  const hint = hideTooltip ? null : commandTooltip(command, t, shape === 'icon');

  return (
    <button
      type="button"
      className={styles.button}
      data-shape={shape}
      aria-label={shape === 'icon' ? label : undefined}
      aria-pressed={stateful ? checked : undefined}
      disabled={command.disabled}
      {...(hint ? tooltip(hint, tooltipSide ?? (shape === 'row' ? 'top' : 'bottom')) : {})}
      onClick={() => runCommand(command)}
    >
      <span className={styles.icon}>
        {/* A command without an icon shows a check mark while it is on. */}
        {command.icon ? <Icon name={command.icon} size={shape === 'tile' ? 22 : 18} /> : checked && <Icon name="check" size={14} />}
      </span>
      {shape !== 'icon' && <span className={styles.label}>{label}</span>}
    </button>
  );
}
