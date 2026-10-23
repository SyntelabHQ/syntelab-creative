import { formatShortcut, shortcutOfKeyPress } from '@syntelab/command-registry';
import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { useState } from 'react';
import { SHORTCUT_LIST } from '../commands';
import styles from './settings.module.css';

export interface ShortcutEditorProps {
  /** The keys the user chose, by command id; an empty text means "no keys". Commands not named keep their own. */
  readonly chosen: Readonly<Record<string, string>>;
  readonly onChange: (chosen: Record<string, string>) => void;
}

/** The keys a command answers to now: the user's, else its own. */
function shortcutNow(id: string, own: string, chosen: Readonly<Record<string, string>>): string {
  return chosen[id] ?? own;
}

/** True for keys that may run a command: with Ctrl or Alt, or a function key. Plain letters are for typing. */
function usableShortcut(shortcut: string): boolean {
  return shortcut.includes('Mod+') || shortcut.includes('Alt+') || /^(Shift\+)?F\d{1,2}$/.test(shortcut);
}

/**
 * The choice after `id` was given `shortcut`: a command that had those keys
 * loses them (two commands cannot answer to the same keys), and a choice that
 * is the command's own keys is forgotten.
 */
function withShortcut(chosen: Readonly<Record<string, string>>, id: string, shortcut: string): Record<string, string> {
  const next: Record<string, string> = { ...chosen };
  for (const other of SHORTCUT_LIST) {
    if (other.id !== id && shortcut !== '' && shortcutNow(other.id, other.shortcut, chosen) === shortcut) next[other.id] = '';
  }
  const own = SHORTCUT_LIST.find((command) => command.id === id)?.shortcut;
  if (shortcut === own) delete next[id];
  else next[id] = shortcut;
  return next;
}

/** The keys of every command, each to be changed (press the new keys), cleared or put back. */
export function ShortcutEditor({ chosen, onChange }: ShortcutEditorProps) {
  const t = useTranslation();
  /** The id of the command whose new keys are being waited for. */
  const [listening, setListening] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <dl className={styles.keys}>
      {SHORTCUT_LIST.map(({ id, labelKey, shortcut: own }) => {
        const now = shortcutNow(id, own, chosen);
        const waiting = listening === id;
        return (
          <div key={id} className={styles.keyRow}>
            <dt>{t(labelKey).replace(/…$/, '')}</dt>
            <dd className={styles.keyEdit}>
              <button
                type="button"
                className={styles.keyButton}
                data-listening={waiting}
                aria-label={t('pdf-organizer.settings.shortcutChange', { command: t(labelKey).replace(/…$/, '') })}
                onClick={() => {
                  setRefused(false);
                  setListening(waiting ? null : id);
                }}
                onBlur={() => waiting && setListening(null)}
                onKeyDown={(event) => {
                  if (!waiting) return;
                  // These keys are an answer to the question, not a command to run.
                  event.preventDefault();
                  event.stopPropagation();
                  event.nativeEvent.stopImmediatePropagation();
                  if (event.key === 'Escape') return setListening(null);
                  if (event.key === 'Backspace' || event.key === 'Delete') {
                    onChange(withShortcut(chosen, id, ''));
                    return setListening(null);
                  }
                  const pressed = shortcutOfKeyPress(event, isMac);
                  if (pressed === null) return;
                  if (!usableShortcut(pressed)) return setRefused(true);
                  onChange(withShortcut(chosen, id, pressed));
                  setListening(null);
                }}
              >
                {waiting ? t(refused ? 'pdf-organizer.settings.shortcutRefused' : 'pdf-organizer.settings.shortcutPress') : now ? <kbd>{formatShortcut(now, isMac)}</kbd> : t('pdf-organizer.settings.shortcutNone')}
              </button>
              <IconButton
                variant="ghost"
                className={styles.revert}
                aria-label={t('pdf-organizer.settings.revert')}
                tooltipSide="bottom-end"
                disabled={chosen[id] === undefined}
                onClick={() => {
                  // Its own keys back; whoever took them meanwhile gives them up.
                  const { [id]: _mine, ...rest } = chosen;
                  onChange(withShortcut(rest, id, own));
                }}
              >
                <Icon name="arrow-rotate-left" size={14} />
              </IconButton>
            </dd>
          </div>
        );
      })}
      <div className={styles.keysFoot}>
        <span>{t('pdf-organizer.settings.shortcutHow')}</span>
        <Button disabled={Object.keys(chosen).length === 0} onClick={() => onChange({})}>
          <Icon name="arrow-rotate-left" size={14} />
          {t('pdf-organizer.settings.shortcutReset')}
        </Button>
      </div>
    </dl>
  );
}
