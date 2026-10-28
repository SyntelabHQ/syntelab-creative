import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import type { TooltipSide } from '@syntelab/ui-kit';
import { openChangelog, useChangelogUnread } from '../changelog';
import { openSitePage } from '../links';
import styles from './side-actions.module.css';
import { useSupportNudge } from './use-support-nudge';

const ICON_SIZE = 18;

export interface SideActionsProps {
  /** One under the other (a folded list of tools), or side by side. */
  readonly stacked: boolean;
  /** Where their names show, as tooltips. */
  readonly tooltipSide: TooltipSide;
}

/**
 * What is new (with its glow and red dot while something is unread),
 * feedback, and support (whose heart beats once, a minute into the session):
 * small icons at the bottom of the list of tools, or on the bar on top where
 * there is no list.
 */
export function SideActions({ stacked, tooltipSide }: SideActionsProps) {
  const t = useTranslation();
  const changelogUnread = useChangelogUnread();
  const supportNudge = useSupportNudge();
  /** The name read by screen readers, also shown as a tooltip. */
  const named = (name: string) => ({ 'aria-label': name, ...tooltip(name, tooltipSide) });

  return (
    <div className={styles.actions} data-stacked={stacked}>
      <button type="button" className={styles.item} data-action="changelog" data-unread={changelogUnread} {...named(t('shell.changelog.title'))} aria-haspopup="dialog" onClick={openChangelog}>
        <Icon name="changelog" size={ICON_SIZE} />
      </button>
      <button type="button" className={styles.item} data-action="feedback" {...named(t('shell.help.feedback'))} onClick={() => openSitePage('feedback')}>
        <Icon name="feedback" size={ICON_SIZE} />
      </button>
      <button type="button" className={styles.item} data-action="support" data-nudge={supportNudge} {...named(t('shell.donate.button'))} onClick={() => openSitePage('support')}>
        <Icon name="support" size={ICON_SIZE} />
      </button>
    </div>
  );
}
