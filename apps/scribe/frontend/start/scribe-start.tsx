import { useTranslation } from '@syntelab/i18n';
import type { AppHost } from '@syntelab/shell-api';
import { Button, Icon } from '@syntelab/ui-kit';
import { RecentTexts } from '../document/recent-texts-list';
import styles from './scribe-start.module.css';

/** What Scribe is opened for most: each leads straight to the tool, with an empty text ready for it. */
export const START_CHOICES = [
  { id: 'count', icon: 'ruler' },
  { id: 'replace', icon: 'magnifying-glass' },
  { id: 'duplicates', icon: 'clone' },
  { id: 'compare', icon: 'code-compare' },
  { id: 'sort', icon: 'arrows-up-down' },
  { id: 'reverse', icon: 'right-left' },
  { id: 'filler', icon: 'pen-to-square' },
  { id: 'random', icon: 'keyboard' },
] as const;
export type StartChoice = (typeof START_CHOICES)[number]['id'];

export interface ScribeStartProps {
  readonly host: Pick<AppHost, 'loadData' | 'saveData'>;
  /** One of the things to do was chosen. */
  readonly onChoose: (choice: StartChoice) => void;
  /** An empty text, with nothing chosen. */
  readonly onNewText: () => void;
  readonly onOpen: () => void;
  readonly onFindInFolder: () => void;
  readonly onRecipes: () => void;
  readonly onOpenRecent: (path: string) => void;
}

/**
 * What Scribe shows when it is opened: not an empty page, but what can be
 * done, to be chosen. Each choice opens the text with the tool for it
 * beside; the texts opened lately are a click away.
 */
export function ScribeStart({ host, onChoose, onNewText, onOpen, onFindInFolder, onRecipes, onOpenRecent }: ScribeStartProps) {
  const t = useTranslation();
  return (
    <div className={styles.start}>
      <div className={styles.inner}>
        <h1 className={styles.title}>{t('scribe.start.title')}</h1>
        <p className={styles.lead}>{t('scribe.start.lead')}</p>
        <ul className={styles.choices}>
          {START_CHOICES.map((choice) => (
            <li key={choice.id}>
              <button type="button" className={styles.choice} onClick={() => onChoose(choice.id)}>
                <span className={styles.icon}>
                  <Icon name={choice.icon} size={20} />
                </span>
                <span className={styles.texts}>
                  <span className={styles.name}>{t(`scribe.start.${choice.id}`)}</span>
                  <span className={styles.about}>{t(`scribe.start.${choice.id}About`)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
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
          <Button onClick={onRecipes}>
            <Icon name="list-check" size={14} />
            {t('scribe.command.recipes')}
          </Button>
        </div>
        <p className={styles.drop}>{t('scribe.start.drop')}</p>
        <RecentTexts host={host} onOpen={onOpenRecent} />
      </div>
    </div>
  );
}
