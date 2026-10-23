import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import type { ReactNode } from 'react';
import styles from './side-panel.module.css';

/** What the panel beside the text can show. */
export const PANEL_PARTS = ['tools', 'recipes', 'stats'] as const;
export type PanelPart = (typeof PANEL_PARTS)[number];

const PART_ICONS: Readonly<Record<PanelPart, string>> = { tools: 'sliders', recipes: 'list-check', stats: 'ruler' };

export interface SidePanelProps {
  readonly part: PanelPart;
  /** The parts that are shown: the others are not offered. */
  readonly parts: readonly PanelPart[];
  readonly onPartChange: (part: PanelPart) => void;
  /** How wide the panel is, in pixels: the user drags its edge. */
  readonly width: number;
  /** Folds the panel away, down to a strip at the edge of the window. */
  readonly onCollapse: () => void;
  readonly children: ReactNode;
}

/** The panel beside the text: the tools, the recipes, or what the text is made of, one at a time. */
export function SidePanel({ part, parts, onPartChange, width, onCollapse, children }: SidePanelProps) {
  const t = useTranslation();
  return (
    <aside className={styles.panel} style={{ width }} aria-label={t(`scribe.panel.${part}`)}>
      <div className={styles.top}>
        <div role="tablist" className={styles.parts}>
          {parts.map((known) => (
            <button key={known} type="button" role="tab" aria-selected={known === part} className={styles.part} onClick={() => onPartChange(known)}>
              {t(`scribe.panel.${known}`)}
            </button>
          ))}
        </div>
        <IconButton variant="ghost" aria-label={t('scribe.panel.collapse')} tooltipSide="bottom-end" onClick={onCollapse}>
          <Icon name="angles-right" size={14} />
        </IconButton>
      </div>
      {children}
    </aside>
  );
}

export interface PanelRailProps {
  /** Brings the panel back, at one of its parts. */
  readonly onOpen: (part: PanelPart) => void;
  /** The part the panel shows when it is brought back as it was. */
  readonly part: PanelPart;
  /** The parts that are shown. */
  readonly parts: readonly PanelPart[];
}

/** The panel folded away: a strip at the edge of the window, with the way back to each of its parts. */
export function PanelRail({ onOpen, part, parts }: PanelRailProps) {
  const t = useTranslation();
  return (
    <nav className={styles.rail} aria-label={t('scribe.panel.rail')}>
      <IconButton variant="ghost" aria-label={t('scribe.panel.expand')} tooltipSide="bottom-end" onClick={() => onOpen(part)}>
        <Icon name="angles-left" size={14} />
      </IconButton>
      {parts.map((known) => (
        <IconButton key={known} variant="ghost" aria-label={t(`scribe.panel.${known}`)} tooltipSide="bottom-end" onClick={() => onOpen(known)}>
          <Icon name={PART_ICONS[known]} size={16} />
        </IconButton>
      ))}
    </nav>
  );
}
