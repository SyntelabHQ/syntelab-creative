import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { useMemo, useState } from 'react';
import type { FileCommandsInput } from '../commands';
import { openBatchTab } from './open-file';
import { pickAndOpenFiles } from './open-files';
import type { OpenedFiles } from './open-files';

export interface FileCommands {
  /** What the commands do; handed to the command lists. */
  readonly commands: FileCommandsInput;
  /** The "Create a PDF" window is asked for; the tab shows it (see `CreatePdfDialog`). */
  readonly creating: boolean;
  readonly closeCreating: () => void;
}

/**
 * What "Open", "Open several files", "Create a PDF", "Batch processing" and "Settings" do, the
 * same in every kind of tab. `onDone` hears how opening went (to show a
 * problem, or to close a tab that is no longer needed).
 */
export function useFileCommands(host: AppHost, onDone: (opened: OpenedFiles) => void): FileCommands {
  const t = useTranslation();
  const [creating, setCreating] = useState(false);
  const commands = useMemo(
    () => ({
      onOpen: () => void pickAndOpenFiles(host, t, false).then(onDone),
      onOpenSeveral: () => void pickAndOpenFiles(host, t, true).then(onDone),
      onCreatePdf: () => setCreating(true),
      onBatch: () => openBatchTab(host, t('pdf-organizer.command.batch')),
      onSignBatch: () => openBatchTab(host, t('pdf-organizer.command.signBatch'), [], 'sign'),
      onSettings: host.openSettings,
    }),
    // `host` changes when the tab moves to the back; what it opens does not.
    [host.openTab, host.pickFiles, host.invoke, host.openSettings, t, onDone],
  );
  return useMemo(
    () => ({ commands, creating, closeCreating: () => setCreating(false) }),
    [commands, creating],
  );
}
