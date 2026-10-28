import { useTranslation } from '@syntelab/i18n';
import { Icon, tooltip } from '@syntelab/ui-kit';
import styles from './search-button.module.css';
import { openPalette } from './search-palette';
import { shortcutText } from './shortcuts';

export interface SearchButtonProps {
  /** With little room only its icon is shown. */
  readonly folded: boolean;
}

/** The search on top of the window: it looks like a field, and opens the search window. */
export function SearchButton({ folded }: SearchButtonProps) {
  const t = useTranslation();
  const label = t('shell.search.placeholder');
  return (
    <button type="button" className={styles.button} data-folded={folded} aria-label={label} aria-haspopup="dialog" {...(folded ? tooltip(label, 'bottom') : {})} onClick={openPalette}>
      <Icon name="magnifying-glass" size={16} />
      {!folded && (
        <>
          <span className={styles.text}>{label}</span>
          <kbd className={styles.keys}>{shortcutText('Mod+K')}</kbd>
        </>
      )}
    </button>
  );
}
