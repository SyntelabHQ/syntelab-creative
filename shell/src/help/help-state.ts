import type { Command } from '@syntelab/command-registry';
import { createStore } from '../state/create-store';
import { tabs } from '../tabs/tabs-controller';
import { SHELL_MANUAL } from './manual';

/**
 * The commands Help lists: those of the tab Help was opened from. An app
 * keeps the commands of the tab in front only, so they are taken when Help
 * is asked for, before its own tab comes to the front.
 */
export const helpCommands = createStore<readonly Command[]>([]);

/** What Help was asked to open at: the manual of an app (or of the program), or what that manual says about itself. */
export interface HelpTarget {
  /** The id of an app, or `SHELL_MANUAL`. */
  readonly manual: string;
  /** The "About" chapter of that manual in place of its first chapter. */
  readonly about: boolean;
}

/** Where the reader is in Help: what is in view (a topic of a manual, or the commands of one menu) and what is searched for. */
export interface HelpPlace {
  readonly shown: { readonly kind: 'topic'; readonly manual: string; readonly topic: string } | { readonly kind: 'menu'; readonly menuKey: string } | null;
  readonly query: string;
  /**
   * Whose Help this is: an app's (its own manual and nothing else), or the program's (`SHELL_MANUAL`: what the
   * program and each app say of themselves, and the manual of the program). It follows the tab Help is asked from.
   */
  readonly scope: string;
  /** Where to go once the manuals are read; null when the reader is where they want to be. */
  readonly goTo: HelpTarget | null;
}

/** Kept apart from the view, which is put away while another tab is in front. */
export const helpPlace = createStore<HelpPlace>({ shown: null, query: '', scope: SHELL_MANUAL, goTo: null });

const FOLDED_KEY = 'syntelab-creative.help.folded';

function readFolded(): readonly string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** The parts of the contents the reader folded away (a manual, "About", the commands), by their ids. Found again next time. */
export const helpFolded = createStore<readonly string[]>(readFolded());
helpFolded.subscribe(() => {
  try {
    localStorage.setItem(FOLDED_KEY, JSON.stringify(helpFolded.get()));
  } catch {
    // Storage can be unavailable; the folding then lasts for this run only.
  }
});

/** Folds a part of the contents, or opens it again. */
export function setHelpFolded(id: string, folded: boolean): void {
  helpFolded.set((current) => (folded === current.includes(id) ? current : folded ? [...current, id] : current.filter((known) => known !== id)));
}

/**
 * Opens Help in its tab, or brings that tab to the front, as the Help of
 * what it is asked from. From an app: that app's manual, and only it. From
 * Start or Settings: the program's, which opens at what the program says of
 * itself. With `about` it is always the program's Help, at what the app it
 * is asked from says of itself. `commands` are those of the tab it is asked
 * from. Asked from Help itself, without `about`, nothing moves.
 */
export function openHelp(commands: readonly Command[], about = false): void {
  const { activeId, tabs: open } = tabs.store.get();
  const from = open.find((tab) => tab.id === activeId);
  if (from?.kind !== 'help') {
    helpCommands.set(commands.filter((command) => !command.comingSoon));
    const app = from?.kind === 'app' && from.appId ? from.appId : null;
    // What is said about the program and its apps is in the program's Help; so is everything asked for outside an app.
    const ofProgram = about || app === null;
    helpPlace.set((place) => ({ ...place, query: '', scope: ofProgram ? SHELL_MANUAL : (app ?? SHELL_MANUAL), goTo: { manual: app ?? SHELL_MANUAL, about: ofProgram } }));
  } else if (about) helpPlace.set((place) => ({ ...place, query: '', scope: SHELL_MANUAL, goTo: { manual: SHELL_MANUAL, about } }));
  tabs.openHelp();
}
