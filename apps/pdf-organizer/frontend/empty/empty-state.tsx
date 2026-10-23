import { useTranslation } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon, MenuButton } from '@syntelab/ui-kit';
import { useCallback, useMemo, useState } from 'react';
import { emptyTabCommands } from '../commands';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { DropHint } from '../document/drop-hint';
import { openBinderTab, openFileInTab } from '../document/open-file';
import type { OpenedFiles } from '../document/open-files';
import { useFileCommands } from '../document/use-file-commands';
import { useReceivedFiles } from '../document/use-received-files';
import { useTabCommands } from '../use-tab-commands';
import { DefaultAppNote } from './default-app-note';
import styles from './empty-state.module.css';
import { RecentFileList } from './recent-file-list';

/** Shown in a PDF Organizer tab that has no document: open a file, make a new PDF, or pick a recent one. */
export function EmptyState({ host }: AppViewProps) {
  const t = useTranslation();
  const [problem, setProblem] = useState<string | null>(null);
  const { closeTab } = host;

  const onDone = useCallback(
    (opened: OpenedFiles) => {
      setProblem(opened.problem);
      // The chosen files get their own tabs; this empty one is no longer needed.
      if (opened.chosen > 0 && !opened.problem) closeTab();
    },
    [closeTab],
  );
  const fileCommands = useFileCommands(host, onDone);
  const files = fileCommands.commands;

  const openRecent = useCallback(
    (path: string) => {
      openFileInTab(host, path);
      host.closeTab();
    },
    [host],
  );

  const commands = useMemo(() => emptyTabCommands(files, () => openBinderTab(host, t('pdf-organizer.binder.title'))), [files, host, t]);
  useTabCommands(host, commands);

  // Files dropped here or pasted are gathered in a binder.
  const filesOver = useReceivedFiles(host, (received) => {
    if (received.paths.length > 0) openBinderTab(host, t('pdf-organizer.binder.title'), received.paths);
    setProblem(received.skipped > 0 ? 'pdf-organizer.error.someFilesSkipped' : null);
  });

  return (
    <div className={styles.empty}>
      <DropHint shown={filesOver} textKey="pdf-organizer.drop.toBinder" />
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={onDone} />
      <h1 className={styles.title}>{t('pdf-organizer.empty.title')}</h1>
      <p className={styles.hint}>{t('pdf-organizer.empty.hint')}</p>
      <div className={styles.actions}>
        <span className={styles.split}>
          <Button variant="primary" className={styles.splitMain} onClick={files.onOpen}>
            <Icon name="folder-open" size={18} />
            {t('pdf-organizer.open.button')}
          </Button>
          <MenuButton
            label={t('pdf-organizer.open.more')}
            align="end"
            tooltipSide="bottom"
            sections={[
              {
                id: 'open',
                items: [
                  { id: 'one', kind: 'action', icon: 'folder-open', label: t('pdf-organizer.open.button'), onSelect: files.onOpen },
                  {
                    id: 'several',
                    kind: 'action',
                    icon: 'folder-tree',
                    label: t('pdf-organizer.command.openSeveral'),
                    hint: t('pdf-organizer.hint.openSeveral'),
                    onSelect: files.onOpenSeveral,
                  },
                ],
              },
            ]}
          >
            <Icon name="caret-down" size={14} />
          </MenuButton>
        </span>
        <Button onClick={files.onCreatePdf}>
          <Icon name="wand-magic-sparkles" size={18} />
          {t('pdf-organizer.command.createPdf')}
        </Button>
      </div>
      <p className={styles.dropTip}>{t('pdf-organizer.empty.dropTip')}</p>
      {problem && (
        <p className={styles.problem} role="alert">
          {t(problem)}
        </p>
      )}
      <RecentFileList host={host} onOpen={openRecent} />
      <DefaultAppNote host={host} />
    </div>
  );
}
