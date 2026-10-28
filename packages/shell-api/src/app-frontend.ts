import type { Command } from '@syntelab/command-registry';
import type { ComponentType } from 'react';
import type { ToolEntry } from './app-manifest';

/** Values a tab carries for its app (for example the file it shows). */
export type AppTabParams = Readonly<Record<string, string>>;

export interface AppTabRequest {
  /**
   * Identifies the tab among the app's tabs: opening the same key again
   * activates the existing tab. Without a key the app's main tab is used.
   */
  readonly key?: string;
  /** Shown on the tab. Defaults to the app's name. */
  readonly title?: string;
  readonly params?: AppTabParams;
}

export interface PickSavePathOptions {
  /** Name of the file type shown in the dialog, already translated. */
  readonly typeName: string;
  /** Extension without the dot: `pdf`. Added to the name when the user leaves it out. */
  readonly extension: string;
  /** The file name the dialog starts with. */
  readonly suggestedName: string;
  /**
   * Several types to choose among, in place of `typeName` and `extension`:
   * the first is the one the dialog starts with. An extension `*` lets the
   * user write any ending ("All files").
   */
  readonly types?: readonly { readonly name: string; readonly extensions: readonly string[] }[];
}

export interface PickFilesOptions {
  /** Name of the file type shown in the dialog, already translated. */
  readonly typeName: string;
  /** Extensions without the dot: `['pdf']`. */
  readonly extensions: readonly string[];
  readonly multiple?: boolean;
}

/** One sheet to print: a picture of a page. */
export interface PrintPage {
  /** Where the picture is (a `resourceUrl`). */
  readonly url: string;
  /** True for a page wider than it is tall; it is printed on a sheet turned sideways. */
  readonly landscape: boolean;
  /** The real size of the page, in millimetres: needed to print it at that size. */
  readonly width?: number;
  readonly height?: number;
}

/** How pictures are put on paper. Everything left out is as the printer has it. */
export interface PrintOptions {
  /** The paper, upright, in millimetres: the print window starts with it. Without it, the printer's own paper is used. */
  readonly sheet?: { readonly width: number; readonly height: number };
  /** `auto` (the default) turns the sheet sideways for wide pages; the others lay every sheet the same way. */
  readonly orientation?: 'auto' | 'portrait' | 'landscape';
  /** True (the default): each page is made to fit its sheet. False: pages are printed at their real size. */
  readonly fit?: boolean;
}

/**
 * How much of the shell is hidden around the app: nothing, its bars (the app
 * has the whole window), or its bars with the window covering the screen.
 */
export type ImmersiveMode = 'none' | 'read' | 'full-screen';

/**
 * Everything an app's interface gets from the shell, for one tab. The app
 * never talks to the system or to its Rust side in any other way.
 */
