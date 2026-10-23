import type { CommandMenu } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import { Icon, IconButton, MenuButton } from '@syntelab/ui-kit';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { RIBBON_MODES } from '../../preferences';
import type { RibbonMode } from '../../preferences';
import { fitGroups, fitIconGroups } from './fit-groups';
import { RibbonGroup } from './ribbon-group';
import styles from './ribbon.module.css';

/** Width a folded group takes, with its padding. Matches ribbon-group.module.css. */
const FOLDED_GROUP_WIDTH = 85;
const TAB_SCROLL_STEP = 160;
/** How long the pointer may be away before a ribbon shown on hover goes again, in milliseconds. */
const HOVER_CLOSE_MILLISECONDS = 280;

const MODE_ICONS: Record<RibbonMode, string> = { full: 'rectangle-list', compact: 'grip', hover: 'arrow-pointer' };

export interface RibbonProps {
  readonly menus: readonly CommandMenu[];
  /**
   * `full`: large buttons with their names. `compact`: icons only, their
   * names as tooltips. `hover`: only the tabs; the commands of a tab show
   * over the page while the pointer is on its name.
   */
  readonly mode: RibbonMode;
  /** The user chose another form, in the menu at the end of the tabs. */
  readonly onModeChange: (mode: RibbonMode) => void;
}

/**
 * The ribbon layout: one tab per menu, buttons in named groups, in the form
 * the user chose (see `mode`). It stays one row high at any width: groups
 * that do not fit become smaller, then fold into single buttons, and the
 * tabs scroll sideways.
 */
export function Ribbon({ menus, mode, onModeChange }: RibbonProps) {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** In `hover` mode: whether the commands are shown right now. */
  const [shown, setShown] = useState(false);
  const closing = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const panelId = useId();
  // The app's own commands (View…) are a more useful first tab than File.
  const selected = menus.find((menu) => menu.menuKey === selectedKey) ?? menus[2] ?? menus[0];
  useEffect(() => () => clearTimeout(closing.current), []);
  if (!selected) return null;

  const onHover = mode === 'hover';
  const open = (menuKey: string) => {
    clearTimeout(closing.current);
    setSelectedKey(menuKey);
    setShown(true);
  };
  const closeSoon = () => {
    clearTimeout(closing.current);
    closing.current = setTimeout(() => setShown(false), HOVER_CLOSE_MILLISECONDS);
  };

  return (
    <div
      className={styles.ribbon}
      data-mode={mode}
      onPointerEnter={onHover ? () => clearTimeout(closing.current) : undefined}
      onPointerLeave={onHover ? closeSoon : undefined}
      // A command was run, or Escape pressed: the commands step back again.
      onKeyDown={onHover ? (event) => event.key === 'Escape' && setShown(false) : undefined}
    >
      <div className={styles.tabs}>
        <RibbonTabs
          menus={menus}
          selectedKey={onHover && !shown ? null : selected.menuKey}
          panelId={panelId}
          onSelect={(menuKey) => (onHover ? open(menuKey) : setSelectedKey(menuKey))}
          onPoint={onHover ? open : undefined}
        />
        <span className={styles.mode}>
          <MenuButton
            label={t('shell.ribbon.mode')}
            align="end"
            tooltipSide="bottom-end"
            sections={[
              {
                id: 'mode',
                title: t('shell.ribbon.mode'),
                items: RIBBON_MODES.map((option) => ({
                  id: option,
                  kind: 'choice' as const,
                  label: t(`shell.ribbon.mode.${option}`),
                  hint: t(`shell.ribbon.mode.${option}Hint`),
                  icon: MODE_ICONS[option],
                  checked: mode === option,
                  onSelect: () => onModeChange(option),
                })),
              },
            ]}
          >
            <Icon name="chevron-down" size={12} />
          </MenuButton>
        </span>
      </div>
      <RibbonPanel id={panelId} menu={selected} hidden={onHover && !shown} icons={mode === 'compact'} overlay={onHover} />
    </div>
  );
}

interface RibbonTabsProps {
  readonly menus: readonly CommandMenu[];
  readonly selectedKey: string | null;
  readonly panelId: string;
  readonly onSelect: (menuKey: string) => void;
  /** The pointer came onto the name of a tab. */
  readonly onPoint?: (menuKey: string) => void;
}

