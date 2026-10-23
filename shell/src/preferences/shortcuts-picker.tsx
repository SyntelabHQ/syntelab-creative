import { shortcutOfKeyPress, useCommands } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Button } from '@syntelab/ui-kit';
import { useState } from 'react';
import { commandRegistry, DEFAULT_SHELL_SHORTCUTS, shortcutLabel } from '../commands';
import { useStore } from '../state/create-store';
import styles from './pickers.module.css';
import { preferences, updatePreferences } from './preferences-store';

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The keys of the program's own commands (going from tab to tab, Settings,
 * Help), which work in every app. Click the keys of a command, then press
 * the new ones; Escape leaves them as they are, Backspace takes them away.
 */
export function ShortcutsPicker() {
  const t = useTranslation();
  const { shortcuts } = useStore(preferences);
  const commands = useCommands(commandRegistry);
  /** The command whose new keys are waited for. */
  const [listening, setListening] = useState<string | null>(null);
  /** The command that already has the keys just pressed. */
  const [taken, setTaken] = useState<string | null>(null);

  // The commands that have keys as the program ships them: those are the ones that can be given others.
  const own = commands.filter((command) => command.id in DEFAULT_SHELL_SHORTCUTS);
  const choose = (id: string, keys: string | undefined) => {
    const next = { ...shortcuts };
    if (keys === undefined || keys === DEFAULT_SHELL_SHORTCUTS[id]) delete next[id];
    else next[id] = keys;
    updatePreferences({ shortcuts: next });
  };

  return (
    <div className={styles.options}>
      <dl className={styles.keys}>
        {own.map((command) => {
          const waiting = listening === command.id;
          return (
            <div key={command.id} className={styles.keyRow}>
              <dt>{t(command.labelKey)}</dt>
              <dd>
                <button
                  type="button"
                  className={styles.keyButton}
                  data-listening={waiting}
                  aria-label={t('shell.shortcuts.change', { command: t(command.labelKey) })}
                  onClick={() => {
                    setTaken(null);
                    setListening(waiting ? null : command.id);
                  }}
                  onBlur={() => waiting && setListening(null)}
                  onKeyDown={(event) => {
                    if (!waiting) return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === 'Escape') return setListening(null);
                    if (event.key === 'Backspace' || event.key === 'Delete') {
                      choose(command.id, '');
                      return setListening(null);
                    }
                    const keys = shortcutOfKeyPress(event, IS_MAC);
                    if (!keys) return;
                    const other = commands.find((known) => known.id !== command.id && known.shortcut === keys);
                    if (other) return setTaken(t(other.labelKey).replace(/…$/, ''));
                    choose(command.id, keys);
                    setListening(null);
                  }}
                >
                  {waiting ? t('shell.shortcuts.press') : shortcutLabel(command) ? <kbd>{shortcutLabel(command)}</kbd> : t('shell.shortcuts.none')}
                </button>
              </dd>
            </div>
          );
        })}
      </dl>
      {taken && (
        <p className={styles.note} role="alert">
          {t('shell.shortcuts.taken', { command: taken })}
        </p>
      )}
      <p className={styles.note}>{t('shell.shortcuts.note')}</p>
      <span>
        <Button disabled={Object.keys(shortcuts).length === 0} onClick={() => updatePreferences({ shortcuts: {} })}>
          {t('shell.shortcuts.reset')}
        </Button>
      </span>
    </div>
  );
}
