import { useCommands } from '@syntelab/command-registry';
import { useI18n } from '@syntelab/i18n';
import type { AppEntry } from '@syntelab/shell-api';
import { useApps, useAppTexts } from '../apps';
import { tabs } from '../tabs';
import { commandRegistry } from './shell-commands';

/** One thing the search can find, and what choosing it does. */
export interface Found {
  readonly id: string;
  readonly label: string;
  /** The app it belongs to, named beside it; none for a command of the program. */
  readonly app?: AppEntry;
  /** Said after the label, smaller: what an app is for, or the tool a command belongs to. */
  readonly detail?: string;
  /** For a command: its icon (a file of `assets/icons/`). */
  readonly icon?: string;
  /** The color of its icon (a tool of the app in front), as a CSS value. */
  readonly color?: string;
  /** Every name it answers to: in the language of the program and in English. */
  readonly names: readonly string[];
  readonly run: () => void;
}

/**
 * Everything the search can find, by its name, in the current language or in
 * English: the apps, what each app says can be opened in it (a tool, a
 * converter: `search` in its manifest), and the commands, with the tool
 * each belongs to. An app is found by what it is for too ("pdf", "text",
 * "developers").
 */
export function useSearchItems(): Found[] {
  const { t, tSource } = useI18n();
  const commands = useCommands(commandRegistry);
  const { apps } = useApps();
  const appTexts = useAppTexts();

  // An app that is only planned cannot be opened: it would be a dead end in the results.
  const usableApps = apps.filter((app) => app.manifest.status === 'active');
  return [
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
      .map((command) => ({
        id: `command:${command.id}`,
        label: t(command.labelKey),
        icon: command.icon,
        detail: command.menuKey ? t(command.menuKey) : undefined,
        // Found by the name of its tool too: "organize" lists what Organize pages does.
        names: [t(command.labelKey), tSource(command.labelKey), ...(command.menuKey ? [t(command.menuKey), tSource(command.menuKey)] : [])],
        run: () => void commandRegistry.execute(command.id),
      })),
  ];
}