/** The row of tabs. Too many for the width: it scrolls, with an arrow at each end. */
function RibbonTabs({ menus, selectedKey, panelId, onSelect, onPoint }: RibbonTabsProps) {
  const { t, direction } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ before: false, after: false });

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    // In a right-to-left page the scroll position counts down from zero.
    const scrolled = Math.abs(list.scrollLeft);
    const next = { before: scrolled > 1, after: scrolled + list.clientWidth < list.scrollWidth - 1 };
    setMore((current) => (current.before === next.before && current.after === next.after ? current : next));
  }, []);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, menus]);

  const scroll = (steps: 1 | -1) => {
    const sign = direction === 'rtl' ? -1 : 1;
    listRef.current?.scrollBy({ left: steps * sign * TAB_SCROLL_STEP, behavior: 'smooth' });
  };
  const backIcon = direction === 'rtl' ? 'chevron-right' : 'chevron-left';
  const forwardIcon = direction === 'rtl' ? 'chevron-left' : 'chevron-right';

  return (
    <>
      {more.before && (
        <IconButton variant="ghost" className={styles.small} aria-label={t('shell.layout.scrollBack')} onClick={() => scroll(-1)}>
          <Icon name={backIcon} size={12} />
        </IconButton>
      )}
      <div ref={listRef} role="tablist" aria-label={t('shell.layout.tools')} className={styles.tabList} onScroll={measure}>
        {menus.map((menu) => (
          <button
            key={menu.menuKey}
            type="button"
            role="tab"
            aria-selected={menu.menuKey === selectedKey}
            aria-controls={panelId}
            className={styles.tab}
            onPointerEnter={onPoint ? (event) => event.pointerType !== 'touch' && onPoint(menu.menuKey) : undefined}
            onClick={(event) => {
              onSelect(menu.menuKey);
              event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }}
          >
            {t(menu.menuKey)}
          </button>
        ))}
      </div>
      {more.after && (
        <IconButton
          variant="ghost"
          className={styles.small}
          aria-label={t('shell.layout.moreTabs')}
          tooltipSide="bottom-end"
          onClick={() => scroll(1)}
        >
          <Icon name={forwardIcon} size={12} />
        </IconButton>
      )}
    </>
  );
}

interface RibbonPanelProps {
  readonly id: string;
  readonly menu: CommandMenu;
  readonly hidden: boolean;
  /** Every group as icons without names. */
  readonly icons: boolean;
  /** Laid over the page under the tabs, instead of pushing it down. */
  readonly overlay: boolean;
}

/** The groups of the selected tab, as many open as the width allows. */
function RibbonPanel({ id, menu, hidden, icons, overlay }: RibbonPanelProps) {
  const { t, language } = useI18n();
  const panelRef = useRef<HTMLDivElement>(null);
  const fullRefs = useRef<(HTMLDivElement | null)[]>([]);
  const compactRefs = useRef<(HTMLDivElement | null)[]>([]);
  const iconRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [available, setAvailable] = useState(Number.POSITIVE_INFINITY);
  const [widths, setWidths] = useState<readonly { full: number; compact: number; icons: number }[]>([]);

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
  }, [hidden]);

  // Every group is also drawn, unseen, large and compact, to know what fits.
  useLayoutEffect(() => {
    const widthOf = (refs: typeof fullRefs, index: number) => refs.current[index]?.offsetWidth ?? 0;
    const next = menu.groups.map((_, index) => ({ full: widthOf(fullRefs, index), compact: widthOf(compactRefs, index), icons: widthOf(iconRefs, index) }));
    setWidths((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [menu, language, hidden, icons]);

  const measured = widths.length === menu.groups.length;
  const room = available - 16;
  const sizes = icons
    ? fitIconGroups(menu.groups.map((_, index) => (measured ? (widths[index]?.icons ?? 0) : 0)), FOLDED_GROUP_WIDTH, room)
    : fitGroups(
        // Not measured yet: assume it fits, and correct right after.
        menu.groups.map((_, index) => (measured && widths[index] ? widths[index] : { full: 0, compact: 0 })),
        FOLDED_GROUP_WIDTH,
        room,
      );
  const menuName = t(menu.menuKey);

  return (
    <div id={id} role="tabpanel" aria-label={menuName} className={styles.panel} data-overlay={overlay} hidden={hidden} ref={panelRef}>
      {menu.groups.map((group, index) => (
        <RibbonGroup key={group.groupKey} group={group} fallbackName={menuName} size={sizes[index] ?? 'full'} />
      ))}
      {/* Every group once more, unseen, in each form it may take: to know what fits. */}
      {
        <div className={styles.measure} aria-hidden="true" inert>
          {(icons ? (['icons'] as const) : (['full', 'compact'] as const)).flatMap((size) =>
            menu.groups.map((group, index) => (
              <RibbonGroup
                key={`${size}:${group.groupKey}`}
                ref={(element) => {
                  (size === 'full' ? fullRefs : size === 'compact' ? compactRefs : iconRefs).current[index] = element;
                }}
                group={group}
                fallbackName={menuName}
                size={size}
              />
            )),
          )}
        </div>
      }
    </div>
  );
}
