import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { Button, IconButton } from '../button/button';
import { useDismiss } from '../dismiss/use-dismiss';
import { Icon } from '../icon/icon';
import { tooltip } from '../tooltip/tooltip';
import type { TooltipSide } from '../tooltip/tooltip';
import styles from './menu-button.module.css';

export interface MenuItem {
  readonly id: string;
  /** Already translated. */
  readonly label: string;
  /**
   * `choice`: one of several in its section (shows a check mark when chosen).
   * `toggle`: on or off. `action`: just does something.
   */
  readonly kind: 'choice' | 'toggle' | 'action';
  /** Name of a file in `assets/icons/`. Shown for actions; choices and toggles show their check mark. */
  readonly icon?: string;
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /** A sentence about the item, already translated; shown as a tooltip beside it. */
  readonly hint?: string;
  /** The keys that do the same, already written for the reader: `Ctrl+S`. */
  readonly shortcut?: string;
  readonly onSelect: () => void;
}

/** A group of items, separated from the next by a line. */
export interface MenuSection {
  readonly id: string;
  /** Already translated; shown small above the items. */
  readonly title?: string;
  readonly items: readonly MenuItem[];
}

export interface MenuButtonProps {
  /** Name of the button and of the menu, already translated. */
  readonly label: string;
  /**
   * `icon` (default): the button shows `children` (an icon) and the label is
   * its tooltip. `text`: the button shows the label itself, like a menu bar.
   */
  readonly variant?: 'icon' | 'text';
  readonly children?: ReactNode;
  /** For `text`: an icon shown before the label (a file of `assets/icons/`, by its name). */
  readonly icon?: string;
  /** The menu closes by itself a moment after the pointer leaves it and its button: for a menu that stands alone, not one of a bar. */
  readonly closeOnLeave?: boolean;
  readonly sections: readonly MenuSection[];
  /** Which edge of the button the menu lines up with. */
  readonly align?: 'start' | 'end';
  readonly tooltipSide?: TooltipSide;
}

const ROLES = { choice: 'menuitemradio', toggle: 'menuitemcheckbox', action: 'menuitem' } as const;

/** How long a menu that closes when the pointer leaves it waits before it does, in milliseconds. */
const LEAVE_DELAY = 350;

/** Space kept between an open menu and the bottom of the window. */
const WINDOW_MARGIN = 12;

/**
 * The menu of a menu bar that is open now, if any. While one is open, moving
 * the pointer onto another name of the bar opens that menu instead, as menu
 * bars do everywhere.
 */
let openBarMenu: { readonly close: () => void } | null = null;

/** A button that opens a menu under it. */
export function MenuButton(props: MenuButtonProps) {
  const { label, variant = 'icon', children, icon, closeOnLeave = false, sections, align = 'end', tooltipSide = 'bottom-end' } = props;
  const [open, setOpen] = useState(false);
  /** How tall the menu may be before it scrolls: the room under its button. */
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  // Closing when the pointer leaves waits a moment: a pointer that slips off the edge and comes back keeps the menu.
  const leaving = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stay = () => clearTimeout(leaving.current);
  const leave = () => {
    if (!closeOnLeave || !open) return;
    stay();
    leaving.current = setTimeout(close, LEAVE_DELAY);
  };
  useEffect(() => stay, []);

  const enabledItems = () =>
    [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? [])];

  useEffect(() => {
    if (!open) return;
    const button = containerRef.current?.getBoundingClientRect();
    if (button) setMaxHeight(Math.max(120, window.innerHeight - button.bottom - 6 - WINDOW_MARGIN));
    enabledItems()[0]?.focus({ preventScroll: true });
  }, [open]);

  // A menu of the bar tells the others it is the open one.
  useEffect(() => {
    if (!open || variant !== 'text') return;
    const self = { close };
    openBarMenu = self;
    return () => {
      if (openBarMenu === self) openBarMenu = null;
    };
  }, [open, variant, close]);

  /** The pointer came onto this name while another menu of the bar is open: take over. */
  const takeOver = () => {
    if (open || !openBarMenu) return;
    openBarMenu.close();
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = enabledItems();
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items[items.length - 1];
    if (!next) return;
    event.preventDefault();
    next.focus();
  };

  const triggerProps = {
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    'aria-controls': menuId,
    onClick: () => setOpen((value) => !value),
  } as const;

  return (
    <div ref={containerRef} className={styles.container} onPointerEnter={stay} onPointerLeave={leave}>
      {variant === 'text' ? (
        <Button variant="ghost" className={styles.textTrigger} onPointerEnter={takeOver} {...triggerProps}>
          {icon && <Icon name={icon} size={14} />}
          {label}
        </Button>
      ) : (
        <IconButton
          variant="ghost"
          aria-label={label}
          tooltipSide={tooltipSide}
          // The tooltip would cover the open menu.
          data-tooltip={open ? undefined : label}
          {...triggerProps}
        >
          {children}
        </IconButton>
      )}
      {/* The outer box scrolls a menu taller than the window; see the styles for why it is wider than the menu. */}
      <div className={styles.menu} data-align={align} hidden={!open} style={{ maxHeight }}>
      <div ref={menuRef} id={menuId} role="menu" aria-label={label} className={styles.panel} onKeyDown={onKeyDown}>
        {sections.map((section) => (
          <div key={section.id} role="group" aria-label={section.title} className={styles.section}>
            {section.title && (
              <div role="presentation" className={styles.sectionTitle}>
                {section.title}
              </div>
            )}
            {section.items.map((item) => (
              <button
                key={item.id}
                type="button"
                role={ROLES[item.kind]}
                aria-checked={item.kind === 'action' ? undefined : (item.checked ?? false)}
                tabIndex={-1}
                disabled={item.disabled}
                className={styles.item}
                {...(item.hint ? tooltip(item.hint, 'end') : {})}
                onClick={() => {
                  item.onSelect();
                  // A toggle can be flipped again without reopening the menu.
                  if (item.kind !== 'toggle') close();
                }}
              >
                <span className={styles.mark}>
                  {item.kind === 'action'
                    ? item.icon && <Icon name={item.icon} size={16} />
                    : item.checked && <Icon name="check" size={14} />}
                </span>
                <span className={styles.label}>{item.label}</span>
                {item.shortcut && <kbd className={styles.shortcut}>{item.shortcut}</kbd>}
              </button>
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}