export interface AppHost {
  readonly appId: string;
  /** False while another tab is in front; heavy content should be released. */
  readonly active: boolean;
  readonly params: AppTabParams;
  readonly immersive: ImmersiveMode;
  /** Hides or shows the shell's bars. The user can always leave with Escape. */
  setImmersive(mode: ImmersiveMode): void;
  /**
   * The tool of this tab whose bar is open (the key of its menu, as in
   * `app.json` `tools`), or null while the user only reads. The app shows what
   * the tool works on: the grid of pages for Organize, the pen for Sign.
   */
  readonly tool: string | null;
  /** The app's tools, as its `app.json` lists them: for a start page that shows them as cards. */
  readonly tools: readonly ToolEntry[];
  /** Opens the bar of one of the app's tools in this tab, or closes it with null (a card of a start page). */
  showTool(menuKey: string | null): void;
  /**
   * Whether the bar of `idleTool` (app.json) stands over the content while no
   * tool is open: true while the tab shows something to work on (a document),
   * not on a start page. Hidden until the app says so.
   */
  setIdleBar(shown: boolean): void;
  /** Runs a command of the app's Rust side. Rejects with an `AppInvokeError`. */
  invoke<T>(command: string, payload?: unknown): Promise<T>;
  /** URL of binary data produced by the app's Rust side (pictures…). */
  resourceUrl(path: string, query?: Readonly<Record<string, string | number>>): string;
  /** Asks the user for files. Returns their paths; empty when cancelled. */
  pickFiles(options: PickFilesOptions): Promise<string[]>;
  /**
   * Adds commands to the program (menus, tools, search) and
   * returns a function that removes them. An app registers the commands of
   * the tab in front, and replaces them when their state changes.
   */
  registerCommands(commands: readonly Command[]): () => void;
  /** Asks the user where to save a file. Returns the path; null when cancelled. */
  pickSavePath(options: PickSavePathOptions): Promise<string | null>;
  /**
   * Where on disk files dropped on the window are, in their order. Null when
   * the window cannot tell (a plain browser, a system that does not say):
   * then only their content can be used.
   */
  pathsOfDropped(files: readonly File[]): Promise<readonly string[] | null>;
  /** Asks the user for a folder (to write several files into). Returns its path; null when cancelled. */
  pickFolder(): Promise<string | null>;
  /**
   * Prints pictures, one per sheet, through the system's print window (the
   * user picks the printer there, or cancels). Resolves when that window is
   * closed; rejects when a picture could not be loaded.
   */
  printImages(pages: readonly PrintPage[], options?: PrintOptions): Promise<void>;
  /**
   * Hands an address the user clicked (a link in a document) to the system:
   * a web page opens in the browser, `mailto:` in the mail program. Only
   * `http:`, `https:` and `mailto:` are opened; anything else is refused.
   */
  openLink(url: string): Promise<void>;
  /**
   * Offers a file on disk to the system's "Share" window (mail, nearby
   * devices…). Where the system has none, the file is shown in its folder.
   */
  shareFile(path: string): Promise<void>;
  /** Opens the folder of a file the app wrote in the system's file manager, with that file selected. */
  showInFolder(path: string): Promise<void>;
  /**
   * Saves the web page at an address the user typed as a PDF at
   * `destination`, with the browser installed on the computer. The program
   * goes online for this only, and only when the user asks. Rejects with an
   * error whose message is `not-an-address`, `no-browser` or `failed`.
   */
  saveWebPage(address: string, destination: string): Promise<void>;
  /**
   * Reads the source (HTML) of the web page at an address the user typed,
   * with the browser installed on the computer. The program goes online for
   * this only, and only when the user asks. Rejects with an error whose
   * message is `not-an-address`, `no-browser` or `failed`.
   */
  readWebPage(address: string): Promise<string>;
  /**
   * Whether the user chose this program as the system's default app for PDF
   * files. Null where that cannot be chosen (only Windows for now, and only
   * the installed program).
   */
  isDefaultPdfApp(): Promise<boolean | null>;
  /**
   * Opens the system's settings where the user makes this program the default
   * app for PDF files (a program cannot make itself the default).
   */
  openDefaultAppSettings(): Promise<void>;
  /**
   * Small data the app wants to find again next time (a list of recent
   * files, a choice…). Kept on this computer, per app. `loadData` returns
   * undefined when nothing was saved under the key.
   */
  loadData<T>(key: string): T | undefined;
  saveData(key: string, value: unknown): void;
  /** Opens (or activates) another tab of this app. */
  openTab(request: AppTabRequest): void;
  /** Opens Settings at this app's own part. */
  openSettings(): void;
  /**
   * Tells the shell whether this tab holds changes that closing it would
   * lose. While it does, the shell marks the tab and asks before closing it
   * or the program.
   */
  setUnsavedChanges(unsaved: boolean): void;
  /**
   * Closes the tab this host belongs to. The user is asked first when the tab
   * has unsaved changes, unless `discardChanges` says they no longer matter
   * (they were just saved elsewhere).
   */
  closeTab(options?: { readonly discardChanges?: boolean }): void;
}

export interface AppViewProps {
  readonly host: AppHost;
}

/** What the app's own part of Settings gets from the shell: its place to keep small data, and its own Rust side to ask (what the settings list may be known only there). */
export type AppSettingsHost = Pick<AppHost, 'appId' | 'loadData' | 'saveData' | 'invoke'>;

export interface AppSettingsProps {
  readonly host: AppSettingsHost;
}

/** What `apps/<app-id>/frontend/index.ts` exports as default. */
export interface AppFrontend {
  /** Shown inside each of the app's tabs. */
  readonly View: ComponentType<AppViewProps>;
  /**
   * The app's own settings, shown in the app's part of Settings under the
   * ones the shell offers for every app (its layout). They apply to this app
   * only.
   */
  readonly Settings?: ComponentType<AppSettingsProps>;
}

export type AppInvokeErrorKind = 'not-found' | 'invalid-request' | 'superseded' | 'failed' | 'unavailable';

/** Why a command of the app's Rust side did not succeed. */
export class AppInvokeError extends Error {
  readonly kind: AppInvokeErrorKind;
  /** For `failed`: a stable code the app can translate. */
  readonly code: string | null;

  constructor(kind: AppInvokeErrorKind, code: string | null, detail: string) {
    super(detail);
    this.name = 'AppInvokeError';
    this.kind = kind;
    this.code = code;
  }
}
