import { useTranslation } from '@syntelab/i18n';
import type { IdleTool } from '@syntelab/shell-api';
import { Icon } from '@syntelab/ui-kit';
import { shortcutText } from '../../commands';
import styles from './idle-bar.module.css';
import { toolColor } from './use-tools';
import type { Tool } from './use-tools';

export interface IdleBarProps {
  /** What the app calls the time no tool is open (Reading). */
  readonly idle: IdleTool;
  /** The tools one click away: those marked `quick` that can be used now. */
  readonly tools: readonly Tool[];
  readonly onChoose: (tool: Tool) => void;
}

/**
 * The bar over the content while no tool is open: what the user is doing
 * (reading), and the tools used most, one click away. The others are in the
 * list on the side and in the search.
 */
export function IdleBar({ idle, tools, onChoose }: IdleBarProps) {
  const t = useTranslation();
  const name = t(idle.labelKey);
  return (
    <div role="toolbar" aria-label={name} className={styles.bar}>
      <span className={styles.name}>
        <span className={styles.nameIcon}>
          <Icon name={idle.icon} size={18} />
        </span>
        {name}
      </span>
      <div className={styles.chips}>
        {tools.map((tool) => (
          <button key={tool.menu.menuKey} type="button" className={styles.chip} onClick={() => onChoose(tool)}>
            <span className={styles.chipIcon} style={{ color: toolColor(tool) }}>
              <Icon name={tool.icon} size={14} />
            </span>
            {t(tool.menu.menuKey)}
          </button>
        ))}
      </div>
      <span className={styles.hint}>{t('shell.tools.idleHint', { keys: shortcutText('Mod+K') })}</span>
    </div>
  );
}
