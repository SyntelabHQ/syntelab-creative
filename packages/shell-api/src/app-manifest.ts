/**
 * Contract version the shell understands. Mirrors `API_VERSION` in
 * `crates/syntelab-app-api`.
 */
export const API_VERSION = 1;

/** Text per language code, as written in `app.json`. */
export type LocalizedText = Readonly<Record<string, string>>;

export type AppStatus = 'active' | 'coming-soon';

export interface AppBrand {
  /** `#RRGGBB`. */
  readonly color: string;
  /** Path of the icon inside the app folder. */
  readonly icon: string;
}

/** An entry the app wants in the file manager's right-click menu. */
export interface ContextMenuEntry {
  /** Lowercase words joined by hyphens: `combine-to-pdf`. The app is told this when the entry is chosen. */
  readonly id: string;
  /** The key of its label in the app's translations. */
  readonly labelKey: string;
  /** The kinds of files it shows on, each as an ending with its dot (`.pdf`). */
  readonly fileTypes?: readonly string[];
}

/** Something of an app the search of the Start page finds and opens: a tool, a converter. */
export interface SearchEntry {
  /** Tells it apart from the app's other entries. */
  readonly id: string;
  /** The key of its name in the app's translations. */
  readonly labelKey: string;
  /** What the tab that is opened for it is given (`AppHost.params`). */
  readonly params?: Readonly<Record<string, string>>;
}

/** The parts of `apps/<app-id>/app.json` the shell reads. */
export interface AppManifest {
  readonly id: string;
  readonly version: string;
  readonly apiVersion: number;
  readonly status: AppStatus;
  readonly name: LocalizedText;
  readonly description: LocalizedText;
  readonly brand: AppBrand;
  readonly fileTypes?: readonly string[];
  /** What the app adds to the file manager's right-click menu. */
  readonly contextMenu?: readonly ContextMenuEntry[];
  /**
   * The entries of `contextMenu` open to the side from one named after the
   * app ("Syntelab Dev"), instead of each standing in the menu by itself.
   */
  readonly contextMenuGrouped?: boolean;
  /** What of the app the search of the Start page finds besides the app itself. */
  readonly search?: readonly SearchEntry[];
  /**
   * The layout the app starts with (`classic`, `ribbon` or `side-panel`),
   * until the user picks another one for this app.
   */
  readonly defaultLayout?: string;
}

/** An app as the shell lists it: its manifest plus the icon's SVG source. */
export interface AppEntry {
  readonly manifest: AppManifest;
  readonly iconSvg: string | null;
}

/** Picks the first language of the fallback chain the text exists in. */
export function localizeText(text: LocalizedText, fallbackChain: readonly string[]): string {
  for (const language of fallbackChain) {
    const value = text[language];
    if (value) return value;
  }
  return Object.values(text)[0] ?? '';
}
