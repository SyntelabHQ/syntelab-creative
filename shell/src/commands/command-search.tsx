import { searchItems, useCommands } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import type { AppEntry } from '@syntelab/shell-api';
import { Icon, useDismiss } from '@syntelab/ui-kit';
import { useCallback, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AppIcon, useApps, useAppTexts } from '../apps';
import { tabs } from '../tabs';
import styles from './command-search.module.css';
import { commandRegistry } from './shell-commands';

/** One thing the search can find, and what choosing it does. */
interface Found {
  readonly id: string;
  readonly label: string;
  /** The app it belongs to, named beside it; none for a command of the program. */
  readonly app?: AppEntry;
  /** Said after the label, smaller: what an app is for. */
  readonly detail?: string;
  /** Every name it answers to: in the language of the program and in English. */
  readonly names: readonly string[];
  readonly run: () => void;
}

/** The most results listed: the nearest ones, not a page to scroll. */
const LISTED_MOST = 12;

/**
 * Finds what the program has by its name, in the current language or in
 * English: the apps, what each app says can be opened in it (a tool, a
 * converter: `search` in its manifest), and the commands. An app is found
 * by what it is for too ("pdf", "text", "developers").
 */
export function CommandSearch() {
  const { t, tSource } = useI18n();
  const commands = useCommands(commandRegistry);
  const { apps } = useApps();
  const appTexts = useAppTexts();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  // An app that is only planned cannot be opened: it would be a dead end in the results.
  const usableApps = apps.filter((app) => app.manifest.status === 'active');
  const found: Found[] = [
    ...usableApps.map((app) => {
      const { id, name, description } = app.manifest;
      return { id: `app:${id}`, label: appTexts.name(app), app, detail: appTexts.description(app), names: [appTexts.name(app), appTexts.description(app), name.en ?? '', description.en ?? '', id], run: () => tabs.openApp(id) };
    }),
    ...usableApps.flatMap((app) =>
      (app.manifest.search ?? []).map((entry) => {
        const label = t(entry.labelKey);
        // The tab is named as the apps name their own tabs for such a thing (`tool:base64`, `converter:length`), so
        // one that is already open is come back to, not opened twice. It is titled as the app, since what an app
        // shows in a tab may change while the tab stays.
        const [[name, value] = ['search', entry.id]] = Object.entries(entry.params ?? {});
        return { id: `app:${app.manifest.id}:${entry.id}`, label, app, names: [label, tSource(entry.labelKey)], run: () => tabs.openApp(app.manifest.id, { key: `${name}:${value}`, params: entry.params ?? {} }) };
      }),
    ),
    // Commands that are only planned would be dead ends too.
    ...commands
      .filter((command) => !command.comingSoon)
      .map((command) => ({ id: `command:${command.id}`, label: t(command.labelKey), names: [t(command.labelKey), tSource(command.labelKey)], run: () => void commandRegistry.execute(command.id) })),
  ];
  const results = searchItems(found, query, (item) => item.names).slice(0, LISTED_MOST);
  const open = query.trim() !== '';
  const optionId = (index: number) => `${listId}-${index}`;

  const close = useCallback(() => setQuery(''), []);
  useDismiss(containerRef, open, close);

  const run = (item: Found) => {
    close();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const item = results[activeIndex];
      if (item) run(item);
    }
  };

  return (
    <div ref={containerRef} className={styles.search}>
      <span className={styles.icon}>
        <Icon name="magnifying-glass" size={18} />
      </span>
      <input
        type="search"
        role="combobox"
        className={styles.input}
        aria-label={t('shell.search.placeholder')}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results.length > 0 ? optionId(activeIndex) : undefined}
        placeholder={t('shell.search.placeholder')}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      <ul id={listId} role="listbox" className={styles.results} hidden={!open}>
        {results.map((item, index) => (
          <li key={item.id} id={optionId(index)} role="option" aria-selected={index === activeIndex} className={styles.option} onPointerEnter={() => setActiveIndex(index)} onClick={() => run(item)}>
            {item.app && (
              <span className={styles.app} aria-hidden="true">
                <AppIcon app={item.app} size={18} />
              </span>
            )}
            <span className={styles.label}>{item.label}</span>
            {/* An app says what it is for; a thing of an app says whose it is. */}
            {item.app && <span className={styles.detail}>{item.detail ?? appTexts.name(item.app)}</span>}
          </li>
        ))}
        {open && results.length === 0 && (
          <li role="presentation" className={styles.empty}>
            {t('shell.search.noResults')}
          </li>
        )}
      </ul>
    </div>
  );
}
