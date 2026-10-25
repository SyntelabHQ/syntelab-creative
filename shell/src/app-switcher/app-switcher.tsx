import { useTranslation } from '@syntelab/i18n';
import { Button, Icon, tooltip, useDismiss } from '@syntelab/ui-kit';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { BrandLogo, Wordmark } from '../brand';
import { commandRegistry, CommandSearch } from '../commands';
import { UpdateStatus } from '../updates';
import { AppGrid } from './app-grid';
import styles from './app-switcher.module.css';
import { DonationBanner } from './donation-banner';

/**
 * The Syntelab logo at the top of the bar on the side, which opens the list of apps: each app has a window of its
 * own, and choosing one opens it, or brings its window to the front when it is open. The search, the program's
 * version and About are there too.
 */
export function AppSwitcher({ iconSize }: { readonly iconSize: number }) {
  const t = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDismiss(containerRef, open, close);

  // Escape closes the list wherever the focus is in it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, close]);

  const name = t('shell.switcher.open');
  return (
    <div ref={containerRef} className={styles.switcher}>
      <button
        type="button"
        className={styles.logo}
        aria-label={name}
        {...(open ? {} : tooltip(name, 'end'))}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((shown) => !shown)}
      >
        <BrandLogo size={iconSize + 10} />
      </button>
      {open && (
        <div id={panelId} role="dialog" aria-label={t('shell.switcher.title')} className={styles.panel}>
          <header className={styles.header}>
            <BrandLogo size={32} />
            <div className={styles.title}>
              <Wordmark size="small" />
            </div>
            <CommandSearch />
          </header>
          <AppGrid onOpened={close} />
          <DonationBanner />
          <footer className={styles.footer}>
            <UpdateStatus />
            <Button
              variant="ghost"
              onClick={() => {
                close();
                void commandRegistry.execute('shell.about');
              }}
            >
              <Icon name="circle-info" size={14} />
              {t('shell.help.aboutProgram')}
            </Button>
          </footer>
        </div>
      )}
    </div>
  );
}
