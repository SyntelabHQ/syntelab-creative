import type { CommandMenu } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { preferences, updatePreferences } from '../../preferences';
import { useStore } from '../../state/create-store';
import { CommandButton } from '../command-button';
import { primaryCommands } from '../use-menus';
import styles from './side-panel.module.css';

export interface SidePanelProps {
  readonly menus: readonly CommandMenu[];
  readonly collapsed: boolean;
  /** The edge of the window the panel sits on, so tooltips and the fold arrow point inward. */
  readonly edge: 'start' | 'end';
}

/**
 * The side panel layout: every command as a row, under its menu and group.
 * Folded, it is a narrow strip with the main commands as icons.
 */
export function SidePanel({ menus, collapsed, edge }: SidePanelProps) {
  const t = useTranslation();
  const foldLabel = t(collapsed ? 'shell.layout.expandPanel' : 'shell.layout.collapsePanel');
  const { panelFoldedSections } = useStore(preferences);
  // Tooltips of the narrow strip open toward the content, away from the window edge.
  const inward = edge === 'start' ? 'end' : 'start';

  const toggleSection = (menuKey: string) =>
    updatePreferences({
      panelFoldedSections: panelFoldedSections.includes(menuKey)
        ? panelFoldedSections.filter((key) => key !== menuKey)
        : [...panelFoldedSections, menuKey],
    });

  return (
    <aside aria-label={t('shell.layout.tools')} className={styles.panel} data-collapsed={collapsed} data-edge={edge}>
      <div className={styles.head}>
        {!collapsed && <span className={styles.title}>{t('shell.layout.tools')}</span>}
        <IconButton
          variant="ghost"
          className={styles.fold}
          aria-label={foldLabel}
          aria-expanded={!collapsed}
          tooltipSide={collapsed ? inward : 'bottom-end'}
          onClick={() => updatePreferences({ toolsCollapsed: !collapsed })}
        >
          <span className={styles.foldArrow} data-open={!collapsed}>
            <Icon name="chevron-down" size={14} />
          </span>
        </IconButton>
      </div>

      {collapsed ? (
        <div className={styles.quick}>
          {primaryCommands(menus)
            .flat()
            .map((command) => (
              <CommandButton
                key={command.id}
                command={command}
                shape="icon"
                tooltipSide={inward}
              />
            ))}
        </div>
      ) : (
        <div className={styles.sections}>
          {menus.map((menu) => {
            const folded = panelFoldedSections.includes(menu.menuKey);
            return (
            <section key={menu.menuKey} className={styles.section}>
              <h2 className={styles.menuName}>
                <button
                  type="button"
                  className={styles.sectionToggle}
                  aria-expanded={!folded}
                  onClick={() => toggleSection(menu.menuKey)}
                >
                  <span className={styles.sectionArrow} data-open={!folded}>
                    <Icon name="chevron-down" size={12} />
                  </span>
                  {t(menu.menuKey)}
                </button>
              </h2>
              {!folded && menu.groups.map((group) => (
                <div key={group.groupKey} role="group" aria-label={group.groupKey ? t(group.groupKey) : undefined} className={styles.group}>
                  {group.groupKey && <div className={styles.groupName}>{t(group.groupKey)}</div>}
                  {group.commands.map((command) => (
                    <CommandButton key={command.id} command={command} shape="row" />
                  ))}
                </div>
              ))}
            </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
