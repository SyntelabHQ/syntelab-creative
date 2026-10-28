import { useI18n } from '@syntelab/i18n';
import { Icon } from '@syntelab/ui-kit';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fitGroups } from './fit-groups';
import { ToolGroup } from './tool-group';
import styles from './tool-bar.module.css';
import { toolColor } from './use-tools';
import type { Tool } from './use-tools';

/** Width a folded group takes, with its padding. Matches tool-group.module.css. */
const FOLDED_GROUP_WIDTH = 76;

export interface ToolBarProps {
  readonly tool: Tool;
  /** "Done": the bar closes and the page is the user's again. */
  readonly onDone: () => void;
}

/**
 * The bar of the tool the user opened: its name, its commands (each an icon
 * above its name) in groups, as many open as the width allows (the others
 * fold, from the end), and Done.
 */
export function ToolBar({ tool, onDone }: ToolBarProps) {
  const { t, language } = useI18n();
  const { menu } = tool;
  const panelRef = useRef<HTMLDivElement>(null);
  const fullRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const [widths, setWidths] = useState<readonly number[]>([]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const measure = () => {
      if (panel.clientWidth > 0) setAvailable(panel.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, []);

  // Every group is also drawn, unseen, open, to know what fits.
  useLayoutEffect(() => {
    const next = menu.groups.map((_, index) => fullRefs.current[index]?.offsetWidth ?? 0);
    setWidths((current) => (current.length === next.length && current.every((width, index) => width === next[index]) ? current : next));
  }, [menu, language]);

  const measured = widths.length === menu.groups.length;
  const sizes = fitGroups(
    // Not measured yet: assume it fits, and correct right after.
    menu.groups.map((_, index) => (measured ? (widths[index] ?? 0) : 0)),
    FOLDED_GROUP_WIDTH,
    available - 8,
  );
  const name = t(menu.menuKey);

  return (
    <div role="toolbar" aria-label={name} className={styles.bar}>
      <span className={styles.name}>
        <span className={styles.nameIcon} style={{ color: toolColor(tool) }}>
          <Icon name={tool.icon} size={18} />
        </span>
        {name}
      </span>
      <div className={styles.groups} ref={panelRef}>
        {menu.groups.map((group, index) => (
          <ToolGroup key={group.groupKey} group={group} fallbackName={name} size={sizes[index] ?? 'full'} />
        ))}
        {/* Every group once more, unseen and open: to know what fits. */}
        <div className={styles.measure} aria-hidden="true" inert>
          {menu.groups.map((group, index) => (
            <ToolGroup
              key={`measure:${group.groupKey}`}
              ref={(element) => {
                fullRefs.current[index] = element;
              }}
              group={group}
              fallbackName={name}
              size="full"
            />
          ))}
        </div>
      </div>
      <button type="button" className={styles.done} onClick={onDone}>
        {t('shell.tools.done')}
      </button>
    </div>
  );
}
