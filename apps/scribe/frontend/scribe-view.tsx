import { useTranslation } from '@syntelab/i18n';
import type { AppViewProps } from '@syntelab/shell-api';
import { Icon, IconButton } from '@syntelab/ui-kit';
import { CompareView } from './compare/compare-view';
import { useDroppedFiles } from './document/dropped-files';
import { EditorView } from './editor/editor-view';
import { FolderSearchView } from './folder/folder-search-view';
import { LargeFileView } from './large/large-file-view';
import styles from './scribe-view.module.css';

/**
 * One Scribe tab: two texts compared, a folder searched, a file too large
 * for the editor shown a page at a time, a file's text when the tab has
 * one, else a new text that has no file yet. Whatever it shows,
 * files dropped on the window open as new texts.
 */
export function ScribeView({ host }: AppViewProps) {
  const t = useTranslation();
  const dropped = useDroppedFiles(host);
  return (
    <div className={styles.tab}>
      {host.params.compare ? (
        <CompareView host={host} compareKey={host.params.compare} />
      ) : host.params.folderSearch ? (
        <FolderSearchView host={host} />
      ) : host.params.large ? (
        <LargeFileView host={host} path={host.params.large} />
      ) : (
        <EditorView host={host} path={host.params.path} untitled={host.params.untitled} whole={host.params.whole === '1'} tool={host.params.tool} />
      )}
      {dropped.over && (
        <div className={styles.dropHint} aria-hidden="true">
          <Icon name="file-arrow-down" size={28} />
          {t('scribe.drop.hint')}
        </div>
      )}
      {dropped.skipped > 0 && (
        <div className={styles.dropProblem} role="alert">
          <Icon name="triangle-exclamation" size={16} />
          <span>{t('scribe.drop.skipped', { count: dropped.skipped })}</span>
          <IconButton variant="ghost" aria-label={t('scribe.said.dismiss')} tooltipSide="bottom-end" onClick={dropped.forget}>
            <Icon name="xmark" size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
