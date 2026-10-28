import type { CommandGroup } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Icon, useDismiss } from '@syntelab/ui-kit';
import { useCallback, useId, useRef, useState } from 'react';
import type { CSSProperties, Ref } from 'react';
import { CommandButton } from '../command-button';
import type { GroupSize } from './fit-groups';
import styles from './tool-group.module.css';

export interface ToolGroupProps {
  readonly group: CommandGroup;
  /** Shown when the group has no name of its own. */
  readonly fallbackName: string;
  readonly size: GroupSize;
  readonly ref?: Ref<HTMLDivElement>;
}

/** One group of a tool's bar, at the size the width allows. Its name is read out, and shown once it is folded. */
export function ToolGroup({ group, fallbackName, size, ref }: ToolGroupProps) {
  const t = useTranslation();
  const name = group.groupKey ? t(group.groupKey) : fallbackName;

  if (size === 'folded') return <FoldedGroup group={group} name={name} />;

  // Commands that explain themselves: the button, and beside it what it is for, written out.
  const explained = group.commands.every((command) => command.explained && command.hintKey);
  return (
    <div ref={ref} role="group" aria-label={name} className={styles.group} data-size={size} data-explained={explained}>
      <div className={styles.buttons}>
        {group.commands.map((command) =>
          explained ? (
            <div key={command.id} className={styles.explained}>
              <CommandButton command={command} shape="tile" hideTooltip />
              <p className={styles.explanation}>{t(command.hintKey ?? '')}</p>
            </div>
          ) : (
            <CommandButton key={command.id} command={command} shape="tile" />
          ),
        )}
      </div>
    </div>
  );
}

function FoldedGroup({ group, name }: { readonly group: CommandGroup; readonly name: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const popupId = useId();
  const icon = group.commands.find((command) => command.icon)?.icon;

  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  const toggle = () => {
    const button = containerRef.current?.getBoundingClientRect();
    if (button) {
      // Placed against the window, so the bar's own edges cannot cut it off.
      const width = Math.min(260, window.innerWidth - 16);
      const left = Math.max(8, Math.min(button.left, window.innerWidth - width - 8));
      setPosition({ top: button.bottom + 4, left, width });
    }
    setOpen((value) => !value);
  };

  return (
    <div ref={containerRef} className={styles.group} data-size="folded">
      <button
        type="button"
        className={styles.foldedButton}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={popupId}
        onClick={toggle}
      >
        <span className={styles.foldedIcon}>{icon && <Icon name={icon} size={22} />}</span>
        <span className={styles.foldedName}>{name}</span>
        <Icon name="chevron-down" size={10} />
      </button>
      <div
        id={popupId}
        role="group"
        aria-label={name}
        className={styles.popup}
        style={position}
        hidden={!open}
        // A choice closes the window; a toggle may be flipped again.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button:not([aria-pressed])')) close();
        }}
      >
        {open && group.commands.map((command) => <CommandButton key={command.id} command={command} shape="row" />)}
      </div>
    </div>
  );
}
