import { useI18n, useTranslation } from '@syntelab/i18n';
import { localizeText } from '@syntelab/shell-api';
import { useEffect, useId, useMemo, useState } from 'react';
import { useApps } from '../apps';
import { isTauri } from '../platform';
import styles from '../preferences/pickers.module.css';

/** An entry as the Rust side takes it (`explorer_menu.rs`). */
interface Entry {
  readonly appId: string;
  readonly id: string;
  readonly label: string;
  readonly fileTypes: readonly string[];
  /** The label of the entry it opens from, when its app gathers its entries under one ("Syntelab Dev"). */
  readonly groupLabel?: string;
}

/** What the Rust side says of the menu (`explorer_menu_state`). */
interface MenuState {
  readonly supported: boolean;
  readonly registered: boolean;
  readonly complete?: boolean;
  /** A development build, which does not add the entries. */
  readonly development?: boolean;
  /** The entries start another program, or an earlier version wrote them: to be written again. */
  readonly outdated?: boolean;
}

async function call<T>(command: string, payload: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, payload);
}

/** What the apps that can be used declare, with their labels in the language of the program. */
function useEntries(): Entry[] {
  const t = useTranslation();
  const { fallbackChain } = useI18n();
  const { apps } = useApps();
  return useMemo<Entry[]>(
    () =>
      apps
        .filter((app) => app.manifest.status === 'active')
        .flatMap((app) => {
          const groupLabel = app.manifest.contextMenuGrouped ? t('shell.explorerMenu.group', { app: localizeText(app.manifest.name, fallbackChain) }) : undefined;
          return (app.manifest.contextMenu ?? []).map((entry) => ({ appId: app.manifest.id, id: entry.id, label: t(entry.labelKey), fileTypes: entry.fileTypes ?? [], groupLabel }));
        })
        .filter((entry) => entry.fileTypes.length > 0),
    [apps, t, fallbackChain],
  );
}

/**
 * When the program starts: entries that are in the menu but start another
 * program (one since moved, a development build) or were written by an
 * earlier version are written again, to start this one. The user turned the
 * menu on; it is kept as they asked, only pointed at the program in use.
 */
export function useExplorerMenuUpkeep(): void {
  const entries = useEntries();
  useEffect(() => {
    if (!isTauri() || entries.length === 0) return;
    void call<MenuState>('explorer_menu_state', { entriesAsked: entries })
      .then((state) => (state.outdated ? call('set_explorer_menu', { enabled: true, entriesAsked: entries }) : undefined))
      .catch(() => {});
  }, [entries]);
}

/**
 * Whether the apps' entries ("Convert to PDF with PDF Organizer"…) show in
 * the right-click menu of the system's file manager. Shown only where the
 * system has such a menu the program can add to; the entries are added for
 * this user alone. When an app has gained entries since they were added,
 * that is said, and the new ones are added when the user asks: the menu is
 * never changed unasked.
 */
export function ExplorerMenuSetting({ sectionClassName, headingClassName }: { readonly sectionClassName?: string; readonly headingClassName?: string }) {
  const t = useTranslation();
  const noteId = useId();
  const entries = useEntries();
  const [state, setState] = useState<MenuState | null>(null);
  const [problem, setProblem] = useState(false);

  useEffect(() => {
    if (!isTauri() || entries.length === 0) return;
    let cancelled = false;
    call<MenuState>('explorer_menu_state', { entriesAsked: entries })
      .then((answer) => !cancelled && setState(answer))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [entries]);

  if (!state?.supported) return null;
  // An entry shown on files and on folders is named once; the entries of a group after its own label.
  const named = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = entry.groupLabel ?? '';
    named.set(key, (named.get(key) ?? new Set()).add(entry.label));
  }
  const labels = [...named]
    .flatMap(([group, labels]) => (group ? [`${group} (${[...labels].join(', ')})`] : [...labels]))
    .join(', ');

  const change = async (enabled: boolean) => {
    setProblem(false);
    try {
      await call('set_explorer_menu', { enabled, entriesAsked: entries });
      setState({ ...state, registered: enabled, complete: enabled });
    } catch {
      setProblem(true);
    }
  };

  return (
    <section className={sectionClassName}>
      <h2 className={headingClassName}>{t('shell.explorerMenu.title')}</h2>
      <div className={styles.options}>
      <label className={styles.option}>
        <input
          type="checkbox"
          checked={state.registered}
          // A development build only takes the entries out.
          disabled={state.development && !state.registered}
          aria-describedby={noteId}
          onChange={(event) => void change(event.target.checked)}
        />
        {t('shell.explorerMenu.show')}
      </label>
      <p id={noteId} className={styles.note}>
        {t('shell.explorerMenu.note', { entries: labels })}
      </p>
      {state.development && <p className={styles.note}>{t('shell.explorerMenu.development')}</p>}
      {state.registered && state.complete === false && !state.development && (
        <p className={styles.note} role="status">
          {t('shell.explorerMenu.incomplete', { entries: labels })}{' '}
          <button type="button" onClick={() => void change(true)}>
            {t('shell.explorerMenu.addNew')}
          </button>
        </p>
      )}
      {problem && (
        <p className={styles.note} role="alert">
          {t('shell.explorerMenu.failed')}
        </p>
      )}
      </div>
    </section>
  );
}
