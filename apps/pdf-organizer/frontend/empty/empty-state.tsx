import { useTranslation } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Button, Icon, MenuButton, ToolCards } from '@syntelab/ui-kit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emptyTabCommands } from '../commands';
import { openFilesInTabs } from '../document/drafts';
import { pickAndOpenFiles } from '../document/open-files';
import { pageSourceProblem } from '../document/page-sources';
import { CreatePdfDialog } from '../create/create-pdf-dialog';
import { DropHint } from '../document/drop-hint';
import { openBinderTab, openFileInTab } from '../document/open-file';
import type { OpenedFiles } from '../document/open-files';
import { useFileCommands } from '../document/use-file-commands';
import { openDroppedFiles } from '../document/dropped-files';
import { useDroppedFiles } from '../document/use-received-files';
import { useTabCommands } from '../use-tab-commands';
import { DefaultAppNote } from './default-app-note';
import styles from './empty-state.module.css';
import { RecentFileList } from './recent-file-list';

/**
 * The start page of PDF Organizer, in a tab that has no document: what to do
 * today, as cards of the tools; open a file, make a new PDF, or pick a recent
 * one. A tool that works on a document asks for the file first, then opens
 * with it.
 */
export interface EmptyStateProps extends AppViewProps {
  /** Files to open at once, each in its own tab: a non-PDF as an unsaved PDF made from it ("Convert to PDF" in the file manager's menu). */
  readonly openFiles?: readonly string[];
}

export function EmptyState({ host, openFiles }: EmptyStateProps) {
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

  // Once only, even when React runs the effect twice.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !openFiles || openFiles.length === 0) return;
    started.current = true;
    void openFilesInTabs(host, openFiles).then((failed) =>
      onDone({ chosen: openFiles.length, problem: failed[0] ? pageSourceProblem(failed[0].error) : null }),
    );
  }, [host, openFiles, onDone]);
  const files = fileCommands.commands;

  const openRecent = useCallback(
    (path: string) => {
      openFileInTab(host, path);
      host.closeTab();
    },
    [host],
  );

  const newBinder = useCallback(() => openBinderTab(host, t('pdf-organizer.binder.title')), [host, t]);
  const commands = useMemo(() => emptyTabCommands(files, newBinder), [files, newBinder]);
  useTabCommands(host, commands);

  /** A tool chosen with no document: the steps of their own start; the others ask for the file, and the document opens with the tool. */
  const { showTool } = host;
  const chooseTool = useCallback(
    (menuKey: string) => {
      const own: Record<string, () => void> = {
        'pdf-organizer.menu.create': files.onCreatePdf,
        'pdf-organizer.menu.combine': newBinder,
        'pdf-organizer.menu.batch': files.onBatch,
      };
      if (own[menuKey]) return own[menuKey]();
      void pickAndOpenFiles(host, t, false, menuKey).then(onDone);
    },
    // `host` changes when the tab moves to the back; what it opens does not.
    [files, newBinder, host.pickFiles, host.openTab, t, onDone],
  );
  // A tool chosen in the list on the side, while there is no document to open it on.
  const asked = host.tool;
  useEffect(() => {
    if (!asked) return;
    showTool(null);
    chooseTool(asked);
  }, [asked, showTool, chooseTool]);

  // Files dropped here or pasted open each in a tab of its own.
  const filesOver = useDroppedFiles(host, (dropped) => void openDroppedFiles(host, dropped).then(onDone));

  return (
    <div className={styles.empty}>
      <DropHint shown={filesOver} textKey="pdf-organizer.drop.toTabs" icon="folder-open" />
      <CreatePdfDialog host={host} open={fileCommands.creating} onClose={fileCommands.closeCreating} onDone={onDone} />
      <div className={styles.page}>
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <h1 className={styles.title}>{t('pdf-organizer.start.title')}</h1>
            <p className={styles.hint}>{t('pdf-organizer.start.lead')}</p>
          </div>
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
          </div>
        </div>
        {problem && (
          <p className={styles.problem} role="alert">
            {t(problem)}
          </p>
        )}
        <ToolCards
          title={t('pdf-organizer.start.tools')}
          cards={host.tools.map((tool) => ({
            id: tool.menuKey,
            name: t(tool.menuKey),
            description: tool.hintKey ? t(tool.hintKey) : undefined,
            icon: tool.icon,
            color: tool.color,
            onChoose: () => chooseTool(tool.menuKey),
          }))}
        />
        <RecentFileList host={host} onOpen={openRecent} />
        <p className={styles.dropTip}>{t('pdf-organizer.empty.dropTip')}</p>
        <DefaultAppNote host={host} />
      </div>
    </div>
  );
}
