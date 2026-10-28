/**
 * One thing the user can do. Registered once, shown everywhere
 * (menus, tools, search, shortcuts).
 */
export interface Command {
  /** Unique id, prefixed by its owner: `shell.goToStart`, `pdf-organizer.rotate`. */
  readonly id: string;
  /** Translation key of the visible name. */
  readonly labelKey: string;
  /** Translation key of a sentence saying what the command does; shown as a tooltip. */
  readonly hintKey?: string;
  /**
   * Translation key of the top-level menu the command belongs to
   * (`common.menu.file`, `common.menu.view`…). The classic layout shows it as
   * a menu on top, or one of the app's tools. A command
   * without one appears only in the search.
   */
  readonly menuKey?: string;
  /** Translation key of the group inside the menu ("Zoom", "Page display"…). */
  readonly groupKey?: string;
  /** Name of a file in `assets/icons/`, without the extension. */
  readonly icon?: string;
  /**
   * `action` (default): does something. `toggle`: on or off. `choice`: one of
   * the choices in its group.
   */
  readonly kind?: 'action' | 'toggle' | 'choice';
  /** For `toggle` and `choice`: whether it is on right now. */
  readonly checked?: boolean;
  readonly disabled?: boolean;
  /**
   * Planned, not written yet: shown greyed out (set `disabled` too), so the
   * menus already have their final shape, and left out of the search.
   */
  readonly comingSoon?: boolean;
  /**
   * Keys that run the command: `Mod+S`, `Mod+Shift+S`, `F11`. `Mod` is Ctrl,
   * or Command on a Mac. Shown beside the command's name in menus and tooltips.
   */
  readonly shortcut?: string;
  /**
   * Where there is room for it (a group of its own in a tool's bar), what the command
   * is for (`hintKey`) is written out beside its button instead of waiting in
   * a tooltip.
   */
  readonly explained?: boolean;
  /** Important enough for the icons on the top bar. Needs an icon. */
  readonly primary?: boolean;
  readonly run: () => void | Promise<void>;
}
