import { createContext } from 'react';

/** What a tool was opened with from outside the program. */
export interface LaunchedInto {
  /** Full paths: files, or folders when the entry was chosen on folders. */
  readonly files: readonly string[];
  /** They go to the list of files worked on in one run, even when there is one (which may be a folder). */
  readonly listed?: boolean;
  /** They are folders. */
  readonly folders?: boolean;
}

/**
 * The files the tool that is shown was opened with from outside the program
 * (an entry of the file manager's right-click menu, or a file opened with
 * the program); null for a tool opened from inside it. A tool takes them
 * once, when it is made: one file is opened as a file chosen by the user
 * is, several go to the list of files worked on in one run.
 */
export const LaunchedFiles = createContext<LaunchedInto | null>(null);
