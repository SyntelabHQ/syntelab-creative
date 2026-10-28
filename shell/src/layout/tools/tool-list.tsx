import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { preferences, TOOLS_NARROWEST, TOOLS_WIDEST, updatePreferences } from '../../preferences';
import { SideActions } from '../../side-actions';
import { useStore } from '../../state/create-store';
import styles from './tool-list.module.css';
import { toolColor } from './use-tools';
import type { Tool } from './use-tools';

export interface ToolListProps {
  readonly tools: readonly Tool[];
  /** The key of the menu of the tool whose bar is open, or null. */
  readonly open: string | null;
  /** Only the icons, their names as tooltips (☰ on the bar on top). */
  readonly folded: boolean;
  /** Folds the list to its icons, or unfolds it: dragged narrower than it can be with its names, it folds. */
  readonly onFold: (folded: boolean) => void;
  /** A tool was chosen: its bar opens, the open one closes again, a tool of one step runs it. */
  readonly onChoose: (tool: Tool) => void;
}

/**
 * The app's tools, named by what the user wants to do, on the side. Choosing
 * one opens its bar over the page; choosing it again closes it. Folded (☰),
 * or in a narrow window, only their icons are left, with their names as
 * tooltips. At the bottom: what is new, feedback and support.
 */
export function ToolList({ tools, open, folded, onFold, onChoose }: ToolListProps) {
  const t = useTranslation();
  const { toolsWidth } = useStore(preferences);
  const setWidth = (width: number) => updatePreferences({ toolsWidth: Math.min(Math.max(Math.round(width), TOOLS_NARROWEST), TOOLS_WIDEST) });

  // Its edge is dragged: wider, narrower, or folded to its icons when let go narrower than it can be with names.
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const left = handle.parentElement?.getBoundingClientRect();
    const rtl = getComputedStyle(handle).direction === 'rtl';
    const widthAt = (x: number) => (left ? (rtl ? left.right - x : x - left.left) : toolsWidth);
    const move = (moved: globalThis.PointerEvent) => {
      const width = widthAt(moved.clientX);
      if (width < TOOLS_NARROWEST - 40) return onFold(true);
      onFold(false);
      setWidth(width);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const by = event.key === 'ArrowRight' ? 20 : event.key === 'ArrowLeft' ? -20 : 0;
    if (by === 0) return;
    event.preventDefault();
    if (folded) return onFold(false);
    setWidth(toolsWidth + (rtl ? -by : by));
  };
  return (
    <nav aria-label={t('shell.tools.all')} className={styles.list} data-folded={folded} style={{ '--tools-width': `${toolsWidth}px` } as CSSProperties}>
      <h2 className={styles.title}>{t('shell.tools.all')}</h2>
      <ul className={styles.items}>
        {tools.map((tool) => {
          const { menu, icon, hintKey } = tool;
          const name = t(menu.menuKey);
          const chosen = menu.menuKey === open;
          return (
            <li key={menu.menuKey}>
              <button
                type="button"
                className={styles.item}
                aria-pressed={chosen}
                aria-label={name}
                {...tooltip(hintKey ? `${name}: ${t(hintKey)}` : name, 'end')}
                onClick={() => onChoose(tool)}
              >
                <span className={styles.icon} style={{ color: toolColor(tool) }}>
                  <Icon name={icon} size={18} />
                </span>
                <span className={styles.name}>{name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {/* What is new, feedback and support: small, at the bottom, always in sight. */}
      <div className={styles.footer}>
        <SideActions stacked={folded} tooltipSide="end" />
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('shell.tools.resize')}
        aria-valuenow={folded ? 56 : toolsWidth}
        aria-valuemin={56}
        aria-valuemax={TOOLS_WIDEST}
        tabIndex={0}
        className={styles.handle}
        {...tooltip(t('shell.tools.resize'), 'end')}
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          onFold(false);
          updatePreferences({ toolsWidth: 200 });
        }}
        onKeyDown={onKeyDown}
      />
    </nav>
  );
}
