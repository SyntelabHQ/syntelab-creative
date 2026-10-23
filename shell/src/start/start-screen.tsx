import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, IconButton } from '@syntelab/ui-kit';
import { BrandLogo, Wordmark } from '../brand';
import { commandRegistry, CommandSearch } from '../commands';
import { LanguagePicker, updatePreferences } from '../preferences';
import { UpdateStatus } from '../updates';
import { AppGrid } from './app-grid';
import { DonationBanner } from './donation-banner';
import styles from './start-screen.module.css';

function toggleTheme(): void {
  const shownDark = document.documentElement.dataset.theme === 'dark';
  updatePreferences({ theme: shownDark ? 'light' : 'dark' });
}

export function StartScreen() {
  const t = useTranslation();

  return (
    <div className={styles.screen}>
      <div className={styles.content}>
        <header className={styles.header}>
          <BrandLogo size={40} />
          <div className={styles.title}>
            <Wordmark size="small" />
          </div>
          <CommandSearch />
          <LanguagePicker compact />
          <IconButton aria-label={t('shell.theme.toggle')} tooltipSide="bottom-end" onClick={toggleTheme}>
            <Icon name="moon" />
          </IconButton>
        </header>
        <AppGrid />
      </div>
      <DonationBanner />
      <footer className={styles.footer}>
        <UpdateStatus />
        <Button variant="ghost" onClick={() => void commandRegistry.execute('shell.about')}>
          <Icon name="circle-info" size={14} />
          {t('shell.help.aboutProgram')}
        </Button>
      </footer>
    </div>
  );
}
