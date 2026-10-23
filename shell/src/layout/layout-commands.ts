import type { Command } from '@syntelab/command-registry';
import { setAppLayout } from '../preferences';
import type { Layout, PanelSide, ResolvedAppLayout } from '../preferences';

const VIEW = 'common.menu.view';
const LAYOUT_GROUP = 'shell.command.group.layout';

const LAYOUT_COMMANDS: readonly { layout: Layout; labelKey: string; hintKey: string; icon: string }[] = [
  { layout: 'classic', labelKey: 'shell.layout.classic', hintKey: 'shell.layout.classicHint', icon: 'bars' },
  { layout: 'ribbon', labelKey: 'shell.layout.ribbon', hintKey: 'shell.layout.ribbonHint', icon: 'rectangle-list' },
  { layout: 'side-panel', labelKey: 'shell.layout.sidePanel', hintKey: 'shell.layout.sidePanelHint', icon: 'table-columns' },
];

const SIDE_COMMANDS: readonly { side: PanelSide; labelKey: string; icon: string }[] = [
  { side: 'left', labelKey: 'shell.layout.panelLeftCommand', icon: 'chevron-left' },
  { side: 'right', labelKey: 'shell.layout.panelRightCommand', icon: 'chevron-right' },
];

/**
 * The commands that switch the layout of the app in front (View menu). They
 * change that app only: every app keeps its own layout.
 */
export function layoutCommands(appId: string, current: ResolvedAppLayout): Command[] {
  const layouts = LAYOUT_COMMANDS.map(
    ({ layout, labelKey, hintKey, icon }): Command => ({
      id: `shell.layout.${layout}`,
      labelKey,
      hintKey,
      menuKey: VIEW,
      groupKey: LAYOUT_GROUP,
      icon,
      kind: 'choice',
      checked: current.layout === layout,
      run: () => setAppLayout(appId, { layout }),
    }),
  );
  if (current.layout !== 'side-panel') return layouts;

  const sides = SIDE_COMMANDS.map(
    ({ side, labelKey, icon }): Command => ({
      id: `shell.layout.panel.${side}`,
      labelKey,
      icon,
      menuKey: VIEW,
      groupKey: LAYOUT_GROUP,
      kind: 'choice',
      checked: current.panelSide === side,
      run: () => setAppLayout(appId, { panelSide: side }),
    }),
  );
  return [...layouts, ...sides];
}
