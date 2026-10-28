import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon, ToolCards } from '@syntelab/ui-kit';
import { RecentTexts } from '../document/recent-texts-list';
import styles from './scribe-start.module.css';

export interface ScribeStartProps {
  readonly host: Pick<AppHost, 'loadData' | 'saveData' | 'tools'>;
  /** A tool was chosen (the key of its menu). */
  readonly onChoose: (menuKey: string) => void;
  /** An empty text, with nothing chosen. */
  readonly onNewText: () => void;
  readonly onOpen: () => void;
  readonly onFindInFolder: () => void;
  readonly onOpenRecent: (path: string) => void;
}

/**
 * What Scribe shows when it is opened: not an empty page, but the tools, to
 * be chosen, as in the list on the side. Each opens an empty text with its
 * bar above it; the texts opened lately are a click away.
 */
export function ScribeStart({ host, onChoose, onNewText, onOpen, onFindInFolder, onOpenRecent }: ScribeStartProps) {
  const t = useTranslation();
  return (
    <div className={styles.start}>
      <div className={styles.inner}>
        <div className={styles.hero}>
          <div className={styles.heroText}>
            <h1 className={styles.title}>{t('scribe.start.title')}</h1>
            <p className={styles.lead}>{t('scribe.start.lead')}</p>
          </div>
          <div className={styles.also}>
            <Button variant="primary" onClick={onNewText}>
              <Icon name="file-circle-plus" size={14} />
              {t('scribe.start.newText')}
            </Button>
            <Button onClick={onOpen}>
              <Icon name="folder-open" size={14} />
              {t('scribe.command.open')}
            </Button>
            <Button onClick={onFindInFolder}>
              <Icon name="folder-tree" size={14} />
              {t('scribe.command.findInFolder')}
            </Button>
          </div>
        </div>
        <ToolCards
          title={t('scribe.start.tools')}
          cards={host.tools.map((tool) => ({
            id: tool.menuKey,
            name: t(tool.menuKey),
            description: tool.hintKey ? t(tool.hintKey) : undefined,
            icon: tool.icon,
            color: tool.color,
            onChoose: () => onChoose(tool.menuKey),
          }))}
        />
        <RecentTexts host={host} onOpen={onOpenRecent} />
        <p className={styles.drop}>{t('scribe.start.drop')}</p>
      </div>
    </div>
  );
}
